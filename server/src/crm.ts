import { Hono } from "hono";
import { setSignedCookie } from "hono/cookie";
import type Stripe from "stripe";
import { createHash, randomInt, type KeyObject } from "node:crypto";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { Repo, EntStatus } from "./db.js";
import { randomToken, sha256, signEntitlement } from "./tokens.js";
import { periodEnd } from "./stripe.js";
import { sendSubscriptionEmail, verifySmtp } from "./email.js";

export interface CrmRouterDeps {
  repo: Repo;
  signingKey?: KeyObject;
  stripe: Stripe | null;
  config: {
    publicUrl: string;
    pastDueGraceDays: number;
    tokenTtlHours: number;
    trialDays: number;
    maxDevicesPc?: number;
    maxDevicesMobile?: number;
    sessionSecret?: string;
    /** Enables host-mutating dev helpers (make-me-paid, seed-demo, activate_local_app). Never in production. */
    devEndpoints?: boolean;
  };
  now?: () => number;
}

let cachedDeviceId: string | null = null;

export function getLocalWindowsDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  if (process.platform === "win32") {
    try {
      const out = execSync('powershell -Command "(Get-ItemProperty -Path HKLM:\\SOFTWARE\\Microsoft\\Cryptography -Name MachineGuid).MachineGuid"', {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
        timeout: 4000,
      }).trim();
      if (out) {
        cachedDeviceId = createHash("sha256").update(out + "sweepr-device-v1").digest("hex");
        return cachedDeviceId;
      }
    } catch {}
  }
  cachedDeviceId = "3e7e8c84f19b05f7425c71586037803c7de15612d966fa13d0444220bbc6e2d3";
  return cachedDeviceId;
}

export function activateLocalSweepr(
  account: { account_id: string; refresh_token: string },
  signingKey?: KeyObject,
  plan = "lifetime",
  periodEnd?: number
) {
  const userProfile = process.env.USERPROFILE || process.env.HOME || "";
  const paths = [
    join(userProfile, "AppData", "Roaming", "com.sweepr.app"),
    join(userProfile, "AppData", "Roaming", "sweepr"),
  ];
  const results: string[] = [];
  const deviceId = getLocalWindowsDeviceId();

  for (const dir of paths) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "account.json"), JSON.stringify(account, null, 2), "utf8");

      if (signingKey) {
        const exp = periodEnd || Math.floor(Date.now() / 1000) + 36500 * 86400;
        const jws = signEntitlement(signingKey, {
          sub: account.account_id,
          device_id: deviceId,
          status: "active",
          plan,
          iat: Math.floor(Date.now() / 1000),
          exp,
        });
        writeFileSync(join(dir, "entitlement.jws"), jws, "utf8");
      }
      results.push(dir);
    } catch (e: any) {
      console.warn(`[crm] failed activating in ${dir}:`, e.message);
    }
  }
  return { activated: results.length > 0, directories: results, deviceId };
}

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : v?.id ?? null);

export function createCrmRouter(deps: CrmRouterDeps) {
  const { repo, signingKey, stripe, config } = deps;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const router = new Hono();

  // 1. High-level CRM KPIs & Revenue Analytics
  router.get("/stats", (c) => {
    const stats = repo.getCrmStats();
    return c.json(stats);
  });

  // 1b. Crash Reports, Funnel Analytics & Support Tickets Telemetry
  router.get("/telemetry", (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit") || 50), 1), 200);
    const summary = repo.getTelemetrySummary(limit);
    const tickets = repo.listSupportTickets(25);
    return c.json({
      ...summary,
      tickets,
      support_tickets: tickets,
    });
  });

  // 2. Customer List with Search, Filter & Pagination
  router.get("/customers", (c) => {
    const search = c.req.query("search") || undefined;
    const status = c.req.query("status") || undefined;
    const stage = c.req.query("stage") || undefined;
    const limit = Math.min(Number(c.req.query("limit") || 50), 100);
    const offset = Math.max(Number(c.req.query("offset") || 0), 0);

    const result = repo.listCustomers({ search, status, stage, limit, offset });
    return c.json(result);
  });

  // 3. Customer 360 Profile
  router.get("/customers/:id", (c) => {
    const id = c.req.param("id");
    const customer = repo.getCustomer360(id);
    if (!customer) return c.json({ error: "Customer not found" }, 404);
    return c.json(customer);
  });

  // 4. Update Customer Profile
  router.patch("/customers/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const customer = repo.accountById(id);
    if (!customer) return c.json({ error: "Customer not found" }, 404);

    repo.updateAccountProfile(id, {
      name: body.name,
      email: body.email,
      notes: body.notes,
      health_score: body.health_score !== undefined ? Number(body.health_score) : undefined,
      lifecycle_stage: body.lifecycle_stage,
    });

    return c.json({ ok: true, customer: repo.getCustomer360(id) });
  });

  // 5. Add Customer Note
  router.post("/customers/:id/notes", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    if (!body.content || typeof body.content !== "string") {
      return c.json({ error: "Note content is required" }, 400);
    }
    const customer = repo.accountById(id);
    if (!customer) return c.json({ error: "Customer not found" }, 404);

    const author = body.author || "Admin";
    const note = repo.addNote(id, author, body.content.trim());
    return c.json({ ok: true, note });
  });

  // 6. Grant or Extend Subscription/Trial Manually
  router.post("/customers/:id/grant", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const customer = repo.accountById(id);
    if (!customer) return c.json({ error: "Customer not found" }, 404);

    const status: EntStatus = body.status === "active" ? "active" : "trialing";
    const plan = body.plan || "monthly";
    const days = Number(body.days || 30);
    const periodEnd = now() + days * 86400;
    const amount_cents = body.amount_cents !== undefined ? Number(body.amount_cents) : (plan === "annual" ? 9900 : plan === "lifetime" ? 19900 : 999);
    const currency = (body.currency || "usd").toLowerCase();
    const interval = plan === "annual" ? "year" : plan === "lifetime" ? "lifetime" : "month";

    const subId = `sub_${randomToken(8)}`;
    repo.upsertEntitlement({
      account_id: id,
      stripe_subscription_id: subId,
      status,
      plan,
      current_period_end: periodEnd,
      cancel_at_period_end: 0,
    });

    repo.upsertSubscription({
      id: subId,
      account_id: id,
      stripe_subscription_id: null,
      status,
      plan,
      amount_cents,
      currency,
      billing_interval: interval,
      current_period_start: now(),
      current_period_end: periodEnd,
      cancel_at_period_end: 0,
      canceled_at: null,
      trial_start: status === "trialing" ? now() : null,
      trial_end: status === "trialing" ? periodEnd : null,
    });

    if (status === "active" && amount_cents > 0) {
      repo.upsertInvoice({
        id: `in_${randomToken(8)}`,
        account_id: id,
        stripe_invoice_id: null,
        amount_cents,
        amount_paid_cents: amount_cents,
        currency,
        status: "paid",
        due_date: now(),
        paid_at: now(),
        hosted_invoice_url: null,
        pdf_url: null,
        created_at: now(),
      });
    }

    repo.addActivity({
      account_id: id,
      type: "manual_grant",
      title: "Manual Subscription Grant",
      description: `Granted ${status} (${plan}) access for ${days} days`,
      actor: "admin",
      metadata: { days, plan, status, periodEnd, amount_cents },
    });

    if (customer.email && status === "active") {
      const activationKey = randomInt(100000, 1000000).toString();
      repo.setOtp(customer.email.trim().toLowerCase(), sha256(activationKey), now() + 7 * 86400);
      sendSubscriptionEmail(customer.email, "activated", plan, customer.name || undefined, activationKey).catch(console.error);
    }

    return c.json({ ok: true, customer: repo.getCustomer360(id) });
  });

  // 6b. Create New Paid Subscription / Customer
  router.post("/subscriptions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email = (body.email || "").trim().toLowerCase();
    if (!email) return c.json({ error: "Email is required" }, 400);

    const name = (body.name || email.split("@")[0] || "Customer").trim();
    const plan = body.plan || "annual"; // monthly | annual | lifetime
    const status: EntStatus = body.status === "trialing" ? "trialing" : "active";
    const currency = (body.currency || "usd").toLowerCase();

    let defaultAmount = 9900;
    let defaultDays = 365;
    let interval = "year";
    if (plan === "monthly") {
      defaultAmount = 999;
      defaultDays = 30;
      interval = "month";
    } else if (plan === "lifetime") {
      defaultAmount = 19900;
      defaultDays = 36500;
      interval = "lifetime";
    }

    const amount_cents = body.amount_cents !== undefined ? Number(body.amount_cents) : defaultAmount;
    const days = Number(body.days || defaultDays);
    const periodEnd = now() + days * 86400;

    // Check if account already exists with this email
    let acc = repo.accountByEmail(email);
    let refreshToken = "";
    let accountId = "";

    if (acc) {
      accountId = acc.id;
    } else {
      accountId = `acc_${randomToken(10)}`;
      refreshToken = randomToken(32);
      repo.createAccount(accountId, sha256(refreshToken), email);
    }

    repo.updateAccountProfile(accountId, {
      name,
      email,
      notes: body.notes || `Created via CRM as ${status} ${plan} subscription`,
      health_score: 100,
      lifecycle_stage: status === "active" ? "customer" : "trial",
    });

    const subId = `sub_${randomToken(10)}`;
    repo.upsertEntitlement({
      account_id: accountId,
      stripe_subscription_id: subId,
      status,
      plan,
      current_period_end: periodEnd,
      cancel_at_period_end: 0,
    });

    repo.upsertSubscription({
      id: subId,
      account_id: accountId,
      stripe_subscription_id: null,
      status,
      plan,
      amount_cents,
      currency,
      billing_interval: interval,
      current_period_start: now(),
      current_period_end: periodEnd,
      cancel_at_period_end: 0,
      canceled_at: null,
      trial_start: status === "trialing" ? now() : null,
      trial_end: status === "trialing" ? periodEnd : null,
    });

    if (status === "active" && amount_cents > 0) {
      const invId = `in_${randomToken(10)}`;
      repo.upsertInvoice({
        id: invId,
        account_id: accountId,
        stripe_invoice_id: null,
        amount_cents,
        amount_paid_cents: amount_cents,
        currency,
        status: "paid",
        due_date: now(),
        paid_at: now(),
        hosted_invoice_url: null,
        pdf_url: null,
        created_at: now(),
      });
    }

    repo.addActivity({
      account_id: accountId,
      type: "subscription_created",
      title: "Paid Subscription Created",
      description: `Created ${status} ${plan} subscription (${currency.toUpperCase()} ${(amount_cents / 100).toFixed(2)}) for ${name}`,
      actor: "admin",
      metadata: { plan, status, amount_cents, days, periodEnd },
    });

    // Device connection
    if (body.device_id) {
      repo.touchDevice(accountId, body.device_id, "pc", deps.config.maxDevicesPc || 3, deps.config.maxDevicesMobile || 2);
    }

    let localActivation = null;
    if (body.activate_local_app && config.devEndpoints) {
      const localDeviceId = getLocalWindowsDeviceId();
      repo.touchDevice(accountId, localDeviceId, "pc", deps.config.maxDevicesPc || 3, deps.config.maxDevicesMobile || 2);
      if (refreshToken) {
        localActivation = activateLocalSweepr(
          { account_id: accountId, refresh_token: refreshToken },
          signingKey,
          plan,
          periodEnd
        );
      }
    }

    if (email && status === "active") {
      const activationKey = randomInt(100000, 1000000).toString();
      repo.setOtp(email.trim().toLowerCase(), sha256(activationKey), now() + 7 * 86400);
      sendSubscriptionEmail(email, "activated", plan, name, activationKey).catch(console.error);
    }

    return c.json({
      ok: true,
      account_id: accountId,
      refresh_token: refreshToken || undefined,
      customer: repo.getCustomer360(accountId),
      local_activated: localActivation?.activated ?? false,
      message: `Successfully created ${status} ${plan} subscription for ${name}`,
    });
  });

  // 6c. One-Click Make Myself a Paid User (Instant Machine Unlock)
  router.post("/make-me-paid", async (c) => {
    if (!config.devEndpoints) return c.json({ error: "disabled: dev endpoints only" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const email = (body.email || "benjamin@sweepr.local").trim();
    const name = (body.name || "Benjamin").trim();
    const plan = body.plan || "lifetime";
    const days = Number(body.days || 36500); // 100 years
    const amount_cents = body.amount_cents !== undefined ? Number(body.amount_cents) : 19900;
    const currency = (body.currency || "usd").toLowerCase();
    const periodEnd = now() + days * 86400;

    // 1. Get or compute local device ID
    const localDeviceId = getLocalWindowsDeviceId();

    // 2. Check if local account.json already exists in AppData
    const userProfile = process.env.USERPROFILE || process.env.HOME || "";
    const roamingSweeprDir = join(userProfile, "AppData", "Roaming", "com.sweepr.app");
    const existingAccFile = join(roamingSweeprDir, "account.json");
    let existingData: { account_id?: string; refresh_token?: string } | null = null;
    if (existsSync(existingAccFile)) {
      try {
        existingData = JSON.parse(readFileSync(existingAccFile, "utf8"));
      } catch {}
    }

    let accountId = existingData?.account_id;
    let refreshToken = existingData?.refresh_token;

    if (!accountId || !refreshToken) {
      const existingByEmail = repo.accountByEmail(email);
      if (existingByEmail) {
        accountId = existingByEmail.id;
        refreshToken = randomToken(32);
        repo.db.prepare("UPDATE accounts SET refresh_token_hash = ?, updated_at = ? WHERE id = ?")
          .run(sha256(refreshToken), now(), accountId);
      } else {
        accountId = `acc_benjamin_${randomToken(6)}`;
        refreshToken = randomToken(32);
        repo.createAccount(accountId, sha256(refreshToken), email);
      }
    } else {
      if (!repo.accountById(accountId)) {
        repo.createAccount(accountId, sha256(refreshToken), email);
      }
    }

    // 3. Register device
    repo.touchDevice(accountId, localDeviceId, "pc", deps.config.maxDevicesPc || 3, deps.config.maxDevicesMobile || 2);

    // 4. Update profile
    repo.updateAccountProfile(accountId, {
      name,
      email,
      notes: `Owner & Admin Account (${plan.toUpperCase()} VIP)`,
      health_score: 100,
      lifecycle_stage: "customer",
    });

    // 5. Upsert active entitlement
    const subId = `sub_${accountId}`;
    repo.upsertEntitlement({
      account_id: accountId,
      stripe_subscription_id: subId,
      status: "active",
      plan,
      current_period_end: periodEnd,
      cancel_at_period_end: 0,
    });

    // 6. Upsert subscription
    repo.upsertSubscription({
      id: subId,
      account_id: accountId,
      stripe_subscription_id: subId,
      status: "active",
      plan,
      amount_cents,
      currency,
      billing_interval: plan === "lifetime" ? "lifetime" : "year",
      current_period_start: now(),
      current_period_end: periodEnd,
      cancel_at_period_end: 0,
      canceled_at: null,
      trial_start: null,
      trial_end: null,
    });

    // 7. Upsert paid invoice
    repo.upsertInvoice({
      id: `in_${accountId}`,
      account_id: accountId,
      stripe_invoice_id: null,
      amount_cents,
      amount_paid_cents: amount_cents,
      currency,
      status: "paid",
      due_date: now(),
      paid_at: now(),
      hosted_invoice_url: null,
      pdf_url: null,
      created_at: now(),
    });

    // 8. Log activity
    repo.addActivity({
      account_id: accountId,
      type: "owner_activated",
      title: "VIP Account Activated",
      description: `Activated ${name} (${email}) as ${plan.toUpperCase()} paid user on device ${localDeviceId.slice(0, 8)}...`,
      actor: "admin",
    });

    // 9. Write account.json and signed entitlement.jws to AppData
    const localAct = activateLocalSweepr(
      { account_id: accountId, refresh_token: refreshToken },
      signingKey,
      plan,
      periodEnd
    );

    if (email) {
      const activationKey = randomInt(100000, 1000000).toString();
      repo.setOtp(email.trim().toLowerCase(), sha256(activationKey), now() + 7 * 86400);
      sendSubscriptionEmail(email, "activated", plan, name, activationKey).catch(console.error);
    }

    return c.json({
      ok: true,
      account_id: accountId,
      refresh_token: refreshToken,
      device_id: localDeviceId,
      plan,
      status: "active",
      expires_at: periodEnd,
      local_activated: localAct.activated,
      directories: localAct.directories,
      customer: repo.getCustomer360(accountId),
      message: `Congratulations! ${name} is now a paid ${plan.toUpperCase()} user! Local machine was automatically activated.`,
    });
  });

  // 7. Cancel Subscription
  router.post("/customers/:id/cancel", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const customer = repo.accountById(id);
    if (!customer) return c.json({ error: "Customer not found" }, 404);

    const ent = repo.entitlement(id);
    const immediate = Boolean(body.immediate);

    if (ent?.stripe_subscription_id && stripe) {
      try {
        if (immediate) {
          await stripe.subscriptions.cancel(ent.stripe_subscription_id);
        } else {
          await stripe.subscriptions.update(ent.stripe_subscription_id, {
            cancel_at_period_end: true,
          });
        }
      } catch (err: any) {
        console.error("[crm] stripe cancel error:", err);
      }
    }

    if (immediate) {
      repo.setStatus(id, "canceled");
    } else if (ent) {
      repo.upsertEntitlement({
        ...ent,
        cancel_at_period_end: 1,
      });
    }

    repo.addActivity({
      account_id: id,
      type: "subscription_canceled",
      title: "Subscription Canceled",
      description: immediate ? "Canceled immediately by admin" : "Scheduled to cancel at period end",
      actor: "admin",
    });

    if (customer.email) {
      const planName = ent?.plan || "subscription";
      sendSubscriptionEmail(customer.email, "canceled", planName, customer.name || undefined).catch(console.error);
    }

    return c.json({ ok: true, customer: repo.getCustomer360(id) });
  });

  // 8. Pause Subscription
  router.post("/customers/:id/pause", async (c) => {
    const id = c.req.param("id");
    const customer = repo.accountById(id);
    if (!customer) return c.json({ error: "Customer not found" }, 404);

    const ent = repo.entitlement(id);
    if (ent?.stripe_subscription_id && stripe) {
      try {
        await stripe.subscriptions.update(ent.stripe_subscription_id, {
          pause_collection: { behavior: "void" },
        });
      } catch (err: any) {
        console.error("[crm] stripe pause error:", err);
      }
    }

    repo.setStatus(id, "paused");
    repo.addActivity({
      account_id: id,
      type: "subscription_paused",
      title: "Subscription Paused",
      description: "Subscription collection paused by admin",
      actor: "admin",
    });

    return c.json({ ok: true, customer: repo.getCustomer360(id) });
  });

  // 9. Resume Subscription
  router.post("/customers/:id/resume", async (c) => {
    const id = c.req.param("id");
    const customer = repo.accountById(id);
    if (!customer) return c.json({ error: "Customer not found" }, 404);

    const ent = repo.entitlement(id);
    if (ent?.stripe_subscription_id && stripe) {
      try {
        await stripe.subscriptions.update(ent.stripe_subscription_id, {
          pause_collection: null,
        });
      } catch (err: any) {
        console.error("[crm] stripe resume error:", err);
      }
    }

    repo.setStatus(id, "active");
    repo.addActivity({
      account_id: id,
      type: "subscription_resumed",
      title: "Subscription Resumed",
      description: "Subscription resumed by admin",
      actor: "admin",
    });

    return c.json({ ok: true, customer: repo.getCustomer360(id) });
  });

  // 10. Generate Direct Stripe Portal Link for Customer Support
  router.post("/customers/:id/portal-link", async (c) => {
    const id = c.req.param("id");
    const customer = repo.accountById(id);
    if (!customer) return c.json({ error: "Customer not found" }, 404);
    if (!stripe) return c.json({ error: "Stripe is not configured" }, 503);
    if (!customer.stripe_customer_id) {
      return c.json({ error: "Customer has no associated Stripe customer record" }, 400);
    }

    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customer.stripe_customer_id,
        return_url: `${config.publicUrl}/`,
      });
      repo.addActivity({
        account_id: id,
        type: "portal_link_created",
        title: "Billing Portal Link Generated",
        description: "Generated self-serve billing portal link for customer",
        actor: "admin",
      });
      return c.json({ url: session.url });
    } catch (e: any) {
      return c.json({ error: e.message || "Failed to create portal session" }, 500);
    }
  });

  // 10b. Generate One-Time Login Code (OTP) for customer
  router.post("/customers/:id/otp", async (c) => {
    const id = c.req.param("id");
    const customer = repo.accountById(id);
    if (!customer) return c.json({ error: "Customer not found" }, 404);
    if (!customer.email) return c.json({ error: "Customer has no email address" }, 400);

    const normEmail = customer.email.trim().toLowerCase();
    const code = randomInt(100000, 1000000).toString();
    const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
    repo.setOtp(normEmail, sha256(code), expiresAt);

    const dispatch = await sendSubscriptionEmail(normEmail, "otp", code);
    const emailSent = dispatch.ok;
    const emailStatus = dispatch.ok
      ? `Sent via ${dispatch.provider}${dispatch.id ? ` (id: ${dispatch.id})` : ""}`
      : `Failed (${dispatch.provider}): ${dispatch.error || "Unknown error"}`;

    repo.addActivity({
      account_id: id,
      type: "otp_generated",
      title: "Login Code Generated",
      description: `Generated 6-digit login passcode (${code}) for customer portal — ${emailStatus}`,
      actor: "admin",
      metadata: { code, email: normEmail, dispatch },
    });

    return c.json({
      ok: true,
      code,
      email: normEmail,
      expires_at: expiresAt,
      email_sent: emailSent,
      email_status: emailStatus,
      dispatch,
      message: `Passcode: ${code} (Expires in 15 mins)`,
    });
  });

  // 10c. One-click admin login into customer dashboard
  router.post("/customers/:id/impersonate", async (c) => {
    const id = c.req.param("id");
    const customer = repo.accountById(id);
    if (!customer) return c.json({ error: "Customer not found" }, 404);

    if (deps.config.sessionSecret) {
      const isHttps = /^https:/i.test(deps.config.publicUrl);
      await setSignedCookie(c, "sweepr_session", customer.id, deps.config.sessionSecret, {
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: isHttps,
        maxAge: 86400 * 30,
      });
    }

    return c.json({ ok: true, redirect: "/dashboard" });
  });

  // 10d. Test / diagnose SMTP Gmail configuration
  router.get("/smtp-status", async (c) => {
    const status = await verifySmtp();
    return c.json(status);
  });

  // 11. Revoke / Restore Device
  router.post("/customers/:id/devices/:deviceId/revoke", (c) => {
    const id = c.req.param("id");
    const deviceId = c.req.param("deviceId");
    repo.revokeDevice(id, deviceId);
    return c.json({ ok: true, customer: repo.getCustomer360(id) });
  });

  router.post("/customers/:id/devices/:deviceId/restore", (c) => {
    const id = c.req.param("id");
    const deviceId = c.req.param("deviceId");
    repo.restoreDevice(id, deviceId);
    return c.json({ ok: true, customer: repo.getCustomer360(id) });
  });

  // 12. Global Activity Stream
  router.get("/activities", (c) => {
    const limit = Math.min(Number(c.req.query("limit") || 50), 100);
    const activities = repo.getActivities(undefined, limit);
    return c.json({ activities });
  });

  // 13. Synchronize Live Data with Stripe
  router.post("/sync-stripe", async (c) => {
    if (!stripe) {
      return c.json({ error: "Stripe secret key not configured" }, 503);
    }

    let syncedCustomers = 0;
    let syncedSubscriptions = 0;
    let syncedInvoices = 0;

    try {
      // 1. Sync Customers
      const stripeCustomers = await stripe.customers.list({ limit: 100 });
      for (const sc of stripeCustomers.data) {
        if (sc.deleted) continue;
        let acc = repo.accountByCustomer(sc.id);
        if (!acc && sc.email) {
          const byEmail = repo.accountByEmail(sc.email);
          // Only attach to an email-matched account if it isn't already bound to a different Stripe customer.
          if (byEmail && (!byEmail.stripe_customer_id || byEmail.stripe_customer_id === sc.id)) {
            acc = byEmail;
          }
        }
        if (!acc) {
          const newId = `acc_${randomToken(12)}`;
          const token = randomToken(32);
          repo.createAccount(newId, sha256(token), sc.email || undefined);
          repo.setCustomer(newId, sc.id, sc.email || undefined);
          if (sc.name) repo.updateAccountProfile(newId, { name: sc.name });
          acc = repo.accountById(newId);
          syncedCustomers++;
        } else {
          repo.setCustomer(acc.id, sc.id, sc.email || undefined);
          if (sc.name && !acc.name) repo.updateAccountProfile(acc.id, { name: sc.name });
          syncedCustomers++;
        }
      }

      // 2. Sync Subscriptions
      const stripeSubs = await stripe.subscriptions.list({ limit: 100, status: "all" });
      for (const sub of stripeSubs.data) {
        const custId = idOf(sub.customer as any);
        const acc = custId ? repo.accountByCustomer(custId) : undefined;
        if (!acc) continue;

        const subPeriodEnd = periodEnd(sub);
        const price = sub.items?.data?.[0]?.price;
        const amountCents = price?.unit_amount ?? 999;
        const interval = price?.recurring?.interval ?? "month";

        repo.upsertEntitlement({
          account_id: acc.id,
          stripe_subscription_id: sub.id,
          status: sub.status as EntStatus,
          plan: interval === "year" ? "annual" : "monthly",
          current_period_end: subPeriodEnd,
          cancel_at_period_end: sub.cancel_at_period_end ? 1 : 0,
        });

        repo.upsertSubscription({
          id: sub.id,
          account_id: acc.id,
          stripe_subscription_id: sub.id,
          status: sub.status as EntStatus,
          plan: interval === "year" ? "annual" : "monthly",
          amount_cents: amountCents,
          currency: sub.currency || "usd",
          billing_interval: interval,
          current_period_start: (sub as any).current_period_start ?? null,
          current_period_end: subPeriodEnd,
          cancel_at_period_end: sub.cancel_at_period_end ? 1 : 0,
          canceled_at: sub.canceled_at ?? null,
          trial_start: sub.trial_start ?? null,
          trial_end: sub.trial_end ?? null,
        });
        syncedSubscriptions++;
      }

      // 3. Sync Invoices
      const stripeInvoices = await stripe.invoices.list({ limit: 100 });
      for (const inv of stripeInvoices.data) {
        const custId = idOf(inv.customer as any);
        const acc = custId ? repo.accountByCustomer(custId) : undefined;
        if (!acc) continue;

        repo.upsertInvoice({
          id: inv.id,
          account_id: acc.id,
          stripe_invoice_id: inv.id,
          amount_cents: inv.total,
          amount_paid_cents: inv.amount_paid,
          currency: inv.currency,
          status: inv.status || "open",
          due_date: inv.due_date ?? null,
          paid_at: (inv as any).status_transitions?.paid_at ?? null,
          hosted_invoice_url: inv.hosted_invoice_url ?? null,
          pdf_url: inv.invoice_pdf ?? null,
          created_at: inv.created,
        });
        syncedInvoices++;
      }

      return c.json({
        ok: true,
        synced: {
          customers: syncedCustomers,
          subscriptions: syncedSubscriptions,
          invoices: syncedInvoices,
        },
      });
    } catch (e: any) {
      console.error("[crm] stripe sync error:", e);
      return c.json({ error: e.message || "Stripe sync failed" }, 500);
    }
  });

  // 14. Seed Demo CRM Data for testing/showcasing
  router.post("/seed-demo", (c) => {
    if (!config.devEndpoints) return c.json({ error: "disabled: dev endpoints only" }, 404);
    const t = now();
    const demoAccounts = [
      {
        id: "acc_demo_enterprise",
        email: "sarah.connor@cyberdyne.io",
        name: "Sarah Connor (Cyberdyne Systems)",
        status: "active" as EntStatus,
        plan: "annual",
        amount_cents: 9900,
        billing_interval: "year",
        stage: "customer",
        health: 98,
        spend: 19800,
        devices: ["c8f2a91b402e8d7120a45f91e0a293c4b1239857d4e321a0f9b8c7d6e5f4a3b2", "d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2"],
        notes: "Key enterprise account. Requested automated seat billing for upcoming quarter.",
      },
      {
        id: "acc_demo_pro",
        email: "alex.morgan@acme-corp.com",
        name: "Alex Morgan (Acme Corp)",
        status: "active" as EntStatus,
        plan: "monthly",
        amount_cents: 999,
        billing_interval: "month",
        stage: "customer",
        health: 85,
        spend: 2997,
        devices: ["f0e1d2c3b4a5968778695a4b3c2d1e0f0e1d2c3b4a5968778695a4b3c2d1e0f"],
        notes: "Power user. Upgraded from trial after day 3.",
      },
      {
        id: "acc_demo_trial",
        email: "david.beck@startup.tech",
        name: "David Beck",
        status: "trialing" as EntStatus,
        plan: "monthly",
        amount_cents: 999,
        billing_interval: "month",
        stage: "trial",
        health: 92,
        spend: 150,
        devices: ["7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b"],
        notes: "Trial started via web-checkout. Follow up scheduled on Day 5.",
      },
      {
        id: "acc_demo_past_due",
        email: "billing@globex-corp.com",
        name: "Marcus Vance (Globex)",
        status: "past_due" as EntStatus,
        plan: "monthly",
        amount_cents: 999,
        billing_interval: "month",
        stage: "past_due",
        health: 35,
        spend: 1998,
        devices: ["1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"],
        notes: "Card expired on last renewal cycle. Dunning email step 2 sent.",
      },
      {
        id: "acc_demo_churned",
        email: "elena.rostova@designworks.co",
        name: "Elena Rostova",
        status: "canceled" as EntStatus,
        plan: "monthly",
        amount_cents: 999,
        billing_interval: "month",
        stage: "churned",
        health: 15,
        spend: 999,
        devices: [],
        notes: "Canceled due to company downsizing.",
      },
    ];

    for (const demo of demoAccounts) {
      if (!repo.accountById(demo.id)) {
        repo.createAccount(demo.id, sha256(`token_${demo.id}`), demo.email);
      }
      repo.setCustomer(demo.id, `cus_${demo.id.slice(4)}`, demo.email);
      repo.updateAccountProfile(demo.id, {
        name: demo.name,
        email: demo.email,
        notes: demo.notes,
        health_score: demo.health,
        lifecycle_stage: demo.stage,
      });

      repo.upsertEntitlement({
        account_id: demo.id,
        stripe_subscription_id: `sub_${demo.id}`,
        status: demo.status,
        plan: demo.plan,
        current_period_end: demo.status === "active" ? t + 30 * 86400 : demo.status === "past_due" ? t + 2 * 86400 : t + 7 * 86400,
        cancel_at_period_end: demo.status === "canceled" ? 1 : 0,
      });

      repo.upsertSubscription({
        id: `sub_${demo.id}`,
        account_id: demo.id,
        stripe_subscription_id: `sub_${demo.id}`,
        status: demo.status,
        plan: demo.plan,
        amount_cents: demo.amount_cents,
        currency: "usd",
        billing_interval: demo.billing_interval,
        current_period_start: t - 30 * 86400,
        current_period_end: demo.status === "active" ? t + 30 * 86400 : t + 7 * 86400,
        cancel_at_period_end: demo.status === "canceled" ? 1 : 0,
        canceled_at: demo.status === "canceled" ? t : null,
        trial_start: demo.status === "trialing" ? t - 3 * 86400 : null,
        trial_end: demo.status === "trialing" ? t + 4 * 86400 : null,
      });

      for (const dev of demo.devices) {
        repo.touchDevice(demo.id, dev, "pc", deps.config.maxDevicesPc || 3, deps.config.maxDevicesMobile || 2);
      }

      repo.upsertInvoice({
        id: `in_demo_${demo.id}`,
        account_id: demo.id,
        stripe_invoice_id: `in_demo_${demo.id}`,
        amount_cents: demo.amount_cents,
        amount_paid_cents: demo.status === "past_due" ? 0 : demo.amount_cents,
        currency: "usd",
        status: demo.status === "past_due" ? "open" : "paid",
        due_date: t + 7 * 86400,
        paid_at: demo.status === "past_due" ? null : t - 3 * 86400,
        hosted_invoice_url: null,
        pdf_url: null,
        created_at: t - 3 * 86400,
      });

      repo.addNote(demo.id, "System", demo.notes);
    }

    return c.json({ ok: true, message: "Demo CRM data successfully seeded", stats: repo.getCrmStats() });
  });

  // 15. Outreach & Directory Submissions Log
  let outreachSeedChecked = false;
  function ensureOutreachSeeded() {
    if (outreachSeedChecked) return;
    outreachSeedChecked = true;
    try {
      const candidates = [
        join(process.cwd(), "src", "outreach-seed.json"),
        join(process.cwd(), "dist", "outreach-seed.json"),
      ];
      for (const p of candidates) {
        if (existsSync(p)) {
          const data = JSON.parse(readFileSync(p, "utf8"));
          if (Array.isArray(data) && data.length > 0) {
            repo.seedOutreachLogs(data);
          }
          break;
        }
      }
    } catch (e) {
      console.warn("[crm] failed to seed outreach logs:", e);
    }
  }

  router.get("/outreach", (c) => {
    ensureOutreachSeeded();
    const search = c.req.query("search") || undefined;
    const filter = c.req.query("filter") || undefined;
    const limit = Math.min(Number(c.req.query("limit") || 500), 1000);
    const offset = Math.max(Number(c.req.query("offset") || 0), 0);
    return c.json(repo.listOutreachLogs({ search, filter, limit, offset }));
  });

  router.post("/outreach", async (c) => {
    ensureOutreachSeeded();
    const body = await c.req.json().catch(() => ({}));
    if (!body.who || !body.website) {
      return c.json({ error: "Both 'who' (recipient/contact) and 'website' are required" }, 400);
    }
    const item = repo.addOutreachLog({
      who: body.who,
      website: body.website,
      url: body.url,
      how: body.how || "Email (Gmail SMTP)",
      category: body.category || null,
      status: body.status || "delivered",
      message_id: body.message_id || null,
      reached_out_at: body.reached_out_at ? Number(body.reached_out_at) : now(),
    });
    return c.json({ ok: true, item, entry: item });
  });

  router.patch("/outreach/:id", async (c) => {
    ensureOutreachSeeded();
    const id = Number(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid outreach ID" }, 400);
    const body = await c.req.json().catch(() => ({}));
    const updated = repo.updateOutreachLog(id, {
      status: body.status,
      category: body.category,
      who: body.who,
      how: body.how,
    });
    if (!updated) return c.json({ error: "Outreach entry not found" }, 404);
    return c.json({ ok: true, item: updated });
  });

  router.delete("/outreach/:id", (c) => {
    ensureOutreachSeeded();
    const id = Number(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid outreach ID" }, 400);
    const deleted = repo.deleteOutreachLog(id);
    if (!deleted) return c.json({ error: "Outreach entry not found" }, 404);
    return c.json({ ok: true });
  });

  return router;
}

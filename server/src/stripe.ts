import type Stripe from "stripe";
import type { EntStatus, Repo } from "./db.js";
import { syncToCentralCrm } from "./crm-sync.js";

// Stripe moved some fields between API versions (e.g. current_period_end moved
// onto subscription items; invoice.subscription moved under invoice.parent).
// These helpers read both shapes so the server works across SDK versions.

export function periodEnd(sub: any): number | null {
  return sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
}

export function invoiceSubscriptionId(inv: any): string | null {
  const s = inv.subscription ?? inv.parent?.subscription_details?.subscription ?? null;
  return typeof s === "string" ? s : s?.id ?? null;
}

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : v?.id ?? null);

export function syncSubscription(repo: Repo, sub: Stripe.Subscription, accountIdHint?: string | null) {
  const customerId = idOf(sub.customer as any);
  const metaAccountId = typeof sub.metadata?.account_id === "string" ? sub.metadata.account_id.trim() : "";
  const hint = typeof accountIdHint === "string" ? accountIdHint.trim() : "";
  if (metaAccountId && hint && metaAccountId !== hint) {
    throw new Error("account_id mismatch");
  }
  const account =
    (metaAccountId && repo.accountById(metaAccountId)) ||
    (hint && repo.accountById(hint)) ||
    (customerId && repo.accountByCustomer(customerId)) ||
    undefined;
  if (!account) {
    console.warn(`[stripe] no account for subscription ${sub.id}`);
    return;
  }
  if (customerId && !account.stripe_customer_id) repo.setCustomer(account.id, customerId);

  const existingEnt = repo.entitlement(account.id);
  // Never let a later webhook overwrite a dispute-based revocation.
  if (existingEnt?.status === "disputed") return;

  const price = sub.items?.data?.[0]?.price;
  const interval = price?.recurring?.interval ?? "month";
  const intervalCount = price?.recurring?.interval_count ?? 1;
  const currentPeriodEnd = periodEnd(sub);
  const planName = interval === "year" ? "annual" : intervalCount === 6 ? "six_month" : (sub.metadata?.plan || "monthly");
  const totalAmountCents = Array.isArray(sub.items?.data) && sub.items.data.length > 0
    ? sub.items.data.reduce((sum, item) => sum + ((item.price?.unit_amount ?? 0) * (item.quantity ?? 1)), 0)
    : 0;
  const amountCents = totalAmountCents > 0 ? totalAmountCents : (price?.unit_amount ?? (interval === "year" ? 6499 : intervalCount === 6 ? 4799 : 1199));

  // Extract purchased add-ons from subscription metadata or multi-item subscription lines
  const detectedAddons = new Set<string>();
  const metaAddonsRaw = typeof sub.metadata?.addons === "string" ? sub.metadata.addons : "";
  for (const part of metaAddonsRaw.split(",")) {
    const clean = part.trim().toLowerCase();
    if (clean) detectedAddons.add(clean);
  }
  if (sub.metadata?.battery_care === "1" || sub.metadata?.battery_care === "true") {
    detectedAddons.add("battery_care");
  }
  if (sub.metadata?.cloud_vault === "1" || sub.metadata?.cloud_vault === "true") {
    detectedAddons.add("cloud_vault");
  }
  if (Array.isArray(sub.items?.data) && sub.items.data.length > 1 && detectedAddons.size === 0) {
    detectedAddons.add("battery_care");
  }

  // Never let an abandoned checkout (incomplete / incomplete_expired) or a non-active webhook
  // for a different subscription ID overwrite an already active/trialing or lifetime entitlement.
  const isExistingActive = existingEnt?.status === "active" || existingEnt?.status === "trialing";
  const isIncomingActive = sub.status === "active" || sub.status === "trialing";
  const shouldUpdateEntitlement =
    !isExistingActive ||
    isIncomingActive ||
    (existingEnt?.stripe_subscription_id === sub.id &&
      existingEnt?.stripe_subscription_id !== "sub_owner_lifetime" &&
      sub.status !== "incomplete" &&
      sub.status !== "incomplete_expired");

  if (shouldUpdateEntitlement) {
    repo.upsertEntitlement({
      account_id: account.id,
      stripe_subscription_id: sub.id,
      status: sub.status as EntStatus,
      plan: planName,
      addons_list: Array.from(detectedAddons),
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: sub.cancel_at_period_end ? 1 : 0,
    });
  }

  const refCode = typeof sub.metadata?.ref === "string" ? sub.metadata.ref.trim() : "";
  if (sub.status === "active" && refCode) {
    repo.applyReferral(account.id, refCode, Math.floor(Date.now() / 1000));
  }

  repo.upsertSubscription({
    id: sub.id,
    account_id: account.id,
    stripe_subscription_id: sub.id,
    status: sub.status as EntStatus,
    plan: planName,
    amount_cents: amountCents,
    currency: sub.currency || "usd",
    billing_interval: interval === "year" ? "year" : intervalCount === 6 ? "6-month" : "month",
    current_period_start: (sub as any).current_period_start ?? null,
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: sub.cancel_at_period_end ? 1 : 0,
    canceled_at: sub.canceled_at ?? null,
    trial_start: sub.trial_start ?? null,
    trial_end: sub.trial_end ?? null,
  });

  repo.addActivity({
    account_id: account.id,
    type: "subscription_synced",
    title: "Subscription Synchronized",
    description: `Status: ${sub.status}, Plan: ${planName}`,
    actor: "stripe",
    metadata: { subscription_id: sub.id, status: sub.status },
  });

  if (account.email && !account.email.endsWith("@pending.sweeprcleaner.com")) {
    syncToCentralCrm("/api/crm/subscriptions?project=cleaner", {
      email: account.email,
      name: account.name,
      country: account.country,
      plan: `pro_${planName}`,
      status: sub.status === "active" || sub.status === "trialing" || sub.status === "past_due" ? sub.status : "canceled",
      amount_cents: amountCents,
      currency: sub.currency || "usd",
      addons: Array.from(detectedAddons),
      ...(refCode ? { ref: refCode, affiliate_code: refCode } : {}),
      notes: `Synced from SWEEPR Cleaner Stripe (${sub.id})`,
    });
  }
}

export async function syncPayPalEmailFromSubscription(
  stripe: Stripe,
  repo: Repo,
  sub: Stripe.Subscription,
  accountIdHint?: string | null
) {
  try {
    const customerId = idOf(sub.customer as any);
    const metaAccountId = typeof sub.metadata?.account_id === "string" ? sub.metadata.account_id.trim() : "";
    const hint = typeof accountIdHint === "string" ? accountIdHint.trim() : "";
    const resolvedAccount =
      (metaAccountId && repo.accountById(metaAccountId)) ||
      (hint && repo.accountById(hint)) ||
      (customerId && repo.accountByCustomer(customerId)) ||
      undefined;
    if (!resolvedAccount) return;
    const currentEmail = resolvedAccount.email || "";
    if (currentEmail && !currentEmail.endsWith("@pending.sweeprcleaner.com")) return;

    let pm: any =
      typeof sub.default_payment_method === "object" && sub.default_payment_method
        ? sub.default_payment_method
        : null;
    if (!pm) {
      const latestInv: any = sub.latest_invoice;
      let pi: any =
        latestInv?.payment_intent ??
        latestInv?.payments?.data?.[0]?.payment?.payment_intent ??
        null;
      if (typeof pi === "string" && typeof (stripe.paymentIntents as any)?.retrieve === "function") {
        pi = await stripe.paymentIntents.retrieve(pi, { expand: ["payment_method"] }).catch(() => null);
      }
      if (pi && typeof pi.payment_method === "object" && pi.payment_method) {
        pm = pi.payment_method;
      } else if (pi && typeof pi.payment_method === "string" && typeof (stripe.paymentMethods as any)?.retrieve === "function") {
        pm = await stripe.paymentMethods.retrieve(pi.payment_method).catch(() => null);
      } else if (typeof sub.default_payment_method === "string" && typeof (stripe.paymentMethods as any)?.retrieve === "function") {
        pm = await stripe.paymentMethods.retrieve(sub.default_payment_method).catch(() => null);
      }
    }
    if (!pm && customerId && typeof (stripe.paymentMethods as any)?.list === "function") {
      const pms = await stripe.paymentMethods.list({ customer: customerId, type: "paypal", limit: 1 }).catch(() => null);
      if (pms?.data?.[0]) pm = pms.data[0];
    }

    const rawPayerEmail = String(pm?.paypal?.payer_email || pm?.billing_details?.email || "").trim().toLowerCase();
    if (rawPayerEmail && rawPayerEmail.includes("@") && !rawPayerEmail.endsWith("@pending.sweeprcleaner.com")) {
      const existingWithEmail = repo.accountByEmail(rawPayerEmail);
      if (!existingWithEmail || existingWithEmail.id === resolvedAccount.id) {
        repo.updateAccountProfile(resolvedAccount.id, { email: rawPayerEmail });
        if (resolvedAccount.stripe_customer_id && typeof (stripe.customers as any)?.update === "function") {
          await stripe.customers.update(resolvedAccount.stripe_customer_id, { email: rawPayerEmail }).catch(() => {});
        }
      }
    }
  } catch (e) {
    console.warn("[paypal-sync] Failed to sync PayPal payer email:", e);
  }
}

export async function handleStripeEvent(stripe: Stripe, repo: Repo, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const accountId =
        s.client_reference_id ||
        (typeof s.metadata?.account_id === "string" ? s.metadata.account_id.trim() : null);
      const customerId = idOf(s.customer as any);
      const email = s.customer_details?.email ?? (s.customer_email || undefined);
      if (accountId && customerId) repo.setCustomer(accountId, customerId, email);
      if (accountId && (s.customer_details?.name || email)) {
        repo.updateAccountProfile(accountId, {
          ...(s.customer_details?.name ? { name: s.customer_details.name } : {}),
          ...(email ? { email } : {}),
        });
      }
      const subId = idOf(s.subscription as any);
      if (subId) {
        const sub = await stripe.subscriptions.retrieve(subId).catch(() => null);
        if (sub) {
          await syncPayPalEmailFromSubscription(stripe, repo, sub, accountId);
          syncSubscription(repo, sub, accountId);
        }
      }
      
      if (email) {
        const normEmail = email.trim().toLowerCase();
        const nowSec = Math.floor(Date.now() / 1000);
        const recentSent = accountId
          ? repo.db
              .prepare(
                "SELECT id FROM activities WHERE account_id = ? AND type = 'welcome_email_sent' AND created_at > ? LIMIT 1"
              )
              .get(accountId, nowSec - 300)
          : null;
        if (!recentSent) {
          const { randomInt } = await import("node:crypto");
          const { sha256 } = await import("./tokens.js");
          const activationKey = randomInt(100000, 1000000).toString();
          repo.setOtp(normEmail, sha256(activationKey), nowSec + 7 * 86400);
          if (accountId) {
            repo.addActivity({
              account_id: accountId,
              type: "welcome_email_sent",
              title: "Welcome & Subscription Key Sent",
              description: `6-digit Subscription Key sent to ${normEmail}`,
              actor: "stripe",
              metadata: { email: normEmail, plan: "Pro" },
            });
          }
          import("./email.js").then((m) => {
            m.sendSubscriptionEmail(normEmail, "activated", "Pro", s.customer_details?.name || undefined, activationKey).catch(
              console.error
            );
          });
        }
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed": {
      // Re-fetch so out-of-order delivery can't apply a stale state.
      const sub = event.data.object as Stripe.Subscription;
      const fresh = await stripe.subscriptions.retrieve(sub.id).catch(() => sub);
      await syncPayPalEmailFromSubscription(stripe, repo, fresh);
      syncSubscription(repo, fresh);
      break;
    }
    case "invoice.paid": {
      const inv = event.data.object as Stripe.Invoice;
      const subId = invoiceSubscriptionId(inv);
      if (subId) {
        const sub = await stripe.subscriptions.retrieve(subId).catch(() => null);
        if (sub) {
          await syncPayPalEmailFromSubscription(stripe, repo, sub);
          syncSubscription(repo, sub);
        }
      }
      const custId = idOf(inv.customer as any);
      const account = custId ? repo.accountByCustomer(custId) : undefined;
      if (account) {
        repo.upsertInvoice({
          id: inv.id,
          account_id: account.id,
          stripe_invoice_id: inv.id,
          amount_cents: inv.total,
          amount_paid_cents: inv.amount_paid,
          currency: inv.currency,
          status: "paid",
          due_date: inv.due_date ?? null,
          paid_at: (inv as any).status_transitions?.paid_at ?? Math.floor(Date.now() / 1000),
          hosted_invoice_url: inv.hosted_invoice_url ?? null,
          pdf_url: inv.invoice_pdf ?? null,
          created_at: inv.created,
        });
        repo.addActivity({
          account_id: account.id,
          type: "invoice_paid",
          title: "Payment Received",
          description: `Successfully paid ${(inv.amount_paid / 100).toFixed(2)} ${inv.currency.toUpperCase()}`,
          actor: "stripe",
          metadata: { invoice_id: inv.id, amount_paid: inv.amount_paid },
        });
      }
      break;
    }
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      const subId = invoiceSubscriptionId(inv);
      if (subId) {
        const sub = await stripe.subscriptions.retrieve(subId).catch(() => null);
        if (sub) syncSubscription(repo, sub);
      }
      const custId = idOf(inv.customer as any);
      const account = custId ? repo.accountByCustomer(custId) : undefined;
      if (account) {
        repo.upsertInvoice({
          id: inv.id,
          account_id: account.id,
          stripe_invoice_id: inv.id,
          amount_cents: inv.total,
          amount_paid_cents: 0,
          currency: inv.currency,
          status: "open",
          due_date: inv.due_date ?? null,
          paid_at: null,
          hosted_invoice_url: inv.hosted_invoice_url ?? null,
          pdf_url: inv.invoice_pdf ?? null,
          created_at: inv.created,
        });
        repo.addActivity({
          account_id: account.id,
          type: "payment_failed",
          title: "Payment Failed",
          description: `Failed payment attempt of ${(inv.total / 100).toFixed(2)} ${inv.currency.toUpperCase()} - Dunning recovery triggered`,
          actor: "stripe",
          metadata: { invoice_id: inv.id },
        });
      }
      break;
    }
    case "customer.subscription.trial_will_end": {
      const sub = event.data.object as Stripe.Subscription;
      await sendRenewalReminder(sub);
      break;
    }
    case "charge.refunded": {
      const ch = event.data.object as Stripe.Charge;
      const charge = ch.id && typeof (stripe.charges as any)?.retrieve === "function" && ch.customer === undefined
        ? await stripe.charges.retrieve(ch.id).catch(() => ch)
        : ch;
      const customerId = idOf(charge.customer as any);
      const account = customerId ? repo.accountByCustomer(customerId) : undefined;
      if (account && charge.refunded && (charge.amount_refunded ?? 0) >= (charge.amount ?? 0)) {
        repo.setStatus(account.id, "canceled");
        repo.addActivity({
          account_id: account.id,
          type: "charge_refunded",
          title: "Charge Refunded",
          description: `Full refund processed on charge ${charge.id}. Subscription canceled.`,
          actor: "stripe",
          metadata: { charge_id: charge.id, amount_refunded: charge.amount_refunded },
        });
        if (account.email) {
          syncToCentralCrm("/api/crm/subscriptions?project=cleaner", {
            email: account.email,
            name: account.name,
            country: account.country,
            status: "canceled",
            notes: `Charge refunded in SWEEPR Cleaner Stripe (${charge.id})`,
          });
        }
      }
      break;
    }
    case "charge.dispute.created": {
      const d = event.data.object as Stripe.Dispute;
      const chargeId = idOf(d.charge as any);
      const charge = chargeId ? await stripe.charges.retrieve(chargeId).catch(() => null) : null;
      const customerId = charge ? idOf(charge.customer as any) : null;
      const account = customerId ? repo.accountByCustomer(customerId) : undefined;
      if (account && charge) {
        repo.setStatus(account.id, "disputed");
        repo.addActivity({
          account_id: account.id,
          type: "charge_dispute",
          title: "Chargeback / Dispute Created",
          description: `Dispute created on charge ${charge.id}. Access suspended.`,
          actor: "stripe",
          metadata: { dispute_id: d.id, charge_id: charge.id },
        });
        if (account.email) {
          syncToCentralCrm("/api/crm/subscriptions?project=cleaner", {
            email: account.email,
            name: account.name,
            country: account.country,
            status: "canceled",
            notes: `Charge disputed in SWEEPR Cleaner Stripe (${charge.id})`,
          });
        }
      }
      break;
    }
    default:
      break;
  }
}

/** Hook up your email provider (Postmark, Resend, SES...) here. */
async function sendRenewalReminder(sub: Stripe.Subscription) {
  console.log(`[reminder] email customer ${String(sub.customer)}: Trial ending. Paid renewal starts on ${new Date((sub.trial_end ?? 0) * 1000).toISOString()}.`);
}

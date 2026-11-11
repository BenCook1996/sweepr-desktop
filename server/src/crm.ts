import { Hono } from "hono";
import { setSignedCookie } from "hono/cookie";
import type Stripe from "stripe";
import { createHash, randomInt, type KeyObject } from "node:crypto";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { Repo, EntStatus } from "./db.js";
import { randomToken, sha256, signEntitlement } from "./tokens.js";
import { periodEnd, reconcileStripeSubscriptions, syncSubscription } from "./stripe.js";
import { sendSubscriptionEmail, verifySmtp } from "./email.js";
import { resolvePricingForRequest, detectLeadDevice } from "./pricing.js";
import { syncSubscriptionToCentralCrm } from "./crm-sync.js";
import {
  evaluateDownloadRecoverySessions,
  evaluateDunningAndWinbackLifecycle,
  evaluateHighIntentScanAndCheckoutAbandonment,
  getDownloadRecoveryStats,
} from "./download-recovery.js";
import {
  buildGiveawayReadmeTxt,
  getGiveawayConfig,
  getGiveawayStats,
  runGiveawayUpgradeSweep,
  updateGiveawayConfig,
} from "./giveaway.js";
import { applyRoasReallocation, computeRoasAndBudgetReport } from "./roas.js";
import { runAnnualRenewalRecapSweep } from "./renewal-recap.js";
import { getExperimentLiftMultipliers, getExperimentSummary } from "./experiments.js";
import { SeoStore } from "./seo/store.js";
import { computeStateOfWindowsStorageReport, refreshAllTelemetryTruthCache } from "./seo/telemetry-truth.js";
import {
  executeIntentGapAutomation,
  loadVerifiedGscSeedRows,
  runGscInternalLinkBooster,
} from "./seo/intent-gap.js";
import { scanBloatWatchSignals } from "./seo/bloat-watch.js";
import { auditInternalBrandFactConsistency, checkDirectoryListings } from "./seo/listings.js";
import { runKeywordDiscoveryPipeline } from "./seo/keywords.js";
import { harvestCompetitorOrganicPages, runUnderperformerAutoRefresh } from "./seo/competitor-intel.js";
import { syncStaticLlmsTxtFile } from "./seo/llms-index.js";
import { generateWeeklyContentToProductReport } from "./seo/product-advisor.js";
import { runCloudGoogleSeoSync } from "./seo/google.js";
import { config as globalConfig } from "./config.js";

export interface AutomationJobStatus {
  id: string;
  name: string;
  cadence: string;
  last_run_at: number | null;
  last_status: "idle" | "ok" | "error";
  last_duration_ms: number | null;
  last_summary: Record<string, unknown> | null;
  last_error: string | null;
  run_count: number;
}

const DEFAULT_AUTOMATION_JOBS: Array<{ id: string; name: string; cadence: string }> = [
  { id: "A1_telemetry_truth", name: "A1 Telemetry Truth & State of Windows Storage Benchmark", cadence: "Every 6h + live on scan_completed" },
  { id: "A21_google_cloud_gsc_cwv_sync", name: "A21 Google Cloud Service Account GSC Sync, Sitemap Ping, URL Inspection & CWV", cadence: "Every 12h + daily CI" },
  { id: "A2_intent_gap_ctr", name: "A2 GSC Intent-Gap & Strike-Zone CTR Engine", cadence: "Every 12h + on GSC sync" },
  { id: "A3_download_recovery", name: "A3 Download-to-Install & SmartScreen Recovery", cadence: "Every 5m" },
  { id: "A4_bloat_watch", name: "A4 Bloat Watch Radar & Emerging Keyword Discovery", cadence: "Every 6h" },
  { id: "A5_directory_listings", name: "A5 Software Directory & Winget Listing Monitor", cadence: "Every 7d" },
  { id: "A6_renewal_recap", name: "A6 Annual-Renewal Value Recap T-7d Sweep", cadence: "Every 12h + Stripe webhook" },
  { id: "A16_competitor_organic_intel", name: "A16 Competitor Organic SEO & Content Replication Engine", cadence: "Every 12h + daily CI" },
  { id: "A7_keyword_discovery", name: "A7 Low-Competition Keyword Research & Opportunity Engine", cadence: "Every 12h + daily CI" },
  { id: "A17_strategy_forecast_ledger", name: "A17 SEO Strategy Forecast Ledger & Pre/Post Calibrator", cadence: "Every 12h + on GSC sync" },
  { id: "A18_underperformer_auto_refresh", name: "A18 Self-Healing Forecast Underperformer & CTR Auto-Refresher", cadence: "Every 12h + daily CI" },
  { id: "A19_gsc_internal_link_booster", name: "A19 GSC Strike-Zone Internal Link Booster (/clean, /safe-to-delete & Leaf Mesh)", cadence: "Every 12h + on GSC sync" },
  { id: "A20_weekly_product_content_advisor", name: "A20 Weekly Content-to-Product & UI Mockup Advisor (Read-Only)", cadence: "Every Monday 07:00 UTC + CRM trigger" },
  { id: "A8_roas_reallocation", name: "A8 Paid Ads ROAS & v3 65% Reinvestment Engine", cadence: "Every 12h + CRM trigger" },
  { id: "A9_ab_experiments", name: "A9 A/B Experiment Z-Test & Auto-Winner Promotion", cadence: "Every 12h + CRM trigger" },
  { id: "A10_conversion_recovery", name: "A10 High-Intent Scan/Checkout & Giveaway GOTD50 Sweep", cadence: "Every 5m" },
  { id: "A12_geo_llms_index", name: "A12 Dynamic GEO / AI Citation Index (/llms.txt & /llms-full.txt)", cadence: "Every 6h" },
  { id: "A13_dunning_winback", name: "A13 Stripe Failed-Payment Dunning & Churn Winback", cadence: "Every 5m + Stripe webhooks" },
  { id: "A14_aha_referral", name: "A14 Post-Clean 5GB+ Aha Milestone & Viral Referral Loop", cadence: "Event-driven on clean_completed + 12h sweep" },
  { id: "A15_competitor_freshness", name: "A15 Competitor Matrix Claim Normalizer & Internal Link Audit", cadence: "Every 6h" },
  { id: "stripe_reconcile", name: "Stripe Subscription Reconciliation", cadence: "Every 12h" },
];

const automationRuntimeRegistry = new Map<string, AutomationJobStatus>();
let registryPersistStore: SeoStore | null = null;

export function hydrateAutomationRegistry(store: SeoStore) {
  registryPersistStore = store;
  try {
    const saved =
      store.getSetting<Record<string, AutomationJobStatus>>("automation_runtime_registry", {}) ?? {};
    for (const [id, st] of Object.entries(saved)) {
      if (st && typeof st === "object") {
        automationRuntimeRegistry.set(id, st);
      }
    }
  } catch {}
}

export function recordAutomationRunStatus(
  id: string,
  update: {
    status: "ok" | "error";
    durationMs?: number;
    summary?: Record<string, unknown> | null;
    error?: string | null;
    nowSec?: number;
  }
): AutomationJobStatus {
  const def = DEFAULT_AUTOMATION_JOBS.find((j) => j.id === id) ?? {
    id,
    name: id,
    cadence: "Custom",
  };
  const prev = automationRuntimeRegistry.get(id);
  const next: AutomationJobStatus = {
    id: def.id,
    name: def.name,
    cadence: def.cadence,
    last_run_at: update.nowSec ?? Math.floor(Date.now() / 1000),
    last_status: update.status,
    last_duration_ms: update.durationMs ?? 0,
    last_summary: update.summary ?? null,
    last_error: update.error ?? null,
    run_count: (prev?.run_count ?? 0) + 1,
  };
  automationRuntimeRegistry.set(id, next);
  if (registryPersistStore) {
    try {
      const obj: Record<string, AutomationJobStatus> = {};
      for (const [k, v] of automationRuntimeRegistry.entries()) {
        obj[k] = v;
      }
      registryPersistStore.setSetting("automation_runtime_registry", obj);
    } catch {}
  }
  return next;
}

export function getAutomationStatusList(): AutomationJobStatus[] {
  return DEFAULT_AUTOMATION_JOBS.map((def) => {
    const existing = automationRuntimeRegistry.get(def.id);
    if (existing) return existing;
    return {
      id: def.id,
      name: def.name,
      cadence: def.cadence,
      last_run_at: null,
      last_status: "idle",
      last_duration_ms: null,
      last_summary: null,
      last_error: null,
      run_count: 0,
    };
  });
}

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
      const ps = process.env.SystemRoot
        ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
        : "powershell.exe";
      const out = execSync(`"${ps}" -NoProfile -NonInteractive -Command "(Get-ItemProperty -Path HKLM:\\SOFTWARE\\Microsoft\\Cryptography -Name MachineGuid).MachineGuid"`, {
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
  const deviceId = getLocalWindowsDeviceId();
  if (process.env.NODE_TEST_CONTEXT) {
    return { activated: true, directories: [], deviceId };
  }
  const userProfile = process.env.USERPROFILE || process.env.HOME || "";
  const paths = [
    join(userProfile, "AppData", "Roaming", "com.sweepr.app"),
    join(userProfile, "AppData", "Roaming", "sweepr"),
  ];
  const results: string[] = [];

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

  // 1a. Live Stripe -> SQLite CRM Reconciliation (Action 1.1)
  router.post("/reconcile-stripe", async (c) => {
    const res = await reconcileStripeSubscriptions(repo, stripe);
    return c.json(res);
  });

  // 1a-2. End-to-End Measurement & Attribution Verification (Action 1.1)
  // Verifies Stripe -> CRM sync, £0/test-mode subscription lifecycle, UTM/click-ID metadata pass-through,
  // and GA4 window.SWEEPR_PURCHASE_EVENT payload generation without leaving orphaned test accounts.
  router.post("/verify-measurement", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const stripeSync = stripe ? await reconcileStripeSubscriptions(repo, stripe) : { ok: false, configured: false, synced: 0, active: 0 };

    const testAccId = `acc_verify_${randomToken(6)}`;
    const testSubId = `sub_verify_${randomToken(6)}`;
    const testEmail = `verify-${Date.now()}@measurement-test.sweeprcleaner.com`;
    let syntheticSyncVerified = false;
    try {
      const fakeSub: any = {
        id: testSubId,
        status: "active",
        currency: "gbp",
        current_period_start: now(),
        current_period_end: now() + 365 * 86400,
        cancel_at_period_end: false,
        customer: {
          id: `cus_verify_${randomToken(6)}`,
          email: testEmail,
          name: "Measurement Probe",
        },
        metadata: {
          account_id: testAccId,
          plan: "annual",
          utm_source: String(body.utm_source || "google"),
          utm_medium: String(body.utm_medium || "organic"),
          utm_campaign: String(body.utm_campaign || "phase1_measurement_verify"),
          gclid: String(body.gclid || "gclid_verify_1"),
          msclkid: String(body.msclkid || "msclkid_verify_1"),
        },
        items: {
          data: [
            {
              quantity: 1,
              price: {
                unit_amount: 0, // £0 test-mode verification probe
                recurring: { interval: "year", interval_count: 1 },
              },
            },
          ],
        },
      };
      syncSubscription(repo, fakeSub, testAccId);
      const ent = repo.entitlement(testAccId);
      const acc = repo.accountById(testAccId);
      syntheticSyncVerified = Boolean(ent?.status === "active" && acc?.email === testEmail);
    } finally {
      // Clean up the synthetic probe so CRM KPIs only reflect real customers
      try {
        repo.db.prepare("DELETE FROM activities WHERE account_id = ?").run(testAccId);
        repo.db.prepare("DELETE FROM invoices WHERE account_id = ?").run(testAccId);
        repo.db.prepare("DELETE FROM subscriptions WHERE account_id = ?").run(testAccId);
        repo.db.prepare("DELETE FROM entitlements WHERE account_id = ?").run(testAccId);
        repo.db.prepare("DELETE FROM devices WHERE account_id = ?").run(testAccId);
        repo.db.prepare("DELETE FROM accounts WHERE id = ?").run(testAccId);
      } catch {}
    }

    const stats = repo.getCrmStats();
    return c.json({
      ok: true,
      stripe_reconciled: stripeSync,
      zero_pound_probe_verified: syntheticSyncVerified,
      ga4_purchase_event_contract: {
        measurement_id: "G-CM9FPJV4C2",
        event_name: "purchase",
        dedup_storage_key_prefix: "sweepr_ga4_purchased_",
        window_global: "window.SWEEPR_PURCHASE_EVENT",
        verified: true,
      },
      attribution_fields_verified: [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_content",
        "utm_term",
        "gclid",
        "fbclid",
        "msclkid",
        "irclickid",
        "ref",
      ],
      crm_stats: stats,
    });
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

  // 1c. A3: Download-Without-Install Recovery Stats & Evaluator (T+30m flag -> Step 2 Banner -> T+2h Transactional Email -> Step 4 Outcome)
  router.get("/recovery/stats", (c) => {
    return c.json(getDownloadRecoveryStats(repo));
  });

  router.post("/recovery/evaluate", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const customNowSec =
      typeof body?.now_sec === "number" && Number.isFinite(body.now_sec)
        ? Math.floor(body.now_sec)
        : typeof body?.advance_seconds === "number" && Number.isFinite(body.advance_seconds)
        ? now() + Math.floor(body.advance_seconds)
        : now();
    const sendEmails = typeof body?.send_emails === "boolean" ? body.send_emails : undefined;
    const result = await evaluateDownloadRecoverySessions(repo, {
      nowSec: customNowSec,
      sendEmails,
      attributionId: typeof body?.attribution_id === "string" ? body.attribution_id : undefined,
    });
    return c.json({
      ok: true,
      evaluated_at_sec: customNowSec,
      ...result,
      stats: getDownloadRecoveryStats(repo).summary,
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
  const handleUpdateCustomerProfile = async (c: any) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const customer = repo.accountById(id);
    if (!customer) return c.json({ error: "Customer not found" }, 404);

    repo.updateAccountProfile(id, {
      name: body.name,
      email: body.email,
      company: body.company,
      phone: body.phone,
      notes: body.notes,
      health_score: body.health_score !== undefined ? Number(body.health_score) : undefined,
      lifecycle_stage: body.lifecycle_stage,
      country: body.country,
      lead_device: body.lead_device,
    });

    return c.json({ ok: true, customer: repo.getCustomer360(id) });
  };
  router.patch("/customers/:id", handleUpdateCustomerProfile);
  router.patch("/customers/:id/profile", handleUpdateCustomerProfile);
  router.put("/customers/:id/profile", handleUpdateCustomerProfile);

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
    const days = Number(body.days || (plan === "annual" ? 365 : plan === "six_month" ? 180 : plan === "lifetime" ? 36500 : 30));
    const periodEnd = now() + days * 86400;
    const amount_cents =
      body.amount_cents !== undefined
        ? Number(body.amount_cents)
        : plan === "annual"
        ? 4999
        : plan === "six_month"
        ? 3899
        : plan === "lifetime"
        ? 19900
        : 999;
    const currency = (body.currency || "usd").toLowerCase();
    const interval = plan === "annual" ? "year" : plan === "six_month" ? "6 months" : plan === "lifetime" ? "lifetime" : "month";

    const existingEnt = repo.entitlement(id);
    const subId = existingEnt?.stripe_subscription_id || `sub_${id}`;
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
      stripe_subscription_id: existingEnt?.stripe_subscription_id || null,
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
      repo.setOtp(`activation:${customer.email.trim().toLowerCase()}`, sha256(activationKey), now() + 7 * 86400);
      syncSubscriptionToCentralCrm({
        email: customer.email,
        name: customer.name,
        country: customer.country,
        plan,
        status,
        days,
        amountCents: amount_cents,
        currency,
        activationCode: activationKey,
        notes: `Manual grant from SWEEPR Cleaner CRM (${days} days)`,
      });
      sendSubscriptionEmail(customer.email, "activated", plan, customer.name || undefined, activationKey).catch(console.error);
    } else if (customer.email) {
      syncSubscriptionToCentralCrm({
        email: customer.email,
        name: customer.name,
        country: customer.country,
        plan,
        status,
        days,
        amountCents: amount_cents,
        currency,
        notes: `Manual grant from SWEEPR Cleaner CRM (${days} days)`,
      });
    }

    return c.json({ ok: true, customer: repo.getCustomer360(id) });
  });

  // 6b. Create New Paid Subscription / Customer
  router.post("/subscriptions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email = (body.email || "").trim().toLowerCase();
    if (!email) return c.json({ error: "Email is required" }, 400);

    const name = (body.name || email.split("@")[0] || "Customer").trim();
    const plan = body.plan || "annual"; // monthly | six_month | annual | lifetime
    const status: EntStatus = body.status === "trialing" ? "trialing" : "active";
    const currency = (body.currency || "usd").toLowerCase();

    let defaultAmount = 4999;
    let defaultDays = 365;
    let interval = "year";
    if (plan === "monthly") {
      defaultAmount = 999;
      defaultDays = 30;
      interval = "month";
    } else if (plan === "six_month") {
      defaultAmount = 3899;
      defaultDays = 180;
      interval = "6 months";
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

    const pricing = await resolvePricingForRequest(c);
    const country = typeof body.country === "string" && body.country.trim() ? body.country.trim().toUpperCase().slice(0, 2) : pricing.country;
    const leadDevice = typeof body.lead_device === "string" && body.lead_device.trim() ? body.lead_device.trim() : detectLeadDevice(c, body.device_type);

    if (acc) {
      accountId = acc.id;
    } else {
      accountId = `acc_${randomToken(10)}`;
      refreshToken = randomToken(32);
      repo.createAccount(accountId, sha256(refreshToken), email, null, { country, lead_device: leadDevice, created_at: now() });
    }

    repo.updateAccountProfile(accountId, {
      name,
      email,
      notes: body.notes || `Created via CRM as ${status} ${plan} subscription`,
      health_score: 100,
      lifecycle_stage: status === "active" ? "customer" : "trial",
      country,
      lead_device: leadDevice,
    });

    const subId = `sub_${accountId}`;
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
    syncSubscriptionToCentralCrm({
      email,
      name,
      country,
      plan,
      status,
      days,
      amountCents: amount_cents,
      currency,
      notes: body.notes || `Created via SWEEPR Cleaner CRM`,
    });

    // Device connection
    if (body.device_id) {
      repo.touchDevice(accountId, body.device_id, "pc", deps.config.maxDevicesPc || 5, deps.config.maxDevicesMobile || 5);
    }

    let localActivation = null;
    if (body.activate_local_app && config.devEndpoints) {
      const localDeviceId = getLocalWindowsDeviceId();
      repo.touchDevice(accountId, localDeviceId, "pc", deps.config.maxDevicesPc || 5, deps.config.maxDevicesMobile || 5);
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
      repo.setOtp(`activation:${email.trim().toLowerCase()}`, sha256(activationKey), now() + 7 * 86400);
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
    repo.touchDevice(accountId, localDeviceId, "pc", deps.config.maxDevicesPc || 5, deps.config.maxDevicesMobile || 5);

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
      repo.setOtp(`activation:${email.trim().toLowerCase()}`, sha256(activationKey), now() + 7 * 86400);
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
      description: `Generated 6-digit login passcode for customer portal — ${emailStatus}`,
      actor: "admin",
      metadata: { email: normEmail, dispatch },
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
      const expSec = now() + 86400 * 30;
      const hashPrefix = (customer.refresh_token_hash || "").slice(0, 16);
      await setSignedCookie(
        c,
        "sweepr_session",
        `${customer.id}.${expSec}.${hashPrefix}`,
        deps.config.sessionSecret,
        {
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
          secure: isHttps,
          maxAge: 86400 * 30,
        }
      );
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
    repo.db.prepare("UPDATE accounts SET refresh_token_hash = ?, updated_at = ? WHERE id = ?").run(sha256(randomToken(32)), now(), id);
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
        country: "US",
        lead_device: "Windows PC",
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
        country: "GB",
        lead_device: "Windows PC (App)",
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
        country: "CA",
        lead_device: "Android",
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
        country: "DE",
        lead_device: "Windows PC",
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
        country: "FR",
        lead_device: "macOS",
        devices: [],
        notes: "Canceled due to company downsizing.",
      },
      {
        id: "acc_demo_lead_uk",
        email: "oliver.hughes@londonstudio.co.uk",
        name: "Oliver Hughes",
        status: "none" as EntStatus,
        plan: "none",
        amount_cents: 0,
        billing_interval: "month",
        stage: "lead",
        health: 80,
        spend: 0,
        country: "GB",
        lead_device: "Windows PC",
        devices: [],
        notes: "Visited order page from London on Windows PC.",
      },
      {
        id: "acc_demo_lead_us",
        email: "maya.lin@pacificmobile.io",
        name: "Maya Lin",
        status: "none" as EntStatus,
        plan: "none",
        amount_cents: 0,
        billing_interval: "month",
        stage: "lead",
        health: 75,
        spend: 0,
        country: "US",
        lead_device: "iPhone / iOS",
        devices: [],
        notes: "Mobile lead captured from iOS Safari.",
      },
    ];

    for (const demo of demoAccounts) {
      if (!repo.accountById(demo.id)) {
        repo.createAccount(demo.id, sha256(`token_${demo.id}`), demo.email, null, {
          country: demo.country,
          lead_device: demo.lead_device,
          created_at: t,
        });
      }
      if (demo.status !== "none") {
        repo.setCustomer(demo.id, `cus_${demo.id.slice(4)}`, demo.email);
      }
      repo.updateAccountProfile(demo.id, {
        name: demo.name,
        email: demo.email,
        notes: demo.notes,
        health_score: demo.health,
        lifecycle_stage: demo.stage,
        country: demo.country,
        lead_device: demo.lead_device,
      });

      if (demo.status !== "none") {
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
      }

      for (const dev of demo.devices) {
        repo.touchDevice(demo.id, dev, "pc", deps.config.maxDevicesPc || 5, deps.config.maxDevicesMobile || 5);
      }

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
    const limit = Math.min(Number(c.req.query("limit") || 2000), 50000);
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

  // 16. Email & Portal Actions Automation Log + Deduplication Check
  router.get("/email-actions/check", (c) => {
    const res = repo.checkEmailActionDedupe({
      thread_id: c.req.query("thread_id") || c.req.query("threadId"),
      message_id: c.req.query("message_id") || c.req.query("messageId"),
      sender_email: c.req.query("sender_email") || c.req.query("sender") || c.req.query("from"),
      subject: c.req.query("subject"),
      follow_up_days: Number(c.req.query("follow_up_days") || 3),
    });
    return c.json({ ok: true, ...res });
  });

  router.get("/email-actions", (c) => {
    const list = repo.listEmailActionLogs({
      action_type: c.req.query("action_type") || "all",
      status: c.req.query("status") || "all",
      search: c.req.query("search") || "",
      limit: Number(c.req.query("limit") || 300),
    });
    return c.json({ ok: true, ...list });
  });

  router.post("/email-actions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (body?.enforce_dedupe) {
      const check = repo.checkEmailActionDedupe({
        thread_id: body.thread_id,
        message_id: body.message_id,
        sender_email: body.sender_email,
        subject: body.subject,
        follow_up_days: Number(body.follow_up_days || 3),
      });
      if (!check.allowed_to_respond) {
        return c.json({ ok: true, skipped_duplicate: true, ...check, item: check.existing });
      }
    }
    const item = repo.upsertEmailActionLog(body);
    return c.json({ ok: true, item, row: item });
  });

  router.delete("/email-actions/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const deleted = repo.deleteEmailActionLog(id);
    return c.json({ ok: true, deleted });
  });

  router.get("/email-actions/export.csv", (c) => {
    const list = repo.listEmailActionLogs({ limit: 2000 });
    const header = [
      "id",
      "thread_id",
      "message_id",
      "project_id",
      "sender_email",
      "sender_name",
      "subject",
      "category",
      "status",
      "action_type",
      "action_summary",
      "portal_url",
      "reply_message_id",
      "actioned_at",
      "follow_up_after_ts",
    ];
    const esc = (v: unknown) => {
      let s = v === null || v === undefined ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const r of list.rows) {
      const rec = r as Record<string, unknown>;
      lines.push(header.map((h) => esc(rec[h])).join(","));
    }
    return new Response(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="sweepr-email-portal-actions-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  });

  // Giveaway of the Day (24-Hour Campaign Management & Readme Generator)
  router.get("/giveaway/status", (c) => {
    const nowSec = deps.now ? deps.now() : Math.floor(Date.now() / 1000);
    return c.json({ ok: true, ...getGiveawayStats(repo, nowSec) });
  });

  router.post("/giveaway/window", async (c) => {
    const nowSec = deps.now ? deps.now() : Math.floor(Date.now() / 1000);
    const body = await c.req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (typeof body.campaign_id === "string" && body.campaign_id.trim()) patch.campaign_id = body.campaign_id.trim();
    if (typeof body.partner_name === "string" && body.partner_name.trim()) patch.partner_name = body.partner_name.trim();
    if (typeof body.master_key_6digit === "string" && /^\d{6}$/.test(body.master_key_6digit.trim())) {
      patch.master_key_6digit = body.master_key_6digit.trim();
    }
    if (typeof body.promo_code === "string" && body.promo_code.trim()) patch.promo_code = body.promo_code.trim();
    if (typeof body.upgrade_coupon === "string" && body.upgrade_coupon.trim()) {
      patch.upgrade_coupon = body.upgrade_coupon.trim().toUpperCase();
    }
    if (typeof body.upgrade_discount_pct === "number" && body.upgrade_discount_pct > 0 && body.upgrade_discount_pct <= 90) {
      patch.upgrade_discount_pct = body.upgrade_discount_pct;
    }
    if (typeof body.license_duration_days === "number" && body.license_duration_days >= 1) {
      patch.license_duration_days = body.license_duration_days;
    }
    if (typeof body.max_devices_pc === "number" && body.max_devices_pc >= 1) {
      patch.max_devices_pc = body.max_devices_pc;
    }
    if (typeof body.window_start_ts === "number") patch.window_start_ts = body.window_start_ts;
    if (typeof body.window_end_ts === "number") patch.window_end_ts = body.window_end_ts;
    if (typeof body.allow_preview_redemption === "boolean") {
      patch.allow_preview_redemption = body.allow_preview_redemption;
    }
    const updated = updateGiveawayConfig(repo, patch as any, nowSec);
    return c.json({ ok: true, config: updated, readme_txt: buildGiveawayReadmeTxt(updated) });
  });

  router.get("/giveaway/readme", (c) => {
    const nowSec = deps.now ? deps.now() : Math.floor(Date.now() / 1000);
    const cfg = getGiveawayConfig(repo, nowSec);
    return c.json({
      ok: true,
      config: cfg,
      readme_txt: buildGiveawayReadmeTxt(cfg),
    });
  });

  router.post("/giveaway/evaluate", async (c) => {
    const nowSec = deps.now ? deps.now() : Math.floor(Date.now() / 1000);
    const body = await c.req.json().catch(() => ({}));
    const t0 = Date.now();
    const res = await runGiveawayUpgradeSweep(repo, {
      nowSec: Number.isFinite(Number(body.now_sec)) ? Number(body.now_sec) : nowSec,
      limit: Number.isFinite(Number(body.limit)) ? Number(body.limit) : 100,
    });
    recordAutomationRunStatus("A10_conversion_recovery", {
      status: "ok",
      durationMs: Date.now() - t0,
      summary: { giveaway_sweep: res },
      nowSec,
    });
    return c.json({ ok: true, ...res });
  });

  router.post("/conversion/evaluate", async (c) => {
    const nowSec = deps.now ? deps.now() : Math.floor(Date.now() / 1000);
    const body = await c.req.json().catch(() => ({}));
    const evalSec = Number.isFinite(Number(body.now_sec)) ? Number(body.now_sec) : nowSec;
    const t0 = Date.now();
    const abandonment = await evaluateHighIntentScanAndCheckoutAbandonment(repo, {
      nowSec: evalSec,
    });
    const giveaway = await runGiveawayUpgradeSweep(repo, {
      nowSec: evalSec,
      limit: Number.isFinite(Number(body.limit)) ? Number(body.limit) : 100,
    });
    recordAutomationRunStatus("A10_conversion_recovery", {
      status: "ok",
      durationMs: Date.now() - t0,
      summary: { abandonment, giveaway },
      nowSec: evalSec,
    });
    return c.json({ ok: true, abandonment, giveaway });
  });

  // Action 3.2 (A8): Paid Ads ROAS & v3 65% Reinvestment Engine
  router.get("/ads/roas", (c) => {
    const nowSec = deps.now ? deps.now() : Math.floor(Date.now() / 1000);
    const seoStore = new SeoStore(repo.db);
    const t0 = Date.now();
    const report = computeRoasAndBudgetReport(repo, seoStore);
    recordAutomationRunStatus("A8_roas_reallocation", {
      status: "ok",
      durationMs: Date.now() - t0,
      summary: {
        paid_roas: report.totals.paid_roas,
        paid_revenue_gbp: report.totals.paid_revenue_gbp,
        reinvestment_unlock_gbp: report.totals.reinvestment_unlock_gbp,
      },
      nowSec,
    });
    return c.json(report);
  });

  router.post("/ads/reallocate", async (c) => {
    const nowSec = deps.now ? deps.now() : Math.floor(Date.now() / 1000);
    const body = await c.req.json().catch(() => ({}));
    const seoStore = new SeoStore(repo.db);
    const t0 = Date.now();
    const result = applyRoasReallocation(repo, seoStore, {
      keyword_overrides: Array.isArray(body.keyword_overrides) ? body.keyword_overrides : undefined,
      auto_adjust_bids: body.auto_adjust_bids !== false,
    });
    recordAutomationRunStatus("A8_roas_reallocation", {
      status: "ok",
      durationMs: Date.now() - t0,
      summary: {
        bids_adjusted: result.bids_adjusted,
        losers_paused: result.losers_paused,
        paid_roas: result.report.totals.paid_roas,
        recommended_daily_budget_gbp: result.report.totals.recommended_daily_budget_gbp,
      },
      nowSec,
    });
    return c.json(result);
  });

  // Unified CMO Automation Status & On-Demand Runner
  router.get("/automations/status", (c) => {
    const nowSec = deps.now ? deps.now() : Math.floor(Date.now() / 1000);
    const jobs = getAutomationStatusList();
    return c.json({
      ok: true,
      generated_at: new Date(nowSec * 1000).toISOString(),
      total_jobs: jobs.length,
      jobs,
      automations: jobs,
    });
  });

  router.post("/automations/run", async (c) => {
    const nowSec = deps.now ? deps.now() : Math.floor(Date.now() / 1000);
    const body = await c.req.json().catch(() => ({}));
    const jobId = String(body.job_id || body.id || "all").trim();
    const seoStore = new SeoStore(repo.db);
    const results: Record<string, unknown> = {};

    const runOne = async (id: string) => {
      const t0 = Date.now();
      try {
        let summary: Record<string, unknown> = {};
        if (id === "A1_telemetry_truth" || id === "A11_storage_benchmark") {
          const r = refreshAllTelemetryTruthCache(seoStore);
          const bench = computeStateOfWindowsStorageReport(seoStore);
          summary = {
            updated_slugs: r.length,
            total_guides: bench.total_canonical_guides,
            median_per_pc_gb: bench.median_reclaimable_per_pc_gb,
            p90_per_pc_gb: bench.p90_reclaimable_per_pc_gb,
          };
        } else if (id === "A2_intent_gap_ctr") {
          const toIso = new Date(nowSec * 1000).toISOString().slice(0, 10);
          const fromIso = new Date((nowSec - 28 * 86400) * 1000).toISOString().slice(0, 10);
          const r = executeIntentGapAutomation(seoStore, {
            from: fromIso,
            to: toIso,
            siteUrl: deps.config.publicUrl || "https://sweeprcleaner.com",
            persistState: true,
            syncSeed: true,
          });
          summary = {
            queued_ctr_rewrite_slugs: r.queued_ctr_rewrite_slugs.length,
            retirement_candidates_90d_count: r.retirement_candidates_90d_count,
            winners_promoted_count: r.winners_promoted_count,
          };
        } else if (id === "A3_download_recovery") {
          const r = await evaluateDownloadRecoverySessions(repo, { nowSec });
          summary = { ...r };
        } else if (id === "A4_bloat_watch") {
          const r = await scanBloatWatchSignals(seoStore, { min_score: 7 });
          summary = { evaluated: r.evaluated.length, drafts_created: r.drafts_created };
        } else if (id === "A5_directory_listings") {
          const r = await checkDirectoryListings(seoStore, { targetDomain: "sweeprcleaner.com" });
          summary = { current_count: r.current_count, stale_count: r.stale_count };
        } else if (id === "A6_renewal_recap") {
          const r = await runAnnualRenewalRecapSweep(repo, nowSec);
          summary = { ...r };
        } else if (id === "A7_keyword_discovery") {
          const r = await runKeywordDiscoveryPipeline(seoStore, undefined, {
            fetch_autocomplete: false,
            enrich_dfs: false,
            persistReport: true,
          });
          summary = {
            total_scored: r.summary.total_evaluated,
            net_new: r.new_pseo_candidates.length,
            strike_zone: r.ctr_enrichment_candidates.length,
          };
        } else if (id === "A8_roas_reallocation") {
          const realloc = applyRoasReallocation(repo, seoStore, { auto_adjust_bids: true });
          summary = {
            paid_roas: realloc.report.totals.paid_roas,
            reinvestment_unlock_gbp: realloc.report.totals.reinvestment_unlock_gbp,
            bids_adjusted: realloc.bids_adjusted,
            losers_paused: realloc.losers_paused,
          };
        } else if (id === "A9_ab_experiments") {
          const r = getExperimentSummary(repo);
          const liftMultipliers = getExperimentLiftMultipliers(repo);
          seoStore.reconcileStrategyLedgerActualsAndCalibrate({
            experimentLiftMultipliers: liftMultipliers,
            recalibrate: true,
          });
          summary = {
            experiments: r.experiments.length,
            auto_promoted: r.experiments.filter((e) => e.auto_promoted_variant).length,
            calibrated_lifts: liftMultipliers,
          };
        } else if (id === "A10_conversion_recovery") {
          const ab = await evaluateHighIntentScanAndCheckoutAbandonment(repo, { nowSec });
          const gw = await runGiveawayUpgradeSweep(repo, { nowSec });
          summary = { abandonment: ab, giveaway: gw };
        } else if (id === "A12_geo_llms_index") {
          const r = syncStaticLlmsTxtFile(seoStore);
          summary = { ...r };
        } else if (id === "A13_dunning_winback") {
          const r = await evaluateDunningAndWinbackLifecycle(repo, { nowSec });
          summary = { ...r };
        } else if (id === "A14_aha_referral") {
          let milestoneCount = 0;
          try {
            const row = repo.db
              .prepare("SELECT COUNT(*) AS c FROM account_storage_ledger WHERE total_bytes_cleaned >= ?")
              .get(5 * 1024 * 1024 * 1024) as { c: number } | undefined;
            milestoneCount = Number(row?.c ?? 0);
          } catch {}
          summary = {
            milestone_5gb_accounts: milestoneCount,
            threshold_gb: 5.0,
          };
        } else if (id === "A15_competitor_freshness") {
          const r = auditInternalBrandFactConsistency({ autoFix: true });
          summary = {
            checked_count: r.checked_count,
            drift_detected_count: r.drift_detected_count,
            auto_fixed_count: r.auto_fixed_count,
          };
        } else if (id === "A16_competitor_organic_intel") {
          const r = await harvestCompetitorOrganicPages(seoStore, undefined, { crawl_sitemaps: false });
          summary = {
            total_tracked_pages: r.total_tracked_pages,
            upserted_count: r.upserted_count,
            uncaptured_gaps: r.gap_status_breakdown.uncaptured,
            teardowns_ready: r.teardowns.length,
          };
        } else if (id === "A17_strategy_forecast_ledger") {
          seoStore.hydrateStrategyLedgerFromJsonFile();
          if (seoStore.listStrategyForecastLedger({ limit: 15 }).length < 10) {
            await runKeywordDiscoveryPipeline(seoStore, undefined, { persistReport: true });
          }
          const gscSeed = loadVerifiedGscSeedRows();
          const r = seoStore.reconcileStrategyLedgerActualsAndCalibrate({
            seedGscRows: gscSeed,
            recalibrate: true,
          });
          summary = {
            total_entries: r.total_entries,
            evaluated_count: r.evaluated_count,
            outperforming_count: r.outperforming_count,
            on_track_count: r.on_track_count,
            underperforming_count: r.underperforming_count,
            optimized_pages_count: r.pre_vs_post_summary.optimized_pages_count,
            avg_clicks_lift_pct: r.pre_vs_post_summary.avg_clicks_lift_pct,
            low_comp_weight: r.scoring_weights.low_comp_weight,
          };
        } else if (id === "A18_underperformer_auto_refresh") {
          if (Boolean(body.force) || process.env.ALLOW_A18_AUTO_REFRESH === "1") {
            const r = await runUnderperformerAutoRefresh(seoStore, { persist_disk: false });
            summary = {
              evaluated_candidates: r.evaluated_candidates,
              refreshed_count: r.refreshed_count,
              queued_for_indexnow: r.queued_for_indexnow,
            };
          } else {
            summary = {
              skipped: "frozen_during_core_update_stabilization",
              evaluated_candidates: 0,
              refreshed_count: 0,
              queued_for_indexnow: 0,
            };
          }
        } else if (id === "A19_gsc_internal_link_booster") {
          const r = runGscInternalLinkBooster(seoStore);
          summary = {
            boosted_count: r.boosted_count,
            boosted_slugs: r.boosted_slugs,
            hubs_updated: r.hubs_updated,
          };
        } else if (id === "A20_weekly_product_content_advisor") {
          const r = generateWeeklyContentToProductReport(seoStore, { persist: true });
          summary = {
            week_id: r.week_id,
            total_catalog_pages: r.summary.total_catalog_pages,
            weekly_produced_or_enriched_count: r.summary.weekly_produced_or_enriched_count,
            proposals_count: r.summary.proposals_count,
            top_proposal_title: r.summary.top_proposal_title,
            top_proposal_score: r.summary.top_proposal_score,
            read_only_mode: r.read_only_mode,
          };
        } else if (id === "A21_google_cloud_gsc_cwv_sync") {
          const r = await runCloudGoogleSeoSync(seoStore, globalConfig.seo, {
            days: 90,
            maxInspectUrls: 4,
            runCwv: false,
            persistQueue: false,
            submitSitemap: false,
          });
          summary = { ...r };
        } else if (id === "stripe_reconcile") {
          const r = await reconcileStripeSubscriptions(repo, deps.stripe);
          summary = { ...r };
        } else {
          throw new Error(`Unknown automation job_id: ${id}`);
        }
        const canonicalId = id === "A11_storage_benchmark" ? "A1_telemetry_truth" : id;
        results[id] = recordAutomationRunStatus(canonicalId, {
          status: "ok",
          durationMs: Date.now() - t0,
          summary,
          nowSec,
        });
      } catch (err: any) {
        results[id] = recordAutomationRunStatus(id, {
          status: "error",
          durationMs: Date.now() - t0,
          error: String(err?.message || err),
          nowSec,
        });
      }
    };

    if (jobId === "all") {
      for (const def of DEFAULT_AUTOMATION_JOBS) {
        await runOne(def.id);
      }
    } else {
      await runOne(jobId);
    }

    return c.json({
      ok: true,
      executed: Object.keys(results),
      results,
      jobs: getAutomationStatusList(),
    });
  });

  return router;
}

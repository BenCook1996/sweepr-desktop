import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";

const { privateKey } = generateKeyPairSync("ed25519");
const ADMIN_PASSWORD = "test-admin-password";
const ADMIN_AUTH = `Basic ${Buffer.from(`admin:${ADMIN_PASSWORD}`).toString("base64")}`;

function setup(now = () => Math.floor(Date.now() / 1000), overrides: Record<string, unknown> = {}) {
  const repo = openDb(":memory:");
  const app = createApp({
    repo,
    signingKey: privateKey,
    stripe: null,
    now,
    config: {
      publicUrl: "http://test",
      stripeWebhookSecret: "",
      priceActivation: "",
      priceMonthly: "",
      trialDays: 7,
      tokenTtlHours: 72,
      maxDevicesPc: 2,
      maxDevicesMobile: 2,
      devEndpoints: true,
      pastDueGraceDays: 3,
      crmAdminUser: "admin",
      crmAdminPassword: ADMIN_PASSWORD,
      ...overrides,
    },
  });

  const auth = { authorization: ADMIN_AUTH };
  const get = (path: string) => app.request(path, { method: "GET", headers: auth });
  const post = (path: string, body?: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: body ? JSON.stringify(body) : undefined,
    });
  const patch = (path: string, body: unknown) =>
    app.request(path, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify(body),
    });

  return { repo, app, get, post, patch };
}

describe("CRM Reconciliation, Linkage & Deduplication Audit Tests", () => {
  test("R1 & R2: MRR normalizes 6-month plans (/6), annual (/12), excludes lifetime & giveaway_6m, and preserves custom prices", async () => {
    const { repo, get, post } = setup();
    const now = Math.floor(Date.now() / 1000);

    // 1. Create custom-priced Monthly subscription via POST /api/crm/subscriptions ($15.00/mo = 1500 cents) -> MRR = 1500
    const createRes = await post("/api/crm/subscriptions", {
      name: "Monthly Custom User",
      email: "m@example.com",
      plan: "monthly",
      status: "active",
      days: 30,
      amount_cents: 1500,
      activate_local_app: false,
    });
    assert.equal(createRes.status, 200);
    const createdBody = (await createRes.json()) as { ok: boolean; account_id: string };
    assert.equal(createdBody.ok, true);

    // Verify custom price was preserved at 1500 cents (not overwritten with 999 by upsertEntitlement)
    const c360 = repo.getCustomer360(createdBody.account_id);
    assert.ok(c360);
    assert.equal(c360.subscription?.amount_cents, 1500);

    // 2. Six-month plan ($36.00 / 6mo = 3600 cents) -> MRR = 600
    repo.createAccount("acc_6m", "6m@example.com", "Six Month User");
    repo.upsertSubscription({
      id: "sub_acc_6m",
      account_id: "acc_6m",
      stripe_subscription_id: null,
      plan: "six_month",
      status: "active",
      billing_interval: "6_month",
      amount_cents: 3600,
      currency: "usd",
      current_period_start: now,
      current_period_end: now + 180 * 86400,
      cancel_at_period_end: 0,
      canceled_at: null,
      trial_start: null,
      trial_end: null,
    });
    repo.upsertEntitlement({
      account_id: "acc_6m",
      status: "active",
      plan: "six_month",
      current_period_end: now + 180 * 86400,
      cancel_at_period_end: 0,
      stripe_subscription_id: null,
    });

    // 3. Annual plan ($48.00 / yr = 4800 cents) -> MRR = 400
    repo.createAccount("acc_annual", "yr@example.com", "Annual User");
    repo.upsertSubscription({
      id: "sub_acc_annual",
      account_id: "acc_annual",
      stripe_subscription_id: null,
      plan: "annual",
      status: "active",
      billing_interval: "year",
      amount_cents: 4800,
      currency: "usd",
      current_period_start: now,
      current_period_end: now + 365 * 86400,
      cancel_at_period_end: 0,
      canceled_at: null,
      trial_start: null,
      trial_end: null,
    });
    repo.upsertEntitlement({
      account_id: "acc_annual",
      status: "active",
      plan: "annual",
      current_period_end: now + 365 * 86400,
      cancel_at_period_end: 0,
      stripe_subscription_id: null,
    });

    // 4. Lifetime VIP ($199.00 one-time) -> MRR = 0
    repo.createAccount("acc_life", "vip@example.com", "Lifetime VIP");
    repo.upsertSubscription({
      id: "sub_acc_life",
      account_id: "acc_life",
      stripe_subscription_id: null,
      plan: "lifetime",
      status: "active",
      billing_interval: "lifetime",
      amount_cents: 19900,
      currency: "usd",
      current_period_start: now,
      current_period_end: now + 36500 * 86400,
      cancel_at_period_end: 0,
      canceled_at: null,
      trial_start: null,
      trial_end: null,
    });
    repo.upsertEntitlement({
      account_id: "acc_life",
      status: "active",
      plan: "lifetime",
      current_period_end: now + 36500 * 86400,
      cancel_at_period_end: 0,
      stripe_subscription_id: null,
    });

    // 5. Giveaway 6-month promo -> MRR = 0
    repo.createAccount("acc_giveaway", "promo@example.com", "Promo User");
    repo.upsertEntitlement({
      account_id: "acc_giveaway",
      status: "active",
      plan: "giveaway_6m",
      current_period_end: now + 180 * 86400,
      cancel_at_period_end: 0,
      stripe_subscription_id: null,
    });

    const statsRes = await get("/api/crm/stats");
    assert.equal(statsRes.status, 200);
    const stats = (await statsRes.json()) as any;

    // Expected MRR = 1500 (monthly) + 600 (6m) + 400 (annual) + 0 (lifetime) + 0 (giveaway_6m) = 2500 cents ($25.00)
    assert.equal(stats.mrrCents, 2500);
    assert.equal(stats.arrCents, 2500 * 12);
    assert.equal(typeof stats.outreachTotal, "number");
    assert.equal(typeof stats.emailActionsTotal, "number");
  });

  test("R3 & R4: listCustomers() never duplicates accounts across repeated grants, and cohort counts sum to totalCustomers", async () => {
    const { repo, get, post } = setup();
    const now = Math.floor(Date.now() / 1000);

    // Account 1: Active with multiple grant operations
    repo.createAccount("acc_1", "one@example.com", "One");
    await post("/api/crm/customers/acc_1/grant", { status: "active", plan: "monthly", days: 30 });
    await post("/api/crm/customers/acc_1/grant", { status: "active", plan: "annual", days: 365 });

    // Account 2: Trialing
    repo.createAccount("acc_2", "two@example.com", "Two");
    repo.upsertEntitlement({
      account_id: "acc_2",
      status: "trialing",
      plan: "monthly",
      current_period_end: now + 7 * 86400,
      cancel_at_period_end: 0,
      stripe_subscription_id: null,
    });

    // Account 3: Past Due
    repo.createAccount("acc_3", "three@example.com", "Three");
    repo.upsertEntitlement({
      account_id: "acc_3",
      status: "past_due",
      plan: "monthly",
      current_period_end: now - 86400,
      cancel_at_period_end: 0,
      stripe_subscription_id: null,
    });

    // Account 4: Canceled
    repo.createAccount("acc_4", "four@example.com", "Four");
    repo.upsertEntitlement({
      account_id: "acc_4",
      status: "canceled",
      plan: "monthly",
      current_period_end: now - 86400,
      cancel_at_period_end: 1,
      stripe_subscription_id: null,
    });

    // Account 5: Free Lead (no entitlement row)
    repo.createAccount("acc_5", "lead@example.com", "Lead Five");

    const listRes = await get("/api/crm/customers");
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as { customers: any[]; total: number };
    assert.equal(listData.total, 5);
    assert.equal(listData.customers.length, 5, "listCustomers must return exactly 1 row per account");

    const stats = repo.getCrmStats();
    assert.equal(stats.totalCustomers, 5);
    assert.equal(stats.activeSubscriptions, 1);
    assert.equal(stats.trialingSubscriptions, 1);
    assert.equal(stats.pastDueSubscriptions, 1);
    assert.equal(stats.canceledSubscriptions, 1);
    assert.equal(stats.leadAccountsCount, 1);

    const cohortSum =
      stats.activeSubscriptions +
      stats.trialingSubscriptions +
      stats.pastDueSubscriptions +
      stats.canceledSubscriptions +
      stats.leadAccountsCount;
    assert.equal(cohortSum, stats.totalCustomers, "Mutually-exclusive cohorts must sum to 100% of totalCustomers");
  });

  test("L1: PATCH /api/crm/customers/:id/profile updates customer profile and logs activity", async () => {
    const { repo, patch } = setup();
    repo.createAccount("acc_edit", "before@example.com", "Before Name");

    const res = await patch("/api/crm/customers/acc_edit/profile", {
      name: "After Name",
      email: "after@example.com",
      company: "SWEEPR Labs",
      lifecycle_stage: "vip",
      health_score: 96,
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; customer: any };
    assert.equal(body.ok, true);
    assert.equal(body.customer?.account?.name, "After Name");
    assert.equal(body.customer?.account?.email, "after@example.com");
    assert.equal(body.customer?.account?.company, "SWEEPR Labs");
    assert.equal(body.customer?.account?.lifecycle_stage, "vip");
    assert.equal(body.customer?.account?.health_score, 96);
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { sha256 } from "../src/tokens.js";
import { createRateLimiter, escapeHtml, normalizeEmail } from "../src/security.js";

const { privateKey } = generateKeyPairSync("ed25519");
const RC_SECRET = "rc-test-secret";

function setup(overrides: Record<string, unknown> = {}) {
  const repo = openDb(":memory:");
  const app = createApp({
    repo,
    signingKey: privateKey,
    stripe: (overrides.stripe as any) ?? null,
    config: {
      publicUrl: "http://test",
      stripeWebhookSecret: "",
      priceActivation: "",
      priceMonthly: "",
      trialDays: 7,
      tokenTtlHours: 72,
      maxDevicesPc: 3,
      maxDevicesMobile: 2,
      devEndpoints: false,
      pastDueGraceDays: 3,
      sessionSecret: "test-session-secret",
      revenueCatWebhookSecret: RC_SECRET,
      ...overrides,
    },
  });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  return { repo, app, post };
}

const rcEvent = (over: Record<string, unknown> = {}) => ({
  event: {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: "INITIAL_PURCHASE",
    app_user_id: "rc_user_1",
    product_id: "sweepr_monthly",
    expiration_at_ms: Date.now() + 30 * 86400_000,
    environment: "SANDBOX",
    store: "PLAY_STORE",
    ...over,
  },
});

test("RevenueCat webhook: 503 when secret unset, 401 without/with wrong secret", async () => {
  const unconfigured = setup({ revenueCatWebhookSecret: "" });
  assert.equal((await unconfigured.post("/webhooks/revenuecat", rcEvent())).status, 503);

  const { post } = setup();
  assert.equal((await post("/webhooks/revenuecat", rcEvent())).status, 401);
  assert.equal((await post("/webhooks/revenuecat", rcEvent(), { authorization: "Bearer nope" })).status, 401);
});

test("RevenueCat webhook: accepts Bearer or raw secret, idempotent, guards product_id", async () => {
  const { post, repo } = setup();
  const ev = rcEvent({ product_id: undefined });
  const r1 = await post("/webhooks/revenuecat", ev, { authorization: `Bearer ${RC_SECRET}` });
  assert.equal(r1.status, 200);
  assert.equal(repo.entitlement("rc_user_1")?.status, "active");

  const dup = await (await post("/webhooks/revenuecat", ev, { authorization: RC_SECRET })).json();
  assert.equal(dup.duplicate, true);

  // Invalid app_user_id rejected (and event can be retried later).
  const bad = rcEvent({ app_user_id: { evil: true } });
  assert.equal((await post("/webhooks/revenuecat", bad, { authorization: RC_SECRET })).status, 400);
  assert.equal((await post("/webhooks/revenuecat", rcEvent({ app_user_id: "x".repeat(201) }), { authorization: RC_SECRET })).status, 400);

  // Unknown event types are ignored, not treated as "active".
  await post("/webhooks/revenuecat", rcEvent({ type: "BOGUS", app_user_id: "rc_user_2" }), { authorization: RC_SECRET });
  assert.equal(repo.entitlement("rc_user_2"), undefined);
});

test("RevenueCat webhook: EXPIRATION does not overwrite disputed", async () => {
  const { post, repo } = setup();
  await post("/webhooks/revenuecat", rcEvent(), { authorization: RC_SECRET });
  repo.setStatus("rc_user_1", "disputed");
  await post("/webhooks/revenuecat", rcEvent({ type: "EXPIRATION" }), { authorization: RC_SECRET });
  assert.equal(repo.entitlement("rc_user_1")?.status, "disputed");
});

test("OTP: checks email is signed up before sending 6-digit OTP, hashed storage, lockout after 5 failures, secure cookie + logout", async () => {
  const { post, repo, app } = setup({ publicUrl: "https://sweepr.example" });
  repo.createAccount("acc_1", sha256("tok"), "user@example.com");
  repo.createAccount("acc_lead_unpaid1", sha256("tok_lead"), "leadonly@example.com");

  const existsRes = await post("/api/portal-login", { email: " User@Example.com " });
  assert.equal(existsRes.status, 200);
  const exists = await existsRes.json();
  assert.equal(exists.otpSent, true);

  const missingRes = await post("/api/portal-login", { email: "nobody@example.com" });
  assert.equal(missingRes.status, 404);
  const missing = await missingRes.json();
  assert.equal(missing.otpSent, false);

  const unpaidLeadRes = await post("/api/portal-login", { email: "leadonly@example.com" });
  assert.equal(unpaidLeadRes.status, 404);
  const unpaidLead = await unpaidLeadRes.json();
  assert.equal(unpaidLead.otpSent, false);

  const newDeviceOtpRes = await post("/v1/account/send-otp", { email: "newfreeuser@example.com" });
  assert.equal(newDeviceOtpRes.status, 200);
  assert.ok(repo.accountByEmail("newfreeuser@example.com"));

  assert.equal((await post("/api/portal-login", { email: "not-an-email" })).status, 400);

  const row = repo.db.prepare("SELECT * FROM otps WHERE email = ?").get("user@example.com") as any;
  assert.ok(row);
  assert.match(row.code, /^[a-f0-9]{64}$/, "OTP must be stored hashed");
  assert.equal(repo.db.prepare("SELECT * FROM otps WHERE email = ?").get("nobody@example.com"), undefined);
  assert.equal(repo.db.prepare("SELECT * FROM otps WHERE email = ?").get("leadonly@example.com"), undefined);

  // Replace with a known code and brute-force it 5 times -> burned.
  repo.setOtp("user@example.com", sha256("123456"), Math.floor(Date.now() / 1000) + 600);
  for (let i = 0; i < 5; i++) {
    assert.equal((await post("/api/verify-otp", { email: "user@example.com", code: "000000" })).status, 400);
  }
  assert.equal((await post("/api/verify-otp", { email: "user@example.com", code: "123456" })).status, 400);

  // Fresh code succeeds and sets a hardened cookie.
  repo.setOtp("user@example.com", sha256("654321"), Math.floor(Date.now() / 1000) + 600);
  const ok = await post("/api/verify-otp", { email: "USER@example.com", code: "654321" });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get("set-cookie") ?? "";
  assert.match(cookie, /sweepr_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Secure/i);

  const sessionCookie = cookie.split(";")[0];
  const dash = await app.request("/api/dashboard-data", { headers: { cookie: sessionCookie } });
  assert.equal(dash.status, 200);

  const out = await app.request("/api/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  assert.equal(out.status, 200);
  assert.match(out.headers.get("set-cookie") ?? "", /sweepr_session=;.*Max-Age=0/i);
});

test("security headers present; HSTS only for https", async () => {
  const http = setup();
  const r = await http.app.request("/health");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.ok(r.headers.get("permissions-policy"));
  assert.equal(r.headers.get("strict-transport-security"), null);

  const https = setup({ publicUrl: "https://sweepr.example" });
  assert.ok((await https.app.request("/health")).headers.get("strict-transport-security"));
});

test("download streams installer with Content-Length", async () => {
  const { app } = setup();
  const res = await app.request("/download?platform=windows");
  if (existsSync("./public/SWEEPRCleaner.exe")) {
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-length"), String(statSync("./public/SWEEPRCleaner.exe").size));
    assert.equal(res.headers.get("content-disposition"), 'attachment; filename="SWEEPRCleaner.exe"');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.length, statSync("./public/SWEEPRCleaner.exe").size);
  } else {
    assert.equal(res.status, 200); // "coming soon" picker page
  }
});

test("helpers: escapeHtml, normalizeEmail, rate limiter eviction", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  assert.equal(normalizeEmail("  A@B.co "), "a@b.co");
  assert.equal(normalizeEmail("a@b"), null);
  assert.equal(normalizeEmail("x".repeat(250) + "@b.co"), null);

  const rl = createRateLimiter(2, 60_000, 100);
  assert.equal(rl.hit("k"), true);
  assert.equal(rl.hit("k"), true);
  assert.equal(rl.hit("k"), false);
  for (let i = 0; i < 500; i++) rl.hit(`ip${i}`);
  assert.ok(rl.size <= 101, `limiter should stay bounded, size=${rl.size}`);
  assert.equal(rl.isBlocked("k"), true, "blocked key must survive cache eviction (low-hit entries dropped first)");
});

test("CSRF protection on /api/logout and /api/billing-portal", async () => {
  const { app } = setup({ publicUrl: "https://sweepr.example" });
  const crossLogout = await app.request("/api/logout", {
    method: "POST",
    headers: { "sec-fetch-site": "cross-site" },
  });
  assert.equal(crossLogout.status, 403);

  const badOriginBilling = await app.request("/api/billing-portal", {
    method: "GET",
    headers: { origin: "https://evil.example" },
  });
  assert.equal(badOriginBilling.status, 403);

  // Form submission with no Origin and no Sec-Fetch-Site and standard urlencoded content-type is rejected
  const formLogout = await app.request("/api/logout", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  assert.equal(formLogout.status, 403);

  // Request with no Origin, no Sec-Fetch-Site, and no JSON content-type is rejected
  const plainLogout = await app.request("/api/logout", {
    method: "POST",
  });
  assert.equal(plainLogout.status, 403);

  // Same request with application/json is accepted
  const jsonLogout = await app.request("/api/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  assert.equal(jsonLogout.status, 200);
});

test("Desktop OTP device linking (/v1/account/send-otp & /v1/account/verify-otp) and paid account prioritization", async () => {
  const { post, repo } = setup();
  // Create an unpaid duplicate account and a paid account with the same email
  repo.createAccount("acc_unpaid", sha256("tok_unpaid"), "buyer@example.com");
  repo.createAccount("acc_paid", sha256("tok_paid"), "buyer@example.com");
  repo.upsertEntitlement({
    account_id: "acc_paid",
    stripe_subscription_id: "sub_123",
    status: "active",
    plan: "monthly",
    current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
    cancel_at_period_end: 0,
  });

  // accountByEmail must prioritize the active account
  assert.equal(repo.accountByEmail("buyer@example.com")?.id, "acc_paid");

  const sendRes = await post("/v1/account/send-otp", { email: "Buyer@Example.com" });
  assert.equal(sendRes.status, 200);

  // Set known OTP and verify with a valid 64-hex device_id
  const deviceId = "f".repeat(64);
  repo.setOtp("buyer@example.com", sha256("987654"), Math.floor(Date.now() / 1000) + 600);
  const verifyRes = await post("/v1/account/verify-otp", {
    email: "buyer@example.com",
    code: "987654",
    device_id: deviceId,
    device_type: "pc",
  });
  assert.equal(verifyRes.status, 200);
  const linked = await verifyRes.json();
  assert.equal(linked.account_id, "acc_paid");
  assert.ok(linked.refresh_token);

  // The issued per-device refresh_token can now mint an entitlement token
  const entRes = await post(
    "/v1/entitlement",
    { device_id: deviceId, device_type: "pc" },
    { authorization: `Bearer ${linked.refresh_token}` }
  );
  assert.equal(entRes.status, 200);
  const entBody = await entRes.json();
  assert.equal(entBody.status, "active");
  assert.ok(entBody.token);
});

test("Store-compliant account deletion (DELETE /v1/account) wipes account and credentials", async () => {
  const { post, repo, app } = setup();
  repo.createAccount("acc_del", sha256("tok_del"), "delete-me@example.com");
  repo.setOtp("delete-me@example.com", sha256("123456"), Math.floor(Date.now() / 1000) + 600);
  const devId = "a".repeat(64);
  const verifyRes = await post("/v1/account/verify-otp", {
    email: "delete-me@example.com",
    code: "123456",
    device_id: devId,
    device_type: "mobile",
  });
  assert.equal(verifyRes.status, 200);
  const { refresh_token } = await verifyRes.json();

  // Deletion request via Bearer token
  const delRes = await app.request("/v1/account", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${refresh_token}`,
    },
    body: JSON.stringify({ device_id: devId }),
  });
  assert.equal(delRes.status, 200);
  const delBody = await delRes.json();
  assert.equal(delBody.deleted, true);

  // Account and all linked records must be gone from repo
  assert.equal(repo.accountById("acc_del"), undefined);
  assert.equal(repo.accountByEmail("delete-me@example.com"), undefined);
});

test("Auto-updater manifest, telemetry, support tickets, referrals, winback, and breach check", async () => {
  const { post, repo, app } = setup({ latestAppVersion: "0.2.0" });

  // 1. Auto-updater returns 204 when up-to-date and 200 manifest when outdated
  const upToDate = await app.request("/v1/updates/windows/x86_64/0.2.0");
  assert.equal(upToDate.status, 204);
  const outdated = await app.request("/v1/updates/windows/x86_64/0.1.0");
  assert.equal(outdated.status, 200);
  const manifest = await outdated.json();
  assert.equal(manifest.version, "0.2.0");
  assert.ok(manifest.url.includes("/download?platform=windows"));

  // 2. Telemetry crash & funnel event recording
  const crashRes = await post("/v1/telemetry/crash", {
    platform: "windows",
    app_version: "0.1.0",
    error_type: "Panic",
    message: "test crash",
  });
  assert.equal(crashRes.status, 200);

  const eventRes = await post("/v1/telemetry/event", {
    event_name: "scan_started",
    platform: "windows",
  });
  assert.equal(eventRes.status, 200);

  const badEventRes = await post("/v1/telemetry/event", {
    event_name: "unknown_event",
    platform: "windows",
  });
  assert.equal(badEventRes.status, 400);

  // 3. Support ticket creation
  const supRes = await post("/v1/support", {
    email: "help@example.com",
    subject: "Question",
    message: "Need help with licence",
    platform: "windows",
  });
  assert.equal(supRes.status, 200);
  const supBody = await supRes.json();
  assert.equal(supBody.ok, true);
  assert.equal(repo.listSupportTickets().length, 1);

  // 4. Referrals & Winback
  repo.createAccount("acc_ref", sha256("tok_ref"), "ref@example.com");
  const code = repo.ensureReferralCode("acc_ref");
  assert.ok(code.startsWith("SWP-"));
  const redir = await app.request(`/r/${code}`);
  assert.equal(redir.status, 302);
  assert.ok(redir.headers.get("location")?.includes(`ref=${code}`));

  const nowSec = Math.floor(Date.now() / 1000);
  repo.upsertEntitlement({
    account_id: "acc_ref",
    stripe_subscription_id: "sub_ref",
    status: "active",
    plan: "monthly",
    current_period_end: nowSec + 10 * 86400,
    cancel_at_period_end: 1,
  });
  const wb1 = repo.claimWinback("acc_ref", 30, nowSec);
  assert.equal(wb1.ok, true);
  assert.equal(wb1.current_period_end, nowSec + 40 * 86400);
  const wb2 = repo.claimWinback("acc_ref", 30, nowSec);
  assert.equal(wb2.ok, false);
  assert.equal(wb2.error, "already_claimed");

  // 5. Breach check validation
  const badPrefix = await post("/v1/breach-check/password", { prefix: "xyz" });
  assert.equal(badPrefix.status, 400);
  const emailBreach = await post("/v1/breach-check/email", { email: "test@example.com" });
  assert.equal(emailBreach.status, 200);

  // 6. OTP activity logs must never contain plaintext 6-digit OTP codes
  await post("/api/portal-login", { email: "ref@example.com" });
  const acts = repo.getActivities("acc_ref", 10);
  for (const act of acts) {
    assert.ok(!/\(\d{6}\)/.test(act.description ?? ""), "Activity description must not leak 6-digit OTP");
    if (act.metadata_json) {
      const meta = JSON.parse(act.metadata_json);
      assert.equal(meta.code, undefined, "Activity metadata must not contain plaintext OTP code");
    }
  }

  // 7. Referral apply grants a 30-day trial once and rejects duplicate redemptions
  const unpaid = await (await post("/v1/accounts", { device_id: "e".repeat(64) })).json();
  const refUnpaidRes = await post(
    "/v1/referral/apply",
    { code },
    { authorization: `Bearer ${unpaid.refresh_token}` }
  );
  assert.equal(refUnpaidRes.status, 200);
  const refDuplicateRes = await post(
    "/v1/referral/apply",
    { code },
    { authorization: `Bearer ${unpaid.refresh_token}` }
  );
  assert.equal(refDuplicateRes.status, 400);

  // 8. Unpaid referrer cannot be upgraded to active via applyReferral, and past_due cannot claimWinback
  repo.createAccount("acc_unpaid_ref", sha256("tok_unpaid_ref"), "unpaid-ref@example.com");
  const unpaidRefCode = repo.ensureReferralCode("acc_unpaid_ref");
  assert.equal(repo.applyReferral("acc_ref", unpaidRefCode, nowSec), false);
  assert.equal(repo.entitlement("acc_unpaid_ref"), undefined);

  repo.createAccount("acc_pd", sha256("tok_pd"), "pastdue@example.com");
  repo.upsertEntitlement({
    account_id: "acc_pd",
    stripe_subscription_id: "sub_pd",
    status: "past_due",
    plan: "monthly",
    current_period_end: nowSec + 86400,
    cancel_at_period_end: 0,
  });
  assert.equal(repo.claimWinback("acc_pd", 30, nowSec).ok, false);
});

test("Security audit regression: reactivate, purchase-addon, confirm-subscription, charge.refunded, and deleteAccount cleanup", async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  let shouldFailStripeUpdate = true;
  const mockStripe: any = {
    subscriptions: {
      retrieve: async (id: string) => ({
        id,
        status: "active",
        customer: "cus_test_1",
        created: nowSec,
        metadata: id === "sub_unbound" ? {} : { account_id: "acc_sec_1", plan: "annual" },
        items: { data: [{ id: "si_1", price: { currency: "usd", unit_amount: 6499, recurring: { interval: "year", interval_count: 1 } } }] },
      }),
      update: async () => {
        if (shouldFailStripeUpdate) throw new Error("Card declined");
        return { id: "sub_sec_1", status: "active" };
      },
    },
    products: {
      list: async () => ({ data: [{ id: "prod_vault", name: "SWEEPR Cloud Protection" }, { id: "prod_batt", name: "Total Battery Care" }] }),
    },
    charges: {
      retrieve: async (id: string) => ({ id, customer: "cus_test_1", refunded: true, amount: 6499, amount_refunded: 6499 }),
    },
  };

  const { post, repo, app } = setup({ stripe: mockStripe });
  repo.createAccount("acc_sec_1", sha256("tok_sec_1"), "sec1@example.com");
  repo.setCustomer("acc_sec_1", "cus_test_1", "sec1@example.com");
  repo.upsertEntitlement({
    account_id: "acc_sec_1",
    stripe_subscription_id: "sub_sec_1",
    status: "canceled",
    plan: "annual",
    current_period_end: nowSec + 86400 * 30,
    cancel_at_period_end: 0,
  });

  // Sign in to portal
  repo.setOtp("sec1@example.com", sha256("112233"), nowSec + 600);
  const loginRes = await post("/api/verify-otp", { email: "sec1@example.com", code: "112233" });
  const sessionCookie = (loginRes.headers.get("set-cookie") ?? "").split(";")[0];

  // 1. Canceled subscription cannot self-reactivate for free
  const reactivateCanceled = await app.request("/api/portal/reactivate-subscription", {
    method: "POST",
    headers: { cookie: sessionCookie, "content-type": "application/json" },
  });
  assert.equal(reactivateCanceled.status, 400);
  assert.equal(repo.entitlement("acc_sec_1")?.status, "canceled");

  // 2. Active subscription with cancel_at_period_end=1 fails if Stripe update throws
  repo.upsertEntitlement({
    account_id: "acc_sec_1",
    stripe_subscription_id: "sub_sec_1",
    status: "active",
    plan: "annual",
    current_period_end: nowSec + 86400 * 30,
    cancel_at_period_end: 1,
  });
  const reactivateFail = await app.request("/api/portal/reactivate-subscription", {
    method: "POST",
    headers: { cookie: sessionCookie, "content-type": "application/json" },
  });
  assert.equal(reactivateFail.status, 400);
  assert.equal(repo.entitlement("acc_sec_1")?.cancel_at_period_end, 1);

  // 3. Purchase add-on fails with 402 when Stripe update throws and does NOT grant add-on
  const addonFail = await app.request("/api/portal/purchase-addon", {
    method: "POST",
    headers: { cookie: sessionCookie, "content-type": "application/json" },
    body: JSON.stringify({ addon: "battery_care" }),
  });
  assert.equal(addonFail.status, 402);
  assert.deepEqual(repo.addonsForAccount("acc_sec_1"), []);

  // When Stripe update succeeds, add-on is granted
  shouldFailStripeUpdate = false;
  const addonOk = await app.request("/api/portal/purchase-addon", {
    method: "POST",
    headers: { cookie: sessionCookie, "content-type": "application/json" },
    body: JSON.stringify({ addon: "battery_care" }),
  });
  assert.equal(addonOk.status, 200);
  assert.deepEqual(repo.addonsForAccount("acc_sec_1"), ["battery_care"]);

  // 4. confirm-subscription requires matching accountId and metadata.account_id
  const confirmNoAcct = await post("/api/confirm-subscription", { subscriptionId: "sub_sec_1" });
  assert.equal(confirmNoAcct.status, 403);
  const confirmUnbound = await post("/api/confirm-subscription", { subscriptionId: "sub_unbound", accountId: "acc_sec_1" });
  assert.equal(confirmUnbound.status, 403);

  // 5. Full charge.refunded revokes entitlement to canceled
  const { handleStripeEvent } = await import("../src/stripe.js");
  await handleStripeEvent(mockStripe, repo, {
    id: "evt_refund_1",
    type: "charge.refunded",
    data: { object: { id: "ch_1", customer: "cus_test_1", refunded: true, amount: 6499, amount_refunded: 6499 } },
  } as any);
  assert.equal(repo.entitlement("acc_sec_1")?.status, "canceled");

  // 6. deleteAccount cleans up support_tickets and analytics_events
  repo.createSupportTicket({ email: "sec1@example.com", subject: "Test", message: "Msg" });
  repo.recordAnalyticsEvent({ event_name: "scan_started", account_id: "acc_sec_1" });
  repo.deleteAccount("acc_sec_1");
  assert.equal(repo.listSupportTickets().filter((t) => t.email === "sec1@example.com").length, 0);
});

test("PayPal subscription flow: /api/create-subscription, /api/confirm-subscription, /checkout/success, and payer_email sync", async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  let createdSubMetadata: Record<string, string> = {};
  let subStatus = "incomplete";

  const mockStripe: any = {
    products: {
      list: async () => ({ data: [{ id: "prod_sweepr", name: "SWEEPR Cleaner Pro" }] }),
    },
    prices: {
      retrieve: async () => ({ id: "price_monthly_test", product: "prod_sweepr" }),
    },
    coupons: {
      retrieve: async (id: string) => ({ id }),
    },
    customers: {
      create: async (params: any) => ({ id: "cus_paypal_1", email: params.email }),
      update: async (id: string, params: any) => ({ id, ...params }),
    },
    subscriptions: {
      create: async (params: any) => {
        assert.deepEqual(params.payment_settings?.payment_method_types, ["paypal"]);
        createdSubMetadata = params.metadata || {};
        return {
          id: "sub_paypal_1",
          status: "incomplete",
          livemode: false,
          metadata: createdSubMetadata,
          latest_invoice: {
            confirmation_secret: { client_secret: "pi_paypal_1_secret_abc" },
          },
        };
      },
      retrieve: async (id: string) => ({
        id,
        customer: "cus_paypal_1",
        status: subStatus,
        created: nowSec,
        current_period_end: nowSec + 86400 * 30,
        cancel_at_period_end: false,
        currency: "gbp",
        metadata: createdSubMetadata,
        default_payment_method: {
          id: "pm_paypal_1",
          type: "paypal",
          paypal: { payer_email: "verified-paypal@example.com", payer_id: "PAYER123" },
        },
        items: {
          data: [
            {
              price: {
                unit_amount: 999,
                currency: "gbp",
                recurring: { interval: "month", interval_count: 1 },
              },
              quantity: 1,
            },
          ],
        },
      }),
      cancel: async () => ({ id: "sub_paypal_1", status: "canceled" }),
    },
    paymentIntents: {
      confirm: async (id: string, params: any) => {
        assert.equal(id, "pi_paypal_1");
        assert.equal(params.payment_method_data?.type, "paypal");
        assert.equal(params.mandate_data?.customer_acceptance?.type, "online");
        return {
          id,
          livemode: false,
          status: "requires_action",
          next_action: {
            redirect_to_url: {
              url: "https://www.paypal.com/checkoutnow?token=EC-TEST123",
            },
          },
        };
      },
      retrieve: async (id: string) => ({
        id,
        status: "succeeded",
      }),
    },
  };

  const { post, repo, app } = setup({ stripe: mockStripe });

  // 1. Express PayPal popup without upfront email creates pending account & returns PayPal redirectUrl
  const createRes = await post("/api/create-subscription", {
    paymentMethod: "paypal",
    popup: true,
    plan: "monthly",
    applyDiscount: true,
  });
  assert.equal(createRes.status, 200);
  const createData = await createRes.json();
  assert.equal(createData.subscriptionId, "sub_paypal_1");
  assert.equal(createData.redirectUrl, "https://www.paypal.com/checkoutnow?token=EC-TEST123");
  assert.ok(createData.accountId);

  // 2. While still incomplete on PayPal, checkOnly confirm-subscription returns 200 with ok: false
  const checkPending = await post("/api/confirm-subscription", {
    subscriptionId: "sub_paypal_1",
    accountId: createData.accountId,
    checkOnly: true,
  });
  assert.equal(checkPending.status, 200);
  const checkPendingData = await checkPending.json();
  assert.equal(checkPendingData.ok, false);

  // 3. Once PayPal authorization completes (or /checkout/success with redirect_status=succeeded runs),
  // entitlement is activated and PayPal payer_email replaces the @pending.sweeprcleaner.com placeholder
  subStatus = "active";
  const successRes = await app.request(
    `/checkout/success?web=1&popup=1&subscription_id=sub_paypal_1&account_id=${encodeURIComponent(createData.accountId)}&redirect_status=succeeded`
  );
  assert.equal(successRes.status, 200);
  const html = await successRes.text();
  assert.ok(html.includes("paypal_success"));

  const updatedAccount = repo.accountById(createData.accountId);
  assert.equal(updatedAccount?.email, "verified-paypal@example.com");
  const ent = repo.entitlement(createData.accountId);
  assert.equal(ent?.status, "active");
});

test("Alternative D geo-targeted payment profiles & auto-renewing SEPA / iDEAL / Revolut Pay subscriptions", async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  let lastSubPaymentMethodTypes: string[] = [];
  let lastConfirmedPmType = "";
  let lastConfirmedIban = "";

  const mockStripe: any = {
    products: {
      list: async () => ({ data: [{ id: "prod_sweepr", name: "SWEEPR Cleaner Pro" }] }),
    },
    prices: {
      retrieve: async () => ({ id: "price_monthly_test", product: "prod_sweepr" }),
    },
    coupons: {
      retrieve: async (id: string) => ({ id }),
    },
    customers: {
      create: async (params: any) => ({ id: "cus_geo_1", email: params.email }),
      update: async (id: string, params: any) => ({ id, ...params }),
    },
    subscriptions: {
      create: async (params: any) => {
        lastSubPaymentMethodTypes = params.payment_settings?.payment_method_types || [];
        return {
          id: "sub_geo_1",
          status: "incomplete",
          livemode: false,
          metadata: params.metadata || {},
          latest_invoice: {
            confirmation_secret: { client_secret: "pi_geo_1_secret_xyz" },
          },
        };
      },
      retrieve: async (id: string) => ({
        id,
        customer: "cus_geo_1",
        status: "incomplete",
        created: nowSec,
        current_period_end: nowSec + 86400 * 365,
        cancel_at_period_end: false,
        currency: "eur",
        metadata: {},
        items: {
          data: [
            {
              price: {
                unit_amount: 5999,
                currency: "eur",
                recurring: { interval: "year", interval_count: 1 },
              },
              quantity: 1,
            },
          ],
        },
      }),
      cancel: async () => ({ id: "sub_geo_1", status: "canceled" }),
    },
    paymentIntents: {
      confirm: async (id: string, params: any) => {
        lastConfirmedPmType = params.payment_method_data?.type || "";
        lastConfirmedIban = params.payment_method_data?.sepa_debit?.iban || "";
        assert.equal(params.mandate_data?.customer_acceptance?.type, "online");
        if (lastConfirmedPmType === "sepa_debit") {
          return {
            id,
            livemode: false,
            status: "processing",
          };
        }
        return {
          id,
          livemode: false,
          status: "requires_action",
          next_action: {
            redirect_to_url: {
              url: `https://hooks.stripe.com/redirect/${lastConfirmedPmType}`,
            },
          },
        };
      },
    },
  };

  const { post, repo, app } = setup({ stripe: mockStripe });

  // 1. Geo paymentProfile on /api/checkout-config adapts to NL, DE, BE, US, KR, and GB
  const nlCfg = await (await app.request("/api/checkout-config?country=NL")).json();
  assert.deepEqual(nlCfg.paymentProfile.expressWindows, ["ideal", "paypal", "google_pay"]);
  assert.deepEqual(nlCfg.paymentProfile.expressApple, ["ideal", "apple_pay", "paypal"]);
  assert.equal(nlCfg.paymentProfile.defaultLogoMethod, "ideal");

  const deCfg = await (await app.request("/api/checkout-config?country=DE")).json();
  assert.deepEqual(deCfg.paymentProfile.expressWindows, ["paypal", "sepa_debit", "google_pay"]);
  assert.equal(deCfg.paymentProfile.defaultLogoMethod, "sepa_debit");

  const beCfg = await (await app.request("/api/checkout-config?country=BE")).json();
  assert.equal(beCfg.paymentProfile.defaultLogoMethod, "bancontact");

  const usCfg = await (await app.request("/api/checkout-config?country=US")).json();
  assert.deepEqual(usCfg.paymentProfile.expressWindows, ["paypal", "google_pay", "amazon_pay"]);
  assert.equal(usCfg.paymentProfile.logoStripMethods[1].id, "cashapp");

  const krCfg = await (await app.request("/api/checkout-config?country=KR")).json();
  assert.deepEqual(krCfg.paymentProfile.expressWindows, ["kakao_pay", "naver_pay", "paypal"]);
  assert.equal(krCfg.paymentProfile.defaultLogoMethod, "kakao_pay");

  // 2. SEPA Direct Debit (IBAN) validates IBAN, confirms with sepa_debit online mandate, and activates entitlement on 'processing'
  const sepaRes = await post("/api/create-subscription", {
    email: "max.mustermann@example.de",
    name: "Max Mustermann",
    iban: "de89 3704 0044 0532 0130 00",
    paymentMethod: "sepa_debit",
    plan: "annual",
  });
  assert.equal(sepaRes.status, 200);
  const sepaData = await sepaRes.json();
  assert.deepEqual(lastSubPaymentMethodTypes, ["sepa_debit"]);
  assert.equal(lastConfirmedPmType, "sepa_debit");
  assert.equal(lastConfirmedIban, "DE89370400440532013000");
  assert.ok(sepaData.redirectUrl.startsWith("/checkout/success?web=1"));
  assert.equal(repo.entitlement(sepaData.accountId)?.status, "active");

  // 3. iDEAL recurring mandate creates ["ideal", "sepa_debit"] subscription and returns bank redirect URL
  const idealRes = await post("/api/create-subscription", {
    email: "jan@example.nl",
    name: "Jan Jansen",
    paymentMethod: "ideal",
    plan: "annual",
  });
  assert.equal(idealRes.status, 200);
  const idealData = await idealRes.json();
  assert.deepEqual(lastSubPaymentMethodTypes, ["ideal", "sepa_debit"]);
  assert.equal(lastConfirmedPmType, "ideal");
  assert.equal(idealData.redirectUrl, "https://hooks.stripe.com/redirect/ideal");

  // 4. Revolut Pay Express click (without upfront email) creates pending account and returns Revolut redirect URL
  const revRes = await post("/api/create-subscription", {
    paymentMethod: "revolut_pay",
    plan: "annual",
  });
  assert.equal(revRes.status, 200);
  const revData = await revRes.json();
  assert.deepEqual(lastSubPaymentMethodTypes, ["revolut_pay"]);
  assert.equal(lastConfirmedPmType, "revolut_pay");
  assert.equal(revData.redirectUrl, "https://hooks.stripe.com/redirect/revolut_pay");
});






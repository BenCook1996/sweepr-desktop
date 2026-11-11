import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { sha256 } from "../src/tokens.js";
import { createRateLimiter, escapeHtml, normalizeEmail } from "../src/security.js";
import { isPrivateOrLoopbackIp } from "../src/pricing.js";

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
  assert.equal(missingRes.status, 200);
  const missing = await missingRes.json();
  assert.equal(missing.ok, true);

  const unpaidLeadRes = await post("/api/portal-login", { email: "leadonly@example.com" });
  assert.equal(unpaidLeadRes.status, 200);
  const unpaidLead = await unpaidLeadRes.json();
  assert.equal(unpaidLead.ok, true);

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

test("download streams installer with Content-Length and Authenticode + manifest SHA-256 parity", async () => {
  const { app } = setup();
  const res = await app.request("/download?platform=windows");
  if (existsSync("./public/SWEEPRCleaner.exe")) {
    const exeStat = statSync("./public/SWEEPRCleaner.exe");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-length"), String(exeStat.size));
    assert.equal(res.headers.get("content-disposition"), 'attachment; filename="SWEEPRCleaner.exe"');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.length, exeStat.size);

    // Verify embedded SSL.com Authenticode signature & RFC 3161 timestamp in the tail of the PE binary
    const tailText = buf.subarray(Math.max(0, buf.length - 32768)).toString("latin1");
    assert.ok(
      tailText.includes("SSL.com Code Signing Intermediate CA"),
      "SWEEPRCleaner.exe must contain an embedded SSL.com Authenticode signature"
    );
    assert.ok(
      tailText.includes("SSL.com Timestamping Unit"),
      "SWEEPRCleaner.exe must contain an embedded RFC 3161 timestamp"
    );

    // Verify byte-size parity with server/public/pad.xml
    if (existsSync("./public/pad.xml")) {
      const padXml = readFileSync("./public/pad.xml", "utf8");
      const padBytes = (padXml.match(/<File_Size_Bytes>(\d+)<\/File_Size_Bytes>/) || [])[1];
      assert.equal(padBytes, String(exeStat.size), "pad.xml <File_Size_Bytes> must match SWEEPRCleaner.exe size");
    }

    // Verify SHA-256 parity with winget installer manifest
    const wingetPath = "../winget-manifests/s/SWEEPR/Cleaner/0.1.0/SWEEPR.Cleaner.installer.yaml";
    if (existsSync(wingetPath)) {
      const wingetYaml = readFileSync(wingetPath, "utf8");
      const manifestSha = (wingetYaml.match(/InstallerSha256:\s*([A-Fa-f0-9]{64})/) || [])[1]?.toUpperCase();
      const actualSha = createHash("sha256").update(buf).digest("hex").toUpperCase();
      assert.equal(manifestSha, actualSha, "Winget InstallerSha256 must match signed SWEEPRCleaner.exe SHA-256");
    }
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

  // Secondary device token cannot delete the entire account (MED-04)
  const secondaryDelRes = await app.request("/v1/account", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${refresh_token}`,
    },
    body: JSON.stringify({ device_id: devId }),
  });
  assert.equal(secondaryDelRes.status, 403);

  // Deletion request via primary account Bearer token succeeds
  const delRes = await app.request("/v1/account", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer tok_del",
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
  const { post, repo, app } = setup({
    latestAppVersion: "0.2.0",
    minAppVersion: "0.1.5",
    latestAndroidVersion: "1.1.0",
    minAndroidVersion: "1.0.5",
  });

  // 1. Auto-updater returns 204 when up-to-date and 200 manifest when outdated
  const upToDate = await app.request("/v1/updates/windows/x86_64/0.2.0");
  assert.equal(upToDate.status, 204);
  const outdated = await app.request("/v1/updates/windows/x86_64/0.1.0");
  assert.equal(outdated.status, 200);
  const manifest = await outdated.json();
  assert.equal(manifest.version, "0.2.0");
  assert.equal(manifest.latest_version, "0.2.0");
  assert.equal(manifest.min_version, "0.1.5");
  assert.equal(manifest.force_update, true);
  assert.equal(manifest.update_available, true);
  assert.ok(manifest.url.includes("/download?platform=windows"));

  // Android Play Store update manifest check (forced when below min_version, flexible when >= min_version)
  const androidForce = await (
    await app.request("/v1/updates/latest.json?platform=android&current_version=1.0.0")
  ).json();
  assert.equal(androidForce.latest_version, "1.1.0");
  assert.equal(androidForce.min_version, "1.0.5");
  assert.equal(androidForce.update_available, true);
  assert.equal(androidForce.force_update, true);
  assert.equal(androidForce.play_store_url, "https://play.google.com/store/apps/details?id=com.sweepr.app");
  assert.equal(androidForce.market_uri, "market://details?id=com.sweepr.app");

  const androidFlex = await (
    await app.request("/v1/updates/latest.json?platform=android&current_version=1.0.5")
  ).json();
  assert.equal(androidFlex.update_available, true);
  assert.equal(androidFlex.force_update, false);

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

test("Security audit regression: isPrivateOrLoopbackIp full-spectrum IPv4 and IPv6 filtering", () => {
  // IPv4 Loopback & Special
  assert.equal(isPrivateOrLoopbackIp("127.0.0.1"), true);
  assert.equal(isPrivateOrLoopbackIp("127.0.0.2"), true);
  assert.equal(isPrivateOrLoopbackIp("127.255.255.254"), true);
  assert.equal(isPrivateOrLoopbackIp("0.0.0.0"), true);
  assert.equal(isPrivateOrLoopbackIp("0.1.2.3"), true);

  // Private RFC 1918 & CGNAT & Link-Local
  assert.equal(isPrivateOrLoopbackIp("10.0.0.1"), true);
  assert.equal(isPrivateOrLoopbackIp("172.16.0.1"), true);
  assert.equal(isPrivateOrLoopbackIp("172.31.255.255"), true);
  assert.equal(isPrivateOrLoopbackIp("192.168.1.1"), true);
  assert.equal(isPrivateOrLoopbackIp("100.64.0.1"), true);
  assert.equal(isPrivateOrLoopbackIp("100.127.255.255"), true);
  assert.equal(isPrivateOrLoopbackIp("169.254.1.1"), true);

  // Multicast / Reserved / Docs
  assert.equal(isPrivateOrLoopbackIp("224.0.0.1"), true);
  assert.equal(isPrivateOrLoopbackIp("240.0.0.1"), true);
  assert.equal(isPrivateOrLoopbackIp("255.255.255.255"), true);
  assert.equal(isPrivateOrLoopbackIp("192.0.2.1"), true);
  assert.equal(isPrivateOrLoopbackIp("198.51.100.1"), true);
  assert.equal(isPrivateOrLoopbackIp("203.0.113.1"), true);
  assert.equal(isPrivateOrLoopbackIp("198.18.0.1"), true);

  // IPv6 Loopback, Unspecified, Unique-Local, Link-Local, Multicast
  assert.equal(isPrivateOrLoopbackIp("::1"), true);
  assert.equal(isPrivateOrLoopbackIp("0:0:0:0:0:0:0:1"), true);
  assert.equal(isPrivateOrLoopbackIp("::"), true);
  assert.equal(isPrivateOrLoopbackIp("fc00::1"), true);
  assert.equal(isPrivateOrLoopbackIp("fd12:3456:789a::1"), true);
  assert.equal(isPrivateOrLoopbackIp("fe80::1"), true);
  assert.equal(isPrivateOrLoopbackIp("ff02::1"), true);

  // IPv4-Mapped & IPv4-Compatible
  assert.equal(isPrivateOrLoopbackIp("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateOrLoopbackIp("::ffff:192.168.1.1"), true);
  assert.equal(isPrivateOrLoopbackIp("::127.0.0.1"), true);

  // Invalid / non-IP strings
  assert.equal(isPrivateOrLoopbackIp("local"), true);
  assert.equal(isPrivateOrLoopbackIp(""), true);
  assert.equal(isPrivateOrLoopbackIp("not-an-ip"), true);

  // Valid public IPs
  assert.equal(isPrivateOrLoopbackIp("8.8.8.8"), false);
  assert.equal(isPrivateOrLoopbackIp("1.1.1.1"), false);
  assert.equal(isPrivateOrLoopbackIp("93.184.216.34"), false);
  assert.equal(isPrivateOrLoopbackIp("2606:4700:4700::1111"), false);
});

test("Security audit regression: /api/portal/devices/remove rejects cross-origin CSRF", async () => {
  const { app, post } = setup();

  // Cross-origin request with foreign origin must be rejected with 403
  const res = await post(
    "/api/portal/devices/remove",
    { device_id: "test-dev-123" },
    {
      origin: "https://attacker.evil.com",
      "sec-fetch-site": "cross-site",
    }
  );
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, "forbidden_origin");
});

test("Cloudflare Security Audit regressions: CRIT-01..05, HIGH-01..10, MED-01..10", async () => {
  const mockStripe: any = {
    subscriptions: {
      retrieve: async (id: string) => ({
        id,
        status: "incomplete",
        customer: "cus_unpaid_1",
        metadata: { account_id: "acc_unpaid_1", plan: "annual" },
        latest_invoice: {
          payment_intent: {
            id: "pi_unpaid_1",
            status: "requires_payment_method",
          },
        },
      }),
    },
    paymentIntents: {
      retrieve: async (id: string) => ({
        id,
        status: id === "pi_other_succeeded" ? "succeeded" : "requires_payment_method",
        customer: id === "pi_other_succeeded" ? "cus_unrelated" : "cus_unpaid_1",
        metadata: {},
      }),
    },
    webhooks: {
      constructEventAsync: async () => {
        throw new Error("Invalid signature");
      },
    },
    events: {
      retrieve: async (id: string) => ({
        id,
        type: "customer.subscription.created",
        data: { object: { id: "sub_spoofed", status: "active" } },
      }),
    },
  };

  const { app, post, repo } = setup({
    stripe: mockStripe,
    stripeWebhookSecret: "whsec_real_secret",
    trustProxy: true,
  });

  // CRIT-01: Forged redirect_status=succeeded and unrelated payment_intent on /checkout/success must NOT activate incomplete sub
  repo.createAccount("acc_unpaid_1", sha256("tok_unpaid_1"), "unpaid@example.com");
  const forgedSuccess = await app.request(
    "/checkout/success?web=1&subscription_id=sub_unpaid_1&account_id=acc_unpaid_1&redirect_status=succeeded&payment_intent=pi_other_succeeded"
  );
  assert.equal(forgedSuccess.status, 302);
  assert.match(forgedSuccess.headers.get("location") ?? "", /error=payment_cancelled/);
  assert.equal(repo.entitlement("acc_unpaid_1"), undefined);

  // CRIT-02: /v1/checkout with another user's entitled email must require OTP and NOT return token or evict victim devices
  const nowSec = Math.floor(Date.now() / 1000);
  repo.createAccount("acc_victim", sha256("tok_victim"), "victim@example.com");
  repo.upsertEntitlement({
    account_id: "acc_victim",
    stripe_subscription_id: "sub_victim_paid",
    status: "active",
    plan: "annual",
    current_period_end: nowSec + 30 * 86400,
    cancel_at_period_end: 0,
  });
  repo.touchDevice("acc_victim", "1".repeat(64), "pc", 3, 2);

  repo.createAccount("acc_attacker", sha256("tok_attacker"));
  const takeoverAttempt = await post(
    "/v1/checkout",
    { email: "victim@example.com", device_id: "2".repeat(64) },
    { authorization: "Bearer tok_attacker" }
  );
  assert.equal(takeoverAttempt.status, 200);
  const takeoverBody = await takeoverAttempt.json();
  assert.equal(takeoverBody.requires_otp, true);
  assert.equal(takeoverBody.activated, false);
  assert.equal(takeoverBody.token, undefined);
  assert.equal(takeoverBody.refresh_token, undefined);

  // CRIT-03: /v1/billing/google-play/verify rejects unauthenticated binding to existing email (401) and fails closed (503)
  const gpUnauth = await post("/v1/billing/google-play/verify", {
    email: "victim@example.com",
    product_id: "sweepr_annual",
    purchase_token: "fake_purchase_token_12345",
  });
  assert.equal(gpUnauth.status, 401);
  const gpClosed = await post("/v1/billing/google-play/verify", {
    product_id: "sweepr_annual",
    purchase_token: "fake_purchase_token_12345",
  });
  assert.equal(gpClosed.status, 503);

  // CRIT-05: Hardcoded Softpedia backdoor account and OTP must not exist
  assert.equal(repo.accountById("acc_editorial_softpedia"), undefined);
  assert.equal(repo.verifyOtp("andrei.verdeanu@softpedia.com", sha256("749204"), nowSec), false);

  // HIGH-01: Unpaid free-trial account cannot mint referral rewards
  repo.createAccount("acc_trial_ref", sha256("tok_trial_ref"), "trialref@example.com");
  const trialRefCode = repo.ensureReferralCode("acc_trial_ref");
  assert.equal(trialRefCode.length, 14); // SWP- + 10 random hex chars
  repo.upsertEntitlement({
    account_id: "acc_trial_ref",
    stripe_subscription_id: null,
    status: "trialing",
    plan: "monthly",
    current_period_end: nowSec + 7 * 86400,
    cancel_at_period_end: 0,
  });
  repo.createAccount("acc_ref_target", sha256("tok_ref_target"));
  assert.equal(repo.applyReferral("acc_ref_target", trialRefCode, nowSec), false);

  // HIGH-02: Stripe webhook rejects invalid signature without falling back to stripe.events.retrieve
  const whRes = await app.request("/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=123,v1=forged" },
    body: JSON.stringify({ id: "evt_spoofed_123" }),
  });
  assert.equal(whRes.status, 400);

  // HIGH-04: Geo-pricing prioritizes CF-IPCountry over spoofed X-Timezone
  const pricingRes = await app.request("/api/checkout-config", {
    headers: {
      "cf-ipcountry": "GB",
      "x-timezone": "Asia/Kolkata",
    },
  });
  assert.equal(pricingRes.status, 200);
  const pricingBody = await pricingRes.json();
  assert.equal(pricingBody.country, "GB");
  assert.equal(pricingBody.currency, "gbp");

  // HIGH-08: Activation key stored under activation:<email> survives /api/portal-login and is single-use
  repo.setOtp("activation:victim@example.com", sha256("888999"), nowSec + 7 * 86400);
  await post("/api/portal-login", { email: "victim@example.com" });
  assert.equal(repo.verifyOtp("victim@example.com", sha256("888999"), nowSec), true);
  assert.equal(repo.verifyOtp("victim@example.com", sha256("888999"), nowSec), false); // Single-use

  // HIGH-09: Logout immediately invalidates a copied sweepr_session cookie server-side
  repo.setOtp("victim@example.com", sha256("777666"), nowSec + 600);
  const loginRes = await post("/api/verify-otp", { email: "victim@example.com", code: "777666" });
  assert.equal(loginRes.status, 200);
  const sessionCookie = (loginRes.headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(sessionCookie.startsWith("sweepr_session="));

  const dashBefore = await app.request("/api/dashboard-data", {
    headers: { cookie: sessionCookie },
  });
  assert.equal(dashBefore.status, 200);

  const logoutRes = await post("/api/logout", {}, { cookie: sessionCookie });
  assert.equal(logoutRes.status, 200);

  const dashAfter = await app.request("/api/dashboard-data", {
    headers: { cookie: sessionCookie },
  });
  assert.equal(dashAfter.status, 401);
});

test("Desktop Tauri & Web CORS middleware allows trusted origins on /api/* and /v1/* and rejects untrusted origins", async () => {
  const { app } = setup();
  const allowedOrigins = [
    "https://sweeprcleaner.com",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
    "http://localhost:1420",
  ];

  for (const origin of allowedOrigins) {
    const preflight = await app.request("/v1/telemetry/event", {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "Content-Type, Authorization, X-Poll-Secret",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    assert.equal(preflight.headers.get("access-control-allow-methods"), "GET,POST,OPTIONS");
    assert.equal(
      preflight.headers.get("access-control-allow-headers"),
      "Content-Type,Authorization,X-Poll-Secret"
    );

    const apiGet = await app.request("/api/pricing", {
      method: "GET",
      headers: { origin },
    });
    assert.equal(apiGet.status, 200);
    assert.equal(apiGet.headers.get("access-control-allow-origin"), origin);
  }

  const blocked = await app.request("/api/pricing", {
    method: "GET",
    headers: { origin: "https://evil.example" },
  });
  assert.equal(blocked.headers.get("access-control-allow-origin"), null);
});

test("Stripe webhook idempotency only marks processed after handler succeeds, and missing MYskiOdE coupon is omitted", async () => {
  const { handleStripeWebhook } = await import("../src/stripe.js");
  let shouldThrowOnRetrieve = true;
  let lastSubCreateParams: any = null;
  const mockStripe: any = {
    products: {
      list: async () => ({ data: [{ id: "prod_sweepr", name: "SWEEPR Cleaner Pro" }] }),
    },
    prices: {
      retrieve: async () => ({ id: "price_monthly_test", product: "prod_sweepr" }),
    },
    coupons: {
      retrieve: async () => {
        throw new Error("No such coupon: 'MYskiOdE'");
      },
      create: async () => {
        throw new Error("Coupon creation disabled in test");
      },
    },
    customers: {
      create: async (params: any) => ({ id: "cus_coupon_test", email: params.email }),
      update: async (id: string, params: any) => ({ id, ...params }),
    },
    subscriptions: {
      retrieve: async (id: string) => {
        if (shouldThrowOnRetrieve) {
          throw new Error("Transient Stripe API timeout");
        }
        return {
          id,
          status: "active",
          customer: "cus_retry_1",
          metadata: { account_id: "acc_retry_1", plan: "annual" },
          current_period_end: Math.floor(Date.now() / 1000) + 86400 * 365,
          items: {
            data: [
              {
                price: {
                  unit_amount: 4999,
                  currency: "gbp",
                  recurring: { interval: "year", interval_count: 1 },
                },
                quantity: 1,
              },
            ],
          },
        };
      },
      create: async (params: any) => {
        lastSubCreateParams = params;
        return {
          id: "sub_no_coupon_1",
          status: "incomplete",
          livemode: false,
          metadata: params.metadata || {},
          latest_invoice: {
            confirmation_secret: { client_secret: "pi_no_coupon_1_secret_xyz" },
          },
        };
      },
    },
  };

  const { repo, post } = setup({ stripe: mockStripe });
  repo.createAccount("acc_retry_1", sha256("tok_retry_1"), "retry@example.com");

  const checkoutCompletedEvent: any = {
    id: "evt_retry_test_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_retry_1",
        customer: "cus_retry_1",
        client_reference_id: "acc_retry_1",
        subscription: "sub_retry_1",
      },
    },
  };

  // 1. First attempt throws transient error -> must NOT be marked processed
  await assert.rejects(
    () => handleStripeWebhook(mockStripe, repo, checkoutCompletedEvent),
    /Transient Stripe API timeout/
  );
  assert.equal(repo.isWebhookProcessed("evt_retry_test_1"), false);

  // 2. Retry succeeds -> marks event processed and grants active entitlement
  shouldThrowOnRetrieve = false;
  const retryRes = await handleStripeWebhook(mockStripe, repo, checkoutCompletedEvent);
  assert.equal(retryRes.duplicate, false);
  assert.equal(repo.isWebhookProcessed("evt_retry_test_1"), true);
  assert.equal(repo.entitlement("acc_retry_1")?.status, "active");

  // 3. Subsequent delivery of the same event.id returns { duplicate: true } immediately
  const dupRes = await handleStripeWebhook(mockStripe, repo, checkoutCompletedEvent);
  assert.equal(dupRes.duplicate, true);

  // 4. When coupon MYskiOdE does not exist in Stripe, /api/create-subscription omits discounts rather than attaching an unverified coupon
  const subRes = await post("/api/create-subscription", {
    email: "nocoupon@example.com",
    plan: "monthly",
    applyDiscount: true,
    paymentMethod: "card",
  });
  assert.equal(subRes.status, 200);
  assert.equal(lastSubCreateParams?.discounts, undefined);
});

test("Cancel-save downgrade (/api/portal/switch-to-monthly) updates Stripe subscription item price to monthly for customer currency", async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  let lastSubUpdateId = "";
  let lastSubUpdateParams: any = null;
  let createdPriceParams: any = null;

  const mockStripe: any = {
    products: {
      list: async () => ({ data: [{ id: "prod_sweepr", name: "SWEEPR Cleaner Pro" }] }),
    },
    prices: {
      retrieve: async () => ({
        id: "price_gbp_monthly",
        product: "prod_sweepr",
        currency: "gbp",
        unit_amount: 999,
        recurring: { interval: "month", interval_count: 1 },
      }),
      list: async () => ({ data: [] }),
      create: async (params: any) => {
        createdPriceParams = params;
        return {
          id: `price_monthly_${params.currency}_${params.unit_amount}`,
          ...params,
        };
      },
    },
    subscriptions: {
      retrieve: async (id: string) => ({
        id,
        status: "active",
        customer: "cus_downgrade_1",
        currency: "eur",
        current_period_end: nowSec + 86400 * 30,
        cancel_at_period_end: true,
        metadata: { account_id: "acc_downgrade_1", plan: "annual" },
        items: {
          data: [
            {
              id: "si_annual_item_1",
              price: {
                id: "price_annual_eur_5999",
                currency: "eur",
                unit_amount: 5999,
                recurring: { interval: "year", interval_count: 1 },
              },
              quantity: 1,
            },
          ],
        },
      }),
      update: async (id: string, params: any) => {
        lastSubUpdateId = id;
        lastSubUpdateParams = params;
        return { id, status: "active", ...params };
      },
    },
  };

  const { repo, post, app } = setup({ stripe: mockStripe, priceMonthly: "price_gbp_monthly" });
  repo.createAccount("acc_downgrade_1", sha256("tok_dg_1"), "downgrade@example.de");
  repo.setCustomer("acc_downgrade_1", "cus_downgrade_1", "downgrade@example.de");
  repo.upsertEntitlement({
    account_id: "acc_downgrade_1",
    stripe_subscription_id: "sub_downgrade_1",
    status: "active",
    plan: "annual",
    current_period_end: nowSec + 86400 * 30,
    cancel_at_period_end: 1,
  });

  repo.setOtp("downgrade@example.de", sha256("445566"), nowSec + 600);
  const loginRes = await post("/api/verify-otp", { email: "downgrade@example.de", code: "445566" });
  const sessionCookie = (loginRes.headers.get("set-cookie") ?? "").split(";")[0];

  const switchRes = await app.request("/api/portal/switch-to-monthly", {
    method: "POST",
    headers: { cookie: sessionCookie, "content-type": "application/json" },
  });
  assert.equal(switchRes.status, 200);
  const switchBody = await switchRes.json();
  assert.equal(switchBody.ok, true);
  assert.equal(switchBody.plan, "monthly");
  assert.equal(switchBody.cancel_at_period_end, false);

  // Verify getOrCreatePlanPriceId created/resolved the EUR monthly price (1099 cents) and passed items[{ id, price }] to stripe.subscriptions.update
  assert.equal(createdPriceParams?.currency, "eur");
  assert.equal(createdPriceParams?.unit_amount, 1099);
  assert.equal(lastSubUpdateId, "sub_downgrade_1");
  assert.deepEqual(lastSubUpdateParams?.items, [
    { id: "si_annual_item_1", price: "price_monthly_eur_1099" },
  ]);
  assert.equal(lastSubUpdateParams?.cancel_at_period_end, false);
  assert.equal(lastSubUpdateParams?.metadata?.plan, "monthly");
  assert.equal(repo.entitlement("acc_downgrade_1")?.plan, "monthly");
  assert.equal(repo.entitlement("acc_downgrade_1")?.cancel_at_period_end, 0);
});

test("/v1/billing/google-play/verify supports both subscriptionsv2 and one-time add-on products endpoints", async () => {
  const { repo, post } = setup();
  const prevAccessToken = process.env.GOOGLE_PLAY_ACCESS_TOKEN;
  const prevFetch = globalThis.fetch;
  process.env.GOOGLE_PLAY_ACCESS_TOKEN = "gp_test_token_123";

  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes("/purchases/subscriptionsv2/tokens/gp_sub_tok_annual_123456")) {
      return new Response(
        JSON.stringify({
          subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
          lineItems: [{ productId: "sweepr_annual_4999" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.includes("/purchases/products/sweepr_battery_care_999/tokens/gp_prod_tok_battery_123456")) {
      return new Response(
        JSON.stringify({
          purchaseState: 0,
          productId: "sweepr_battery_care_999",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  }) as typeof fetch;

  try {
    // 1. Verify subscription via purchases/subscriptionsv2/tokens/...
    const subRes = await post("/v1/billing/google-play/verify", {
      product_id: "sweepr_annual_4999",
      purchase_token: "gp_sub_tok_annual_123456",
      device_id: "android_dev_sub_1",
      project_id: "cleaner",
    });
    assert.equal(subRes.status, 200);
    const subBody = await subRes.json();
    assert.equal(subBody.active, true);
    assert.equal(subBody.plan, "annual");
    assert.ok(
      requestedUrls.some((u) =>
        u.includes("/purchases/subscriptionsv2/tokens/gp_sub_tok_annual_123456")
      )
    );

    // 2. Verify one-time add-on via purchases/products/{productId}/tokens/{token}
    const addonRes = await post(
      "/v1/billing/google-play/verify",
      {
        product_id: "sweepr_battery_care_999",
        purchase_token: "gp_prod_tok_battery_123456",
        device_id: "android_dev_sub_1",
        project_id: "cleaner",
      },
      { authorization: `Bearer ${subBody.refresh_token}` }
    );
    assert.equal(addonRes.status, 200);
    const addonBody = await addonRes.json();
    assert.equal(addonBody.active, true);
    assert.equal(addonBody.plan, "annual");
    assert.ok(addonBody.addons.includes("battery_care"));
    assert.ok(
      requestedUrls.some((u) =>
        u.includes("/purchases/products/sweepr_battery_care_999/tokens/gp_prod_tok_battery_123456")
      )
    );
    assert.deepEqual(repo.addonsForAccount(subBody.account_id), ["battery_care"]);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevAccessToken === undefined) {
      delete process.env.GOOGLE_PLAY_ACCESS_TOKEN;
    } else {
      process.env.GOOGLE_PLAY_ACCESS_TOKEN = prevAccessToken;
    }
  }
});

test("Mobile /download routes Android to Google Play + SHA-256 APK landing and iOS to App Store + PC/Mac email capture", async () => {
  const { app, post } = setup();

  // 1. Android User-Agent gets clean HTML landing page (no forced raw .apk sideload)
  const androidRes = await app.request("/download", {
    headers: {
      "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36",
    },
  });
  assert.equal(androidRes.status, 200);
  assert.match(androidRes.headers.get("content-type") ?? "", /text\/html/i);
  const androidHtml = await androidRes.text();
  assert.ok(androidHtml.includes("https://play.google.com/store/apps/details?id=com.sweepr.app"));
  assert.ok(androidHtml.includes("Verified SHA-256:"));
  assert.ok(androidHtml.includes("/download?platform=android&direct=1"));
  assert.ok(androidHtml.includes("Send PC &amp; Mac Download Link to My Email"));

  // 2. iOS User-Agent gets clean HTML landing page (no unsigned .mobileconfig MDM stream)
  const iosRes = await app.request("/download", {
    headers: {
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    },
  });
  assert.equal(iosRes.status, 200);
  assert.match(iosRes.headers.get("content-type") ?? "", /text\/html/i);
  const iosHtml = await iosRes.text();
  assert.ok(iosHtml.includes("Send PC &amp; Mac Download Link to My Email"));
  assert.ok(iosHtml.includes("/ios-app"));
  assert.ok(iosHtml.includes("https://testflight.apple.com"));
  assert.ok(!iosHtml.includes("application/x-apple-aspen-config"));

  // 3. Cross-device email capture on mobile binds lead and returns ok
  const bindRes = await post("/api/download-recovery/bind-email", {
    email: "mobile.visitor@example.com",
    platform: "ios",
    send_desktop_link: true,
  });
  assert.equal(bindRes.status, 200);
  const bindData = await bindRes.json();
  assert.equal(bindData.ok, true);
  assert.equal(bindData.email, "mobile.visitor@example.com");
});

test("Referral loop: referred checkout followed by invoice.paid webhook retains full +30-day bonus_seconds extension and records referral_aha_clicked", async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const basePeriodEnd = nowSec + 30 * 86400;
  const referrerBaseEnd = nowSec + 15 * 86400;

  let referrerCode = "";
  const referredSubPayload = () => ({
    id: "sub_referred_1",
    customer: "cus_referred_1",
    status: "active",
    created: nowSec,
    current_period_start: nowSec,
    current_period_end: basePeriodEnd,
    cancel_at_period_end: false,
    currency: "usd",
    metadata: {
      account_id: "acc_referred",
      plan: "monthly",
      ref: referrerCode,
    },
    items: {
      data: [
        {
          id: "si_ref_1",
          price: {
            id: "price_monthly_usd",
            unit_amount: 1199,
            currency: "usd",
            recurring: { interval: "month", interval_count: 1 },
          },
          quantity: 1,
        },
      ],
    },
  });

  const mockStripe = {
    webhooks: {
      constructEvent: (raw: string) => JSON.parse(raw),
    },
    subscriptions: {
      retrieve: async (id: string) => {
        if (id === "sub_referred_1") return referredSubPayload();
        throw new Error(`Unexpected sub ${id}`);
      },
    },
  };

  const { repo, app, post } = setup({
    stripe: mockStripe,
    stripeWebhookSecret: "whsec_ref_test",
  });

  // 1. Seed active referrer account + entitlement
  repo.createAccount("acc_referrer", sha256("tok_referrer"), "referrer@example.com");
  repo.setCustomer("acc_referrer", "cus_referrer_1", "referrer@example.com");
  repo.upsertEntitlement({
    account_id: "acc_referrer",
    stripe_subscription_id: "sub_referrer_1",
    status: "active",
    plan: "monthly",
    current_period_end: referrerBaseEnd,
    cancel_at_period_end: 0,
  });
  referrerCode = repo.ensureReferralCode("acc_referrer");

  // 2. Seed referred account
  repo.createAccount("acc_referred", sha256("tok_referred"), "friend@example.com");
  repo.setCustomer("acc_referred", "cus_referred_1", "friend@example.com");

  const { handleStripeWebhook } = await import("../src/stripe.js");

  // 3. Fire customer.subscription.created webhook for referred checkout
  const subCreatedRes = await handleStripeWebhook(
    mockStripe as any,
    repo,
    {
      id: "evt_ref_sub_created_1",
      type: "customer.subscription.created",
      data: { object: referredSubPayload() },
    } as any
  );
  assert.equal(subCreatedRes.duplicate, false);

  const entAfterCheckout = repo.entitlement("acc_referred");
  assert.ok(entAfterCheckout);
  assert.equal(entAfterCheckout.bonus_seconds, 30 * 86400);
  assert.equal(entAfterCheckout.current_period_end, basePeriodEnd + 30 * 86400);

  const referrerEntAfterCheckout = repo.entitlement("acc_referrer");
  assert.ok(referrerEntAfterCheckout);
  assert.equal(referrerEntAfterCheckout.bonus_seconds, 30 * 86400);
  assert.equal(referrerEntAfterCheckout.current_period_end, referrerBaseEnd + 30 * 86400);

  // 4. Fire subsequent invoice.paid webhook (which re-runs syncSubscription with Stripe's basePeriodEnd)
  const invoicePaidRes = await handleStripeWebhook(
    mockStripe as any,
    repo,
    {
      id: "evt_ref_invoice_paid_1",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_referred_1",
          customer: "cus_referred_1",
          customer_email: "friend@example.com",
          subscription: "sub_referred_1",
          total: 1199,
          amount_paid: 1199,
          currency: "usd",
          created: nowSec,
        },
      },
    } as any
  );
  assert.equal(invoicePaidRes.duplicate, false);

  // Verify the +30-day extension was NOT overwritten by invoice.paid syncSubscription
  const entAfterInvoicePaid = repo.entitlement("acc_referred");
  assert.ok(entAfterInvoicePaid);
  assert.equal(entAfterInvoicePaid.bonus_seconds, 30 * 86400);
  assert.equal(entAfterInvoicePaid.current_period_end, basePeriodEnd + 30 * 86400);

  // 5. Verify referral_aha_clicked is accepted by /v1/telemetry/event
  const ahaRes = await post("/v1/telemetry/event", {
    event_name: "referral_aha_clicked",
    platform: "windows",
    account_id: "acc_referrer",
  });
  assert.equal(ahaRes.status, 200);
  const ahaBody = await ahaRes.json();
  assert.equal(ahaBody.ok, true);

  // 6. Verify GET /share/win renders dynamic OpenGraph meta tags and benchmark SVG card
  const shareWinRes = await app.request(
    `/share/win?gb=18.4%20GB&culprit=NVIDIA%20DXCache%20%2F%20ComfyUI&ms=245&code=${encodeURIComponent(referrerCode)}`
  );
  assert.equal(shareWinRes.status, 200);
  const shareWinHtml = await shareWinRes.text();
  assert.ok(shareWinHtml.includes("I Just Reclaimed 18.4 GB with SWEEPR (245ms Scan)"));
  assert.ok(shareWinHtml.includes("NVIDIA DXCache / ComfyUI"));
  assert.ok(shareWinHtml.includes(`sweeprcleaner.com/r/${referrerCode}`));
  assert.ok(shareWinHtml.includes('property="og:image"'));
  assert.ok(shareWinHtml.includes('name="twitter:card" content="summary_large_image"'));

  const svgRes = await app.request(
    `/share/win.svg?gb=18.4%20GB&culprit=NVIDIA%20DXCache&ms=245&code=${encodeURIComponent(referrerCode)}`
  );
  assert.equal(svgRes.status, 200);
  assert.match(svgRes.headers.get("content-type") ?? "", /image\/svg\+xml/i);

  // 7. Verify GET /clean, GET /benchmark, and GET /tools/pc-cache-calculator render the Windows Gaming & AI Cache Bloat Calculator
  for (const calcPath of ["/clean", "/benchmark", "/tools/pc-cache-calculator"]) {
    const calcRes = await app.request(calcPath);
    assert.equal(calcRes.status, 200);
    const calcHtml = await calcRes.text();
    assert.ok(calcHtml.includes("Windows Gaming &amp; AI Cache Bloat Calculator"));
    assert.ok(calcHtml.includes("Steam &amp; NVIDIA DXCache"));
    assert.ok(calcHtml.includes("Genshin / HoYoPlay"));
    assert.ok(calcHtml.includes("Valorant &amp; Riot"));
    assert.ok(calcHtml.includes("ComfyUI &amp; HuggingFace"));
    assert.ok(calcHtml.includes("Ollama &amp; LM Studio"));
    assert.ok(calcHtml.includes("Docker &amp; WSL2"));
    assert.ok(calcHtml.includes("JetBrains &amp; Cursor"));
    assert.ok(calcHtml.includes("Adobe Media Cache"));
  }

  // 8. Verify Web-to-Desktop 60-minute IP+OS fingerprint attribution bridge (/download?platform=windows -> app_installed & scan_started)
  repo.createAccount("acc_web_funnel", sha256("tok_web_funnel"), "webfunnel@example.com");
  const dlRes = await app.request("/download?platform=windows&attribution_id=attr_web_bridge_01", {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "x-forwarded-for": "198.51.100.77",
    },
  });
  assert.equal(dlRes.headers.get("x-sweepr-attribution-id"), "attr_web_bridge_01");
  // Associate web visitor account with recovery session
  const { associateCheckoutLeadWithRecovery } = await import("../src/download-recovery.js");
  associateCheckoutLeadWithRecovery(repo, {
    attributionId: "attr_web_bridge_01",
    email: "webfunnel@example.com",
    accountId: "acc_web_funnel",
  });

  const desktopDeviceId = "d".repeat(64);
  const installTelemetryRes = await app.request("/v1/telemetry/event", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.77",
    },
    body: JSON.stringify({
      event_name: "app_installed",
      platform: "windows",
      attribution_id: "dt_local_anon_123",
      device_id: desktopDeviceId,
      metadata: { source: "finalize_install" },
    }),
  });
  assert.equal(installTelemetryRes.status, 200);
  const installTelemetryBody = await installTelemetryRes.json();
  assert.equal(installTelemetryBody.ok, true);
  assert.equal(installTelemetryBody.attribution_id, "attr_web_bridge_01");
  assert.equal(installTelemetryBody.account_id, "acc_web_funnel");

  const scanStartTelemetryRes = await app.request("/v1/telemetry/event", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.77",
    },
    body: JSON.stringify({
      event_name: "scan_started",
      platform: "windows",
      device_id: desktopDeviceId,
    }),
  });
  assert.equal(scanStartTelemetryRes.status, 200);
  const scanStartBody = await scanStartTelemetryRes.json();
  assert.equal(scanStartBody.attribution_id, "attr_web_bridge_01");
  assert.equal(scanStartBody.account_id, "acc_web_funnel");

  const recoveryRow = repo.db
    .prepare("SELECT * FROM download_recovery_sessions WHERE attribution_id = ?")
    .get("attr_web_bridge_01") as any;
  assert.ok(recoveryRow);
  assert.ok(Number(recoveryRow.installed_at) > 0);
  assert.equal(recoveryRow.ip_os_fingerprint, "198.51.100.77|windows");
  assert.equal(recoveryRow.matched_device_id, desktopDeviceId);
  assert.equal(recoveryRow.account_id, "acc_web_funnel");

  const linkedDeviceRow = repo.db
    .prepare("SELECT * FROM devices WHERE id = ? AND account_id = ?")
    .get(desktopDeviceId, "acc_web_funnel") as any;
  assert.ok(linkedDeviceRow, "Desktop device should be linked to the web visitor's account");
});

test("Multi-currency purchase telemetry on /checkout/success: injects actual Stripe amount_total/100, uppercase currency, and plan tier", async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const mockStripe: any = {
    checkout: {
      sessions: {
        retrieve: async (id: string) => ({
          id,
          subscription: "sub_usd_6m",
          amount_total: 4799,
          currency: "usd",
          metadata: { account_id: "acc_usd_1", plan: "six_month" },
        }),
      },
    },
    subscriptions: {
      retrieve: async (id: string) => ({
        id,
        status: "active",
        currency: "usd",
        created: nowSec,
        current_period_start: nowSec,
        current_period_end: nowSec + 180 * 86400,
        cancel_at_period_end: false,
        metadata: { account_id: "acc_usd_1", plan: "six_month" },
        items: {
          data: [
            {
              price: {
                unit_amount: 4799,
                currency: "usd",
                recurring: { interval: "month", interval_count: 6 },
              },
            },
          ],
        },
        latest_invoice: {
          amount_paid: 4799,
          currency: "usd",
          payment_intent: { id: "pi_usd_6m", status: "succeeded", amount: 4799, currency: "usd" },
        },
      }),
    },
  };

  const { repo, app } = setup({ stripe: mockStripe });
  repo.createAccount("acc_usd_1", "usdbuyer@example.com");

  const res = await app.request("/checkout/success?web=1&session_id=cs_test_usd_6m&account_id=acc_usd_1", {
    method: "GET",
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("value:47.99"), "Should inject actual amount_total / 100 (47.99)");
  assert.ok(html.includes('currency:"USD"'), "Should inject uppercase currency USD");
  assert.ok(html.includes('plan:"six_month"'), "Should inject actual plan tier six_month");
  assert.ok(html.includes("gtag('event','purchase'"), "Should include gtag purchase event call");
  assert.ok(html.includes("fbq('track','Purchase'"), "Should include fbq Purchase event call");
  assert.ok(!html.includes("value:49.99,currency:'GBP'"), "Must not contain hardcoded 49.99 GBP");
});














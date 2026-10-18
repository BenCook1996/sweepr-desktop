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
    stripe: null,
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

test("OTP: no account enumeration, hashed storage, lockout after 5 failures, secure cookie + logout", async () => {
  const { post, repo, app } = setup({ publicUrl: "https://sweepr.example" });
  repo.createAccount("acc_1", sha256("tok"), "user@example.com");

  const exists = await (await post("/api/portal-login", { email: " User@Example.com " })).json();
  const missing = await (await post("/api/portal-login", { email: "nobody@example.com" })).json();
  assert.deepEqual(exists, { otpSent: true });
  assert.deepEqual(missing, { otpSent: true });
  assert.equal((await post("/api/portal-login", { email: "not-an-email" })).status, 400);

  const row = repo.db.prepare("SELECT * FROM otps WHERE email = ?").get("user@example.com") as any;
  assert.ok(row);
  assert.match(row.code, /^[a-f0-9]{64}$/, "OTP must be stored hashed");
  assert.equal(repo.db.prepare("SELECT * FROM otps WHERE email = ?").get("nobody@example.com"), undefined);

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

  const out = await app.request("/api/logout", { method: "POST" });
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
});




import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { openDb } from "../src/db.js";
import { createApp, isEntitled } from "../src/app.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const DEVICE = "a".repeat(64);

function setup(now = () => Math.floor(Date.now() / 1000)) {
  const repo = openDb(":memory:");
  const app = createApp({
    repo, signingKey: privateKey, stripe: null, now,
    config: {
      publicUrl: "http://test", stripeWebhookSecret: "", priceActivation: "", priceMonthly: "",
      trialDays: 7, tokenTtlHours: 72, maxDevicesPc: 3, maxDevicesMobile: 2, devEndpoints: true, pastDueGraceDays: 3,
    },
  });
  const post = (path: string, body: unknown, token?: string) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  return { repo, app, post };
}

test("unpaid account gets no token", async () => {
  const { post } = setup();
  const acc = await (await post("/v1/accounts", { device_id: DEVICE })).json();
  const r = await (await post("/v1/entitlement", { device_id: DEVICE }, acc.refresh_token)).json();
  assert.equal(r.token, null);
  assert.equal(r.status, "none");
});

test("rejects missing or bad refresh token", async () => {
  const { post } = setup();
  assert.equal((await post("/v1/entitlement", { device_id: DEVICE })).status, 401);
  assert.equal((await post("/v1/entitlement", { device_id: DEVICE }, "nope")).status, 401);
});

test("entitled account receives a valid Ed25519 token bound to device", async () => {
  const { post } = setup();
  const acc = await (await post("/v1/accounts", { device_id: DEVICE })).json();
  await post("/dev/grant", { account_id: acc.account_id, status: "trialing", days: 7 });
  const r = await (await post("/v1/entitlement", { device_id: DEVICE }, acc.refresh_token)).json();
  assert.ok(r.token);
  const [h, p, s] = r.token.split(".");
  assert.ok(verify(null, Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url")));
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(claims.device_id, DEVICE);
  assert.equal(claims.status, "trialing");
  assert.equal(claims.sub, acc.account_id);
  assert.ok(claims.exp - claims.iat <= 72 * 3600);
});

test("device limit enforced", async () => {
  const { post } = setup();
  // 1st PC
  const acc = await (await post("/v1/accounts", { device_id: DEVICE, device_type: "pc" })).json();
  await post("/dev/grant", { account_id: acc.account_id });
  
  // 2nd PC
  assert.equal((await post("/v1/entitlement", { device_id: "b".repeat(64), device_type: "pc" }, acc.refresh_token)).status, 200);
  // 3rd PC
  assert.equal((await post("/v1/entitlement", { device_id: "c".repeat(64), device_type: "pc" }, acc.refresh_token)).status, 200);
  // 4th PC -> 403
  assert.equal((await post("/v1/entitlement", { device_id: "d".repeat(64), device_type: "pc" }, acc.refresh_token)).status, 403);

  // 1st Mobile
  assert.equal((await post("/v1/entitlement", { device_id: "1".repeat(64), device_type: "mobile" }, acc.refresh_token)).status, 200);
  // 2nd Mobile
  assert.equal((await post("/v1/entitlement", { device_id: "2".repeat(64), device_type: "mobile" }, acc.refresh_token)).status, 200);
  // 3rd Mobile -> 403
  assert.equal((await post("/v1/entitlement", { device_id: "3".repeat(64), device_type: "mobile" }, acc.refresh_token)).status, 403);
});

test("past_due grace and cancellation", () => {
  const t = 1_000_000;
  const base = { account_id: "a", stripe_subscription_id: null, plan: "monthly", cancel_at_period_end: 0, updated_at: t };
  assert.equal(isEntitled({ ...base, status: "past_due", current_period_end: t - 86400 }, t, 3), true);
  assert.equal(isEntitled({ ...base, status: "past_due", current_period_end: t - 4 * 86400 }, t, 3), false);
  assert.equal(isEntitled({ ...base, status: "canceled", current_period_end: t + 86400 }, t, 3), false);
  assert.equal(isEntitled({ ...base, status: "disputed", current_period_end: t + 86400 }, t, 3), false);
});

test("checkout returns 503 when Stripe not configured", async () => {
  const { post } = setup();
  const acc = await (await post("/v1/accounts", { device_id: DEVICE })).json();
  assert.equal((await post("/v1/checkout", {}, acc.refresh_token)).status, 503);
});

test("checkout requires OTP when email belongs to a different account, and activates immediately when already authenticated as that account", async () => {
  const { repo, post } = setup();
  // Create a paid account for subscriber@example.com via /v1/accounts
  const paidAcc = await (await post("/v1/accounts", { device_id: DEVICE, email: "subscriber@example.com" })).json();
  await post("/dev/grant", { account_id: paidAcc.account_id, status: "active", days: 365 });

  // 1. Different anonymous desktop device attempts to claim subscriber@example.com without OTP -> must require OTP!
  const otherAcc = await (await post("/v1/accounts", { device_id: "b".repeat(64) })).json();
  const crossRes = await post("/v1/checkout", { email: "subscriber@example.com", device_id: "b".repeat(64) }, otherAcc.refresh_token);
  assert.equal(crossRes.status, 200);
  const crossBody = await crossRes.json();
  assert.equal(crossBody.activated, false);
  assert.equal(crossBody.otp_required, true);
  assert.equal(crossBody.refresh_token, undefined);

  // 2. Caller already authenticated as paidAcc activates immediately
  const res = await post("/v1/checkout", { email: "subscriber@example.com", device_id: DEVICE }, paidAcc.refresh_token);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.activated, true);
  assert.equal(body.account_id, paidAcc.account_id);
  assert.ok(body.refresh_token);
  assert.ok(body.token);

  const [h, p, s] = body.token.split(".");
  assert.ok(verify(null, Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url")));
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(claims.device_id, DEVICE);
  assert.equal(claims.status, "active");
});


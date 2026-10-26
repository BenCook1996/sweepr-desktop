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

test("device limit enforced (unified 3-device limit across any combination of desktop or mobile)", async () => {
  const { post } = setup();
  // 1st device (PC)
  const acc = await (await post("/v1/accounts", { device_id: DEVICE, device_type: "pc" })).json();
  await post("/dev/grant", { account_id: acc.account_id });
  
  // 2nd device (PC)
  assert.equal((await post("/v1/entitlement", { device_id: "b".repeat(64), device_type: "pc" }, acc.refresh_token)).status, 200);
  // 3rd device (Mobile) — any combination of desktop or mobile up to 3 total
  assert.equal((await post("/v1/entitlement", { device_id: "1".repeat(64), device_type: "mobile" }, acc.refresh_token)).status, 200);
  // 4th device (PC) -> 403
  assert.equal((await post("/v1/entitlement", { device_id: "c".repeat(64), device_type: "pc" }, acc.refresh_token)).status, 403);
  // 4th device (Mobile) -> 403
  assert.equal((await post("/v1/entitlement", { device_id: "2".repeat(64), device_type: "mobile" }, acc.refresh_token)).status, 403);
});

test("QR device linking Flow A (create-token -> redeem) and Flow B (challenge -> approve -> poll) with 3-device enforcement", async () => {
  const { app, post } = setup();
  // Create paid account with 1st device (DEVICE)
  const acc = await (await post("/v1/accounts", { device_id: DEVICE, device_type: "pc", email: "qruser@example.com" })).json();
  await post("/dev/grant", { account_id: acc.account_id, status: "active", days: 365 });

  // Flow A: Generate 120s QR pairing token from authenticated session
  const createRes = await post("/api/device-link/create-token", {}, acc.refresh_token);
  assert.equal(createRes.status, 200);
  const created = await createRes.json();
  assert.equal(created.ok, true);
  assert.match(created.token, /^ptk_[A-Za-z0-9_-]+$/);
  assert.ok(created.qr_svg.includes("<svg"));
  assert.equal(created.devices_used, 1);
  assert.equal(created.devices_max, 3);

  // Redeem Flow A token on 2nd device (Mobile)
  const mobileDevId = "e".repeat(64);
  const redeemRes = await post("/api/device-link/redeem", {
    token: created.token,
    device_id: mobileDevId,
    device_type: "mobile",
    device_name: "iPhone 16 Pro",
    platform: "ios",
  });
  assert.equal(redeemRes.status, 200);
  const redeemed = await redeemRes.json();
  assert.equal(redeemed.ok, true);
  assert.equal(redeemed.account_id, acc.account_id);
  assert.ok(redeemed.refresh_token);
  assert.ok(redeemed.token);
  assert.equal(redeemed.devices_used, 2);

  // Replaying the same Flow A token must fail (single-use)
  const replayRes = await post("/api/device-link/redeem", {
    token: created.token,
    device_id: "f".repeat(64),
    device_type: "pc",
  });
  assert.equal(replayRes.status, 400);

  // Flow B: Unactivated 3rd device (Mac Desktop) requests a QR challenge
  const macDevId = "9".repeat(64);
  const chalRes = await post("/api/device-link/challenge", {
    device_id: macDevId,
    device_type: "pc",
    device_name: "MacBook Pro",
    platform: "macos",
  });
  assert.equal(chalRes.status, 200);
  const chal = await chalRes.json();
  assert.equal(chal.ok, true);
  assert.match(chal.challenge_id, /^chk_[A-Za-z0-9_-]+$/);
  assert.match(chal.poll_secret, /^psec_[A-Za-z0-9_-]+$/);
  assert.ok(chal.qr_svg.includes("<svg"));

  // Poll before approval -> pending
  const pollPending = await (
    await app.request(`/api/device-link/poll?challenge_id=${chal.challenge_id}&poll_secret=${chal.poll_secret}`)
  ).json();
  assert.equal(pollPending.status, "pending");

  // Approve Flow B challenge using the mobile device's Bearer token
  const approveRes = await post(
    "/api/device-link/approve",
    { challenge_id: chal.challenge_id },
    redeemed.refresh_token
  );
  assert.equal(approveRes.status, 200);
  const approved = await approveRes.json();
  assert.equal(approved.ok, true);
  assert.equal(approved.devices_used, 3);

  // Poll after approval -> delivers refresh_token + Ed25519 JWS token once
  const pollApproved = await (
    await app.request(`/api/device-link/poll?challenge_id=${chal.challenge_id}&poll_secret=${chal.poll_secret}`)
  ).json();
  assert.equal(pollApproved.status, "approved");
  assert.equal(pollApproved.account_id, acc.account_id);
  assert.ok(pollApproved.refresh_token);
  assert.ok(pollApproved.token);

  // Subsequent poll after delivery -> expired
  const pollAfter = await (
    await app.request(`/api/device-link/poll?challenge_id=${chal.challenge_id}&poll_secret=${chal.poll_secret}`)
  ).json();
  assert.equal(pollAfter.status, "expired");

  // Now at 3/3 devices: attempting to create a 4th QR token returns 403 device_limit_reached
  const fourthTokenRes = await post("/api/device-link/create-token", {}, acc.refresh_token);
  assert.equal(fourthTokenRes.status, 403);
  const fourthBody = await fourthTokenRes.json();
  assert.equal(fourthBody.error, "device_limit_reached");
  assert.equal(fourthBody.devices.length, 3);

  // Removing a device frees a slot (2/3) so creating a new QR token succeeds again
  const rmRes = await post("/api/portal/devices/remove", { device_id: mobileDevId }, acc.refresh_token);
  assert.equal(rmRes.status, 200);
  const rmBody = await rmRes.json();
  assert.equal(rmBody.devices_used, 2);

  const retryTokenRes = await post("/api/device-link/create-token", {}, acc.refresh_token);
  assert.equal(retryTokenRes.status, 200);
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

test("checkout activates immediately when an existing subscriber enters their email on a new desktop device", async () => {
  const { post } = setup();
  // Create a paid account for subscriber@example.com
  const paidAcc = await (await post("/v1/accounts", { device_id: DEVICE, email: "subscriber@example.com" })).json();
  await post("/dev/grant", { account_id: paidAcc.account_id, status: "active", days: 365 });

  // 1. Fresh anonymous desktop install enters subscriber@example.com in "Activate now" -> unlocks immediately
  const newDeviceId = "b".repeat(64);
  const otherAcc = await (await post("/v1/accounts", { device_id: newDeviceId })).json();
  const crossRes = await post("/v1/checkout", { email: "subscriber@example.com", device_id: newDeviceId }, otherAcc.refresh_token);
  assert.equal(crossRes.status, 200);
  const crossBody = await crossRes.json();
  assert.equal(crossBody.activated, true);
  assert.equal(crossBody.account_id, paidAcc.account_id);
  assert.ok(crossBody.refresh_token);
  assert.ok(crossBody.token);

  const [ch, cp, cs] = crossBody.token.split(".");
  assert.ok(verify(null, Buffer.from(`${ch}.${cp}`), publicKey, Buffer.from(cs, "base64url")));
  const crossClaims = JSON.parse(Buffer.from(cp, "base64url").toString());
  assert.equal(crossClaims.device_id, newDeviceId);
  assert.equal(crossClaims.status, "active");

  // 2. Caller already authenticated as paidAcc also activates immediately
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

test("battery_care and cloud_vault add-on pricing (9.99/yr) and Ed25519 signed JWS claims", async () => {
  const { repo, app, post } = setup();
  const cfgUs = await (await app.request("/api/checkout-config?country=US")).json();
  assert.equal(cfgUs.addons.battery_care.annualAmountPence, 999);
  assert.equal(cfgUs.addons.battery_care.annualFormatted, "$9.99");
  assert.equal(cfgUs.addons.battery_care.annualMonthlyEqFormatted, "$0.83");
  assert.equal(cfgUs.addons.battery_care.monthlyAmountPence, 199);
  assert.equal(cfgUs.addons.battery_care.monthlyFormatted, "$1.99");
  assert.equal(cfgUs.addons.cloud_vault.annualAmountPence, 999);
  assert.equal(cfgUs.addons.cloud_vault.annualFormatted, "$9.99");

  const cfgGb = await (await app.request("/api/checkout-config?country=GB")).json();
  assert.equal(cfgGb.addons.battery_care.annualAmountPence, 999);
  assert.equal(cfgGb.addons.battery_care.annualFormatted, "£9.99");
  assert.equal(cfgGb.addons.battery_care.monthlyAmountPence, 199);
  assert.equal(cfgGb.addons.battery_care.monthlyFormatted, "£1.99");
  assert.equal(cfgGb.addons.cloud_vault.annualAmountPence, 999);
  assert.equal(cfgGb.addons.cloud_vault.annualFormatted, "£9.99");

  const cfgEu = await (await app.request("/api/checkout-config?country=DE")).json();
  assert.equal(cfgEu.addons.battery_care.annualAmountPence, 999);
  assert.equal(cfgEu.addons.battery_care.annualFormatted, "€9.99");
  assert.equal(cfgEu.addons.battery_care.monthlyAmountPence, 199);
  assert.equal(cfgEu.addons.battery_care.monthlyFormatted, "€1.99");
  assert.equal(cfgEu.addons.cloud_vault.annualAmountPence, 999);
  assert.equal(cfgEu.addons.cloud_vault.annualFormatted, "€9.99");

  const acc = await (await post("/v1/accounts", { device_id: DEVICE, email: "battery@example.com" })).json();
  await post("/dev/grant", { account_id: acc.account_id, status: "active", days: 365 });
  repo.grantAddon(acc.account_id, "battery_care");

  const entRes = await (await post("/v1/entitlement", { device_id: DEVICE }, acc.refresh_token)).json();
  assert.deepEqual(entRes.addons, ["battery_care"]);
  assert.ok(entRes.token);

  const [h, p, s] = entRes.token.split(".");
  assert.ok(verify(null, Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url")));
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.deepEqual(claims.addons, ["battery_care"]);
});

test("Google Play purchase verification activates entitlement, supports and_ device IDs, and signed-in free user referral unlocks 30-day trial", async () => {
  const { app, post } = setup();
  const DEVICE_B = "b".repeat(64);

  const androidDevice = "and_9876543210abcdef";
  const playRes = await post("/v1/billing/google-play/verify", {
    product_id: "sweepr_annual_4999",
    purchase_token: "play_purchase_token_1234567890",
    order_id: "GPA.3312-4567-8901-23456",
    device_id: androidDevice,
    addons: ["battery_care"],
  });
  assert.equal(playRes.status, 200);
  const playBody = await playRes.json();
  assert.equal(playBody.active, true);
  assert.equal(playBody.plan, "annual");
  assert.ok(playBody.addons.includes("battery_care"));
  assert.ok(playBody.token);

  // Signed-in free user can redeem a valid referral code from an active subscriber and receive a 30-day Pro trial
  const referrer = await (await post("/v1/accounts", { device_id: DEVICE, email: "referrer@example.com" })).json();
  await post("/dev/grant", { account_id: referrer.account_id, status: "active", days: 30 });
  const freeSignedIn = await (await post("/v1/accounts", { device_id: DEVICE_B, email: "friend@example.com" })).json();
  const refRes = await post(
    "/v1/referral/apply",
    { code: referrer.referral_code, device_id: DEVICE_B },
    freeSignedIn.refresh_token,
  );
  assert.equal(refRes.status, 200);
  const refBody = await refRes.json();
  assert.equal(refBody.ok, true);
  assert.equal(refBody.days_added, 30);

  const friendEnt = await (await post("/v1/entitlement", { device_id: DEVICE_B, platform: "android" }, freeSignedIn.refresh_token)).json();
  assert.equal(friendEnt.active, true);
  assert.equal(friendEnt.status, "trialing");

  // Web Account Deletion page is served at GET /delete-account
  const delPage = await app.request("/delete-account");
  assert.equal(delPage.status, 200);
  const delHtml = await delPage.text();
  assert.ok(delHtml.includes("Delete Your Account"));
});




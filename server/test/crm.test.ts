import { test } from "node:test";
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

test("CRM: requires admin auth", async () => {
  const { app } = setup();
  const noAuth = await app.request("/api/crm/stats");
  assert.equal(noAuth.status, 401);
  assert.match(noAuth.headers.get("www-authenticate") ?? "", /^Basic /);

  const bad = await app.request("/api/crm/stats", {
    headers: { authorization: `Basic ${Buffer.from("admin:wrong").toString("base64")}` },
  });
  assert.equal(bad.status, 401);

  // Static copy of the CRM HTML must not be reachable without auth (case/encoding tricks included).
  for (const p of ["/crm", "/crm/index.html", "/CRM/index.html", "/%63rm/index.html", "/admin"]) {
    assert.equal((await app.request(p)).status, 401, p);
  }

  const ok = await app.request("/api/crm/stats", { headers: { authorization: ADMIN_AUTH } });
  assert.equal(ok.status, 200);
});

test("CRM: disabled (503) when no admin password configured", async () => {
  const { app } = setup(undefined, { crmAdminPassword: "" });
  const res = await app.request("/api/crm/stats", { headers: { authorization: ADMIN_AUTH } });
  assert.equal(res.status, 503);
});

test("CRM: rejects cross-origin writes", async () => {
  const { app } = setup();
  const res = await app.request("/api/crm/subscriptions", {
    method: "POST",
    headers: { authorization: ADMIN_AUTH, origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ email: "x@example.com" }),
  });
  assert.equal(res.status, 403);
});

test("CRM: dev-only endpoints are disabled without devEndpoints", async () => {
  const { post } = setup(undefined, { devEndpoints: false });
  assert.equal((await post("/api/crm/seed-demo")).status, 404);
  assert.equal((await post("/api/crm/make-me-paid", {})).status, 404);
});

test("CRM: seed demo accounts and retrieve stats", async () => {
  const { post, get } = setup();

  // 1. Seed demo
  const seedRes = await post("/api/crm/seed-demo");
  assert.equal(seedRes.status, 200);
  const seedJson = await seedRes.json();
  assert.equal(seedJson.ok, true);

  // 2. Fetch stats
  const statsRes = await get("/api/crm/stats");
  assert.equal(statsRes.status, 200);
  const stats = await statsRes.json();
  assert.ok(stats.totalCustomers >= 5);
  assert.ok(stats.activeSubscriptions >= 2);
  assert.ok(stats.mrrCents > 0);
  assert.ok(stats.arrCents > 0);
  assert.ok(stats.averageHealthScore > 0);
});

test("CRM: list and filter customers", async () => {
  const { post, get } = setup();
  await post("/api/crm/seed-demo");

  // All customers
  const allRes = await get("/api/crm/customers");
  assert.equal(allRes.status, 200);
  const all = await allRes.json();
  assert.ok(all.customers.length >= 5);
  assert.equal(all.total, all.customers.length);

  // Filter by active status
  const activeRes = await get("/api/crm/customers?status=active");
  const active = await activeRes.json();
  assert.ok(active.customers.every((c: any) => c.subscription_status === "active"));

  // Search by term
  const searchRes = await get("/api/crm/customers?search=Cyberdyne");
  const searched = await searchRes.json();
  assert.equal(searched.customers.length, 1);
  assert.ok(searched.customers[0].email.includes("cyberdyne"));
});

test("CRM: customer 360 view, notes, updates, and grant", async () => {
  const { post, get, patch } = setup();
  await post("/api/crm/seed-demo");

  const customerId = "acc_demo_pro";

  // 1. Customer 360 profile
  const profileRes = await get(`/api/crm/customers/${customerId}`);
  assert.equal(profileRes.status, 200);
  const profile = await profileRes.json();
  assert.equal(profile.account.id, customerId);
  assert.ok(profile.devices.length > 0);
  assert.ok(profile.activities.length > 0);

  // 2. Add note
  const noteRes = await post(`/api/crm/customers/${customerId}/notes`, {
    content: "Customer requested priority phone support onboarding.",
    author: "Alice CSM",
  });
  assert.equal(noteRes.status, 200);

  // 3. Update customer profile
  const patchRes = await patch(`/api/crm/customers/${customerId}`, {
    name: "Alex Morgan (VIP)",
    health_score: 95,
  });
  assert.equal(patchRes.status, 200);
  const updated = await patchRes.json();
  assert.equal(updated.customer.account.name, "Alex Morgan (VIP)");
  assert.equal(updated.customer.account.health_score, 95);

  // 4. Manually grant extension
  const grantRes = await post(`/api/crm/customers/${customerId}/grant`, {
    status: "active",
    plan: "annual",
    days: 60,
  });
  assert.equal(grantRes.status, 200);
  const granted = await grantRes.json();
  assert.equal(granted.customer.entitlement.status, "active");
  assert.equal(granted.customer.entitlement.plan, "annual");

  // 5. Revoke and restore device
  const deviceId = profile.devices[0].id;
  const revokeRes = await post(`/api/crm/customers/${customerId}/devices/${deviceId}/revoke`);
  assert.equal(revokeRes.status, 200);
  const revokedCust = await revokeRes.json();
  const revokedDevice = revokedCust.customer.devices.find((d: any) => d.id === deviceId);
  assert.equal(revokedDevice.revoked, 1);

  const restoreRes = await post(`/api/crm/customers/${customerId}/devices/${deviceId}/restore`);
  assert.equal(restoreRes.status, 200);
  const restoredCust = await restoreRes.json();
  const restoredDevice = restoredCust.customer.devices.find((d: any) => d.id === deviceId);
  assert.equal(restoredDevice.revoked, 0);

  // 6. Cancel subscription
  const cancelRes = await post(`/api/crm/customers/${customerId}/cancel`, { immediate: true });
  assert.equal(cancelRes.status, 200);
  const canceledCust = await cancelRes.json();
  assert.equal(canceledCust.customer.entitlement.status, "canceled");
});

test("CRM: create new paid subscription from scratch", async () => {
  const { post, get } = setup();

  const res = await post("/api/crm/subscriptions", {
    email: "carol.danvers@avengers.io",
    name: "Carol Danvers",
    plan: "annual",
    status: "active",
    amount_cents: 9900,
    days: 365,
    notes: "VIP annual subscriber created via CRM",
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(data.account_id);
  assert.ok(data.refresh_token);
  assert.equal(data.customer.account.email, "carol.danvers@avengers.io");
  assert.equal(data.customer.entitlement.status, "active");
  assert.equal(data.customer.entitlement.plan, "annual");
  assert.equal(data.customer.account.total_spend_cents, 9900);
  assert.equal(data.customer.invoices.length, 1);
  assert.equal(data.customer.invoices[0].status, "paid");
  assert.equal(data.customer.invoices[0].amount_paid_cents, 9900);

  // Check stats reflect the new subscription
  const statsRes = await get("/api/crm/stats");
  const stats = await statsRes.json();
  assert.ok(stats.activeSubscriptions >= 1);
  assert.ok(stats.arrCents >= 9900);
});

test("CRM: one-click make myself a paid user", async () => {
  const { post } = setup();

  const res = await post("/api/crm/make-me-paid", {
    email: "benjamin@sweepr.local",
    name: "Benjamin",
    plan: "lifetime",
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.status, "active");
  assert.equal(data.plan, "lifetime");
  assert.ok(data.account_id);
  assert.ok(data.refresh_token);
  assert.ok(data.device_id);
  assert.equal(data.customer.entitlement.status, "active");
  assert.equal(data.customer.account.lifecycle_stage, "customer");
});

test("CRM: outreach log seeding, filtering, and CRUD", async () => {
  const { get, post, patch, app } = setup();

  // 1. Auto-seeds the outreach entries on first GET
  const listRes = await get("/api/crm/outreach?limit=50000");
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.ok(listData.counts.total >= 256);
  assert.ok(listData.counts.emailCount >= 245);
  assert.ok(listData.counts.portalCount >= 4);
  assert.equal(listData.logs.length, listData.counts.total);

  // 2. Filter by portal
  const portalRes = await get("/api/crm/outreach?filter=portal");
  const portalData = await portalRes.json();
  assert.equal(portalData.logs.length, listData.counts.portalCount);

  // 3. Add a new outreach entry
  const addRes = await post("/api/crm/outreach", {
    who: "editor@techradar.com",
    website: "techradar.com",
    url: "https://techradar.com",
    how: "Email (Gmail SMTP — Live Scraped)",
    category: "DR 92 Tech Publication",
    status: "delivered",
  });
  assert.equal(addRes.status, 200);
  const addData = await addRes.json();
  assert.equal(addData.ok, true);
  assert.equal(addData.entry.who, "editor@techradar.com");

  // 4. Update status to listed
  const patchRes = await patch(`/api/crm/outreach/${addData.entry.id}`, { status: "listed" });
  assert.equal(patchRes.status, 200);

  // 5. Delete entry
  const delRes = await app.request(`/api/crm/outreach/${addData.entry.id}`, {
    method: "DELETE",
    headers: { authorization: ADMIN_AUTH },
  });
  assert.equal(delRes.status, 200);
});

test("CRM: lead capture records country, device, and datetime in CRM", async () => {
  const fixedNow = 1760824800; // Fixed unix timestamp
  const { app, get } = setup(() => fixedNow, { trustProxy: true });

  // 1. Capture web order lead via POST /api/lead with Cloudflare country header & iOS User-Agent
  const leadRes = await app.request("/api/lead", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-ipcountry": "GB",
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
    },
    body: JSON.stringify({
      email: "lead.visitor@london.co.uk",
      name: "London Visitor",
    }),
  });
  assert.equal(leadRes.status, 200);
  const leadData = await leadRes.json();
  assert.equal(leadData.ok, true);
  assert.equal(leadData.country, "GB");
  assert.equal(leadData.lead_device, "iPhone / iOS");
  assert.equal(leadData.created_at, fixedNow);

  // 2. Capture desktop app lead via POST /v1/accounts with US header & Windows User-Agent
  const appLeadRes = await app.request("/v1/accounts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-ipcountry": "US",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Tauri/2.0",
    },
    body: JSON.stringify({
      email: "pc.user@austin.io",
      device_id: "a".repeat(64),
      device_type: "pc",
    }),
  });
  assert.equal(appLeadRes.status, 200);

  // 3. Verify both leads appear in CRM filtered by status=lead with country, lead_device, and created_at
  const crmLeadsRes = await get("/api/crm/customers?status=lead");
  assert.equal(crmLeadsRes.status, 200);
  const crmLeads = await crmLeadsRes.json();
  assert.equal(crmLeads.customers.length, 2);

  const ukLead = crmLeads.customers.find((c: any) => c.email === "lead.visitor@london.co.uk");
  assert.ok(ukLead);
  assert.equal(ukLead.country, "GB");
  assert.equal(ukLead.lead_device, "iPhone / iOS");
  assert.equal(ukLead.created_at, fixedNow);
  assert.equal(ukLead.lifecycle_stage, "lead");

  const usLead = crmLeads.customers.find((c: any) => c.email === "pc.user@austin.io");
  assert.ok(usLead);
  assert.equal(usLead.country, "US");
  assert.equal(usLead.lead_device, "Windows PC (App)");
  assert.equal(usLead.created_at, fixedNow);

  // 4. Verify Customer 360 endpoint returns country, lead_device, and created_at
  const detailRes = await get(`/api/crm/customers/${ukLead.id}`);
  assert.equal(detailRes.status, 200);
  const detail = await detailRes.json();
  assert.equal(detail.account.country, "GB");
  assert.equal(detail.account.lead_device, "iPhone / iOS");
  assert.equal(detail.account.created_at, fixedNow);

  // 5. Verify visiting /order and returning to / both return 200 OK with no forced redirects (Google Ads compliance)
  const orderVisit = await app.request("/order");
  assert.equal(orderVisit.status, 200);

  const returnVisit = await app.request("/");
  assert.equal(returnVisit.status, 200);

  const explicitHome = await app.request("/?home=1");
  assert.equal(explicitHome.status, 200);
});


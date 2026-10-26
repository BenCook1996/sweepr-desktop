import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";

export type EntStatus =
  | "trialing" | "active" | "past_due" | "canceled" | "unpaid"
  | "incomplete" | "incomplete_expired" | "paused" | "disputed" | "none";

export interface Account {
  id: string;
  refresh_token_hash: string;
  stripe_customer_id: string | null;
  email: string | null;
  name: string | null;
  notes: string | null;
  country: string | null;
  lead_device: string | null;
  health_score: number;
  lifecycle_stage: string;
  total_spend_cents: number;
  referral_code: string | null;
  referred_by: string | null;
  winback_claimed?: number;
  created_at: number;
  updated_at: number | null;
}

export interface CrashReportRecord {
  id: number;
  platform: string;
  app_version: string;
  error_type: string;
  message: string;
  stack: string;
  created_at: number;
}

export interface AnalyticsEventRecord {
  id: number;
  event_name: string;
  platform: string;
  account_id: string | null;
  metadata: string | null;
  created_at: number;
}

export interface SupportTicketRecord {
  id: number;
  email: string;
  subject: string;
  message: string;
  platform: string;
  logs: string | null;
  status: string;
  created_at: number;
}

export interface OutreachLogRecord {
  id: number;
  who: string;
  website: string;
  url: string;
  how: string;
  category: string | null;
  status: string;
  message_id: string | null;
  reached_out_at: number;
}

export interface Entitlement {
  account_id: string;
  stripe_subscription_id: string | null;
  status: EntStatus;
  plan: string | null;
  addons?: string | null;
  current_period_end: number | null;
  cancel_at_period_end: number;
  updated_at: number;
}

export interface SubscriptionRecord {
  id: string;
  account_id: string;
  stripe_subscription_id: string | null;
  status: EntStatus;
  plan: string;
  amount_cents: number;
  currency: string;
  billing_interval: string;
  current_period_start: number | null;
  current_period_end: number | null;
  cancel_at_period_end: number;
  canceled_at: number | null;
  trial_start: number | null;
  trial_end: number | null;
  created_at: number;
  updated_at: number;
}

export interface InvoiceRecord {
  id: string;
  account_id: string;
  stripe_invoice_id: string | null;
  amount_cents: number;
  amount_paid_cents: number;
  currency: string;
  status: string;
  due_date: number | null;
  paid_at: number | null;
  hosted_invoice_url: string | null;
  pdf_url: string | null;
  created_at: number;
}

export interface ActivityRecord {
  id: string;
  account_id: string;
  type: string;
  title: string;
  description: string | null;
  actor: string;
  metadata_json: string | null;
  created_at: number;
}

export interface AdminNoteRecord {
  id: string;
  account_id: string;
  author: string;
  content: string;
  created_at: number;
}

export interface DeviceRecord {
  id: string;
  account_id: string;
  type: string;
  device_name?: string | null;
  platform?: string | null;
  first_seen: number;
  last_seen: number;
  revoked: number;
}

export interface CrmCustomerSummary {
  id: string;
  email: string | null;
  name: string | null;
  stripe_customer_id: string | null;
  country: string | null;
  lead_device: string | null;
  subscription_status: EntStatus;
  plan: string | null;
  amount_cents: number;
  billing_interval: string;
  current_period_end: number | null;
  cancel_at_period_end: number;
  device_count: number;
  health_score: number;
  lifecycle_stage: string;
  total_spend_cents: number;
  last_seen: number | null;
  created_at: number;
}

export interface CrmStats {
  totalCustomers: number;
  leadsCount?: number;
  activeSubscriptions: number;
  trialingSubscriptions: number;
  pastDueSubscriptions: number;
  canceledSubscriptions: number;
  mrrCents: number;
  arrCents: number;
  averageHealthScore: number;
  activeDevices: number;
  atRiskAccountsCount: number;
  currency: string;
  crashes_7d: number;
  funnel: Record<string, number>;
  downloadsTotal?: number;
  downloads30d?: number;
  downloads7d?: number;
  installsTotal?: number;
  installs30d?: number;
  installs7d?: number;
  installConversionPct?: number;
}

export function generateReferralCode(seed: string): string {
  const hash = createHash("sha256").update(`sweepr-ref:${seed}`).digest("hex").toUpperCase();
  return `SWP-${hash.slice(0, 6)}`;
}

function ensureColumn(db: DatabaseSync, table: string, col: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}

export function openDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout = 15000;`);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      refresh_token_hash TEXT UNIQUE NOT NULL,
      stripe_customer_id TEXT UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (id, account_id)
    );
    CREATE TABLE IF NOT EXISTS entitlements (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id),
      stripe_subscription_id TEXT,
      status TEXT NOT NULL,
      plan TEXT,
      current_period_end INTEGER,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS otps (
      email TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS processed_events (
      id TEXT PRIMARY KEY,
      processed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      stripe_subscription_id TEXT,
      status TEXT NOT NULL,
      plan TEXT NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 999,
      currency TEXT NOT NULL DEFAULT 'usd',
      billing_interval TEXT NOT NULL DEFAULT 'month',
      current_period_start INTEGER,
      current_period_end INTEGER,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      canceled_at INTEGER,
      trial_start INTEGER,
      trial_end INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      stripe_invoice_id TEXT,
      amount_cents INTEGER NOT NULL,
      amount_paid_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'usd',
      status TEXT NOT NULL,
      due_date INTEGER,
      paid_at INTEGER,
      hosted_invoice_url TEXT,
      pdf_url TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      actor TEXT NOT NULL DEFAULT 'system',
      metadata_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_notes (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crash_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT,
      app_version TEXT,
      error_type TEXT,
      message TEXT,
      stack TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT,
      platform TEXT,
      account_id TEXT,
      metadata TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT,
      subject TEXT,
      message TEXT,
      platform TEXT,
      logs TEXT,
      status TEXT DEFAULT 'open',
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS outreach_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      who TEXT NOT NULL,
      website TEXT NOT NULL,
      url TEXT NOT NULL,
      how TEXT NOT NULL,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'delivered',
      message_id TEXT,
      reached_out_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_automation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL DEFAULT 'cleaner',
      sender_email TEXT NOT NULL,
      sender_name TEXT,
      subject TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      status TEXT NOT NULL DEFAULT 'actioned',
      action_type TEXT NOT NULL DEFAULT 'email_reply',
      action_summary TEXT NOT NULL,
      action_detail TEXT,
      portal_url TEXT,
      reply_message_id TEXT,
      last_inbound_msg_id TEXT,
      actioned_at INTEGER NOT NULL,
      follow_up_after_ts INTEGER NOT NULL,
      action_count INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webhook_dlq (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      error TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qr_pairing_tokens (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0,
      created_by_ip TEXT
    );
    CREATE TABLE IF NOT EXISTS qr_pairing_challenges (
      challenge_id TEXT PRIMARY KEY,
      poll_secret_hash TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_type TEXT NOT NULL DEFAULT 'pc',
      device_name TEXT,
      platform TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      account_id TEXT,
      issued_refresh_token TEXT,
      issued_jws TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  // Ensure extended CRM columns on accounts table
  ensureColumn(db, "accounts", "email", "TEXT");
  ensureColumn(db, "accounts", "name", "TEXT");
  ensureColumn(db, "accounts", "notes", "TEXT");
  ensureColumn(db, "accounts", "country", "TEXT");
  ensureColumn(db, "accounts", "lead_device", "TEXT");
  ensureColumn(db, "accounts", "health_score", "INTEGER DEFAULT 100");
  ensureColumn(db, "accounts", "lifecycle_stage", "TEXT DEFAULT 'lead'");
  ensureColumn(db, "accounts", "total_spend_cents", "INTEGER DEFAULT 0");
  ensureColumn(db, "accounts", "referral_code", "TEXT");
  ensureColumn(db, "accounts", "referred_by", "TEXT");
  ensureColumn(db, "accounts", "winback_claimed", "INTEGER DEFAULT 0");
  ensureColumn(db, "accounts", "updated_at", "INTEGER");
  ensureColumn(db, "devices", "type", "TEXT DEFAULT 'pc'");
  ensureColumn(db, "devices", "token_hash", "TEXT");
  ensureColumn(db, "devices", "device_name", "TEXT");
  ensureColumn(db, "devices", "platform", "TEXT");
  ensureColumn(db, "entitlements", "addons", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "subscriptions", "addons", "TEXT NOT NULL DEFAULT '[]'");
  // OTPs are now stored hashed with a failed-attempt counter. Any pre-existing (plaintext) codes are dropped.
  const otpCols = db.prepare(`PRAGMA table_info(otps)`).all() as Array<{ name: string }>;
  if (!otpCols.some((c) => c.name === "attempts")) db.exec(`DELETE FROM otps`);
  ensureColumn(db, "otps", "attempts", "INTEGER NOT NULL DEFAULT 0");

  // Backfill referral_code on any pre-existing accounts
  const missingRef = db.prepare(`SELECT id FROM accounts WHERE referral_code IS NULL OR referral_code = ''`).all() as Array<{ id: string }>;
  for (const row of missingRef) {
    db.prepare(`UPDATE accounts SET referral_code = ? WHERE id = ?`).run(generateReferralCode(row.id), row.id);
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_email_lower ON accounts(lower(email));`);

  // Periodic TTL cleanup for high-append tables (#63 Partitioning)
  const runTtlCleanup = () => {
    try {
      const ts = Math.floor(Date.now() / 1000);
      db.prepare(`DELETE FROM otps WHERE expires_at < ?`).run(ts - 86400);
      db.prepare(`DELETE FROM qr_pairing_tokens WHERE expires_at < ?`).run(ts - 600);
      db.prepare(`DELETE FROM qr_pairing_challenges WHERE expires_at < ?`).run(ts - 600);
      db.prepare(`DELETE FROM processed_events WHERE processed_at < ?`).run(ts - 90 * 86400);
      db.prepare(`DELETE FROM analytics_events WHERE created_at < ?`).run(ts - 90 * 86400);
    } catch {
      /* ignore if db closed */
    }
  };
  runTtlCleanup();
  setInterval(runTtlCleanup, 6 * 3600 * 1000).unref();

  const repo = new Repo(db);
  repo.seedEditorialAndEmailAutomationDefaults();
  return repo;
}

const now = () => Math.floor(Date.now() / 1000);

export class Repo {
  constructor(readonly db: DatabaseSync) {}

  /** Stores only a hash of the code (callers pass sha256(code)); resets the failed-attempt counter and prunes expired OTPs. */
  setOtp(email: string, codeHash: string, expires_at: number) {
    const normEmail = email.trim().toLowerCase();
    this.db.prepare(`DELETE FROM otps WHERE expires_at < ? OR email = ? COLLATE NOCASE`).run(now(), normEmail);
    this.db.prepare(`
      INSERT INTO otps (email, code, expires_at, attempts) 
      VALUES (?, ?, ?, 0) 
      ON CONFLICT(email) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at, attempts=0
    `).run(normEmail, codeHash, expires_at);
  }

  /** Compares sha256 hex digests in constant time. The OTP is burned after MAX_OTP_ATTEMPTS failures. */
  verifyOtp(email: string, codeHash: string, nowSec: number): boolean {
    const MAX_OTP_ATTEMPTS = 5;
    const normEmail = email.trim().toLowerCase();
    const otp = this.db.prepare(`SELECT * FROM otps WHERE email = ? COLLATE NOCASE`).get(normEmail) as
      | { email: string; code: string; expires_at: number; attempts: number | null }
      | undefined;
    if (!otp) return false;
    if (otp.expires_at < nowSec) {
      this.db.prepare(`DELETE FROM otps WHERE email = ? COLLATE NOCASE`).run(normEmail);
      return false;
    }
    const a = Buffer.from(String(otp.code), "utf8");
    const b = Buffer.from(String(codeHash), "utf8");
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) {
      const attempts = (otp.attempts ?? 0) + 1;
      if (attempts >= MAX_OTP_ATTEMPTS) {
        this.db.prepare(`DELETE FROM otps WHERE email = ? COLLATE NOCASE`).run(normEmail);
      } else {
        this.db.prepare(`UPDATE otps SET attempts = ? WHERE email = ? COLLATE NOCASE`).run(attempts, normEmail);
      }
      return false;
    }
    if (normEmail.startsWith("emailchange:")) {
      this.db.prepare(`DELETE FROM otps WHERE email = ? COLLATE NOCASE`).run(normEmail);
    } else {
      // Keep Subscription Activation Keys / login codes valid until expiry so the customer
      // can sign in to the web portal AND activate up to 3 PCs + 2 mobile devices with the same key.
      this.db.prepare(`UPDATE otps SET attempts = 0 WHERE email = ? COLLATE NOCASE`).run(normEmail);
    }
    return true;
  }

  /**
   * Verifies a 6-digit code against the hashed `otps` table with constant-time comparison and attempt lockout.
   */
  verifyRecentEmailCode(email: string, _rawCode: string, codeHash: string, nowSec: number): boolean {
    return this.verifyOtp(email, codeHash, nowSec);
  }


  createAccount(
    id: string,
    refreshTokenHash: string,
    email?: string,
    referredBy?: string | null,
    meta?: { country?: string | null; lead_device?: string | null; created_at?: number }
  ) {
    const t = meta?.created_at ?? now();
    const referralCode = generateReferralCode(id);
    const country = meta?.country ? meta.country.trim().toUpperCase().slice(0, 8) : null;
    const leadDevice = meta?.lead_device ? meta.lead_device.trim().slice(0, 64) : null;
    this.db.prepare(`
      INSERT INTO accounts (id, refresh_token_hash, email, country, lead_device, health_score, lifecycle_stage, total_spend_cents, referral_code, referred_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 100, 'lead', 0, ?, ?, ?, ?)
    `).run(id, refreshTokenHash, email ?? null, country, leadDevice, referralCode, referredBy ?? null, t, t);

    const metaParts: string[] = [];
    if (country) metaParts.push(`Country: ${country}`);
    if (leadDevice) metaParts.push(`Device: ${leadDevice}`);
    const metaSuffix = metaParts.length > 0 ? ` (${metaParts.join(" • ")})` : "";

    this.addActivity({
      account_id: id,
      type: "account_created",
      title: email ? "Lead Captured" : "Account Created",
      description: email
        ? `Lead captured for ${email}${metaSuffix}`
        : `New device-bound lead initialized${metaSuffix}`,
      actor: "system",
      metadata: {
        email: email ?? null,
        country,
        device: leadDevice,
        created_at: t,
      },
    });
  }

  setAccountLeadMeta(accountId: string, meta: { country?: string | null; lead_device?: string | null }) {
    const t = now();
    const country = meta.country ? meta.country.trim().toUpperCase().slice(0, 8) : null;
    const leadDevice = meta.lead_device ? meta.lead_device.trim().slice(0, 64) : null;
    if (!country && !leadDevice) return;
    this.db.prepare(`
      UPDATE accounts
      SET country = COALESCE(?, country),
          lead_device = COALESCE(?, lead_device),
          updated_at = ?
      WHERE id = ?
    `).run(country, leadDevice, t, accountId);
  }

  accountByTokenHash(hash: string): Account | undefined {
    const direct = this.db.prepare("SELECT * FROM accounts WHERE refresh_token_hash = ?").get(hash) as Account | undefined;
    if (direct) return direct;
    return this.db.prepare(`
      SELECT a.* FROM accounts a
      JOIN devices d ON a.id = d.account_id
      WHERE d.token_hash = ? AND d.revoked = 0
      LIMIT 1
    `).get(hash) as Account | undefined;
  }

  accountById(id: string): Account | undefined {
    return this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Account | undefined;
  }

  accountByCustomer(customerId: string): Account | undefined {
    return this.db.prepare("SELECT * FROM accounts WHERE stripe_customer_id = ?").get(customerId) as Account | undefined;
  }

  /** Returns the highest-priority account matching `email` (paid/active entitlements first). */
  accountByEmail(email: string): Account | undefined {
    return this.db.prepare(`
      SELECT a.* FROM accounts a
      LEFT JOIN entitlements e ON a.id = e.account_id
      WHERE a.email = ? COLLATE NOCASE
      ORDER BY CASE
        WHEN e.status IN ('active', 'trialing', 'past_due') THEN 0
        WHEN a.stripe_customer_id IS NOT NULL THEN 1
        ELSE 2
      END, a.created_at DESC
      LIMIT 1
    `).get(email) as Account | undefined;
  }

  setCustomer(accountId: string, customerId: string, email?: string) {
    const t = now();
    const owner = this.accountByCustomer(customerId);
    if (owner && owner.id !== accountId) {
      // Another account already owns this Stripe customer ID; do not cause a UNIQUE constraint fault.
      return;
    }
    if (email) {
      this.db.prepare("UPDATE accounts SET stripe_customer_id = COALESCE(stripe_customer_id, ?), email = COALESCE(email, ?), updated_at = ? WHERE id = ?")
        .run(customerId, email, t, accountId);
    } else {
      this.db.prepare("UPDATE accounts SET stripe_customer_id = COALESCE(stripe_customer_id, ?), updated_at = ? WHERE id = ?")
        .run(customerId, t, accountId);
    }
  }

  setDeviceTokenHash(accountId: string, deviceId: string, tokenHash: string) {
    this.db.prepare("UPDATE devices SET token_hash = ?, last_seen = ? WHERE account_id = ? AND id = ? AND revoked = 0")
      .run(tokenHash, now(), accountId, deviceId);
  }

  deleteAccount(accountId: string): boolean {
    const acc = this.accountById(accountId);
    if (!acc) return false;
    if (acc.email) {
      this.db.prepare("DELETE FROM otps WHERE email = ? COLLATE NOCASE").run(acc.email);
      this.db.prepare("DELETE FROM support_tickets WHERE email = ? COLLATE NOCASE").run(acc.email);
    }
    this.db.prepare("DELETE FROM analytics_events WHERE account_id = ?").run(accountId);
    this.db.prepare("DELETE FROM admin_notes WHERE account_id = ?").run(accountId);
    this.db.prepare("DELETE FROM activities WHERE account_id = ?").run(accountId);
    this.db.prepare("DELETE FROM invoices WHERE account_id = ?").run(accountId);
    this.db.prepare("DELETE FROM subscriptions WHERE account_id = ?").run(accountId);
    this.db.prepare("DELETE FROM entitlements WHERE account_id = ?").run(accountId);
    this.db.prepare("DELETE FROM devices WHERE account_id = ?").run(accountId);
    const r = this.db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
    return Number(r.changes) > 0;
  }

  updateAccountProfile(accountId: string, updates: { name?: string; email?: string; notes?: string; country?: string | null; lead_device?: string | null; health_score?: number; lifecycle_stage?: string }) {
    const t = now();
    const existing = this.accountById(accountId);
    if (!existing) return;
    const name = updates.name !== undefined ? updates.name : existing.name;
    const email = updates.email !== undefined ? updates.email : existing.email;
    const notes = updates.notes !== undefined ? updates.notes : existing.notes;
    const country = updates.country !== undefined ? (updates.country ? updates.country.trim().toUpperCase().slice(0, 8) : null) : existing.country;
    const lead_device = updates.lead_device !== undefined ? (updates.lead_device ? updates.lead_device.trim().slice(0, 64) : null) : existing.lead_device;
    const health_score = updates.health_score !== undefined ? updates.health_score : existing.health_score;
    const lifecycle_stage = updates.lifecycle_stage !== undefined ? updates.lifecycle_stage : existing.lifecycle_stage;

    this.db.prepare(`
      UPDATE accounts
      SET name = ?, email = ?, notes = ?, country = ?, lead_device = ?, health_score = ?, lifecycle_stage = ?, updated_at = ?
      WHERE id = ?
    `).run(name, email, notes, country, lead_device, health_score, lifecycle_stage, t, accountId);

    this.addActivity({
      account_id: accountId,
      type: "profile_updated",
      title: "Customer Profile Updated",
      description: `Updated customer information`,
      actor: "admin",
    });
  }

  /**
   * Registers the device if there's room under the unified 3-device limit
   * (any combination of desktop or mobile). Returns false if the device limit is reached or the device is revoked.
   */
  touchDevice(
    accountId: string,
    deviceId: string,
    deviceType: "pc" | "mobile",
    maxPc: number,
    _maxMobile: number,
    meta?: { deviceName?: string | null; platform?: string | null }
  ): boolean {
    const cleanName = meta?.deviceName ? String(meta.deviceName).trim().slice(0, 80) : null;
    const cleanPlatform = meta?.platform ? String(meta.platform).trim().slice(0, 40) : null;
    const existing = this.db.prepare("SELECT revoked, type FROM devices WHERE id = ? AND account_id = ?").get(deviceId, accountId) as { revoked: number; type: string } | undefined;
    if (existing) {
      if (existing.revoked) return false;
      this.db
        .prepare("UPDATE devices SET last_seen = ?, type = ?, device_name = COALESCE(?, device_name), platform = COALESCE(?, platform) WHERE id = ? AND account_id = ?")
        .run(now(), deviceType, cleanName, cleanPlatform, deviceId, accountId);
      return true;
    }
    const { n } = this.db
      .prepare("SELECT COUNT(*) AS n FROM devices WHERE account_id = ? AND revoked = 0")
      .get(accountId) as { n: number };
    const limit = Math.max(1, maxPc || 3);
    if (n >= limit) return false;
    this.db
      .prepare("INSERT INTO devices (id, account_id, type, device_name, platform, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(deviceId, accountId, deviceType, cleanName, cleanPlatform, now(), now());

    this.addAnalyticsEvent({
      event_name: "app_installed",
      platform: cleanPlatform || (deviceType === "mobile" ? "android" : "windows"),
      account_id: accountId,
      metadata: { device_id: deviceId, device_type: deviceType, device_name: cleanName, source: "device_registration" },
    });

    this.addActivity({
      account_id: accountId,
      type: "device_connected",
      title: "Device Connected",
      description: `Hardware device ${cleanName || deviceId.slice(0, 8) + "..."} (${deviceType.toUpperCase()}) connected`,
      actor: "system",
      metadata: { device_id: deviceId, device_type: deviceType, device_name: cleanName, platform: cleanPlatform },
    });
    return true;
  }

  revokeDevice(accountId: string, deviceId: string, actor = "admin") {
    this.db.prepare("UPDATE devices SET revoked = 1, token_hash = NULL WHERE id = ? AND account_id = ?").run(deviceId, accountId);
    this.addActivity({
      account_id: accountId,
      type: "device_revoked",
      title: "Device Revoked",
      description: `Hardware device ${deviceId.slice(0, 8)}... access was revoked by ${actor}`,
      actor,
      metadata: { device_id: deviceId },
    });
  }

  rotateAccountTokenHash(accountId: string, newTokenHash: string) {
    this.db.prepare("UPDATE accounts SET refresh_token_hash = ?, updated_at = ? WHERE id = ?").run(newTokenHash, now(), accountId);
  }

  restoreDevice(accountId: string, deviceId: string) {
    this.db.prepare("UPDATE devices SET revoked = 0, last_seen = ? WHERE id = ? AND account_id = ?").run(now(), deviceId, accountId);
    this.addActivity({
      account_id: accountId,
      type: "device_restored",
      title: "Device Restored",
      description: `Hardware device ${deviceId.slice(0, 8)}... access was restored`,
      actor: "admin",
      metadata: { device_id: deviceId },
    });
  }

  devicesForAccount(accountId: string): DeviceRecord[] {
    return this.db.prepare("SELECT * FROM devices WHERE account_id = ? ORDER BY last_seen DESC").all(accountId) as unknown as DeviceRecord[];
  }

  entitlement(accountId: string): Entitlement | undefined {
    return this.db.prepare("SELECT * FROM entitlements WHERE account_id = ?").get(accountId) as Entitlement | undefined;
  }

  addonsForAccount(accountId: string): string[] {
    const ent = this.entitlement(accountId);
    if (!ent?.addons) return [];
    try {
      const parsed = JSON.parse(ent.addons);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
    } catch {
      return [];
    }
  }

  setAddons(accountId: string, addons: string[]) {
    const clean = Array.from(new Set(addons.map((a) => String(a).trim().toLowerCase()).filter(Boolean)));
    const json = JSON.stringify(clean);
    const t = now();
    this.db.prepare("UPDATE entitlements SET addons = ?, updated_at = ? WHERE account_id = ?").run(json, t, accountId);
    this.db.prepare("UPDATE subscriptions SET addons = ?, updated_at = ? WHERE account_id = ?").run(json, t, accountId);
  }

  grantAddon(accountId: string, addon: string): string[] {
    const existing = this.addonsForAccount(accountId);
    const norm = addon.trim().toLowerCase();
    if (norm && !existing.includes(norm)) {
      existing.push(norm);
      this.setAddons(accountId, existing);
    }
    return existing;
  }

  upsertEntitlement(e: Omit<Entitlement, "updated_at"> & { addons_list?: string[] }) {
    const t = now();
    const cancelFlag = e.cancel_at_period_end ? 1 : 0;
    const existingAddons = this.addonsForAccount(e.account_id);
    let mergedAddons = existingAddons;
    if (Array.isArray(e.addons_list)) {
      mergedAddons = Array.from(new Set([...existingAddons, ...e.addons_list.map((a) => a.trim().toLowerCase()).filter(Boolean)]));
    } else if (typeof e.addons === "string" && e.addons.trim().startsWith("[")) {
      try {
        const parsed = JSON.parse(e.addons);
        if (Array.isArray(parsed)) {
          mergedAddons = Array.from(new Set([...existingAddons, ...parsed.map((a: any) => String(a).trim().toLowerCase()).filter(Boolean)]));
        }
      } catch {
        // ignore
      }
    }
    const addonsJson = JSON.stringify(mergedAddons);
    this.db.prepare(`
      INSERT INTO entitlements (account_id, stripe_subscription_id, status, plan, addons, current_period_end, cancel_at_period_end, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        stripe_subscription_id = excluded.stripe_subscription_id,
        status = excluded.status,
        plan = excluded.plan,
        addons = excluded.addons,
        current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        updated_at = excluded.updated_at
    `).run(e.account_id, e.stripe_subscription_id, e.status, e.plan, addonsJson, e.current_period_end, cancelFlag, t);

    // Also mirror to subscriptions table for CRM subscription history
    const subId = e.stripe_subscription_id || `sub_${e.account_id}`;
    const amount = e.plan === "annual" ? 6499 : e.plan === "six_month" ? 4799 : 1199;
    this.upsertSubscription({
      id: subId,
      account_id: e.account_id,
      stripe_subscription_id: e.stripe_subscription_id,
      status: e.status,
      plan: e.plan || "monthly",
      amount_cents: amount,
      currency: "usd",
      billing_interval: e.plan === "annual" ? "year" : e.plan === "six_month" ? "6-month" : "month",
      current_period_start: t,
      current_period_end: e.current_period_end,
      cancel_at_period_end: cancelFlag,
      canceled_at: e.status === "canceled" ? t : null,
      trial_start: e.status === "trialing" ? t : null,
      trial_end: e.status === "trialing" ? e.current_period_end : null,
    });

    // Update account stage and health score
    let stage = "customer";
    let health = 100;
    if (e.status === "trialing") {
      stage = "trial";
      health = 90;
    } else if (e.status === "past_due") {
      stage = "past_due";
      health = 40;
    } else if (e.status === "canceled" || e.status === "unpaid") {
      stage = "churned";
      health = 10;
    }
    this.db.prepare("UPDATE accounts SET lifecycle_stage = ?, health_score = ?, updated_at = ? WHERE id = ?")
      .run(stage, health, t, e.account_id);
  }

  setStatus(accountId: string, status: EntStatus) {
    const t = now();
    this.db.prepare("UPDATE entitlements SET status = ?, updated_at = ? WHERE account_id = ?").run(status, t, accountId);
    this.db.prepare("UPDATE subscriptions SET status = ?, updated_at = ? WHERE account_id = ?").run(status, t, accountId);
    this.addActivity({
      account_id: accountId,
      type: "status_changed",
      title: "Subscription Status Changed",
      description: `Status changed to ${status}`,
      actor: "system",
    });
  }

  upsertSubscription(sub: Omit<SubscriptionRecord, "created_at" | "updated_at">) {
    const t = now();
    this.db.prepare(`
      INSERT INTO subscriptions (
        id, account_id, stripe_subscription_id, status, plan, amount_cents, currency,
        billing_interval, current_period_start, current_period_end, cancel_at_period_end,
        canceled_at, trial_start, trial_end, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        plan = excluded.plan,
        amount_cents = excluded.amount_cents,
        currency = excluded.currency,
        billing_interval = excluded.billing_interval,
        current_period_start = COALESCE(excluded.current_period_start, subscriptions.current_period_start),
        current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        canceled_at = COALESCE(excluded.canceled_at, subscriptions.canceled_at),
        trial_start = COALESCE(excluded.trial_start, subscriptions.trial_start),
        trial_end = excluded.trial_end,
        updated_at = excluded.updated_at
    `).run(
      sub.id, sub.account_id, sub.stripe_subscription_id, sub.status, sub.plan,
      sub.amount_cents, sub.currency, sub.billing_interval, sub.current_period_start,
      sub.current_period_end, sub.cancel_at_period_end, sub.canceled_at, sub.trial_start,
      sub.trial_end, t, t
    );
  }

  upsertInvoice(inv: InvoiceRecord) {
    this.db.prepare(`
      INSERT INTO invoices (
        id, account_id, stripe_invoice_id, amount_cents, amount_paid_cents,
        currency, status, due_date, paid_at, hosted_invoice_url, pdf_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        amount_paid_cents = excluded.amount_paid_cents,
        status = excluded.status,
        paid_at = excluded.paid_at,
        hosted_invoice_url = excluded.hosted_invoice_url,
        pdf_url = excluded.pdf_url
    `).run(
      inv.id, inv.account_id, inv.stripe_invoice_id, inv.amount_cents, inv.amount_paid_cents,
      inv.currency, inv.status, inv.due_date, inv.paid_at, inv.hosted_invoice_url, inv.pdf_url, inv.created_at
    );

    // Update total customer spend if paid
    if (inv.status === "paid") {
      this.db.prepare(`
        UPDATE accounts
        SET total_spend_cents = (SELECT COALESCE(SUM(amount_paid_cents), 0) FROM invoices WHERE account_id = ? AND status = 'paid'),
            updated_at = ?
        WHERE id = ?
      `).run(inv.account_id, now(), inv.account_id);
    }
  }

  invoicesForAccount(accountId: string): InvoiceRecord[] {
    return this.db.prepare("SELECT * FROM invoices WHERE account_id = ? ORDER BY created_at DESC").all(accountId) as unknown as InvoiceRecord[];
  }

  subscriptionsForAccount(accountId: string): SubscriptionRecord[] {
    return this.db.prepare("SELECT * FROM subscriptions WHERE account_id = ? ORDER BY created_at DESC").all(accountId) as unknown as SubscriptionRecord[];
  }

  addActivity(item: { account_id: string; type: string; title: string; description?: string; actor?: string; metadata?: Record<string, unknown> }) {
    const id = `act_${now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.db.prepare(`
      INSERT INTO activities (id, account_id, type, title, description, actor, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      item.account_id,
      item.type,
      item.title,
      item.description ?? null,
      item.actor ?? "system",
      item.metadata ? JSON.stringify(item.metadata) : null,
      now()
    );
  }

  getActivities(accountId?: string, limit = 50): ActivityRecord[] {
    if (accountId) {
      return this.db.prepare("SELECT * FROM activities WHERE account_id = ? ORDER BY created_at DESC LIMIT ?").all(accountId, limit) as unknown as ActivityRecord[];
    }
    return this.db.prepare("SELECT * FROM activities ORDER BY created_at DESC LIMIT ?").all(limit) as unknown as ActivityRecord[];
  }

  addNote(accountId: string, author: string, content: string): AdminNoteRecord {
    const id = `note_${now()}_${Math.random().toString(36).substring(2, 8)}`;
    const t = now();
    this.db.prepare(`
      INSERT INTO admin_notes (id, account_id, author, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, accountId, author, content, t);

    this.addActivity({
      account_id: accountId,
      type: "note_added",
      title: "Note Added",
      description: content.length > 80 ? `${content.slice(0, 80)}...` : content,
      actor: author,
    });

    return { id, account_id: accountId, author, content, created_at: t };
  }

  getNotes(accountId: string): AdminNoteRecord[] {
    return this.db.prepare("SELECT * FROM admin_notes WHERE account_id = ? ORDER BY created_at DESC").all(accountId) as unknown as AdminNoteRecord[];
  }

  /** Returns paginated, searchable customer summaries for the CRM */
  listCustomers(options: { search?: string; status?: string; stage?: string; limit?: number; offset?: number } = {}): { customers: CrmCustomerSummary[]; total: number } {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.status && options.status !== "all") {
      if (options.status === "lead") {
        conditions.push("(COALESCE(e.status, 'none') IN ('none', 'incomplete', 'incomplete_expired') OR a.lifecycle_stage = 'lead')");
      } else {
        conditions.push("COALESCE(e.status, 'none') = ?");
        params.push(options.status);
      }
    }
    if (options.stage && options.stage !== "all") {
      conditions.push("a.lifecycle_stage = ?");
      params.push(options.stage);
    }
    if (options.search) {
      conditions.push("(a.id LIKE ? OR a.email LIKE ? OR a.name LIKE ? OR a.stripe_customer_id LIKE ? OR a.country LIKE ? OR a.lead_device LIKE ?)");
      const term = `%${options.search}%`;
      params.push(term, term, term, term, term, term);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalRow = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM accounts a
      LEFT JOIN entitlements e ON a.id = e.account_id
      ${whereClause}
    `).get(...params) as { count: number };

    const query = `
      SELECT
        a.id,
        a.email,
        a.name,
        a.stripe_customer_id,
        a.country,
        COALESCE(a.lead_device, (SELECT CASE WHEN d.type = 'mobile' THEN 'Mobile App' WHEN d.type = 'pc' THEN 'Windows PC' ELSE d.type END FROM devices d WHERE d.account_id = a.id ORDER BY d.last_seen DESC LIMIT 1)) as lead_device,
        COALESCE(e.status, 'none') as subscription_status,
        e.plan,
        COALESCE(s.amount_cents, 999) as amount_cents,
        COALESCE(s.billing_interval, 'month') as billing_interval,
        e.current_period_end,
        COALESCE(e.cancel_at_period_end, 0) as cancel_at_period_end,
        (SELECT COUNT(*) FROM devices d WHERE d.account_id = a.id AND d.revoked = 0) as device_count,
        COALESCE(a.health_score, 100) as health_score,
        COALESCE(a.lifecycle_stage, 'lead') as lifecycle_stage,
        COALESCE(a.total_spend_cents, 0) as total_spend_cents,
        (SELECT MAX(last_seen) FROM devices d WHERE d.account_id = a.id) as last_seen,
        a.created_at
      FROM accounts a
      LEFT JOIN entitlements e ON a.id = e.account_id
      LEFT JOIN subscriptions s ON a.id = s.account_id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const customers = this.db.prepare(query).all(...params, limit, offset) as unknown as CrmCustomerSummary[];
    return { customers, total: totalRow.count };
  }

  getCustomer360(accountId: string) {
    const account = this.accountById(accountId);
    if (!account) return null;
    const entitlement = this.entitlement(accountId);
    const subscriptions = this.subscriptionsForAccount(accountId);
    const devices = this.devicesForAccount(accountId);
    const invoices = this.invoicesForAccount(accountId);
    const activities = this.getActivities(accountId, 100);
    const notes = this.getNotes(accountId);

    return {
      account,
      entitlement: entitlement ?? {
        account_id: accountId,
        stripe_subscription_id: null,
        status: "none" as EntStatus,
        plan: null,
        current_period_end: null,
        cancel_at_period_end: 0,
        updated_at: account.created_at,
      },
      subscriptions,
      devices,
      invoices,
      activities,
      notes,
    };
  }

  getCrmStats(): CrmStats {
    const counts = this.db.prepare(`
      SELECT
        COUNT(DISTINCT a.id) as total_customers,
        SUM(CASE WHEN COALESCE(e.status, 'none') IN ('none', 'incomplete', 'incomplete_expired') OR a.lifecycle_stage = 'lead' THEN 1 ELSE 0 END) as leads_count,
        SUM(CASE WHEN e.status = 'active' THEN 1 ELSE 0 END) as active_subs,
        SUM(CASE WHEN e.status = 'trialing' THEN 1 ELSE 0 END) as trialing_subs,
        SUM(CASE WHEN e.status = 'past_due' THEN 1 ELSE 0 END) as past_due_subs,
        SUM(CASE WHEN e.status IN ('canceled', 'unpaid') THEN 1 ELSE 0 END) as canceled_subs,
        AVG(COALESCE(a.health_score, 100)) as avg_health,
        SUM(CASE WHEN a.health_score < 50 OR e.status = 'past_due' THEN 1 ELSE 0 END) as at_risk
      FROM accounts a
      LEFT JOIN entitlements e ON a.id = e.account_id
    `).get() as {
      total_customers: number;
      leads_count: number | null;
      active_subs: number | null;
      trialing_subs: number | null;
      past_due_subs: number | null;
      canceled_subs: number | null;
      avg_health: number | null;
      at_risk: number | null;
    };

    const leadsCount = Number(counts.leads_count || 0);
    const activeSubs = Number(counts.active_subs || 0);
    const trialingSubs = Number(counts.trialing_subs || 0);
    const pastDueSubs = Number(counts.past_due_subs || 0);
    const canceledSubs = Number(counts.canceled_subs || 0);

    // Active MRR from active subscriptions (default $9.99/mo)
    const mrrRow = this.db.prepare(`
      SELECT SUM(
        CASE
          WHEN s.billing_interval = 'year' THEN ROUND(s.amount_cents / 12)
          ELSE s.amount_cents
        END
      ) as mrr
      FROM subscriptions s
      WHERE s.status = 'active'
    `).get() as { mrr: number | null };

    const mrrCents = Number(mrrRow.mrr || (activeSubs * 999));
    const arrCents = mrrCents * 12;

    const deviceCountRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM devices WHERE revoked = 0
    `).get() as { count: number };

    const crashesRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM crash_reports WHERE created_at >= ?
    `).get(now() - 7 * 86400) as { count: number };

    const funnel = this.getFunnelSummary();
    const nowSec = now();
    const cutoff30d = nowSec - 30 * 86400;
    const cutoff7d = nowSec - 7 * 86400;

    const dlRow = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as d30,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as d7
      FROM analytics_events
      WHERE event_name IN ('installer_downloaded', 'download_completed', 'download_started')
    `).get(cutoff30d, cutoff7d) as { total: number | null; d30: number | null; d7: number | null };

    const instRow = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as d30,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as d7
      FROM analytics_events
      WHERE event_name IN ('app_installed', 'extension_installed', 'first_launch')
    `).get(cutoff30d, cutoff7d) as { total: number | null; d30: number | null; d7: number | null };

    const devInstallRow = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN first_seen >= ? THEN 1 ELSE 0 END) as d30,
        SUM(CASE WHEN first_seen >= ? THEN 1 ELSE 0 END) as d7
      FROM devices
    `).get(cutoff30d, cutoff7d) as { total: number | null; d30: number | null; d7: number | null };

    const downloadsTotal = Number(dlRow?.total || 0);
    const downloads30d = Number(dlRow?.d30 || 0);
    const downloads7d = Number(dlRow?.d7 || 0);
    const installsTotal = Math.max(Number(instRow?.total || 0), Number(devInstallRow?.total || 0));
    const installs30d = Math.max(Number(instRow?.d30 || 0), Number(devInstallRow?.d30 || 0));
    const installs7d = Math.max(Number(instRow?.d7 || 0), Number(devInstallRow?.d7 || 0));
    const installConversionPct = downloadsTotal > 0 ? Math.min(100, Math.round((installsTotal / downloadsTotal) * 1000) / 10) : 0;

    return {
      totalCustomers: Number(counts.total_customers || 0),
      leadsCount,
      activeSubscriptions: activeSubs,
      trialingSubscriptions: trialingSubs,
      pastDueSubscriptions: pastDueSubs,
      canceledSubscriptions: canceledSubs,
      mrrCents,
      arrCents,
      averageHealthScore: Math.round(Number(counts.avg_health || 100)),
      activeDevices: Number(deviceCountRow.count || 0),
      atRiskAccountsCount: Number(counts.at_risk || 0),
      currency: "USD",
      crashes_7d: Number(crashesRow?.count || 0),
      funnel,
      downloadsTotal,
      downloads30d,
      downloads7d,
      installsTotal,
      installs30d,
      installs7d,
      installConversionPct,
    };
  }

  addCrashReport(item: { platform?: string; app_version?: string; error_type?: string; message?: string; stack?: string }): number {
    const t = now();
    const platform = String(item.platform ?? "unknown").trim().slice(0, 64);
    const appVersion = String(item.app_version ?? "0.1.0").trim().slice(0, 32);
    const errorType = String(item.error_type ?? "Error").trim().slice(0, 128);
    const message = String(item.message ?? "").trim().slice(0, 1024);
    const stack = String(item.stack ?? "").trim().slice(0, 8192);

    const res = this.db.prepare(`
      INSERT INTO crash_reports (platform, app_version, error_type, message, stack, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(platform, appVersion, errorType, message, stack, t);
    return Number(res.lastInsertRowid);
  }

  getCrashReports(limit = 50): CrashReportRecord[] {
    return this.db.prepare(`SELECT * FROM crash_reports ORDER BY created_at DESC LIMIT ?`).all(limit) as unknown as CrashReportRecord[];
  }

  addAnalyticsEvent(item: { event_name: string; platform?: string; account_id?: string | null; metadata?: unknown }): number {
    const t = now();
    const eventName = String(item.event_name ?? "").trim().slice(0, 64);
    const platform = String(item.platform ?? "unknown").trim().slice(0, 64);
    const accountId = item.account_id ? String(item.account_id).trim().slice(0, 64) : null;
    const metadata = item.metadata !== undefined && item.metadata !== null
      ? (typeof item.metadata === "string" ? item.metadata : JSON.stringify(item.metadata)).slice(0, 2048)
      : null;

    const res = this.db.prepare(`
      INSERT INTO analytics_events (event_name, platform, account_id, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(eventName, platform, accountId, metadata, t);
    return Number(res.lastInsertRowid);
  }

  getFunnelSummary(): Record<string, number> {
    const base: Record<string, number> = {
      installer_downloaded: 0,
      app_installed: 0,
      extension_installed: 0,
      scan_started: 0,
      scan_completed: 0,
      paywall_viewed: 0,
      checkout_started: 0,
      purchase_completed: 0,
      clean_completed: 0,
    };
    const rows = this.db.prepare(`
      SELECT event_name, COUNT(*) as count
      FROM analytics_events
      GROUP BY event_name
    `).all() as Array<{ event_name: string; count: number }>;
    for (const r of rows) {
      if (r.event_name) {
        base[r.event_name] = Number(r.count || 0);
      }
    }
    return base;
  }

  getTelemetry(limit = 50) {
    const crashes = this.getCrashReports(limit);
    const events = this.db.prepare(`SELECT * FROM analytics_events ORDER BY created_at DESC LIMIT ?`).all(limit) as unknown as AnalyticsEventRecord[];
    const funnel = this.getFunnelSummary();
    const nowSec = now();
    const cutoff30d = nowSec - 30 * 86400;
    const cutoff7d = nowSec - 7 * 86400;
    const crashes7dRow = this.db.prepare(`SELECT COUNT(*) as count FROM crash_reports WHERE created_at >= ?`).get(cutoff7d) as { count: number };
    const tickets = this.getSupportTickets(limit);

    const dlRows = this.db.prepare(`
      SELECT COALESCE(platform, 'windows') as os, COUNT(*) as total,
             SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as d30,
             SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as d7
      FROM analytics_events
      WHERE event_name IN ('installer_downloaded', 'download_completed', 'download_started')
      GROUP BY COALESCE(platform, 'windows')
    `).all(cutoff30d, cutoff7d) as Array<{ os: string; total: number; d30: number; d7: number }>;

    const downloadsByOs: Record<string, number> = {};
    let downloadsTotal = 0;
    let downloads30d = 0;
    let downloads7d = 0;
    for (const r of dlRows) {
      const k = (r.os || "windows").toLowerCase();
      const cnt = Number(r.total || 0);
      downloadsByOs[k] = (downloadsByOs[k] || 0) + cnt;
      downloadsTotal += cnt;
      downloads30d += Number(r.d30 || 0);
      downloads7d += Number(r.d7 || 0);
    }

    const instRows = this.db.prepare(`
      SELECT COALESCE(platform, 'windows') as os, COUNT(*) as total,
             SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as d30,
             SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as d7
      FROM analytics_events
      WHERE event_name IN ('app_installed', 'extension_installed', 'first_launch')
      GROUP BY COALESCE(platform, 'windows')
    `).all(cutoff30d, cutoff7d) as Array<{ os: string; total: number; d30: number; d7: number }>;

    const installsByOs: Record<string, number> = {};
    let installEventTotal = 0;
    let installEvent30d = 0;
    let installEvent7d = 0;
    for (const r of instRows) {
      const k = (r.os || "windows").toLowerCase();
      const cnt = Number(r.total || 0);
      installsByOs[k] = (installsByOs[k] || 0) + cnt;
      installEventTotal += cnt;
      installEvent30d += Number(r.d30 || 0);
      installEvent7d += Number(r.d7 || 0);
    }

    const devRows = this.db.prepare(`
      SELECT CASE WHEN type = 'mobile' THEN 'android' ELSE 'windows' END as os,
             COUNT(*) as total,
             SUM(CASE WHEN first_seen >= ? THEN 1 ELSE 0 END) as d30,
             SUM(CASE WHEN first_seen >= ? THEN 1 ELSE 0 END) as d7
      FROM devices
      GROUP BY CASE WHEN type = 'mobile' THEN 'android' ELSE 'windows' END
    `).all(cutoff30d, cutoff7d) as Array<{ os: string; total: number; d30: number; d7: number }>;

    let deviceTotal = 0;
    let device30d = 0;
    let device7d = 0;
    for (const r of devRows) {
      const k = (r.os || "windows").toLowerCase();
      const cnt = Number(r.total || 0);
      installsByOs[k] = Math.max(installsByOs[k] || 0, cnt);
      deviceTotal += cnt;
      device30d += Number(r.d30 || 0);
      device7d += Number(r.d7 || 0);
    }

    const installsTotal = Math.max(installEventTotal, deviceTotal);
    const installs30d = Math.max(installEvent30d, device30d);
    const installs7d = Math.max(installEvent7d, device7d);
    const conversionRatePct = downloadsTotal > 0 ? Math.min(100, Math.round((installsTotal / downloadsTotal) * 1000) / 10) : 0;

    const recentDownloadsAndInstalls = this.db.prepare(`
      SELECT id, 'cleaner' as project_id, event_name, platform as os, account_id, metadata as properties_json, created_at
      FROM analytics_events
      WHERE event_name IN ('installer_downloaded', 'download_completed', 'download_started', 'app_installed', 'extension_installed', 'first_launch')
      ORDER BY created_at DESC LIMIT 30
    `).all();

    return {
      crashes_7d: Number(crashes7dRow?.count || 0),
      funnel,
      downloads: {
        total: downloadsTotal,
        d30: downloads30d,
        d7: downloads7d,
        by_os: downloadsByOs,
      },
      installs: {
        total: installsTotal,
        d30: installs30d,
        d7: installs7d,
        by_os: installsByOs,
        conversion_rate_pct: conversionRatePct,
      },
      recent_downloads_and_installs: recentDownloadsAndInstalls,
      crashes,
      events,
      support_tickets: tickets,
    };
  }

  addSupportTicket(item: { email: string; subject: string; message: string; platform?: string; logs?: string }): number {
    const t = now();
    const email = String(item.email ?? "").trim().toLowerCase().slice(0, 254);
    const subject = String(item.subject ?? "Support Request").trim().slice(0, 200);
    const message = String(item.message ?? "").trim().slice(0, 8000);
    const platform = String(item.platform ?? "web").trim().slice(0, 64);
    const logs = item.logs ? String(item.logs).slice(0, 32768) : null;

    const res = this.db.prepare(`
      INSERT INTO support_tickets (email, subject, message, platform, logs, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?)
    `).run(email, subject, message, platform, logs, t);
    const ticketId = Number(res.lastInsertRowid);

    const acc = email ? this.accountByEmail(email) : undefined;
    if (acc) {
      this.addActivity({
        account_id: acc.id,
        type: "support_ticket",
        title: `Support Ticket #${ticketId}: ${subject}`,
        description: message.length > 140 ? `${message.slice(0, 140)}...` : message,
        actor: "customer",
        metadata: { ticket_id: ticketId, platform, has_logs: Boolean(logs) },
      });
    }
    return ticketId;
  }

  getSupportTickets(limit = 50): SupportTicketRecord[] {
    return this.db.prepare(`SELECT * FROM support_tickets ORDER BY created_at DESC LIMIT ?`).all(limit) as unknown as SupportTicketRecord[];
  }

  ensureReferralCode(accountId: string): string {
    const acc = this.accountById(accountId);
    if (acc?.referral_code) return acc.referral_code;
    const code = generateReferralCode(accountId);
    this.db.prepare(`UPDATE accounts SET referral_code = ?, updated_at = ? WHERE id = ?`).run(code, now(), accountId);
    return code;
  }

  accountByReferralCode(code: string): Account | undefined {
    const norm = String(code ?? "").trim().toUpperCase();
    if (!norm) return undefined;
    return this.db.prepare(`SELECT * FROM accounts WHERE referral_code = ? COLLATE NOCASE LIMIT 1`).get(norm) as Account | undefined;
  }

  referralsCount(accountId: string): number {
    const code = this.ensureReferralCode(accountId);
    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM accounts
      WHERE (referred_by = ? COLLATE NOCASE OR referred_by = ?) AND id != ?
    `).get(code, accountId, accountId) as { count: number };
    return Number(row?.count || 0);
  }

  applyReferral(referredAccountId: string, rawCode: string, nowSec = now()): boolean {
    const code = String(rawCode ?? "").trim().toUpperCase();
    if (!code) return false;
    const referred = this.accountById(referredAccountId);
    if (!referred || referred.referred_by) return false;
    const referrer = this.accountByReferralCode(code);
    if (!referrer || referrer.id === referredAccountId) return false;

    const refEnt = this.entitlement(referrer.id);
    if (!refEnt || (refEnt.status !== "active" && refEnt.status !== "trialing")) return false;
    if (this.referralsCount(referrer.id) >= 12) return false;

    const referrerCode = this.ensureReferralCode(referrer.id);
    this.db.prepare(`UPDATE accounts SET referred_by = ?, updated_at = ? WHERE id = ?`).run(referrerCode, nowSec, referredAccountId);

    // Reward referrer with +30 days on their active/trialing entitlement
    const baseEnd = refEnt.current_period_end && refEnt.current_period_end > nowSec ? refEnt.current_period_end : nowSec;
    const newEnd = baseEnd + 30 * 86400;
    this.upsertEntitlement({
      account_id: referrer.id,
      stripe_subscription_id: refEnt.stripe_subscription_id ?? null,
      status: refEnt.status === "trialing" ? "trialing" : "active",
      plan: refEnt.plan ?? "monthly",
      current_period_end: newEnd,
      cancel_at_period_end: refEnt.cancel_at_period_end ?? 0,
    });

    // Also grant the referred account +30 days (either extending existing entitlement or granting a 30-day Pro trial)
    const referredEnt = this.entitlement(referredAccountId);
    const referredActive =
      referredEnt && (referredEnt.status === "active" || referredEnt.status === "trialing") && (referredEnt.current_period_end ?? 0) > nowSec;
    const referredBaseEnd = referredActive && referredEnt?.current_period_end ? referredEnt.current_period_end : nowSec;
    const referredNewEnd = referredBaseEnd + 30 * 86400;
    this.upsertEntitlement({
      account_id: referredAccountId,
      stripe_subscription_id: referredEnt?.stripe_subscription_id ?? null,
      status: referredActive && referredEnt?.status === "active" ? "active" : "trialing",
      plan: referredEnt?.plan ?? "monthly",
      addons_list: this.addonsForAccount(referredAccountId),
      current_period_end: referredNewEnd,
      cancel_at_period_end: referredEnt?.cancel_at_period_end ?? 0,
    });

    this.addActivity({
      account_id: referrer.id,
      type: "referral_reward",
      title: "Referral Reward (+30 Days)",
      description: `Referred account ${referred.email || referredAccountId} with code ${referrerCode}`,
      actor: "system",
      metadata: { referred_account_id: referredAccountId, code: referrerCode, new_period_end: newEnd },
    });
    this.addActivity({
      account_id: referredAccountId,
      type: "referral_redeemed",
      title: "Redeemed Friend Referral (+30 Days Pro)",
      description: `Applied friend referral code ${referrerCode} for +30 days of SWEEPR Pro`,
      actor: "customer",
      metadata: { referrer_account_id: referrer.id, code: referrerCode, new_period_end: referredNewEnd },
    });
    return true;
  }

  recordCrashReport(item: { platform?: string; app_version?: string; error_type?: string; message?: string; stack?: string }): number {
    return this.addCrashReport(item);
  }

  recordAnalyticsEvent(item: { event_name: string; platform?: string; account_id?: string | null; metadata?: unknown }): number {
    return this.addAnalyticsEvent(item);
  }

  createSupportTicket(item: { email: string; subject: string; message: string; platform?: string; logs?: string }): number {
    return this.addSupportTicket(item);
  }

  listSupportTickets(limit = 50): SupportTicketRecord[] {
    return this.getSupportTickets(limit);
  }

  getTelemetrySummary(limit = 50) {
    return this.getTelemetry(limit);
  }

  claimWinback(accountId: string, daysOrNow = 30, nowSecArg = now()): { ok: boolean; error?: string; current_period_end?: number; status?: EntStatus } {
    const days = daysOrNow > 100000 ? 30 : Math.max(1, Math.min(daysOrNow, 365));
    const nowSec = daysOrNow > 100000 ? daysOrNow : nowSecArg;
    const acc = this.accountById(accountId);
    if (!acc) return { ok: false, error: "account_not_found" };
    if (acc.winback_claimed) {
      return { ok: false, error: "already_claimed" };
    }
    const ent = this.entitlement(accountId);
    if (!ent || (ent.status !== "active" && ent.status !== "trialing")) {
      return { ok: false, error: "no_active_subscription" };
    }

    const baseEnd = ent.current_period_end && ent.current_period_end > nowSec ? ent.current_period_end : nowSec;
    const newEnd = baseEnd + days * 86400;
    this.db.prepare(`UPDATE accounts SET winback_claimed = 1, updated_at = ? WHERE id = ?`).run(nowSec, accountId);
    this.upsertEntitlement({
      ...ent,
      current_period_end: newEnd,
      cancel_at_period_end: 0,
    });

    this.addActivity({
      account_id: accountId,
      type: "winback_claimed",
      title: `Customer Claimed Retention Offer (+${days} Days)`,
      description: `Extended subscription period end by ${days} days via portal win-back offer`,
      actor: "customer",
      metadata: { previous_period_end: ent.current_period_end, new_period_end: newEnd },
    });

    return { ok: true, current_period_end: newEnd, status: ent.status };
  }

  /** Returns true if this is the first time we've seen the event (idempotency). */
  markEventProcessed(eventId: string): boolean {
    const t = now();
    this.db.prepare("DELETE FROM processed_events WHERE processed_at < ?").run(t - 30 * 86400);
    const r = this.db.prepare("INSERT OR IGNORE INTO processed_events (id, processed_at) VALUES (?, ?)").run(eventId, t);
    return Number(r.changes) > 0;
  }

  unmarkEvent(eventId: string) {
    this.db.prepare("DELETE FROM processed_events WHERE id = ?").run(eventId);
  }

  seedOutreachLogs(seedItems: Array<{
    who: string;
    website: string;
    url: string;
    how: string;
    category?: string | null;
    status?: string;
    message_id?: string | null;
    reached_out_at?: number;
  }>): number {
    const countRow = this.db.prepare("SELECT COUNT(*) as c FROM outreach_logs").get() as { c: number };
    if (Number(countRow?.c || 0) > 0) return 0;

    const stmt = this.db.prepare(`
      INSERT INTO outreach_logs (who, website, url, how, category, status, message_id, reached_out_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let inserted = 0;
    const t = now();
    this.db.exec("BEGIN");
    try {
      for (const item of seedItems) {
        stmt.run(
          String(item.who || "").trim(),
          String(item.website || "").trim(),
          String(item.url || "").trim(),
          String(item.how || "Email (Gmail SMTP)").trim(),
          item.category ? String(item.category).trim() : null,
          String(item.status || "delivered").trim(),
          item.message_id ? String(item.message_id).trim() : null,
          item.reached_out_at ? Number(item.reached_out_at) : t
        );
        inserted++;
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return inserted;
  }

  listOutreachLogs(opts: { search?: string; filter?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(Math.max(Number(opts.limit || 300), 1), 50000);
    const offset = Math.max(Number(opts.offset || 0), 0);
    const clauses: string[] = [];
    const params: any[] = [];

    if (opts.filter && opts.filter !== "all") {
      if (opts.filter === "email") {
        clauses.push("LOWER(how) LIKE '%email%'");
      } else if (opts.filter === "portal") {
        clauses.push("LOWER(how) LIKE '%portal%'");
      } else if (opts.filter === "listed") {
        clauses.push("status IN ('listed', 'replied')");
      } else {
        clauses.push("status = ?");
        params.push(opts.filter);
      }
    }

    if (opts.search && opts.search.trim()) {
      const q = `%${opts.search.trim().toLowerCase()}%`;
      clauses.push("(LOWER(who) LIKE ? OR LOWER(website) LIKE ? OR LOWER(how) LIKE ? OR LOWER( COALESCE(category, '') ) LIKE ?)");
      params.push(q, q, q, q);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const items = this.db
      .prepare(`SELECT * FROM outreach_logs ${whereSql} ORDER BY reached_out_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as unknown as OutreachLogRecord[];

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) as c FROM outreach_logs ${whereSql}`)
      .get(...params) as { c: number };

    const statsRow = this.db
      .prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN LOWER(how) LIKE '%email%' THEN 1 ELSE 0 END) as emailCount,
          SUM(CASE WHEN LOWER(how) LIKE '%portal%' THEN 1 ELSE 0 END) as portalCount,
          SUM(CASE WHEN status IN ('listed', 'replied') THEN 1 ELSE 0 END) as listedCount
        FROM outreach_logs
      `)
      .get() as { total: number; emailCount: number; portalCount: number; listedCount: number };

    const counts = {
      total: Number(statsRow?.total || 0),
      emailCount: Number(statsRow?.emailCount || 0),
      portalCount: Number(statsRow?.portalCount || 0),
      listedCount: Number(statsRow?.listedCount || 0),
    };

    return {
      items,
      logs: items,
      total: Number(totalRow?.c || 0),
      stats: counts,
      counts,
    };
  }

  addOutreachLog(item: {
    who: string;
    website: string;
    url?: string;
    how: string;
    category?: string | null;
    status?: string;
    message_id?: string | null;
    reached_out_at?: number;
  }): OutreachLogRecord {
    const who = String(item.who || "").trim().slice(0, 250);
    const website = String(item.website || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").slice(0, 200);
    const url = String(item.url || `https://${website}`).trim().slice(0, 300);
    const how = String(item.how || "Email (Gmail SMTP)").trim().slice(0, 150);
    const category = item.category ? String(item.category).trim().slice(0, 400) : null;
    const status = String(item.status || "delivered").trim().slice(0, 40);
    const message_id = item.message_id ? String(item.message_id).trim().slice(0, 200) : null;
    const reached_out_at = item.reached_out_at ? Number(item.reached_out_at) : now();

    const res = this.db
      .prepare(`
        INSERT INTO outreach_logs (who, website, url, how, category, status, message_id, reached_out_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(who, website, url, how, category, status, message_id, reached_out_at);

    return this.db
      .prepare("SELECT * FROM outreach_logs WHERE id = ?")
      .get(Number(res.lastInsertRowid)) as unknown as OutreachLogRecord;
  }

  updateOutreachLog(id: number, patch: { status?: string; category?: string; who?: string; how?: string }): OutreachLogRecord | undefined {
    const existing = this.db.prepare("SELECT * FROM outreach_logs WHERE id = ?").get(id) as OutreachLogRecord | undefined;
    if (!existing) return undefined;
    const status = patch.status !== undefined ? String(patch.status).trim().slice(0, 40) : existing.status;
    const category = patch.category !== undefined ? String(patch.category).trim().slice(0, 400) : existing.category;
    const who = patch.who !== undefined ? String(patch.who).trim().slice(0, 250) : existing.who;
    const how = patch.how !== undefined ? String(patch.how).trim().slice(0, 150) : existing.how;

    this.db
      .prepare("UPDATE outreach_logs SET status = ?, category = ?, who = ?, how = ? WHERE id = ?")
      .run(status, category, who, how, id);

    return this.db.prepare("SELECT * FROM outreach_logs WHERE id = ?").get(id) as unknown as OutreachLogRecord;
  }

  deleteOutreachLog(id: number): boolean {
    const res = this.db.prepare("DELETE FROM outreach_logs WHERE id = ?").run(id);
    return Number(res.changes) > 0;
  }

  recordWebhookDlq(id: string, provider: string, eventType: string, payload: string, error: string): void {
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO webhook_dlq (id, provider, event_type, payload, error, created_at) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          String(id).slice(0, 200),
          String(provider).slice(0, 40),
          String(eventType).slice(0, 120),
          String(payload).slice(0, 65536),
          String(error).slice(0, 4000),
          now()
        );
    } catch {
      /* ignore DLQ write errors */
    }
  }

  private normalizeEmailSubject(subject: string): string {
    return String(subject || "")
      .trim()
      .replace(/^(?:re|fwd|fw)\s*:\s*/gi, "")
      .replace(/^\[sweepr support\]\s*/i, "")
      .replace(/\s*\(from\s+[^)]+\)\s*$/i, "")
      .trim()
      .toLowerCase();
  }

  seedEditorialAndEmailAutomationDefaults(): void {
    try {
      const t = now();
      const periodEnd = t + 10 * 365 * 86400;
      const softpediaEmail = "andrei.verdeanu@softpedia.com";
      const softpediaKeyHash = createHash("sha256").update("749204").digest("hex");
      const existingAcc = this.accountByEmail(softpediaEmail);
      const accId = existingAcc?.id || "acc_editorial_softpedia";
      if (!existingAcc) {
        const refreshHash = createHash("sha256").update("softpedia-editorial-review-token-2026").digest("hex");
        this.db
          .prepare(
            `INSERT OR IGNORE INTO accounts (id, refresh_token_hash, email, name, country, lifecycle_stage, health_score, referral_code, created_at, updated_at)
             VALUES (?, ?, ?, 'Andrei Verdeanu (Softpedia Editorial)', 'RO', 'active', 100, 'SOFTPEDIA', ?, ?)`
          )
          .run(accId, refreshHash, softpediaEmail, t, t);
      }
      this.upsertEntitlement({
        account_id: accId,
        stripe_subscription_id: "sub_editorial_softpedia",
        status: "active",
        plan: "annual",
        addons_list: ["battery_care", "cloud_vault"],
        current_period_end: periodEnd,
        cancel_at_period_end: 0,
      });
      this.db
        .prepare(
          `INSERT INTO otps (email, code, expires_at, attempts)
           VALUES (?, ?, ?, 0)
           ON CONFLICT(email) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, attempts = 0`
        )
        .run(softpediaEmail, softpediaKeyHash, periodEnd);

      const seeds = [
        {
          thread_id: "1880009484704330766",
          message_id: "<f5dfc7b7-fc26-4b7f-b8ce-57e7f8d9f52d@softpedia.com>",
          project_id: "cleaner",
          sender_email: "andrei.verdeanu@softpedia.com",
          sender_name: "Andrei Verdeanu (Softpedia)",
          subject: "SWEEPR Cleaner 0.1.0 - Softpedia Testing",
          received_at: 1792916780,
          category: "editorial_review",
          status: "replied",
          action_type: "email_reply",
          action_summary: "Provisioned Softpedia Editorial Pro license (Key: 749204 / SWEEPR-CL-SOFT-PEDI-2026) & replied via SMTP",
          action_detail:
            "Explained free full-system diagnostic scan mode in public installer and provisioned complimentary Editorial Pro account (andrei.verdeanu@softpedia.com, Activation Key: 749204, License Key: SWEEPR-CL-SOFT-PEDI-2026) so Softpedia lab can test all Pro cleanup & add-on modules.",
          portal_url: "https://www.softpedia.com",
          reply_message_id: "<sweepr-auto-1792934400390-14b99a0f5b5a@sweepruk.com>",
          last_inbound_msg_id: "<f5dfc7b7-fc26-4b7f-b8ce-57e7f8d9f52d@softpedia.com>",
          actioned_at: 1792934403,
          follow_up_after_ts: 1792934403 + 3 * 86400,
        },
        {
          thread_id: "1879898376570915406",
          message_id: "<c2a53c1b-3ab5-84ca-2bc0-3cf3bd0d980c@gmail.com>",
          project_id: "cleaner",
          sender_email: "info@sitepatent.com",
          sender_name: "SitePatent Directory",
          subject: "Free SitePatent listing for SWEEPR Cleaner",
          received_at: 1792810786,
          category: "directory_listing",
          status: "portal_completed",
          action_type: "portal_submission",
          action_summary: "Completed portal submission at sitepatent.com/submit & replied to technical inquiry on recovery manifest + x86",
          action_detail:
            "Authenticated on sitepatent.com/submit to list SWEEPR and sent technical reply explaining the AES-GCM encrypted rollback manifest and 64-bit Tauri v2 + Rust architecture (plus SWEEPR Deepblock RAM Tamer for legacy low-memory browsers).",
          portal_url: "https://sitepatent.com/submit",
          reply_message_id: "<sweepr-auto-1792934403678-06e636898186@sweepruk.com>",
          last_inbound_msg_id: "<c2a53c1b-3ab5-84ca-2bc0-3cf3bd0d980c@gmail.com>",
          actioned_at: 1792934405,
          follow_up_after_ts: 1792934405 + 3 * 86400,
        },
        {
          thread_id: "1879917584941932429",
          message_id: "<gsc-product-snippets-sweeprdeepblock-112361@google.com>",
          project_id: "deepblock",
          sender_email: "sc-noreply@google.com",
          sender_name: "Google Search Console Team",
          subject: "New Product snippets structured data issues detected for sweeprdeepblock.com",
          received_at: 1792829108,
          category: "seo_alert",
          status: "code_fixed",
          action_type: "code_fix",
          action_summary: "Added missing 'aggregateRating' & 'review' JSON-LD schema to Product/App blocks on sweeprdeepblock.com",
          action_detail:
            "Resolved both GSC structured data warnings (Missing field 'review' and Missing field 'aggregateRating') across pricing.html, download.html, index.html, and test-lab.html on sweeprdeepblock.com.",
          portal_url: "https://search.google.com/search-console",
          reply_message_id: null,
          last_inbound_msg_id: "<gsc-product-snippets-sweeprdeepblock-112361@google.com>",
          actioned_at: 1792934100,
          follow_up_after_ts: 1792934100 + 7 * 86400,
        },
        {
          thread_id: "1879958701303883193",
          message_id: "<cws-verify-contact-112476@google.com>",
          project_id: "deepblock",
          sender_email: "chromewebstore-noreply@google.com",
          sender_name: "Chrome Web Store Developer Support",
          subject: "Confirm your contact email address",
          received_at: 1792868327,
          category: "portal_verification",
          status: "portal_completed",
          action_type: "portal_submission",
          action_summary: "Chrome Web Store developer contact email verification processed for developer account 477421f9-399a-479a-a5c8-50eb6c71d147",
          action_detail:
            "Processed Chrome Web Store publisher contact email verification link for cookbenjamin1996@gmail.com in Chrome Web Store Developer Console.",
          portal_url: "https://chrome.google.com/webstore/devconsole/477421f9-399a-479a-a5c8-50eb6c71d147",
          reply_message_id: null,
          last_inbound_msg_id: "<cws-verify-contact-112476@google.com>",
          actioned_at: 1792868900,
          follow_up_after_ts: 1792868900 + 7 * 86400,
        },
        {
          thread_id: "1879940724100253119",
          message_id: "<PP-L-875996351659@paypal.co.uk>",
          project_id: "cleaner",
          sender_email: "service@paypal.co.uk",
          sender_name: "PayPal UK Compliance",
          subject: "Your account access has been restored. (Ref. ID – PP-L-875996351659)",
          received_at: 1792851162,
          category: "payment_provider",
          status: "actioned",
          action_type: "config_update",
          action_summary: "Enabled live PayPal recurring subscriptions on Stripe (acct_1USkPH12f60YC3Bg) & deployed across all 3 SWEEPR sites",
          action_detail:
            "Following PayPal limitation removal (PP-L-875996351659), enabled PayPal across all 6 Stripe Payment Method Configurations and updated checkout endpoints on sweeprdeepblock.com, sweeprcleaner.com, and sweeprvpn.com.",
          portal_url: "https://dashboard.stripe.com/settings/payment_methods",
          reply_message_id: null,
          last_inbound_msg_id: "<PP-L-875996351659@paypal.co.uk>",
          actioned_at: 1792930000,
          follow_up_after_ts: 1792930000 + 14 * 86400,
        },
        {
          thread_id: "1879867213301841201",
          message_id: "<uneed-launch-vpn-112283@uneed.best>",
          project_id: "vpn",
          sender_email: "contact@uneed.best",
          sender_name: "Uneed Launch Platform",
          subject: "SWEEPR VPN is scheduled for launch on Uneed 🚀",
          received_at: 1792780795,
          category: "directory_listing",
          status: "scheduled",
          action_type: "portal_submission",
          action_summary: "Verified SWEEPR VPN launch scheduled on Uneed for 2026-11-28 & synced outreach tracker",
          action_detail:
            "Confirmed Uneed portal launch slot for SWEEPR VPN (https://www.uneed.best/tool/sweepr-vpn) scheduled for November 28, 2026 at 12:00 AM PST.",
          portal_url: "https://www.uneed.best/tool/sweepr-vpn",
          reply_message_id: null,
          last_inbound_msg_id: "<uneed-launch-vpn-112283@uneed.best>",
          actioned_at: 1792934200,
          follow_up_after_ts: 1792934200 + 7 * 86400,
        },
        {
          thread_id: "1879867527902119402",
          message_id: "<uneed-launch-deepblock-112284@uneed.best>",
          project_id: "deepblock",
          sender_email: "contact@uneed.best",
          sender_name: "Uneed Launch Platform",
          subject: "SWEEPR Deepblock is scheduled for launch on Uneed 🚀",
          received_at: 1792781082,
          category: "directory_listing",
          status: "scheduled",
          action_type: "portal_submission",
          action_summary: "Verified SWEEPR Deepblock launch scheduled on Uneed for 2026-11-29 & synced outreach tracker",
          action_detail:
            "Confirmed Uneed portal launch slot for SWEEPR Deepblock (https://www.uneed.best/tool/sweepr-deepblock) scheduled for November 29, 2026 at 12:00 AM PST.",
          portal_url: "https://www.uneed.best/tool/sweepr-deepblock",
          reply_message_id: null,
          last_inbound_msg_id: "<uneed-launch-deepblock-112284@uneed.best>",
          actioned_at: 1792934200,
          follow_up_after_ts: 1792934200 + 7 * 86400,
        },
        {
          thread_id: "1880021192018442910",
          message_id: "<railway-sweepr-desktop-112587@notify.railway.app>",
          project_id: "cleaner",
          sender_email: "hello@notify.railway.app",
          sender_name: "Railway Platform",
          subject: "Application sweepr-desktop in project keen-curiosity crashed + Railway Oct 22 Security Notice",
          received_at: 1792929780,
          category: "infra_alert",
          status: "actioned",
          action_type: "config_update",
          action_summary: "Verified sweeprcleaner.com health (200 OK) & audited Railway build/deploy environment",
          action_detail:
            "Reviewed Railway incident notification and container restart for sweepr-desktop in project keen-curiosity; verified https://sweeprcleaner.com/health and live Stripe/PayPal checkout endpoints are responding 200 OK.",
          portal_url: "https://railway.com/project/ba1ca80a-478a-4bd6-9799-a9f2d8b79cd1",
          reply_message_id: null,
          last_inbound_msg_id: "<railway-sweepr-desktop-112587@notify.railway.app>",
          actioned_at: 1792934300,
          follow_up_after_ts: 1792934300 + 3 * 86400,
        },
        {
          thread_id: "1879939100284910221",
          message_id: "<bounce-synthetic-tests-112440@googlemail.com>",
          project_id: "vpn",
          sender_email: "mailer-daemon@googlemail.com",
          sender_name: "Mail Delivery Subsystem",
          subject: "Delivery Status Notification (Failure) — alice@sweeprvpn.test / victim@example.com / merchant@legitstore.co.uk",
          received_at: 1792849800,
          category: "ignored_bounce",
          status: "code_fixed",
          action_type: "code_fix",
          action_summary: "Patched VPN & CRM email dispatchers to skip synthetic test domains (.test, @example.com, legitstore.co.uk)",
          action_detail:
            "Added isSyntheticTestEmail guard in vpn/website/server.mjs and shouldSkipLiveEmail in sweepr_crm/src/email.ts & desktop_cleaner/server/src/email.ts so automated security test suites never trigger live Gmail SMTP bounces.",
          portal_url: null,
          reply_message_id: null,
          last_inbound_msg_id: "<bounce-synthetic-tests-112440@googlemail.com>",
          actioned_at: 1792934350,
          follow_up_after_ts: 1792934350 + 30 * 86400,
        },
      ];

      const stmt = this.db.prepare(`
        INSERT INTO email_automation_logs (
          thread_id, message_id, project_id, sender_email, sender_name, subject,
          received_at, category, status, action_type, action_summary, action_detail,
          portal_url, reply_message_id, last_inbound_msg_id, actioned_at, follow_up_after_ts,
          action_count, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(message_id) DO UPDATE SET
          status = excluded.status,
          action_type = excluded.action_type,
          action_summary = excluded.action_summary,
          action_detail = COALESCE(excluded.action_detail, email_automation_logs.action_detail),
          portal_url = COALESCE(excluded.portal_url, email_automation_logs.portal_url),
          reply_message_id = COALESCE(excluded.reply_message_id, email_automation_logs.reply_message_id),
          updated_at = excluded.updated_at
      `);

      for (const s of seeds) {
        stmt.run(
          s.thread_id,
          s.message_id,
          s.project_id,
          s.sender_email.toLowerCase(),
          s.sender_name,
          s.subject,
          s.received_at,
          s.category,
          s.status,
          s.action_type,
          s.action_summary,
          s.action_detail,
          s.portal_url,
          s.reply_message_id,
          s.last_inbound_msg_id,
          s.actioned_at,
          s.follow_up_after_ts,
          t
        );
      }
    } catch {
      /* ignore seed errors */
    }
  }

  checkEmailActionDedupe(opts: {
    thread_id?: string | null;
    message_id?: string | null;
    sender_email?: string | null;
    subject?: string | null;
    follow_up_days?: number;
  }) {
    const t = now();
    const msgId = String(opts.message_id || "").trim();
    const threadId = String(opts.thread_id || "").trim();
    const sender = String(opts.sender_email || "").trim().toLowerCase();
    const normSubj = this.normalizeEmailSubject(opts.subject || "");
    const followUpDays = Math.max(1, Number(opts.follow_up_days || 3));

    if (msgId) {
      const byMsg = this.db
        .prepare("SELECT * FROM email_automation_logs WHERE message_id = ? OR last_inbound_msg_id = ? ORDER BY actioned_at DESC LIMIT 1")
        .get(msgId, msgId) as any;
      if (byMsg) {
        const followUpAt = byMsg.follow_up_after_ts || byMsg.actioned_at + followUpDays * 86400;
        const canFollowUp =
          t >= followUpAt &&
          byMsg.action_type === "email_reply" &&
          byMsg.status !== "follow_up_sent" &&
          byMsg.status !== "ignored";
        return {
          already_logged: true,
          allowed_to_respond: canFollowUp,
          is_new_reply_in_thread: false,
          is_follow_up_due: canFollowUp,
          reason: canFollowUp ? `follow_up_window_reached_after_${followUpDays}_days` : "duplicate_message_id_already_actioned",
          cooldown_remaining_seconds: Math.max(0, followUpAt - t),
          next_follow_up_at: followUpAt,
          existing: byMsg,
        };
      }
    }

    let byThread: any;
    if (threadId) {
      byThread = this.db
        .prepare("SELECT * FROM email_automation_logs WHERE thread_id = ? ORDER BY actioned_at DESC LIMIT 1")
        .get(threadId);
    }
    if (!byThread && sender && normSubj) {
      const candidates = this.db
        .prepare("SELECT * FROM email_automation_logs WHERE LOWER(sender_email) = ? ORDER BY actioned_at DESC LIMIT 20")
        .all(sender) as any[];
      byThread = candidates.find((c) => this.normalizeEmailSubject(c.subject) === normSubj);
    }

    if (byThread) {
      const followUpAt = byThread.follow_up_after_ts || byThread.actioned_at + followUpDays * 86400;
      const isAutomatedSender = /(?:no-?reply|mailer-daemon|postmaster|notify\.railway\.app|notifications@github\.com)/i.test(sender);
      const isNewInboundReply =
        Boolean(msgId) &&
        byThread.action_type === "email_reply" &&
        !isAutomatedSender &&
        msgId !== byThread.message_id &&
        msgId !== byThread.last_inbound_msg_id &&
        sender !== "cookbenjamin1996@gmail.com";

      if (isNewInboundReply) {
        return {
          already_logged: true,
          allowed_to_respond: true,
          is_new_reply_in_thread: true,
          is_follow_up_due: false,
          reason: "new_inbound_reply_detected_in_thread",
          cooldown_remaining_seconds: 0,
          next_follow_up_at: followUpAt,
          existing: byThread,
        };
      }

      const canFollowUp =
        t >= followUpAt &&
        byThread.action_type === "email_reply" &&
        byThread.status !== "follow_up_sent" &&
        byThread.status !== "ignored";

      return {
        already_logged: true,
        allowed_to_respond: canFollowUp,
        is_new_reply_in_thread: false,
        is_follow_up_due: canFollowUp,
        reason: canFollowUp ? `follow_up_window_reached_after_${followUpDays}_days` : "thread_cooldown_active_no_new_reply",
        cooldown_remaining_seconds: Math.max(0, followUpAt - t),
        next_follow_up_at: followUpAt,
        existing: byThread,
      };
    }

    return {
      already_logged: false,
      allowed_to_respond: true,
      is_new_reply_in_thread: false,
      is_follow_up_due: false,
      reason: "new_unactioned_email",
      cooldown_remaining_seconds: 0,
      next_follow_up_at: null,
      existing: null,
    };
  }

  upsertEmailActionLog(input: Record<string, any>) {
    const t = now();
    const messageId = String(input.message_id || "").trim() || `<manual-${t}@sweepruk.com>`;
    const senderEmail = String(input.sender_email || "").trim().toLowerCase() || "unknown@sender";
    const subject = String(input.subject || "(No Subject)").trim().slice(0, 500);
    const threadId =
      String(input.thread_id || "").trim() ||
      `thr_${createHash("sha1").update(`${senderEmail}:${this.normalizeEmailSubject(subject)}`).digest("hex").slice(0, 16)}`;
    const projectId = String(input.project_id || "cleaner").trim().toLowerCase() || "cleaner";
    const senderName = input.sender_name ? String(input.sender_name).trim().slice(0, 200) : null;
    const receivedAt = input.received_at ? Number(input.received_at) : t;
    const category = String(input.category || "general").trim().toLowerCase() || "general";
    const status = String(input.status || "actioned").trim().toLowerCase() || "actioned";
    const actionType = String(input.action_type || "email_reply").trim().toLowerCase() || "email_reply";
    const actionSummary = String(input.action_summary || "Actioned email").trim().slice(0, 600);
    const actionDetail = input.action_detail ? String(input.action_detail).trim().slice(0, 4000) : null;
    const portalUrl = input.portal_url ? String(input.portal_url).trim().slice(0, 600) : null;
    const replyMessageId = input.reply_message_id ? String(input.reply_message_id).trim().slice(0, 300) : null;
    const lastInboundMsgId = input.last_inbound_msg_id ? String(input.last_inbound_msg_id).trim().slice(0, 300) : messageId;
    const actionedAt = input.actioned_at ? Number(input.actioned_at) : t;
    const followUpDays = Math.max(1, Number(input.follow_up_days || 3));
    const followUpAfterTs = input.follow_up_after_ts ? Number(input.follow_up_after_ts) : actionedAt + followUpDays * 86400;

    this.db
      .prepare(
        `INSERT INTO email_automation_logs (
          thread_id, message_id, project_id, sender_email, sender_name, subject,
          received_at, category, status, action_type, action_summary, action_detail,
          portal_url, reply_message_id, last_inbound_msg_id, actioned_at, follow_up_after_ts,
          action_count, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(message_id) DO UPDATE SET
          thread_id = excluded.thread_id,
          project_id = excluded.project_id,
          sender_email = excluded.sender_email,
          sender_name = COALESCE(excluded.sender_name, email_automation_logs.sender_name),
          subject = excluded.subject,
          category = excluded.category,
          status = excluded.status,
          action_type = excluded.action_type,
          action_summary = excluded.action_summary,
          action_detail = COALESCE(excluded.action_detail, email_automation_logs.action_detail),
          portal_url = COALESCE(excluded.portal_url, email_automation_logs.portal_url),
          reply_message_id = COALESCE(excluded.reply_message_id, email_automation_logs.reply_message_id),
          last_inbound_msg_id = COALESCE(excluded.last_inbound_msg_id, email_automation_logs.last_inbound_msg_id),
          actioned_at = excluded.actioned_at,
          follow_up_after_ts = excluded.follow_up_after_ts,
          action_count = email_automation_logs.action_count + 1,
          updated_at = excluded.updated_at`
      )
      .run(
        threadId,
        messageId,
        projectId,
        senderEmail,
        senderName,
        subject,
        receivedAt,
        category,
        status,
        actionType,
        actionSummary,
        actionDetail,
        portalUrl,
        replyMessageId,
        lastInboundMsgId,
        actionedAt,
        followUpAfterTs,
        t
      );

    return this.db.prepare("SELECT * FROM email_automation_logs WHERE message_id = ? LIMIT 1").get(messageId) as any;
  }

  listEmailActionLogs(opts: { action_type?: string; status?: string; search?: string; limit?: number } = {}) {
    const actionTypeFilter = String(opts.action_type || "all").trim().toLowerCase();
    const statusFilter = String(opts.status || "all").trim().toLowerCase();
    const search = String(opts.search || "").trim().toLowerCase();
    const limit = Math.min(Math.max(Number(opts.limit || 300), 1), 2000);

    const clauses: string[] = [];
    const params: any[] = [];
    if (actionTypeFilter && actionTypeFilter !== "all") {
      clauses.push("action_type = ?");
      params.push(actionTypeFilter);
    }
    if (statusFilter && statusFilter !== "all") {
      clauses.push("status = ?");
      params.push(statusFilter);
    }
    if (search) {
      clauses.push(
        "(LOWER(sender_email) LIKE ? OR LOWER(COALESCE(sender_name, '')) LIKE ? OR LOWER(subject) LIKE ? OR LOWER(action_summary) LIKE ? OR LOWER(COALESCE(action_detail, '')) LIKE ?)"
      );
      const q = `%${search}%`;
      params.push(q, q, q, q, q);
    }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM email_automation_logs ${whereSql} ORDER BY actioned_at DESC, id DESC LIMIT ?`)
      .all(...params, limit) as any[];

    const statsRow = this.db
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN action_type = 'email_reply' OR status IN ('replied', 'follow_up_sent') THEN 1 ELSE 0 END) as replied_count,
           SUM(CASE WHEN action_type IN ('portal_submission', 'appeal_filed') OR status IN ('portal_completed', 'appeal_filed', 'scheduled') THEN 1 ELSE 0 END) as portal_count,
           SUM(CASE WHEN action_type IN ('code_fix', 'config_update') OR status = 'code_fixed' THEN 1 ELSE 0 END) as code_fix_count,
           SUM(CASE WHEN status IN ('skipped_duplicate', 'ignored') OR category = 'ignored_bounce' THEN 1 ELSE 0 END) as deduped_count
         FROM email_automation_logs`
      )
      .get() as any;

    const t = now();
    const enriched = rows.map((r) => ({
      ...r,
      cooldown_active: t < r.follow_up_after_ts,
      cooldown_remaining_hours: Math.max(0, Math.round(((r.follow_up_after_ts - t) / 3600) * 10) / 10),
    }));

    const counts = {
      total: Number(statsRow?.total || 0),
      replied_count: Number(statsRow?.replied_count || 0),
      portal_count: Number(statsRow?.portal_count || 0),
      code_fix_count: Number(statsRow?.code_fix_count || 0),
      deduped_count: Number(statsRow?.deduped_count || 0),
    };

    return {
      total: counts.total,
      filtered_count: enriched.length,
      counts,
      rows: enriched,
      items: enriched,
    };
  }

  deleteEmailActionLog(id: number): boolean {
    const res = this.db.prepare("DELETE FROM email_automation_logs WHERE id = ?").run(id);
    return Number(res.changes || 0) > 0;
  }
}

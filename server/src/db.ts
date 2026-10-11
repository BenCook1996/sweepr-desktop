import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

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
  health_score: number;
  lifecycle_stage: string;
  total_spend_cents: number;
  created_at: number;
  updated_at: number | null;
}

export interface Entitlement {
  account_id: string;
  stripe_subscription_id: string | null;
  status: EntStatus;
  plan: string | null;
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
  first_seen: number;
  last_seen: number;
  revoked: number;
}

export interface CrmCustomerSummary {
  id: string;
  email: string | null;
  name: string | null;
  stripe_customer_id: string | null;
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
  `);

  // Ensure extended CRM columns on accounts table
  ensureColumn(db, "accounts", "email", "TEXT");
  ensureColumn(db, "accounts", "name", "TEXT");
  ensureColumn(db, "accounts", "notes", "TEXT");
  ensureColumn(db, "accounts", "health_score", "INTEGER DEFAULT 100");
  ensureColumn(db, "accounts", "lifecycle_stage", "TEXT DEFAULT 'lead'");
  ensureColumn(db, "accounts", "total_spend_cents", "INTEGER DEFAULT 0");
  ensureColumn(db, "accounts", "updated_at", "INTEGER");
  ensureColumn(db, "devices", "type", "TEXT DEFAULT 'pc'");

  return new Repo(db);
}

const now = () => Math.floor(Date.now() / 1000);

export class Repo {
  constructor(readonly db: DatabaseSync) {}

  setOtp(email: string, code: string, expires_at: number) {
    this.db.prepare(`
      INSERT INTO otps (email, code, expires_at) 
      VALUES (?, ?, ?) 
      ON CONFLICT(email) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at
    `).run(email, code, expires_at);
  }

  verifyOtp(email: string, code: string, now: number): boolean {
    const otp = this.db.prepare(`SELECT * FROM otps WHERE email = ?`).get(email) as any;
    if (!otp) return false;
    if (otp.expires_at < now) return false;
    if (otp.code !== code) return false;
    this.db.prepare(`DELETE FROM otps WHERE email = ?`).run(email);
    return true;
  }


  createAccount(id: string, refreshTokenHash: string, email?: string) {
    const t = now();
    this.db.prepare(`
      INSERT INTO accounts (id, refresh_token_hash, email, health_score, lifecycle_stage, total_spend_cents, created_at, updated_at)
      VALUES (?, ?, ?, 100, 'lead', 0, ?, ?)
    `).run(id, refreshTokenHash, email ?? null, t, t);

    this.addActivity({
      account_id: id,
      type: "account_created",
      title: "Account Created",
      description: email ? `Account created for ${email}` : `New device-bound account initialized`,
      actor: "system",
    });
  }

  accountByTokenHash(hash: string): Account | undefined {
    return this.db.prepare("SELECT * FROM accounts WHERE refresh_token_hash = ?").get(hash) as Account | undefined;
  }

  accountById(id: string): Account | undefined {
    return this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Account | undefined;
  }

  accountByCustomer(customerId: string): Account | undefined {
    return this.db.prepare("SELECT * FROM accounts WHERE stripe_customer_id = ?").get(customerId) as Account | undefined;
  }

  accountByEmail(email: string): Account | undefined {
    return this.db.prepare("SELECT * FROM accounts WHERE email = ? COLLATE NOCASE").get(email) as Account | undefined;
  }

  setCustomer(accountId: string, customerId: string, email?: string) {
    const t = now();
    if (email) {
      this.db.prepare("UPDATE accounts SET stripe_customer_id = ?, email = COALESCE(email, ?), updated_at = ? WHERE id = ?")
        .run(customerId, email, t, accountId);
    } else {
      this.db.prepare("UPDATE accounts SET stripe_customer_id = ?, updated_at = ? WHERE id = ?")
        .run(customerId, t, accountId);
    }
  }

  updateAccountProfile(accountId: string, updates: { name?: string; email?: string; notes?: string; health_score?: number; lifecycle_stage?: string }) {
    const t = now();
    const existing = this.accountById(accountId);
    if (!existing) return;
    const name = updates.name !== undefined ? updates.name : existing.name;
    const email = updates.email !== undefined ? updates.email : existing.email;
    const notes = updates.notes !== undefined ? updates.notes : existing.notes;
    const health_score = updates.health_score !== undefined ? updates.health_score : existing.health_score;
    const lifecycle_stage = updates.lifecycle_stage !== undefined ? updates.lifecycle_stage : existing.lifecycle_stage;

    this.db.prepare(`
      UPDATE accounts
      SET name = ?, email = ?, notes = ?, health_score = ?, lifecycle_stage = ?, updated_at = ?
      WHERE id = ?
    `).run(name, email, notes, health_score, lifecycle_stage, t, accountId);

    this.addActivity({
      account_id: accountId,
      type: "profile_updated",
      title: "Customer Profile Updated",
      description: `Updated customer information`,
      actor: "admin",
    });
  }

  /** Registers the device if there's room. Returns false if the device limit is reached or the device is revoked. */
  touchDevice(accountId: string, deviceId: string, deviceType: "pc" | "mobile", maxPc: number, maxMobile: number): boolean {
    const existing = this.db.prepare("SELECT revoked, type FROM devices WHERE id = ? AND account_id = ?").get(deviceId, accountId) as { revoked: number, type: string } | undefined;
    if (existing) {
      if (existing.revoked) return false;
      this.db.prepare("UPDATE devices SET last_seen = ?, type = ? WHERE id = ? AND account_id = ?").run(now(), deviceType, deviceId, accountId);
      return true;
    }
    const { n } = this.db.prepare("SELECT COUNT(*) AS n FROM devices WHERE account_id = ? AND revoked = 0 AND type = ?").get(accountId, deviceType) as { n: number };
    const limit = deviceType === "mobile" ? maxMobile : maxPc;
    if (n >= limit) return false;
    this.db.prepare("INSERT INTO devices (id, account_id, type, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)").run(deviceId, accountId, deviceType, now(), now());

    this.addActivity({
      account_id: accountId,
      type: "device_connected",
      title: "Device Connected",
      description: `Hardware device ${deviceId.slice(0, 8)}... (${deviceType.toUpperCase()}) connected`,
      actor: "system",
      metadata: { device_id: deviceId, device_type: deviceType },
    });
    return true;
  }

  revokeDevice(accountId: string, deviceId: string) {
    this.db.prepare("UPDATE devices SET revoked = 1 WHERE id = ? AND account_id = ?").run(deviceId, accountId);
    this.addActivity({
      account_id: accountId,
      type: "device_revoked",
      title: "Device Revoked",
      description: `Hardware device ${deviceId.slice(0, 8)}... access was revoked by admin`,
      actor: "admin",
      metadata: { device_id: deviceId },
    });
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

  upsertEntitlement(e: Omit<Entitlement, "updated_at">) {
    const t = now();
    this.db.prepare(`
      INSERT INTO entitlements (account_id, stripe_subscription_id, status, plan, current_period_end, cancel_at_period_end, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        stripe_subscription_id = excluded.stripe_subscription_id,
        status = excluded.status,
        plan = excluded.plan,
        current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        updated_at = excluded.updated_at
    `).run(e.account_id, e.stripe_subscription_id, e.status, e.plan, e.current_period_end, e.cancel_at_period_end, t);

    // Also mirror to subscriptions table for CRM subscription history
    const subId = e.stripe_subscription_id || `sub_${e.account_id}`;
    const amount = e.plan === "annual" ? 9900 : 999;
    this.upsertSubscription({
      id: subId,
      account_id: e.account_id,
      stripe_subscription_id: e.stripe_subscription_id,
      status: e.status,
      plan: e.plan || "monthly",
      amount_cents: amount,
      currency: "usd",
      billing_interval: e.plan === "annual" ? "year" : "month",
      current_period_start: t,
      current_period_end: e.current_period_end,
      cancel_at_period_end: e.cancel_at_period_end,
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
      conditions.push("COALESCE(e.status, 'none') = ?");
      params.push(options.status);
    }
    if (options.stage && options.stage !== "all") {
      conditions.push("a.lifecycle_stage = ?");
      params.push(options.stage);
    }
    if (options.search) {
      conditions.push("(a.id LIKE ? OR a.email LIKE ? OR a.name LIKE ? OR a.stripe_customer_id LIKE ?)");
      const term = `%${options.search}%`;
      params.push(term, term, term, term);
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
      active_subs: number | null;
      trialing_subs: number | null;
      past_due_subs: number | null;
      canceled_subs: number | null;
      avg_health: number | null;
      at_risk: number | null;
    };

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

    return {
      totalCustomers: Number(counts.total_customers || 0),
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
    };
  }

  /** Returns true if this is the first time we've seen the event (idempotency). */
  markEventProcessed(eventId: string): boolean {
    const r = this.db.prepare("INSERT OR IGNORE INTO processed_events (id, processed_at) VALUES (?, ?)").run(eventId, now());
    return Number(r.changes) > 0;
  }

  unmarkEvent(eventId: string) {
    this.db.prepare("DELETE FROM processed_events WHERE id = ?").run(eventId);
  }
}

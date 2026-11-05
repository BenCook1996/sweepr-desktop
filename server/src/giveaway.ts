import type { Repo, Account } from "./db.js";
import { randomToken, sha256 } from "./tokens.js";
import { escapeHtml } from "./security.js";
import { dispatchTransactionalCustomerEmail } from "./download-recovery.js";

export interface GiveawayConfig {
  campaign_id: string;
  partner_name: string;
  partner_url: string;
  master_key_6digit: string;
  promo_code: string;
  upgrade_coupon: string;
  upgrade_discount_pct: number;
  license_duration_days: number;
  max_devices_pc: number;
  max_devices_mobile: number;
  /** Unix timestamp (seconds) when the 24h giveaway window opens */
  window_start_ts: number;
  /** Unix timestamp (seconds) when the 24h giveaway window closes */
  window_end_ts: number;
  /** Allows GOTD review/QA team to test activation before the scheduled 24h date */
  allow_preview_redemption: boolean;
  updated_at: number;
}

export interface GiveawayRedemptionResult {
  ok: boolean;
  error?: string;
  message?: string;
  account_id?: string;
  email?: string;
  plan?: string;
  expires_at?: number;
  max_devices_pc?: number;
  activation_key?: string;
  upgrade_url?: string;
}

const GIVEAWAY_CONFIG_KEY = "giveaway_gotd_config_v1";
export const DEFAULT_GOTD_KEY_6DIGIT = "662026";
export const DEFAULT_GOTD_PROMO_CODE = "GOTD-2026-SWEEPR";
export const DEFAULT_GOTD_UPGRADE_COUPON = "GOTD50";

export function ensureGiveawayTables(repo: Repo): void {
  repo.db.exec(`
    CREATE TABLE IF NOT EXISTS giveaway_config (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS giveaway_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      email TEXT NOT NULL,
      code_used TEXT NOT NULL,
      device_id TEXT,
      ip_hash TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      upgraded_at INTEGER,
      nurture_3d_sent_at INTEGER,
      expiry_14d_sent_at INTEGER,
      expiry_3d_sent_at INTEGER,
      UNIQUE(campaign_id, email)
    );
  `);
  const migrations = [
    "ALTER TABLE giveaway_redemptions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    "ALTER TABLE giveaway_redemptions ADD COLUMN upgraded_at INTEGER",
    "ALTER TABLE giveaway_redemptions ADD COLUMN nurture_3d_sent_at INTEGER",
    "ALTER TABLE giveaway_redemptions ADD COLUMN expiry_14d_sent_at INTEGER",
    "ALTER TABLE giveaway_redemptions ADD COLUMN expiry_3d_sent_at INTEGER",
  ];
  for (const sql of migrations) {
    try {
      repo.db.exec(sql);
    } catch {
      // Column already exists
    }
  }
}

export function getGiveawayConfig(repo: Repo, nowSec = Math.floor(Date.now() / 1000)): GiveawayConfig {
  ensureGiveawayTables(repo);
  const row = repo.db
    .prepare("SELECT value_json FROM giveaway_config WHERE key = ?")
    .get(GIVEAWAY_CONFIG_KEY) as { value_json: string } | undefined;

  const defaults: GiveawayConfig = {
    campaign_id: "gotd-2026-11",
    partner_name: "Giveaway of the Day",
    partner_url: "https://www.giveawayoftheday.com/",
    master_key_6digit: DEFAULT_GOTD_KEY_6DIGIT,
    promo_code: DEFAULT_GOTD_PROMO_CODE,
    upgrade_coupon: DEFAULT_GOTD_UPGRADE_COUPON,
    upgrade_discount_pct: 50,
    license_duration_days: 180,
    max_devices_pc: 1,
    max_devices_mobile: 0,
    // Default window covers current QA/review period + 24h slot configurable via CRM
    window_start_ts: nowSec - 3600,
    window_end_ts: nowSec + 30 * 86400,
    allow_preview_redemption: true,
    updated_at: nowSec,
  };

  if (!row?.value_json) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(row.value_json);
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function updateGiveawayConfig(
  repo: Repo,
  patch: Partial<GiveawayConfig>,
  nowSec = Math.floor(Date.now() / 1000)
): GiveawayConfig {
  ensureGiveawayTables(repo);
  const current = getGiveawayConfig(repo, nowSec);
  const next: GiveawayConfig = {
    ...current,
    ...patch,
    updated_at: nowSec,
  };
  repo.db
    .prepare(
      `INSERT INTO giveaway_config (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .run(GIVEAWAY_CONFIG_KEY, JSON.stringify(next), nowSec);
  return next;
}

export function isGiveawayWindowOpen(cfg: GiveawayConfig, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (cfg.allow_preview_redemption) return true;
  return nowSec >= cfg.window_start_ts && nowSec <= cfg.window_end_ts;
}

export function isGiveawayCodeMatch(cfg: GiveawayConfig, rawCode: string): boolean {
  const cleaned = String(rawCode || "").trim().toUpperCase();
  if (!cleaned) return false;
  return (
    cleaned === cfg.master_key_6digit.toUpperCase() ||
    cleaned === cfg.promo_code.toUpperCase() ||
    cleaned === DEFAULT_GOTD_KEY_6DIGIT ||
    cleaned === DEFAULT_GOTD_PROMO_CODE
  );
}

/**
 * Provisions or refreshes a 6-Month, 1-PC Giveaway Pro entitlement for the given email.
 * Does NOT send outbound SMTP emails so thousands of concurrent GOTD users never hit SMTP rate limits.
 */
export function redeemGiveawayLicense(
  repo: Repo,
  opts: {
    email: string;
    code: string;
    deviceId?: string;
    ipHash?: string;
    nowSec?: number;
  }
): GiveawayRedemptionResult {
  ensureGiveawayTables(repo);
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const cfg = getGiveawayConfig(repo, nowSec);

  const email = String(opts.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false, error: "invalid_email", message: "Please enter a valid email address." };
  }

  if (!isGiveawayCodeMatch(cfg, opts.code)) {
    return { ok: false, error: "invalid_giveaway_key", message: "Invalid Giveaway activation key." };
  }

  if (!isGiveawayWindowOpen(cfg, nowSec)) {
    return {
      ok: false,
      error: "giveaway_window_closed",
      message:
        "This 24-hour Giveaway of the Day registration window has closed. You can still claim 50% off the 5-Device Annual Pro Plan below.",
      upgrade_url: `/order?plan=annual&coupon=${encodeURIComponent(cfg.upgrade_coupon)}`,
    };
  }

  let account: Account | undefined = repo.accountByEmail(email);
  if (!account) {
    const newId = `acc_gotd_${randomToken(10)}`;
    repo.createAccount(newId, sha256(randomToken(32)), email, null, {
      country: "GB",
      lead_device: "windows",
    });
    account = repo.accountById(newId);
  }
  if (!account) {
    return { ok: false, error: "account_error", message: "Could not initialize account." };
  }

  // Never downgrade an existing paid multi-device subscriber
  const existingEnt = repo.entitlement(account.id);
  const isPaidActive =
    existingEnt &&
    (existingEnt.status === "active" || existingEnt.status === "trialing") &&
    existingEnt.plan !== "giveaway_6m" &&
    (existingEnt.current_period_end ?? 0) > nowSec;

  const expiresAt =
    isPaidActive && existingEnt?.current_period_end
      ? existingEnt.current_period_end
      : nowSec + cfg.license_duration_days * 86400;

  const effectivePlan = isPaidActive && existingEnt?.plan ? existingEnt.plan : "giveaway_6m";

  if (!isPaidActive) {
    repo.upsertEntitlement({
      account_id: account.id,
      status: "active",
      plan: "giveaway_6m",
      current_period_end: expiresAt,
      cancel_at_period_end: 1,
      stripe_subscription_id: `sub_gotd_${cfg.campaign_id}_${account.id}`,
    });
  }

  // Set 6-digit OTP in local store so the user can also immediately use 662026 in `/v1/account/verify-otp` or `/api/verify-otp`
  repo.setOtp(`activation:${email}`, sha256(cfg.master_key_6digit), nowSec + 7 * 86400);

  repo.db
    .prepare(
      `INSERT INTO giveaway_redemptions (campaign_id, account_id, email, code_used, device_id, ip_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(campaign_id, email) DO UPDATE SET
         code_used = excluded.code_used,
         device_id = COALESCE(excluded.device_id, giveaway_redemptions.device_id),
         expires_at = excluded.expires_at`
    )
    .run(
      cfg.campaign_id,
      account.id,
      email,
      String(opts.code).trim().toUpperCase(),
      opts.deviceId ?? null,
      opts.ipHash ?? null,
      expiresAt,
      nowSec
    );

  repo.addAnalyticsEvent({
    event_name: "giveaway_license_redeemed",
    platform: "windows",
    account_id: account.id,
    metadata: {
      campaign_id: cfg.campaign_id,
      partner: cfg.partner_name,
      plan: effectivePlan,
      expires_at: expiresAt,
    },
  });

  repo.addActivity({
    account_id: account.id,
    type: "giveaway_activated",
    title: "Giveaway of the Day 6-Month License Activated",
    description: `Activated 6-month (1-PC) Pro license via ${cfg.partner_name} (${cfg.campaign_id})`,
    actor: "customer",
    metadata: { campaign_id: cfg.campaign_id, expires_at: expiresAt },
  });

  return {
    ok: true,
    account_id: account.id,
    email,
    plan: effectivePlan,
    expires_at: expiresAt,
    max_devices_pc: isPaidActive ? 5 : cfg.max_devices_pc,
    activation_key: cfg.master_key_6digit,
    upgrade_url: `/order?plan=annual&coupon=${encodeURIComponent(cfg.upgrade_coupon)}&email=${encodeURIComponent(email)}`,
    message:
      "Your 6-Month SWEEPR Cleaner Pro License (1 Windows PC) is now active! Open SWEEPR Cleaner -> Account & Settings -> enter your email and 6-digit key 662026 to unlock Pro immediately.",
  };
}

export function getGiveawayStats(repo: Repo, nowSec = Math.floor(Date.now() / 1000)) {
  ensureGiveawayTables(repo);
  const cfg = getGiveawayConfig(repo, nowSec);
  const totalRow = repo.db
    .prepare("SELECT COUNT(*) as count FROM giveaway_redemptions WHERE campaign_id = ?")
    .get(cfg.campaign_id) as { count: number };
  const upgradedRow = repo.db
    .prepare("SELECT COUNT(*) as count FROM giveaway_redemptions WHERE campaign_id = ? AND status = 'upgraded'")
    .get(cfg.campaign_id) as { count: number };
  const nurture3dRow = repo.db
    .prepare("SELECT COUNT(*) as count FROM giveaway_redemptions WHERE campaign_id = ? AND nurture_3d_sent_at IS NOT NULL")
    .get(cfg.campaign_id) as { count: number };
  const expiry14dRow = repo.db
    .prepare("SELECT COUNT(*) as count FROM giveaway_redemptions WHERE campaign_id = ? AND expiry_14d_sent_at IS NOT NULL")
    .get(cfg.campaign_id) as { count: number };
  const expiry3dRow = repo.db
    .prepare("SELECT COUNT(*) as count FROM giveaway_redemptions WHERE campaign_id = ? AND expiry_3d_sent_at IS NOT NULL")
    .get(cfg.campaign_id) as { count: number };
  const recent = repo.db
    .prepare(
      "SELECT id, campaign_id, account_id, email, code_used, device_id, expires_at, created_at, status, upgraded_at, nurture_3d_sent_at, expiry_14d_sent_at, expiry_3d_sent_at FROM giveaway_redemptions ORDER BY created_at DESC LIMIT 50"
    )
    .all();

  return {
    config: cfg,
    window_open: isGiveawayWindowOpen(cfg, nowSec),
    total_redemptions: Number(totalRow?.count || 0),
    upgraded_count: Number(upgradedRow?.count || 0),
    nurture_3d_sent_count: Number(nurture3dRow?.count || 0),
    expiry_14d_sent_count: Number(expiry14dRow?.count || 0),
    expiry_3d_sent_count: Number(expiry3dRow?.count || 0),
    recent_redemptions: recent,
  };
}

export interface GiveawayLifecycleSweepResult {
  evaluated: number;
  reconciled_upgraded: number;
  nurture_3d_sent: number;
  expiry_14d_sent: number;
  expiry_3d_sent: number;
  expired_marked: number;
}

/**
 * A10 Giveaway-to-Pro (GOTD50) Lifecycle Sweep:
 * - Reconciles users who already upgraded to a paid multi-device plan
 * - Sends T+3d multi-PC/mobile value upsell (50% off with GOTD50)
 * - Sends T-14d and T-3d license expiry warnings with 1-click GOTD50 upgrade link
 */
export async function runGiveawayUpgradeSweep(
  repo: Repo,
  opts?: { nowSec?: number; limit?: number }
): Promise<GiveawayLifecycleSweepResult> {
  ensureGiveawayTables(repo);
  const nowSec = opts?.nowSec ?? Math.floor(Date.now() / 1000);
  const limit = Math.max(1, Math.min(250, opts?.limit ?? 100));
  const cfg = getGiveawayConfig(repo, nowSec);

  const rows = repo.db
    .prepare(
      `SELECT id, campaign_id, account_id, email, expires_at, created_at, status,
              nurture_3d_sent_at, expiry_14d_sent_at, expiry_3d_sent_at
       FROM giveaway_redemptions
       WHERE status = 'active'
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .all(limit) as Array<{
    id: number;
    campaign_id: string;
    account_id: string;
    email: string;
    expires_at: number;
    created_at: number;
    status: string;
    nurture_3d_sent_at: number | null;
    expiry_14d_sent_at: number | null;
    expiry_3d_sent_at: number | null;
  }>;

  let reconciled_upgraded = 0;
  let nurture_3d_sent = 0;
  let expiry_14d_sent = 0;
  let expiry_3d_sent = 0;
  let expired_marked = 0;

  for (const r of rows) {
    const ent = repo.entitlement(r.account_id);
    if (
      ent &&
      (ent.status === "active" || ent.status === "trialing") &&
      ent.plan &&
      ent.plan !== "giveaway_6m"
    ) {
      repo.db
        .prepare("UPDATE giveaway_redemptions SET status = 'upgraded', upgraded_at = COALESCE(upgraded_at, ?) WHERE id = ?")
        .run(nowSec, r.id);
      reconciled_upgraded += 1;
      continue;
    }

    if (r.expires_at <= nowSec) {
      repo.db
        .prepare("UPDATE giveaway_redemptions SET status = 'expired' WHERE id = ?")
        .run(r.id);
      expired_marked += 1;
      continue;
    }

    const upgradeUrl = `https://sweeprcleaner.com/order?plan=annual&coupon=${encodeURIComponent(cfg.upgrade_coupon)}&email=${encodeURIComponent(r.email)}&utm_source=giveaway_lifecycle&utm_campaign=${encodeURIComponent(r.campaign_id)}`;
    const daysRemaining = Math.max(1, Math.ceil((r.expires_at - nowSec) / 86400));

    // 1. T-3d Final Expiry Reminder (<= 3 days remaining)
    if (!r.expiry_3d_sent_at && r.expires_at - nowSec <= 3 * 86400) {
      const dispatch = await dispatchTransactionalCustomerEmail({
        to: r.email,
        subject: `Final Reminder: Your 6-Month SWEEPR Cleaner Pro license expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} (50% Off Renewal)`,
        textBody: [
          "Hi there,",
          "",
          `Your 6-Month Giveaway of the Day SWEEPR Cleaner Pro license expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}.`,
          "",
          `Keep automatic background cleanups active and expand coverage to 5 Devices (Windows, Mac, Android & iOS) for 50% off with your partner code ${cfg.upgrade_coupon}:`,
          `Upgrade for 50% Off: ${upgradeUrl}`,
          "",
          "— The SWEEPR Team",
        ].join("\n"),
        htmlBody: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f1f17;">
          <h2 style="margin:0 0 12px;">Your 6-Month Pro License Expires in ${daysRemaining} Day${daysRemaining === 1 ? "" : "s"}</h2>
          <p>Keep automatic background storage cleanup active and protect up to <strong>5 Devices (Windows, Mac, Android &amp; iOS)</strong> for a full year at <strong>${cfg.upgrade_discount_pct}% OFF</strong> with code <code>${escapeHtml(cfg.upgrade_coupon)}</code>.</p>
          <p style="margin:20px 0;"><a href="${escapeHtml(upgradeUrl)}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;">Renew &amp; Unlock 5 Devices (${cfg.upgrade_discount_pct}% Off) &rarr;</a></p>
        </div>`,
      });
      if (dispatch.ok) {
        repo.db
          .prepare("UPDATE giveaway_redemptions SET expiry_3d_sent_at = ? WHERE id = ?")
          .run(nowSec, r.id);
        repo.addActivity({
          account_id: r.account_id,
          type: "giveaway_expiry_3d_sent",
          title: "Giveaway T-3d Expiry Reminder Sent",
          description: `Sent 3-day expiry reminder with ${cfg.upgrade_coupon} link to ${r.email}`,
          actor: "automation",
          metadata: { campaign_id: r.campaign_id, coupon: cfg.upgrade_coupon, provider: dispatch.provider },
        });
        expiry_3d_sent += 1;
      }
      continue;
    }

    // 2. T-14d Expiry Warning (<= 14 days remaining)
    if (!r.expiry_14d_sent_at && r.expires_at - nowSec <= 14 * 86400) {
      const dispatch = await dispatchTransactionalCustomerEmail({
        to: r.email,
        subject: `Your 6-Month SWEEPR Cleaner Pro license expires in ${daysRemaining} days — claim 50% off Annual Pro`,
        textBody: [
          "Hi there,",
          "",
          `Your 6-Month Giveaway of the Day SWEEPR Cleaner Pro license expires in ${daysRemaining} days.`,
          "",
          `As a Giveaway community member, you can lock in 50% off our 5-Device Annual Pro Plan (Windows, Mac, Android & iOS) using code ${cfg.upgrade_coupon}:`,
          `Claim 50% Off: ${upgradeUrl}`,
          "",
          "— The SWEEPR Team",
        ].join("\n"),
        htmlBody: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f1f17;">
          <h2 style="margin:0 0 12px;">Your 6-Month License Expires in ${daysRemaining} Days</h2>
          <p>Lock in <strong>${cfg.upgrade_discount_pct}% OFF</strong> the <strong>5-Device Annual Pro Plan</strong> across Windows, Mac, Android &amp; iOS using your partner code <code>${escapeHtml(cfg.upgrade_coupon)}</code>.</p>
          <p style="margin:20px 0;"><a href="${escapeHtml(upgradeUrl)}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;">Claim ${cfg.upgrade_discount_pct}% Off 5-Device Pro &rarr;</a></p>
        </div>`,
      });
      if (dispatch.ok) {
        repo.db
          .prepare("UPDATE giveaway_redemptions SET expiry_14d_sent_at = ? WHERE id = ?")
          .run(nowSec, r.id);
        repo.addActivity({
          account_id: r.account_id,
          type: "giveaway_expiry_14d_sent",
          title: "Giveaway T-14d Expiry Warning Sent",
          description: `Sent 14-day expiry notice with ${cfg.upgrade_coupon} link to ${r.email}`,
          actor: "automation",
          metadata: { campaign_id: r.campaign_id, coupon: cfg.upgrade_coupon, provider: dispatch.provider },
        });
        expiry_14d_sent += 1;
      }
      continue;
    }

    // 3. T+3d Multi-PC / Mobile Value Upsell (>= 3 days after activation)
    if (!r.nurture_3d_sent_at && nowSec - r.created_at >= 3 * 86400) {
      const dispatch = await dispatchTransactionalCustomerEmail({
        to: r.email,
        subject: "How is SWEEPR Cleaner Pro running? Unlock 5 Devices for 50% off (GOTD50)",
        textBody: [
          "Hi there,",
          "",
          "Thank you for activating your 6-Month SWEEPR Cleaner Pro license (1 Windows PC)!",
          "",
          `Want to protect your laptop, second PC, Mac, or phone too? Use partner code ${cfg.upgrade_coupon} to upgrade to the 5-Device Annual Pro Plan for 50% off:`,
          `Upgrade 5 Devices (50% Off): ${upgradeUrl}`,
          "",
          "— The SWEEPR Team",
        ].join("\n"),
        htmlBody: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f1f17;">
          <h2 style="margin:0 0 12px;">Protect Up to 5 Devices Across Windows, Mac, Android &amp; iOS</h2>
          <p>Your Giveaway license covers <strong>1 Windows PC for 6 months</strong>. Need to clean a laptop, second desktop, or mobile device? Upgrade to the <strong>5-Device Annual Pro Plan</strong> for <strong>${cfg.upgrade_discount_pct}% OFF</strong> with code <code>${escapeHtml(cfg.upgrade_coupon)}</code>.</p>
          <p style="margin:20px 0;"><a href="${escapeHtml(upgradeUrl)}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;">Unlock 5-Device Pro (${cfg.upgrade_discount_pct}% Off) &rarr;</a></p>
        </div>`,
      });
      if (dispatch.ok) {
        repo.db
          .prepare("UPDATE giveaway_redemptions SET nurture_3d_sent_at = ? WHERE id = ?")
          .run(nowSec, r.id);
        repo.addActivity({
          account_id: r.account_id,
          type: "giveaway_nurture_3d_sent",
          title: "Giveaway T+3d Multi-Device Upsell Sent",
          description: `Sent 3-day multi-device upgrade offer (${cfg.upgrade_coupon}) to ${r.email}`,
          actor: "automation",
          metadata: { campaign_id: r.campaign_id, coupon: cfg.upgrade_coupon, provider: dispatch.provider },
        });
        nurture_3d_sent += 1;
      }
    }
  }

  return {
    evaluated: rows.length,
    reconciled_upgraded,
    nurture_3d_sent,
    expiry_14d_sent,
    expiry_3d_sent,
    expired_marked,
  };
}

/**
 * Triggered when a `giveaway_6m` user hits the 1-PC device limit on a 2nd PC.
 * Sends an idempotent 1-time upgrade email with the 50% off GOTD50 link.
 */
export async function triggerGiveawayDeviceLimitUpgradeEmail(
  repo: Repo,
  accountId: string,
  email: string | null | undefined,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<{ triggered: boolean; upgrade_url: string }> {
  const cfg = getGiveawayConfig(repo, nowSec);
  const safeEmail = String(email || "").trim().toLowerCase();
  const upgradeUrl = `/order?plan=annual&coupon=${encodeURIComponent(cfg.upgrade_coupon)}${safeEmail ? `&email=${encodeURIComponent(safeEmail)}` : ""}&utm_source=app_device_limit`;

  if (!safeEmail || !safeEmail.includes("@")) {
    return { triggered: false, upgrade_url: upgradeUrl };
  }

  const alreadySent = repo.db
    .prepare(
      "SELECT id FROM activities WHERE account_id = ? AND type = 'giveaway_device_limit_upsell_sent' LIMIT 1"
    )
    .get(accountId) as { id: string } | undefined;

  if (alreadySent) {
    return { triggered: false, upgrade_url: upgradeUrl };
  }

  const fullUpgradeUrl = `https://sweeprcleaner.com${upgradeUrl}`;
  const dispatch = await dispatchTransactionalCustomerEmail({
    to: safeEmail,
    subject: "Add your 2nd PC to SWEEPR Cleaner Pro — 50% Off 5-Device Upgrade (GOTD50)",
    textBody: [
      "Hi there,",
      "",
      "We noticed you tried activating SWEEPR Cleaner Pro on an additional PC.",
      "Your Giveaway of the Day edition covers 1 Windows PC. You can upgrade to our 5-Device Annual Pro Plan for 50% off with code GOTD50:",
      `Unlock 5 Devices (50% Off): ${fullUpgradeUrl}`,
      "",
      "— The SWEEPR Team",
    ].join("\n"),
    htmlBody: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f1f17;">
      <h2 style="margin:0 0 12px;">Need SWEEPR Cleaner Pro on a 2nd PC?</h2>
      <p>Your Giveaway license covers <strong>1 Windows PC</strong>. Upgrade to the <strong>5-Device Annual Pro Plan</strong> right now for <strong>${cfg.upgrade_discount_pct}% OFF</strong> using code <code>${escapeHtml(cfg.upgrade_coupon)}</code>.</p>
      <p style="margin:20px 0;"><a href="${escapeHtml(fullUpgradeUrl)}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;">Upgrade to 5 Devices (${cfg.upgrade_discount_pct}% Off) &rarr;</a></p>
    </div>`,
  });

  if (dispatch.ok) {
    repo.addActivity({
      account_id: accountId,
      type: "giveaway_device_limit_upsell_sent",
      title: "Giveaway 2nd-PC Device Limit Upgrade Email Sent",
      description: `Sent 50% off 5-device upgrade email (${cfg.upgrade_coupon}) after 1-PC limit reached`,
      actor: "automation",
      metadata: { coupon: cfg.upgrade_coupon, provider: dispatch.provider },
    });
  }

  return { triggered: dispatch.ok, upgrade_url: upgradeUrl };
}

export function buildGiveawayReadmeTxt(cfg: GiveawayConfig): string {
  return [
    "======================================================================",
    "SWEEPR Cleaner Pro (6-Month Giveaway of the Day Special Edition)",
    "Publisher: SWEEPR (https://sweeprcleaner.com)",
    "======================================================================",
    "",
    "Thank you for downloading SWEEPR Cleaner from Giveaway of the Day!",
    "",
    "INSTALLATION & ACTIVATION INSTRUCTIONS (24-HOUR GIVEAWAY WINDOW):",
    "----------------------------------------------------------------------",
    "1. Run SWEEPRCleaner.exe to install and launch SWEEPR Cleaner.",
    "   (Signed with SSL.com Authenticode — SHA-256: 38E5CDF33C813709C0B4124334CD10EA797C70AAED0C598F4CCB5A5F477544AA)",
    "",
    "2. Activate your 6-Month Pro License (choose Option A or Option B):",
    "",
    "   OPTION A — Activate Directly Inside the Desktop App (Fastest):",
    "   - Open SWEEPR Cleaner and click the 'Account / Settings' tab.",
    "   - Enter your email address and click 'Send Code'.",
    `   - Enter the 6-digit Giveaway Activation Key: ${cfg.master_key_6digit}`,
    "   - Click 'Activate' — your PC is immediately unlocked for 6 months!",
    "",
    "   OPTION B — Activate on the Official Giveaway Web Page:",
    "   - Visit: https://sweeprcleaner.com/giveaway",
    `   - Enter your email address and Giveaway Key: ${cfg.master_key_6digit} (or ${cfg.promo_code})`,
    "",
    "----------------------------------------------------------------------",
    "EXCLUSIVE 50% OFF UPGRADE FOR GIVEAWAY OF THE DAY USERS:",
    "----------------------------------------------------------------------",
    "Want to protect up to 5 Devices across Windows, macOS, Android & iOS",
    "with a full 12-Month Pro License, free major updates & 24/7 support?",
    "",
    `Claim 50% OFF here: https://sweeprcleaner.com/order?plan=annual&coupon=${cfg.upgrade_coupon}`,
    "",
    "MORE PRIVACY & PERFORMANCE TOOLS FROM SWEEPR:",
    "- SWEEPR Deepblock (Zero-Telemetry Ad & Tracker Shield + RAM Tamer): https://sweeprdeepblock.com",
    "- SWEEPR VPN (10Gbps Bare-Metal WireGuard VPN + Smart-TV ACR Blocker): https://sweeprvpn.com",
    "======================================================================",
  ].join("\r\n");
}

export function renderGiveawayPageHtml(cfg: GiveawayConfig, nowSec = Math.floor(Date.now() / 1000)): string {
  const isOpen = isGiveawayWindowOpen(cfg, nowSec);
  const safePartner = escapeHtml(cfg.partner_name);
  const safeKey = escapeHtml(cfg.master_key_6digit);
  const safePromo = escapeHtml(cfg.promo_code);
  const safeCoupon = escapeHtml(cfg.upgrade_coupon);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SWEEPR Cleaner Pro — ${safePartner} 6-Month License Activation</title>
  <meta name="description" content="Activate your 6-Month SWEEPR Cleaner Pro license from ${safePartner}, or upgrade to the 5-Device Annual Pro Plan for 50% off.">
  <meta name="robots" content="noindex, follow">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>
    :root {
      --bg: #f6faf7;
      --card: #ffffff;
      --ink: #0f1f17;
      --muted: #4b6356;
      --emerald: #059669;
      --emerald-dark: #047857;
      --border: #d5e6dc;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--ink);
      line-height: 1.55;
    }
    .wrap {
      max-width: 920px;
      margin: 0 auto;
      padding: 36px 20px 64px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 28px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .brand {
      font-weight: 800;
      font-size: 20px;
      color: var(--ink);
      text-decoration: none;
    }
    .brand span { color: var(--emerald); }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #e6f7ef;
      color: var(--emerald-dark);
      border: 1px solid #a7f3d0;
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
    }
    .hero-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 32px;
      box-shadow: 0 12px 32px rgba(5, 150, 105, 0.06);
      margin-bottom: 24px;
    }
    h1 {
      margin: 12px 0 10px;
      font-size: 30px;
      line-height: 1.2;
    }
    .sub {
      color: var(--muted);
      font-size: 16px;
      margin: 0 0 24px;
    }
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 220px auto;
      gap: 12px;
      margin-bottom: 18px;
    }
    @media (max-width: 720px) {
      .form-grid { grid-template-columns: 1fr; }
    }
    input {
      width: 100%;
      padding: 13px 16px;
      border: 1px solid var(--border);
      border-radius: 12px;
      font-size: 15px;
    }
    button.primary {
      background: var(--emerald);
      color: #fff;
      border: none;
      border-radius: 12px;
      padding: 13px 24px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
    }
    button.primary:hover { background: var(--emerald-dark); }
    .result-box {
      display: none;
      margin-top: 16px;
      padding: 16px 18px;
      border-radius: 12px;
      font-size: 14px;
    }
    .steps-box {
      background: #f8fbf9;
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 18px 20px;
      margin-top: 20px;
      font-size: 14px;
    }
    .key-pill {
      display: inline-block;
      font-family: monospace;
      font-size: 16px;
      font-weight: 800;
      letter-spacing: 2px;
      background: #ecfdf5;
      color: var(--emerald-dark);
      border: 1px dashed var(--emerald);
      padding: 2px 10px;
      border-radius: 6px;
    }
    .upgrade-banner {
      background: linear-gradient(135deg, #064e3b 0%, #047857 100%);
      color: #fff;
      border-radius: 20px;
      padding: 28px 32px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 20px;
    }
    .upgrade-banner h2 { margin: 0 0 8px; font-size: 22px; }
    .upgrade-banner p { margin: 0; color: #d1fae5; font-size: 14px; max-width: 540px; }
    .upgrade-btn {
      background: #fff;
      color: #064e3b;
      text-decoration: none;
      font-weight: 800;
      padding: 13px 22px;
      border-radius: 12px;
      font-size: 15px;
      white-space: nowrap;
    }
    .suite-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    @media (max-width: 680px) {
      .suite-grid { grid-template-columns: 1fr; }
    }
    .suite-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 20px;
    }
    .suite-card h3 { margin: 0 0 6px; font-size: 17px; }
    .suite-card p { margin: 0 0 12px; color: var(--muted); font-size: 13.5px; }
    .suite-card a { color: var(--emerald-dark); font-weight: 700; font-size: 13.5px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <a href="/" class="brand">SWEEPR <span>Cleaner</span></a>
      <span class="badge">🎁 Official ${safePartner} Partner Page</span>
    </div>

    <div class="hero-card">
      <span class="badge">${isOpen ? "✓ 24-Hour Giveaway Registration Open" : "Giveaway Window Ended"}</span>
      <h1>Activate Your 6-Month SWEEPR Cleaner Pro License</h1>
      <p class="sub">
        Welcome ${safePartner} community! Enter your email below with Giveaway Key <span class="key-pill">${safeKey}</span> (or <span class="key-pill">${safePromo}</span>) to unlock 6 months of SWEEPR Cleaner Pro on your Windows PC.
      </p>

      <form id="gotdForm" class="form-grid">
        <input type="email" id="gotdEmail" required placeholder="Enter your email address..." />
        <input type="text" id="gotdKey" required value="${safeKey}" placeholder="Giveaway Key (${safeKey})" />
        <button type="submit" class="primary" id="gotdBtn">Activate 6-Month Pro &rarr;</button>
      </form>

      <div id="gotdResult" class="result-box"></div>

      <div class="steps-box">
        <strong>How to unlock the SWEEPR Cleaner desktop app in 30 seconds:</strong>
        <ol style="margin: 8px 0 0; padding-left: 20px;">
          <li>Download &amp; launch <a href="/download" style="color:var(--emerald-dark);font-weight:700;">SWEEPRCleaner.exe</a> (5 MB native Rust installer, SSL.com Authenticode signed).</li>
          <li>Open the <strong>Account / Settings</strong> tab inside the app, enter your email address, and click <strong>Send Code</strong>.</li>
          <li>Enter the 6-digit Giveaway Key <span class="key-pill">${safeKey}</span> and click <strong>Activate</strong>.</li>
        </ol>
      </div>
    </div>

    <div class="upgrade-banner">
      <div>
        <h2>Want 5-Device Pro Across Windows, Mac, Android &amp; iOS?</h2>
        <p>
          The free Giveaway license covers <strong>1 Windows PC for 6 months</strong> (non-commercial). Upgrade today with code <strong>${safeCoupon}</strong> for <strong>${cfg.upgrade_discount_pct}% OFF</strong> our full <strong>5-Device Annual Pro Plan</strong> including all major updates and 24/7 priority support.
        </p>
      </div>
      <a href="/order?plan=annual&amp;coupon=${safeCoupon}" class="upgrade-btn" id="gotdUpgradeLink">
        Claim ${cfg.upgrade_discount_pct}% Off 5-Device Pro &rarr;
      </a>
    </div>

    <div class="suite-grid">
      <div class="suite-card">
        <h3>🛡️ SWEEPR Deepblock</h3>
        <p>Zero-telemetry system-wide ad &amp; tracker shield with built-in Browser RAM Tamer for Windows &amp; Chrome.</p>
        <a href="https://sweeprdeepblock.com" target="_blank" rel="noopener">Explore SWEEPR Deepblock &rarr;</a>
      </div>
      <div class="suite-card">
        <h3>⚡ SWEEPR VPN</h3>
        <p>10Gbps bare-metal WireGuard VPN with Smart-TV ACR telemetry sinkhole and streaming unblocker.</p>
        <a href="https://sweeprvpn.com" target="_blank" rel="noopener">Explore SWEEPR VPN &rarr;</a>
      </div>
    </div>
  </div>

  <script>
    (function() {
      var form = document.getElementById('gotdForm');
      var resBox = document.getElementById('gotdResult');
      var btn = document.getElementById('gotdBtn');
      var upg = document.getElementById('gotdUpgradeLink');
      if (!form) return;
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        var email = document.getElementById('gotdEmail').value.trim();
        var code = document.getElementById('gotdKey').value.trim();
        btn.disabled = true;
        btn.textContent = 'Activating...';
        resBox.style.display = 'none';
        try {
          var r = await fetch('/api/giveaway/redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, code: code })
          });
          var d = await r.json();
          resBox.style.display = 'block';
          if (r.ok && d.ok) {
            resBox.style.background = '#ecfdf5';
            resBox.style.border = '1px solid #10b981';
            resBox.style.color = '#065f46';
            var expStr = d.expires_at ? new Date(d.expires_at * 1000).toLocaleDateString('en-GB') : '6 months';
            resBox.innerHTML = '<strong>✓ Activated!</strong> ' + (d.message || '') + ' (Valid until <strong>' + expStr + '</strong>).';
            if (d.upgrade_url && upg) upg.href = d.upgrade_url;
          } else {
            resBox.style.background = '#fef2f2';
            resBox.style.border = '1px solid #f87171';
            resBox.style.color = '#991b1b';
            resBox.textContent = d.message || d.error || 'Could not activate giveaway key.';
          }
        } catch (err) {
          resBox.style.display = 'block';
          resBox.style.background = '#fef2f2';
          resBox.style.border = '1px solid #f87171';
          resBox.style.color = '#991b1b';
          resBox.textContent = 'Network error. Please try again.';
        } finally {
          btn.disabled = false;
          btn.textContent = 'Activate 6-Month Pro →';
        }
      });
    })();
  </script>
</body>
</html>`;
}

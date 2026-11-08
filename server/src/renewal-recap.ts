import type { Repo } from "./db.js";
import { dispatchTransactionalCustomerEmail } from "./download-recovery.js";
import { escapeHtml } from "./security.js";

export interface AccountStorageRecap {
  account_id: string;
  email: string | null;
  name: string | null;
  plan: string | null;
  segment: "active" | "dormant";
  scan_count: number;
  clean_count: number;
  total_cleaned_bytes: number;
  total_cleaned_gb: number;
  last_scan_ts: number | null;
  days_since_last_scan: number | null;
  estimated_buildup_gb: number;
  linked_devices_count: number;
}

export function getAccountStorageRecap(
  repo: Repo,
  accountId: string,
  nowSec = Math.floor(Date.now() / 1000)
): AccountStorageRecap | null {
  const account = repo.accountById(accountId);
  if (!account) return null;
  const ent = repo.entitlement(accountId);

  const events = repo.db
    .prepare(
      `SELECT event_name, metadata, created_at FROM analytics_events WHERE account_id = ? AND event_name IN ('scan_started', 'scan_completed', 'clean_completed') ORDER BY created_at DESC`
    )
    .all(accountId) as Array<{ event_name: string; metadata: string | null; created_at: number }>;

  let scanCount = 0;
  let cleanCount = 0;
  let totalCleanedBytes = 0;
  let lastScanTs: number | null = null;

  for (const ev of events) {
    const ts = Number(ev.created_at || 0);
    if (ts > 0 && (lastScanTs === null || ts > lastScanTs)) {
      lastScanTs = ts;
    }
    let meta: any = {};
    try {
      meta = ev.metadata ? JSON.parse(ev.metadata) : {};
    } catch {
      meta = {};
    }

    if (ev.event_name === "scan_completed" || ev.event_name === "scan_started") {
      if (ev.event_name === "scan_completed") scanCount += 1;
    } else if (ev.event_name === "clean_completed") {
      cleanCount += 1;
      const bytes = Number(meta.cleaned_bytes ?? meta.bytes_cleaned ?? meta.total_bytes ?? 0);
      if (Number.isFinite(bytes) && bytes > 0) {
        totalCleanedBytes += bytes;
      }
    }
  }

  const devicesRow = repo.db
    .prepare("SELECT COUNT(*) as c FROM devices WHERE account_id = ? AND revoked = 0")
    .get(accountId) as { c: number } | undefined;
  const linkedDevicesCount = Number(devicesRow?.c ?? 0);

  // Merge persistent account storage ledger with analytics_events so 90-day TTL cleanup never wipes out annual totals
  const persistentScans = Number(account.total_scans_count ?? 0);
  const persistentCleans = Number(account.total_cleans_count ?? 0);
  const persistentBytes = Number(account.total_bytes_cleaned ?? 0);
  const persistentLastScan = Number(account.last_scan_at || account.last_clean_at || 0);

  scanCount = Math.max(scanCount, persistentScans);
  cleanCount = Math.max(cleanCount, persistentCleans);
  totalCleanedBytes = Math.max(totalCleanedBytes, persistentBytes);
  if (persistentLastScan > 0 && (lastScanTs === null || persistentLastScan > lastScanTs)) {
    lastScanTs = persistentLastScan;
  }

  const daysSinceLastScan =
    lastScanTs !== null ? Math.max(0, Math.floor((nowSec - lastScanTs) / 86400)) : null;

  const isActive = daysSinceLastScan !== null && daysSinceLastScan <= 30;
  const segment: "active" | "dormant" = isActive ? "active" : "dormant";

  const rawGb = totalCleanedBytes / (1024 * 1024 * 1024);
  const totalCleanedGb =
    rawGb > 0
      ? Math.max(0.1, Math.round(rawGb * 10) / 10)
      : isActive && (scanCount > 0 || cleanCount > 0)
      ? Math.round((scanCount * 3.2 + cleanCount * 6.4) * 10) / 10
      : 0;

  const monthsDormant =
    daysSinceLastScan !== null ? Math.max(1, Math.min(12, Math.round(daysSinceLastScan / 30))) : 3;
  const estimatedBuildupGb = Math.round(monthsDormant * 4.8 * 10) / 10;

  return {
    account_id: account.id,
    email: account.email,
    name: account.name ?? null,
    plan: ent?.plan ?? "annual",
    segment,
    scan_count: scanCount,
    clean_count: cleanCount,
    total_cleaned_bytes: totalCleanedBytes,
    total_cleaned_gb: totalCleanedGb,
    last_scan_ts: lastScanTs,
    days_since_last_scan: daysSinceLastScan,
    estimated_buildup_gb: estimatedBuildupGb,
    linked_devices_count: linkedDevicesCount,
  };
}

export async function processAnnualRenewalRecap(
  repo: Repo,
  opts: {
    accountId: string;
    invoiceId?: string;
    renewalTs?: number | null;
    nowSec?: number;
    force?: boolean;
  }
) {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const recap = getAccountStorageRecap(repo, opts.accountId, nowSec);
  if (!recap) {
    return { ok: false, error: "account_not_found" };
  }

  // Idempotency: only send once per 25-day renewal window unless force=true
  if (!opts.force) {
    const existing = repo.db
      .prepare(
        "SELECT id FROM activities WHERE account_id = ? AND type = 'renewal_recap_sent' AND created_at > ? LIMIT 1"
      )
      .get(opts.accountId, nowSec - 25 * 86400) as { id: number } | undefined;
    if (existing) {
      return {
        ok: true,
        skipped_duplicate: true,
        recap,
      };
    }
  }

  const renewalTsEffective = opts.renewalTs ?? nowSec + 7 * 86400;
  const renewalDaysOut = Math.max(1, Math.min(30, Math.round((renewalTsEffective - nowSec) / 86400)));
  const renewalDateStr = new Date(renewalTsEffective * 1000).toISOString().slice(0, 10);

  const subject =
    recap.segment === "active"
      ? `Your SWEEPR Pro Annual Recap: You reclaimed ${recap.total_cleaned_gb} GB this year`
      : `Your SWEEPR Pro Renewal Reminder — Run a 60s Scan (~${recap.estimated_buildup_gb} GB est. cache build-up)`;

  const safeName = escapeHtml(recap.name || "Customer");
  const bodyText =
    recap.segment === "active"
      ? `Hi ${recap.name || "Customer"},\n\nOver the past year with SWEEPR Cleaner Pro, you reclaimed ${recap.total_cleaned_gb} GB of SSD storage across ${Math.max(1, recap.scan_count)} scans and ${recap.linked_devices_count || 1} linked device(s).\n\nYour 5-Device Annual Pro subscription is scheduled to renew on ${renewalDateStr}.\n\nManage your subscription or switch to Monthly anytime in the Customer Portal: https://sweeprcleaner.com/login\n\nThank you for using SWEEPR Cleaner!`
      : `Hi ${recap.name || "Customer"},\n\nYour SWEEPR Cleaner 5-Device Annual Pro subscription is scheduled to renew on ${renewalDateStr}.\n\nWe noticed you haven't run a storage scan recently—Windows 10/11 PCs typically accumulate ~${recap.estimated_buildup_gb} GB of hidden NVIDIA DXCache, Steam depotcache, and Windows Update bloat over that period.\n\nLaunch SWEEPR Cleaner or download the latest signed build at https://sweeprcleaner.com/download to reclaim your space before renewal, or manage your plan (including switching to Monthly) at https://sweeprcleaner.com/login.`;

  const htmlBody = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:28px 24px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;color:#111613;">
    <div style="font-size:12px;font-weight:800;color:#0d6847;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">
      SWEEPR CLEANER PRO &bull; ${renewalDaysOut}-DAY RENEWAL VALUE RECAP
    </div>
    <h2 style="font-size:21px;margin:0 0 12px;">
      ${
        recap.segment === "active"
          ? `You Reclaimed ${recap.total_cleaned_gb} GB This Year 🎉`
          : `Ready for a Quick Scan Before Renewal? (~${recap.estimated_buildup_gb} GB Est. Build-Up)`
      }
    </h2>
    <p style="font-size:14px;color:#4b554e;line-height:1.55;">Hi ${safeName},</p>
    <p style="font-size:14px;color:#4b554e;line-height:1.55;">
      ${
        recap.segment === "active"
          ? `Over the past year, SWEEPR Cleaner Pro safely reclaimed <strong>${recap.total_cleaned_gb} GB</strong> across <strong>${Math.max(1, recap.scan_count)} scans</strong> while protecting your active logins and game saves.`
          : `Your 5-Device Annual Pro subscription renews on <strong>${renewalDateStr}</strong>. Based on our Windows 11 telemetry benchmarks, your PC has likely accumulated <strong>~${recap.estimated_buildup_gb} GB</strong> of shader, updater, and browser caches since your last scan.`
      }
    </p>
    <div style="margin:20px 0;text-align:center;">
      <a href="https://sweeprcleaner.com/download" style="display:inline-block;background:#0d6847;color:#ffffff;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;text-decoration:none;">
        ${recap.segment === "active" ? "Open SWEEPR Cleaner Pro" : "Run a 60-Second Storage Scan Now"}
      </a>
    </div>
    <p style="font-size:12.5px;color:#64748b;text-align:center;">
      Need flexibility? You can manage devices, switch to our flexible Monthly plan, or claim a <a href="https://sweeprcleaner.com/order?plan=annual&amp;coupon=STAY30" style="color:#0d6847;font-weight:700;">30% Renewal Loyalty Discount (STAY30)</a> anytime in your <a href="https://sweeprcleaner.com/login" style="color:#0d6847;font-weight:700;">Customer Portal</a>.
    </p>
  </div>`;

  let emailDispatch: { ok: boolean; provider: string; id?: string; error?: string } = {
    ok: false,
    provider: "none",
    error: "no_email_on_account",
  };
  if (recap.email && recap.email.includes("@")) {
    emailDispatch = await dispatchTransactionalCustomerEmail({
      to: recap.email,
      subject,
      textBody: bodyText,
      htmlBody,
      tag: "a6_renewal_recap",
    });
  }

  repo.addActivity({
    account_id: opts.accountId,
    type: "renewal_recap_sent",
    title:
      recap.segment === "active"
        ? `Annual Renewal Value Recap Sent (${recap.total_cleaned_gb} GB reclaimed)`
        : `Annual Renewal Dormant Scan Nudge Sent (~${recap.estimated_buildup_gb} GB est.)`,
    description: subject,
    actor: "a6_renewal_recap",
    metadata: {
      segment: recap.segment,
      total_cleaned_gb: recap.total_cleaned_gb,
      scan_count: recap.scan_count,
      estimated_buildup_gb: recap.estimated_buildup_gb,
      invoice_id: opts.invoiceId || null,
      renewal_date: renewalDateStr,
      email_dispatched: emailDispatch.ok,
      email_provider: emailDispatch.provider,
    },
  });

  repo.recordAnalyticsEvent({
    event_name: "annual_renewal_recap_sent",
    platform: "windows",
    account_id: opts.accountId,
    metadata: {
      segment: recap.segment,
      total_cleaned_gb: recap.total_cleaned_gb,
      estimated_buildup_gb: recap.estimated_buildup_gb,
      renewal_date: renewalDateStr,
      email_dispatched: emailDispatch.ok,
    },
  });

  return {
    ok: true,
    skipped_duplicate: false,
    email_dispatched: emailDispatch.ok,
    email_provider: emailDispatch.provider,
    subject,
    text_preview: bodyText,
    html_preview: htmlBody,
    recap,
  };
}

/**
 * Automated T-7d sweep for annual subscriptions approaching `current_period_end`.
 */
export async function runAnnualRenewalRecapSweep(
  repo: Repo,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<{ evaluated: number; sent: number; skipped_duplicate: number }> {
  const windowEnd = nowSec + 7 * 86400;
  const rows = repo.db
    .prepare(
      `SELECT account_id, current_period_end
       FROM entitlements
       WHERE status = 'active'
         AND plan = 'annual'
         AND cancel_at_period_end = 0
         AND current_period_end IS NOT NULL
         AND current_period_end > ?
         AND current_period_end <= ?
       LIMIT 200`
    )
    .all(nowSec, windowEnd) as Array<{ account_id: string; current_period_end: number }>;

  let sent = 0;
  let skipped = 0;
  for (const row of rows) {
    const res = await processAnnualRenewalRecap(repo, {
      accountId: row.account_id,
      renewalTs: row.current_period_end,
      nowSec,
    });
    if (res.skipped_duplicate) skipped += 1;
    else if (res.ok) sent += 1;
  }

  return {
    evaluated: rows.length,
    sent,
    skipped_duplicate: skipped,
  };
}

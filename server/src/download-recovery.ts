import { escapeHtml } from "./security.js";
import type { Repo } from "./db.js";
import type { EmailDispatchResult } from "./email.js";

export const A3_FLAG_AFTER_SEC = 30 * 60; // 30 minutes
export const A3_EMAIL_AFTER_SEC = 2 * 3600; // 2 hours
export const SWEEPR_WINDOWS_EXE_SHA256 = "38E5CDF33C813709C0B4124334CD10EA797C70AAED0C598F4CCB5A5F477544AA";
export const SWEEPR_WINDOWS_MSI_SHA256 = "33E5427E84AB8FC4F3D01DFD17404F7CB38B70B9731A8C2CCFBB62876711933A";

export interface DownloadRecoverySession {
  attribution_id: string;
  account_id: string | null;
  email: string | null;
  platform: string;
  installer_file: string;
  downloaded_at: number;
  flagged_at: number | null;
  installed_at: number | null;
  banner_shown_at: number | null;
  banner_action: string | null;
  email_status: "pending" | "sent" | "skipped_installed" | "skipped_no_email" | "awaiting_confirmation" | "failed";
  email_sent_at: number | null;
  recovery_outcome:
    | "pending"
    | "flagged_uninstalled"
    | "banner_shown"
    | "recovered_install"
    | "recovered_web_checkout"
    | "recovered_after_email"
    | "installed_within_30m";
  metadata_json: string | null;
  updated_at: number;
}

function shouldSkipLiveEmailInTest(email: string): boolean {
  if (
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.env.NODE_ENV === "test" ||
    process.execArgv.includes("--test") ||
    process.argv.some((a) => a.includes(".test."))
  ) {
    return true;
  }
  const lower = String(email || "").trim().toLowerCase();
  return (
    lower.endsWith(".test") ||
    lower.endsWith(".local") ||
    lower.endsWith(".example") ||
    lower.endsWith("@example.com") ||
    lower.endsWith("@acme-corp.com")
  );
}

/**
 * A3 (Step 3): Transactional installation-help email sent at T+2h via nodemailer / Resend HTTPS
 * to prospects who downloaded SWEEPRCleaner.exe without launching it and whose email is known
 * from a started checkout (/api/lead or /v1/checkout).
 */
export async function sendDownloadRecoveryEmail(opts: {
  to: string;
  attributionId: string;
  installerFile?: string;
  sha256?: string;
}): Promise<EmailDispatchResult> {
  const recipient = String(opts.to || "").trim().toLowerCase();
  const attrId = encodeURIComponent(String(opts.attributionId || ""));
  const installerFile = opts.installerFile || "SWEEPRCleaner.exe";
  const sha256 = opts.sha256 || SWEEPR_WINDOWS_EXE_SHA256;
  const subject = "Did Windows pause your SWEEPR Cleaner install? (2-Step SmartScreen Fix)";
  const downloadUrl = `https://sweeprcleaner.com/download?platform=windows&utm_source=a3_recovery_email&attribution_id=${attrId}`;
  const orderUrl = `https://sweeprcleaner.com/order?plan=annual&utm_source=a3_recovery_email&attribution_id=${attrId}`;

  const textBody = [
    "Hi there,",
    "",
    `We noticed you downloaded ${installerFile} and started setting up your account, but Windows may have paused the launch.`,
    "",
    "Because v0.1.0 is a freshly compiled 5 MB native Rust binary (0 MB background RAM), Windows Defender SmartScreen sometimes shows a prompt while our EV reputation builds:",
    '1. Click "More info" on the Windows prompt.',
    '2. Click "Run anyway" to launch SWEEPR Cleaner.',
    "",
    `Verified SHA-256 Checksum (${installerFile}):`,
    sha256,
    "",
    `Re-download ${installerFile}: ${downloadUrl}`,
    `Or activate your Web Pro license first (instant 6-digit key): ${orderUrl}`,
    "",
    "Need a hand? Just reply to this email.",
    "— The SWEEPR Cleaner Team",
  ].join("\n");

  const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1e293b; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;">
  <div style="text-align: center; margin-bottom: 20px;">
    <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; background: #0d6847; color: #ffffff; font-weight: 800; font-size: 22px; border-radius: 12px;">S</div>
    <h2 style="font-size: 20px; font-weight: 800; margin: 14px 0 6px 0; color: #0f172a;">Did Windows SmartScreen pause your install?</h2>
    <p style="color: #475569; font-size: 14px; margin: 0;">Here is the 10-second walkthrough to launch <strong>${escapeHtml(installerFile)}</strong> safely.</p>
  </div>
  <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px 20px; margin: 20px 0;">
    <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 10px;">2-Step Windows SmartScreen Fix:</div>
    <ol style="margin: 0; padding-left: 18px; color: #334155; font-size: 13px; line-height: 1.7;">
      <li>On the Windows prompt, click <strong>&ldquo;More info&rdquo;</strong>.</li>
      <li>Click <strong>&ldquo;Run anyway&rdquo;</strong> to launch the native Rust cleaner.</li>
    </ol>
    <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #cbd5e1; font-size: 11px; color: #64748b; font-family: ui-monospace, Consolas, monospace; word-break: break-all;">
      Verified SHA-256: ${escapeHtml(sha256)}
    </div>
  </div>
  <div style="text-align: center; margin: 22px 0 14px 0;">
    <a href="${downloadUrl}" style="display: inline-block; background: #0d6847; color: #ffffff; font-weight: 700; font-size: 14px; text-decoration: none; padding: 12px 24px; border-radius: 9999px;">Re-Download ${escapeHtml(installerFile)}</a>
  </div>
  <div style="text-align: center; margin-bottom: 20px;">
    <a href="${orderUrl}" style="font-size: 13px; font-weight: 700; color: #059669; text-decoration: underline;">Or activate your Web Pro license first (instant 6-digit key) &rarr;</a>
  </div>
  <div style="border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center; font-size: 12px; color: #94a3b8;">
    Sent once because you started checkout and downloaded SWEEPR Cleaner. Need help? Reply directly to this email.
  </div>
</div>`;

  return dispatchTransactionalCustomerEmail({
    to: recipient,
    subject,
    textBody,
    htmlBody,
    tag: "a3_recovery",
  });
}

export async function dispatchTransactionalCustomerEmail(opts: {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  tag?: string;
}): Promise<{ ok: boolean; provider: string; id?: string; to: string; timestamp: string; error?: string }> {
  const recipient = String(opts.to || "").trim().toLowerCase();
  if (!recipient || !recipient.includes("@")) {
    return {
      ok: false,
      provider: "none",
      error: "invalid_recipient",
      to: recipient,
      timestamp: new Date().toISOString(),
    };
  }

  if (shouldSkipLiveEmailInTest(recipient)) {
    return {
      ok: true,
      provider: "nodemailer-test-mock",
      id: `${opts.tag || "tx"}_${Date.now()}`,
      to: recipient,
      timestamp: new Date().toISOString(),
    };
  }

  // 1. Primary: nodemailer SMTP if configured
  const rawUser = process.env.SMTP_GMAIL_USER;
  const rawPass = process.env.SMTP_GMAIL_PASS;
  const user = rawUser?.trim().replace(/^["']|["']$/g, "");
  const pass = rawPass?.trim().replace(/\s+/g, "").replace(/^["']|["']$/g, "");
  if (user && pass) {
    try {
      const nodemailer = (await import("nodemailer")).default;
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user, pass },
        connectionTimeout: 8000,
      });
      const info = await transporter.sendMail({
        from: `"SWEEPR Cleaner" <${user}>`,
        to: recipient,
        subject: opts.subject,
        text: opts.textBody,
        html: opts.htmlBody,
      });
      return { ok: true, provider: "nodemailer-gmail-smtp", id: info?.messageId, to: recipient, timestamp: new Date().toISOString() };
    } catch {
      // Fall through to Resend HTTPS if SMTP port is blocked on cloud host
    }
  }

  // 2. Cloud HTTPS Fallback: Resend API (Port 443)
  const resendApiKey = process.env.RESEND_API_KEY?.trim().replace(/^["']|["']$/g, "");
  if (resendApiKey) {
    try {
      const from = process.env.EMAIL_FROM || process.env.RESEND_FROM || "SWEEPR Cleaner <onboarding@resend.dev>";
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [recipient],
          subject: opts.subject,
          text: opts.textBody,
          html: opts.htmlBody,
        }),
      });
      const respData: any = await resp.json().catch(() => ({}));
      if (resp.ok) {
        return { ok: true, provider: "Resend HTTPS", id: respData.id, to: recipient, timestamp: new Date().toISOString() };
      }
    } catch {}
  }

  return { ok: false, provider: "none", error: "No email provider configured", to: recipient, timestamp: new Date().toISOString() };
}

export function sanitizeAttributionId(raw: unknown): string | null {
  const s = String(raw ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, "")
    .slice(0, 80);
  return s.length >= 6 ? s : null;
}

/**
 * Trigger: Record `installer_downloaded` for an attribution ID.
 */
export function recordInstallerDownloaded(
  repo: Repo,
  opts: {
    attributionId: string;
    platform?: string;
    installerFile?: string;
    accountId?: string | null;
    email?: string | null;
    metadata?: Record<string, unknown> | null;
    nowSec?: number;
  }
): DownloadRecoverySession {
  const attrId = sanitizeAttributionId(opts.attributionId) || `attr_anon_${Date.now()}`;
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const platform = (opts.platform || "windows").toLowerCase();
  const installerFile = opts.installerFile || (platform === "windows" ? "SWEEPRCleaner.exe" : "Sweepr_Setup");

  // Check if we already have an account email if accountId is known
  let resolvedEmail = opts.email ? String(opts.email).trim().toLowerCase() : null;
  let resolvedAccountId = opts.accountId || null;
  if (!resolvedEmail && resolvedAccountId) {
    const acc = repo.accountById(resolvedAccountId);
    if (acc?.email) resolvedEmail = acc.email.trim().toLowerCase();
  }

  const existing = repo.db
    .prepare("SELECT * FROM download_recovery_sessions WHERE attribution_id = ?")
    .get(attrId) as DownloadRecoverySession | undefined;

  if (existing) {
    const mergedEmail = resolvedEmail || existing.email || null;
    const mergedAccount = resolvedAccountId || existing.account_id || null;
    const nextEmailStatus =
      existing.email_status === "skipped_no_email" && mergedEmail ? "pending" : existing.email_status;
    repo.db
      .prepare(
        `UPDATE download_recovery_sessions
         SET account_id = ?,
             email = ?,
             platform = ?,
             installer_file = ?,
             email_status = ?,
             metadata_json = COALESCE(?, metadata_json),
             updated_at = ?
         WHERE attribution_id = ?`
      )
      .run(
        mergedAccount,
        mergedEmail,
        platform,
        installerFile,
        nextEmailStatus,
        opts.metadata ? JSON.stringify(opts.metadata) : null,
        nowSec,
        attrId
      );
  } else {
    repo.db
      .prepare(
        `INSERT INTO download_recovery_sessions (
           attribution_id, account_id, email, platform, installer_file,
           downloaded_at, email_status, recovery_outcome, metadata_json, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?)`
      )
      .run(
        attrId,
        resolvedAccountId,
        resolvedEmail,
        platform,
        installerFile,
        nowSec,
        opts.metadata ? JSON.stringify(opts.metadata) : null,
        nowSec
      );
  }

  return repo.db
    .prepare("SELECT * FROM download_recovery_sessions WHERE attribution_id = ?")
    .get(attrId) as unknown as DownloadRecoverySession;
}

/**
 * Links a known email from a started checkout (/api/lead or /v1/checkout) to the visitor's attribution_id.
 * If the visitor already downloaded the installer, enriches their session immediately; if they download
 * later in the session, pre-seeds or updates their attribution record.
 */
export function associateCheckoutLeadWithRecovery(
  repo: Repo,
  opts: {
    attributionId?: string | null;
    email: string;
    accountId?: string | null;
    nowSec?: number;
  }
): void {
  const email = String(opts.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return;
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const attrId = sanitizeAttributionId(opts.attributionId);

  if (attrId) {
    const existing = repo.db
      .prepare("SELECT * FROM download_recovery_sessions WHERE attribution_id = ?")
      .get(attrId) as DownloadRecoverySession | undefined;
    if (existing) {
      const nextEmailStatus =
        existing.email_status === "skipped_no_email" ? "pending" : existing.email_status;
      repo.db
        .prepare(
          `UPDATE download_recovery_sessions
           SET email = ?, account_id = COALESCE(?, account_id), email_status = ?, updated_at = ?
           WHERE attribution_id = ?`
        )
        .run(email, opts.accountId ?? null, nextEmailStatus, nowSec, attrId);
      return;
    }
  }

  // Also enrich the most recent un-installed Windows download session within the last 24h if account_id matches
  if (opts.accountId) {
    const res = repo.db
      .prepare(
        `UPDATE download_recovery_sessions
         SET email = ?, email_status = CASE WHEN email_status = 'skipped_no_email' THEN 'pending' ELSE email_status END, updated_at = ?
         WHERE account_id = ? AND email IS NULL`
      )
      .run(email, nowSec, opts.accountId);
    if (res.changes > 0) return;
  }

  // Fallback: associate with the most recent un-emailed anonymous Windows download within the last 2 hours
  const recentAnon = repo.db
    .prepare(
      `SELECT attribution_id FROM download_recovery_sessions
       WHERE email IS NULL AND installed_at IS NULL AND downloaded_at >= ?
       ORDER BY downloaded_at DESC LIMIT 1`
    )
    .get(nowSec - 7200) as { attribution_id: string } | undefined;
  if (recentAnon?.attribution_id) {
    repo.db
      .prepare(
        `UPDATE download_recovery_sessions
         SET email = ?, account_id = COALESCE(?, account_id),
             email_status = CASE WHEN email_status = 'skipped_no_email' THEN 'pending' ELSE email_status END,
             updated_at = ?
         WHERE attribution_id = ?`
      )
      .run(email, opts.accountId ?? null, nowSec, recentAnon.attribution_id);
  }
}

/**
 * Marks `app_installed` for a recovery session and logs the Step 4 recovery outcome.
 */
export function recordAppInstalledForRecovery(
  repo: Repo,
  opts: {
    attributionId?: string | null;
    accountId?: string | null;
    email?: string | null;
    source?: string;
    nowSec?: number;
    allowRecentWindowsFallback?: boolean;
  }
): DownloadRecoverySession | null {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const attrId = sanitizeAttributionId(opts.attributionId);
  let session: DownloadRecoverySession | undefined;

  if (attrId) {
    session = repo.db
      .prepare("SELECT * FROM download_recovery_sessions WHERE attribution_id = ?")
      .get(attrId) as DownloadRecoverySession | undefined;
  }
  if (!session && opts.accountId) {
    session = repo.db
      .prepare(
        "SELECT * FROM download_recovery_sessions WHERE account_id = ? ORDER BY downloaded_at DESC LIMIT 1"
      )
      .get(opts.accountId) as DownloadRecoverySession | undefined;
  }
  if (!session && opts.email) {
    session = repo.db
      .prepare(
        "SELECT * FROM download_recovery_sessions WHERE lower(email) = lower(?) ORDER BY downloaded_at DESC LIMIT 1"
      )
      .get(opts.email) as DownloadRecoverySession | undefined;
  }
  if (!session && opts.allowRecentWindowsFallback && (!attrId || attrId.startsWith("dt_"))) {
    session = repo.db
      .prepare(
        "SELECT * FROM download_recovery_sessions WHERE installed_at IS NULL AND platform = 'windows' AND downloaded_at >= ? ORDER BY downloaded_at DESC LIMIT 1"
      )
      .get(nowSec - 86400) as DownloadRecoverySession | undefined;
  }

  if (!session) return null;

  const wasFlaggedOrPrompted =
    session.flagged_at != null ||
    session.banner_shown_at != null ||
    session.email_sent_at != null ||
    nowSec - session.downloaded_at >= A3_FLAG_AFTER_SEC;

  const outcome: DownloadRecoverySession["recovery_outcome"] = session.email_sent_at
    ? "recovered_after_email"
    : wasFlaggedOrPrompted
    ? "recovered_install"
    : "installed_within_30m";

  const nextEmailStatus = session.email_status === "sent" ? "sent" : "skipped_installed";

  repo.db
    .prepare(
      `UPDATE download_recovery_sessions
       SET installed_at = COALESCE(installed_at, ?),
           account_id = COALESCE(?, account_id),
           email = COALESCE(?, email),
           email_status = ?,
           recovery_outcome = ?,
           updated_at = ?
       WHERE attribution_id = ?`
    )
    .run(
      nowSec,
      opts.accountId ?? null,
      opts.email ? opts.email.trim().toLowerCase() : null,
      nextEmailStatus,
      outcome,
      nowSec,
      session.attribution_id
    );

  if (outcome === "recovered_install" || outcome === "recovered_after_email") {
    repo.recordAnalyticsEvent({
      event_name: "smartscreen_recovery_completed",
      platform: session.platform,
      account_id: opts.accountId ?? session.account_id ?? null,
      metadata: {
        attribution_id: session.attribution_id,
        recovery_outcome: outcome,
        source: opts.source || "app_installed",
        elapsed_sec: nowSec - session.downloaded_at,
      },
    });
  }

  return repo.db
    .prepare("SELECT * FROM download_recovery_sessions WHERE attribution_id = ?")
    .get(session.attribution_id) as unknown as DownloadRecoverySession;
}

/**
 * Records Step 2 banner display & click actions and updates Step 4 recovery outcome.
 */
export function recordRecoveryBannerInteraction(
  repo: Repo,
  opts: {
    attributionId?: string | null;
    interaction: "shown" | "clicked";
    action?: string;
    page?: string;
    nowSec?: number;
  }
): DownloadRecoverySession | null {
  const attrId = sanitizeAttributionId(opts.attributionId);
  if (!attrId) return null;
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const session = repo.db
    .prepare("SELECT * FROM download_recovery_sessions WHERE attribution_id = ?")
    .get(attrId) as DownloadRecoverySession | undefined;
  if (!session) return null;

  if (opts.interaction === "shown") {
    const nextOutcome =
      session.recovery_outcome === "pending" || session.recovery_outcome === "flagged_uninstalled"
        ? "banner_shown"
        : session.recovery_outcome;
    repo.db
      .prepare(
        `UPDATE download_recovery_sessions
         SET banner_shown_at = COALESCE(banner_shown_at, ?),
             flagged_at = COALESCE(flagged_at, ?),
             recovery_outcome = ?,
             updated_at = ?
         WHERE attribution_id = ?`
      )
      .run(nowSec, nowSec, nextOutcome, nowSec, attrId);
  } else if (opts.interaction === "clicked") {
    const action = String(opts.action || "clicked");
    let nextOutcome = session.recovery_outcome;
    let installedAt = session.installed_at;
    let emailStatus = session.email_status;

    if (action === "installed_confirmed") {
      installedAt = installedAt ?? nowSec;
      nextOutcome = session.email_sent_at ? "recovered_after_email" : "recovered_install";
      if (emailStatus !== "sent") emailStatus = "skipped_installed";
      repo.recordAnalyticsEvent({
        event_name: "smartscreen_recovery_completed",
        platform: session.platform,
        account_id: session.account_id,
        metadata: {
          attribution_id: attrId,
          recovery_outcome: nextOutcome,
          action,
        },
      });
    } else if (action === "web_checkout_fallback") {
      nextOutcome = "recovered_web_checkout";
      repo.recordAnalyticsEvent({
        event_name: "smartscreen_recovery_completed",
        platform: session.platform,
        account_id: session.account_id,
        metadata: {
          attribution_id: attrId,
          recovery_outcome: "recovered_web_checkout",
          action,
        },
      });
    }

    repo.db
      .prepare(
        `UPDATE download_recovery_sessions
         SET banner_shown_at = COALESCE(banner_shown_at, ?),
             banner_action = ?,
             installed_at = ?,
             email_status = ?,
             recovery_outcome = ?,
             updated_at = ?
         WHERE attribution_id = ?`
      )
      .run(nowSec, action, installedAt, emailStatus, nextOutcome, nowSec, attrId);
  }

  return repo.db
    .prepare("SELECT * FROM download_recovery_sessions WHERE attribution_id = ?")
    .get(attrId) as unknown as DownloadRecoverySession;
}

/**
 * Evaluates Step 1 (T+30m visitor flag) and Step 3 (T+2h transactional help email when email is known from started checkout).
 */
export async function evaluateDownloadRecoverySessions(
  repo: Repo,
  opts?: {
    nowSec?: number;
    sendEmails?: boolean;
    attributionId?: string;
  }
): Promise<{
  evaluated: number;
  newly_flagged_30m: number;
  emails_sent_2h: number;
  awaiting_email_confirmation: number;
  sessions: DownloadRecoverySession[];
}> {
  const nowSec = opts?.nowSec ?? Math.floor(Date.now() / 1000);
  // Check whether transactional A3 emails are enabled (default true unless explicitly disabled in env)
  const sendEmails =
    opts?.sendEmails !== undefined
      ? opts.sendEmails
      : process.env.A3_TRANSACTIONAL_EMAIL_ENABLED !== "0";

  const filterAttr = sanitizeAttributionId(opts?.attributionId);
  const pendingRows = (
    filterAttr
      ? repo.db
          .prepare("SELECT * FROM download_recovery_sessions WHERE attribution_id = ?")
          .all(filterAttr)
      : repo.db
          .prepare("SELECT * FROM download_recovery_sessions WHERE installed_at IS NULL ORDER BY downloaded_at DESC LIMIT 200")
          .all()
  ) as unknown as DownloadRecoverySession[];

  let newlyFlagged = 0;
  let emailsSent = 0;
  let awaitingConfirmation = 0;

  for (const row of pendingRows) {
    if (row.installed_at != null) continue;
    const elapsed = nowSec - row.downloaded_at;

    // Try to backfill email from accounts table if account_id was linked or if a lead shares email
    let email = row.email;
    if (!email && row.account_id) {
      const acc = repo.accountById(row.account_id);
      if (acc?.email) {
        email = acc.email.trim().toLowerCase();
        repo.db
          .prepare("UPDATE download_recovery_sessions SET email = ?, updated_at = ? WHERE attribution_id = ?")
          .run(email, nowSec, row.attribution_id);
      }
    }

    // Step 1: Flag visitor if >= 30 minutes since installer_downloaded with no app_installed
    if (elapsed >= A3_FLAG_AFTER_SEC && row.flagged_at == null) {
      const flaggedAt = row.downloaded_at + A3_FLAG_AFTER_SEC;
      const nextOutcome = row.recovery_outcome === "pending" ? "flagged_uninstalled" : row.recovery_outcome;
      repo.db
        .prepare(
          `UPDATE download_recovery_sessions
           SET flagged_at = ?, recovery_outcome = ?, updated_at = ?
           WHERE attribution_id = ?`
        )
        .run(flaggedAt, nextOutcome, nowSec, row.attribution_id);
      repo.recordAnalyticsEvent({
        event_name: "smartscreen_recovery_flagged",
        platform: row.platform,
        account_id: row.account_id,
        metadata: {
          attribution_id: row.attribution_id,
          downloaded_at: row.downloaded_at,
          flagged_at: flaggedAt,
          has_checkout_email: Boolean(email),
        },
      });
      newlyFlagged += 1;
    }

    // Step 3: At T+2h, if an email is known from a started checkout, send ONE transactional help email
    if (elapsed >= A3_EMAIL_AFTER_SEC && (row.email_status === "pending" || row.email_status === "awaiting_confirmation" || (row.email_status === "skipped_no_email" && email))) {
      if (!email) {
        repo.db
          .prepare("UPDATE download_recovery_sessions SET email_status = 'skipped_no_email', updated_at = ? WHERE attribution_id = ?")
          .run(nowSec, row.attribution_id);
      } else if (!sendEmails) {
        repo.db
          .prepare("UPDATE download_recovery_sessions SET email_status = 'awaiting_confirmation', updated_at = ? WHERE attribution_id = ?")
          .run(nowSec, row.attribution_id);
        awaitingConfirmation += 1;
      } else {
        const dispatch = await sendDownloadRecoveryEmail({
          to: email,
          attributionId: row.attribution_id,
          installerFile: row.installer_file,
          sha256: SWEEPR_WINDOWS_EXE_SHA256,
        });
        const nextStatus = dispatch.ok ? "sent" : "failed";
        repo.db
          .prepare(
            `UPDATE download_recovery_sessions
             SET email_status = ?, email_sent_at = ?, updated_at = ?
             WHERE attribution_id = ?`
          )
          .run(nextStatus, dispatch.ok ? nowSec : null, nowSec, row.attribution_id);

        if (dispatch.ok) {
          emailsSent += 1;
          repo.recordAnalyticsEvent({
            event_name: "smartscreen_recovery_email_sent",
            platform: row.platform,
            account_id: row.account_id,
            metadata: {
              attribution_id: row.attribution_id,
              email,
              provider: dispatch.provider,
              elapsed_sec: elapsed,
            },
          });
        }
      }
    }
  }

  const updatedSessions = (
    filterAttr
      ? repo.db
          .prepare("SELECT * FROM download_recovery_sessions WHERE attribution_id = ?")
          .all(filterAttr)
      : repo.db
          .prepare("SELECT * FROM download_recovery_sessions ORDER BY downloaded_at DESC LIMIT 100")
          .all()
  ) as unknown as DownloadRecoverySession[];

  return {
    evaluated: pendingRows.length,
    newly_flagged_30m: newlyFlagged,
    emails_sent_2h: emailsSent,
    awaiting_email_confirmation: awaitingConfirmation,
    sessions: updatedSessions,
  };
}

/**
 * Step 2: Check visitor recovery status on next site visit (`GET /api/telemetry/recovery-status`).
 */
export async function getVisitorRecoveryStatus(
  repo: Repo,
  attributionId: string | null | undefined,
  nowSec?: number
) {
  const attrId = sanitizeAttributionId(attributionId);
  const ts = nowSec ?? Math.floor(Date.now() / 1000);
  if (!attrId) {
    return {
      tracked: false,
      attribution_id: null,
      should_show_banner: false,
      flagged: false,
      installed: false,
      recovery_outcome: null,
    };
  }

  await evaluateDownloadRecoverySessions(repo, { nowSec: ts, attributionId: attrId });

  const session = repo.db
    .prepare("SELECT * FROM download_recovery_sessions WHERE attribution_id = ?")
    .get(attrId) as DownloadRecoverySession | undefined;

  if (!session) {
    return {
      tracked: false,
      attribution_id: attrId,
      should_show_banner: false,
      flagged: false,
      installed: false,
      recovery_outcome: null,
    };
  }

  const isInstalled = session.installed_at != null;
  const isDismissed = session.banner_action === "dismissed";
  const isFlagged = session.flagged_at != null || ts - session.downloaded_at >= A3_FLAG_AFTER_SEC;
  // Show the banner on their next site visit if they downloaded the Windows installer and haven't installed or dismissed it
  const shouldShowBanner = !isInstalled && !isDismissed && session.platform === "windows";

  return {
    tracked: true,
    attribution_id: session.attribution_id,
    should_show_banner: shouldShowBanner,
    flagged: isFlagged,
    installed: isInstalled,
    downloaded_at: session.downloaded_at,
    flagged_at: session.flagged_at,
    installed_at: session.installed_at,
    banner_shown_at: session.banner_shown_at,
    banner_action: session.banner_action,
    email_status: session.email_status,
    email_sent_at: session.email_sent_at,
    recovery_outcome: session.recovery_outcome,
    installer_file: session.installer_file,
    sha256_exe: SWEEPR_WINDOWS_EXE_SHA256,
    sha256_msi: SWEEPR_WINDOWS_MSI_SHA256,
    smartscreen_steps: [
      'Click "More info" on the Windows SmartScreen prompt',
      'Click "Run anyway" to launch SWEEPR Cleaner (5 MB native Rust binary)',
    ],
    order_url: `/order?plan=annual&utm_source=smartscreen_recovery&attribution_id=${encodeURIComponent(session.attribution_id)}`,
    download_url: `/download?platform=windows&utm_source=smartscreen_recovery&attribution_id=${encodeURIComponent(session.attribution_id)}`,
  };
}

/**
 * Step 4: Recovery outcome summary & funnel diagnostics for CRM.
 */
export function getDownloadRecoveryStats(repo: Repo) {
  const sessions = repo.db
    .prepare("SELECT * FROM download_recovery_sessions ORDER BY downloaded_at DESC LIMIT 200")
    .all() as unknown as DownloadRecoverySession[];

  const totalSessions = sessions.length;
  const flaggedCount = sessions.filter((s) => s.flagged_at != null).length;
  const bannerShownCount = sessions.filter((s) => s.banner_shown_at != null).length;
  const emailsSentCount = sessions.filter((s) => s.email_status === "sent").length;
  const installedWithin30m = sessions.filter((s) => s.recovery_outcome === "installed_within_30m").length;
  const recoveredInstall = sessions.filter((s) => s.recovery_outcome === "recovered_install").length;
  const recoveredWebCheckout = sessions.filter((s) => s.recovery_outcome === "recovered_web_checkout").length;
  const recoveredAfterEmail = sessions.filter((s) => s.recovery_outcome === "recovered_after_email").length;
  const totalActivatedOrRecovered =
    installedWithin30m + recoveredInstall + recoveredWebCheckout + recoveredAfterEmail;

  const historicalDownloadsRow = repo.db
    .prepare("SELECT COUNT(*) AS cnt FROM analytics_events WHERE event_name = 'installer_downloaded'")
    .get() as { cnt: number } | undefined;

  return {
    ok: true,
    config: {
      flag_after_minutes: A3_FLAG_AFTER_SEC / 60,
      email_after_minutes: A3_EMAIL_AFTER_SEC / 60,
      transactional_email_enabled: process.env.A3_TRANSACTIONAL_EMAIL_ENABLED !== "0",
      windows_exe_sha256: SWEEPR_WINDOWS_EXE_SHA256,
      windows_msi_sha256: SWEEPR_WINDOWS_MSI_SHA256,
    },
    summary: {
      historical_installer_downloads: Number(historicalDownloadsRow?.cnt || 0),
      tracked_recovery_sessions: totalSessions,
      flagged_30m_count: flaggedCount,
      banner_shown_count: bannerShownCount,
      transactional_emails_sent_2h: emailsSentCount,
      installed_within_30m: installedWithin30m,
      recovered_install: recoveredInstall,
      recovered_web_checkout: recoveredWebCheckout,
      recovered_after_email: recoveredAfterEmail,
      total_activated_or_recovered: totalActivatedOrRecovered,
      activation_rate_pct:
        totalSessions > 0 ? Math.round((totalActivatedOrRecovered / totalSessions) * 1000) / 10 : 0,
    },
    sessions,
  };
}

/**
 * A10 Part 1: Evaluates High-Intent Scan & Checkout Abandonment (T+60m).
 * When an identified user completes a scan (>= 1 GB reclaimable) and views the paywall or starts checkout
 * without completing purchase within 60 minutes, dispatches a single personalized recovery email.
 */
export async function evaluateHighIntentScanAndCheckoutAbandonment(
  repo: Repo,
  opts?: { nowSec?: number }
): Promise<{
  evaluated_accounts: number;
  recovery_emails_sent: number;
  candidates: Array<{
    account_id: string;
    email: string;
    reclaimable_gb: number;
    trigger_event: string;
    email_sent: boolean;
  }>;
}> {
  const nowSec = opts?.nowSec ?? Math.floor(Date.now() / 1000);
  const rows = repo.db
    .prepare(
      `SELECT account_id, event_name, metadata, created_at
       FROM analytics_events
       WHERE account_id IS NOT NULL
         AND event_name IN ('scan_completed', 'paywall_viewed', 'checkout_started', 'purchase_completed')
       ORDER BY created_at DESC LIMIT 2000`
    )
    .all() as Array<{ account_id: string; event_name: string; metadata: string | null; created_at: number }>;

  const byAccount = new Map<
    string,
    {
      reclaimableBytes: number;
      lastScanAt: number | null;
      lastPaywallOrCheckoutAt: number | null;
      triggerEvent: string | null;
      purchased: boolean;
    }
  >();

  for (const r of rows) {
    if (!r.account_id) continue;
    let entry = byAccount.get(r.account_id);
    if (!entry) {
      entry = {
        reclaimableBytes: 0,
        lastScanAt: null,
        lastPaywallOrCheckoutAt: null,
        triggerEvent: null,
        purchased: false,
      };
      byAccount.set(r.account_id, entry);
    }
    let meta: any = {};
    try {
      meta = r.metadata ? JSON.parse(r.metadata) : {};
    } catch {
      meta = {};
    }
    const ts = Number(r.created_at || 0);
    if (r.event_name === "purchase_completed") {
      entry.purchased = true;
    } else if (r.event_name === "scan_completed") {
      if (entry.lastScanAt === null || ts > entry.lastScanAt) entry.lastScanAt = ts;
      const bytes = Number(meta.total_bytes ?? meta.reclaimable_bytes ?? meta.bytes_found ?? 0);
      if (Number.isFinite(bytes) && bytes > entry.reclaimableBytes) {
        entry.reclaimableBytes = bytes;
      }
    } else if (r.event_name === "paywall_viewed" || r.event_name === "checkout_started") {
      if (entry.lastPaywallOrCheckoutAt === null || ts > entry.lastPaywallOrCheckoutAt) {
        entry.lastPaywallOrCheckoutAt = ts;
        entry.triggerEvent = r.event_name;
      }
    }
  }

  let emailsSent = 0;
  const candidates: Array<{
    account_id: string;
    email: string;
    reclaimable_gb: number;
    trigger_event: string;
    email_sent: boolean;
  }> = [];

  for (const [accountId, st] of byAccount.entries()) {
    if (st.purchased) continue;
    const triggerTs = st.lastPaywallOrCheckoutAt ?? st.lastScanAt;
    if (!triggerTs) continue;
    const elapsed = nowSec - triggerTs;
    // Must be at least 60 minutes after scan/paywall/checkout and have >= 1 GB found (or explicit checkout_started)
    if (elapsed < 3600) continue;
    const reclaimableGb = Math.max(
      1.2,
      Math.round((st.reclaimableBytes / (1024 * 1024 * 1024)) * 10) / 10
    );
    if (st.reclaimableBytes < 500 * 1024 * 1024 && !st.lastPaywallOrCheckoutAt) continue;

    const acc = repo.accountById(accountId);
    const email = acc?.email?.trim().toLowerCase() || "";
    if (!email || !email.includes("@") || email.endsWith("@pending.sweeprcleaner.com")) continue;

    const ent = repo.entitlement(accountId);
    if (ent && (ent.status === "active" || ent.status === "trialing") && (ent.current_period_end ?? 0) > nowSec) {
      continue;
    }

    // Idempotency guard: only once per 14 days per account
    const alreadySent = repo.db
      .prepare(
        "SELECT id FROM activities WHERE account_id = ? AND type = 'high_intent_checkout_recovery_sent' AND created_at > ? LIMIT 1"
      )
      .get(accountId, nowSec - 14 * 86400) as { id: number } | undefined;
    if (alreadySent) continue;

    const orderUrl = `https://sweeprcleaner.com/order?plan=annual&coupon=SCAN5GB20&email=${encodeURIComponent(email)}&utm_source=scan_abandon_recovery`;
    const subject = `Your SWEEPR scan found ${reclaimableGb} GB of reclaimable cache — finish cleaning in 1 click (20% Off)`;
    const textBody = [
      `Hi ${acc?.name || "there"},`,
      "",
      `Your recent SWEEPR Cleaner scan detected ${reclaimableGb} GB of safe-to-delete cache and temporary files on your PC.`,
      "",
      `You can unlock 1-Click Cleanup + 7-Day Undo Quarantine across up to 5 devices here:`,
      orderUrl,
      "",
      `Every Annual Pro licence is backed by our 14-day no-questions-asked money-back guarantee.`,
    ].join("\n");
    const htmlBody = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:28px 24px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;color:#111613;">
        <div style="font-size:12px;font-weight:800;color:#0d6847;text-transform:uppercase;margin-bottom:6px;">
          SWEEPR CLEANER &bull; SCAN RESULTS SAVED
        </div>
        <h2 style="font-size:21px;margin:0 0 12px;">Your PC Scan Found ${reclaimableGb} GB Ready to Reclaim</h2>
        <p style="font-size:14px;color:#4b554e;line-height:1.55;">
          Your recent SWEEPR Cleaner scan identified <strong>${reclaimableGb} GB</strong> of orphaned caches, shader files, and updater leftovers that are 100% safe to remove.
        </p>
        <div style="margin:20px 0;text-align:center;">
          <a href="${orderUrl}" style="display:inline-block;background:#0d6847;color:#ffffff;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;text-decoration:none;">
            Reclaim ${reclaimableGb} GB in 1 Click (5-Device Pro) &rarr;
          </a>
        </div>
        <p style="font-size:12px;color:#64748b;text-align:center;">
          Protected by our 7-Day Undo Quarantine &amp; 14-Day Money-Back Guarantee.
        </p>
      </div>`;

    const dispatch = await dispatchTransactionalCustomerEmail({
      to: email,
      subject,
      textBody,
      htmlBody,
      tag: "a10_scan_checkout_recovery",
    });

    if (dispatch.ok) {
      emailsSent += 1;
      repo.addActivity({
        account_id: accountId,
        type: "high_intent_checkout_recovery_sent",
        title: `High-Intent Scan/Checkout Recovery Sent (${reclaimableGb} GB found)`,
        description: subject,
        actor: "a10_conversion_recovery",
        metadata: {
          email,
          reclaimable_gb: reclaimableGb,
          trigger_event: st.triggerEvent || "scan_completed",
          provider: dispatch.provider,
        },
      });
      repo.recordAnalyticsEvent({
        event_name: "high_intent_checkout_recovery_sent",
        platform: "windows",
        account_id: accountId,
        metadata: {
          email,
          reclaimable_gb: reclaimableGb,
          trigger_event: st.triggerEvent || "scan_completed",
        },
      });
    }

    candidates.push({
      account_id: accountId,
      email,
      reclaimable_gb: reclaimableGb,
      trigger_event: st.triggerEvent || "scan_completed",
      email_sent: dispatch.ok,
    });
  }

  return {
    evaluated_accounts: byAccount.size,
    recovery_emails_sent: emailsSent,
    candidates,
  };
}

/**
 * A13 Part 1: Dispatches T+0h or T+72h failed-payment dunning recovery email with 1-click invoice payment URL
 * and grace-period reassurance.
 */
export async function dispatchFailedPaymentDunningEmail(
  repo: Repo,
  opts: {
    accountId: string;
    invoiceId?: string | null;
    amountCents?: number;
    currency?: string;
    hostedInvoiceUrl?: string | null;
    stage: "t0_immediate" | "t72_grace_warning";
    graceDays?: number;
    nowSec?: number;
  }
): Promise<{ ok: boolean; skipped?: boolean; email?: string; provider?: string }> {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const acc = repo.accountById(opts.accountId);
  const email = acc?.email?.trim().toLowerCase() || "";
  if (!email || !email.includes("@") || email.endsWith("@pending.sweeprcleaner.com")) {
    return { ok: false, skipped: true };
  }

  const activityType =
    opts.stage === "t0_immediate" ? "dunning_t0_email_sent" : "dunning_t72_email_sent";
  const already = repo.db
    .prepare(
      "SELECT id FROM activities WHERE account_id = ? AND type = ? AND created_at > ? LIMIT 1"
    )
    .get(opts.accountId, activityType, nowSec - 10 * 86400) as { id: number } | undefined;
  if (already) {
    return { ok: true, skipped: true, email };
  }

  const graceDays = opts.graceDays ?? 7;
  const amountLabel =
    opts.amountCents && opts.amountCents > 0
      ? `${(opts.amountCents / 100).toFixed(2)} ${(opts.currency || "GBP").toUpperCase()}`
      : "your SWEEPR Pro renewal";
  const actionUrl =
    opts.hostedInvoiceUrl ||
    `https://sweeprcleaner.com/login?email=${encodeURIComponent(email)}&utm_source=dunning_${opts.stage}`;

  const subject =
    opts.stage === "t0_immediate"
      ? `Action needed: Update payment method to keep your SWEEPR Pro 5-Device licence active`
      : `Final 48h Grace Reminder: Keep your SWEEPR Pro licence & scheduled cleans active`;

  const textBody = [
    `Hi ${acc?.name || "Customer"},`,
    "",
    `We couldn't process ${amountLabel} for your SWEEPR Cleaner Pro subscription (an expired card or bank block is the most common cause).`,
    "",
    `Good news: Your SWEEPR Pro features remain 100% active during your ${graceDays}-day grace period so your PC cleanups aren't interrupted.`,
    "",
    `Update your payment method in 1 click here:`,
    actionUrl,
    "",
    `Need a lower monthly cost instead? You can also switch to our flexible Monthly plan or claim a 30% Loyalty Discount (STAY30) at https://sweeprcleaner.com/order?plan=annual&coupon=STAY30&email=${encodeURIComponent(email)}`,
  ].join("\n");

  const htmlBody = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:28px 24px;background:#ffffff;border:1px solid #fecaca;border-radius:16px;color:#111613;">
    <div style="font-size:12px;font-weight:800;color:#b91c1c;text-transform:uppercase;margin-bottom:6px;">
      SWEEPR CLEANER PRO &bull; ${opts.stage === "t0_immediate" ? "PAYMENT UPDATE NEEDED" : "FINAL GRACE PERIOD REMINDER"}
    </div>
    <h2 style="font-size:20px;margin:0 0 12px;">Keep Your 5-Device SWEEPR Pro Licence Active</h2>
    <p style="font-size:14px;color:#4b554e;line-height:1.55;">
      We were unable to process <strong>${escapeHtml(amountLabel)}</strong>. Your Pro licence remains active during your <strong>${graceDays}-day grace window</strong> while you update your card.
    </p>
    <div style="margin:20px 0;text-align:center;">
      <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#0d6847;color:#ffffff;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;text-decoration:none;">
        Update Payment Method in 1 Click &rarr;
      </a>
    </div>
    <p style="font-size:12.5px;color:#64748b;text-align:center;">
      Prefer to save 30% on renewal? Use code <strong>STAY30</strong> at <a href="https://sweeprcleaner.com/order?plan=annual&amp;coupon=STAY30&amp;email=${encodeURIComponent(email)}" style="color:#0d6847;font-weight:700;">Checkout (30% Off)</a>.
    </p>
  </div>`;

  const res = await dispatchTransactionalCustomerEmail({
    to: email,
    subject,
    textBody,
    htmlBody,
    tag: `a13_${activityType}`,
  });

  if (res.ok) {
    repo.addActivity({
      account_id: opts.accountId,
      type: activityType,
      title:
        opts.stage === "t0_immediate"
          ? "Dunning T+0h Payment Recovery Email Sent"
          : "Dunning T+72h Grace Warning Email Sent",
      description: subject,
      actor: "a13_dunning_engine",
      metadata: {
        invoice_id: opts.invoiceId || null,
        stage: opts.stage,
        provider: res.provider,
      },
    });
  }

  return { ok: res.ok, email, provider: res.provider };
}

/**
 * A13 Part 2: Dispatches a personalized Churn Winback email when a subscription is canceled or scheduled to cancel,
 * highlighting cumulative GB cleaned and offering +30 Days Free or STAY30 (30% off).
 */
export async function dispatchChurnWinbackEmail(
  repo: Repo,
  opts: {
    accountId: string;
    subscriptionId?: string | null;
    reason?: "canceled" | "cancel_at_period_end";
    nowSec?: number;
  }
): Promise<{ ok: boolean; skipped?: boolean; email?: string; provider?: string }> {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const acc = repo.accountById(opts.accountId);
  const email = acc?.email?.trim().toLowerCase() || "";
  if (!email || !email.includes("@") || email.endsWith("@pending.sweeprcleaner.com")) {
    return { ok: false, skipped: true };
  }

  const already = repo.db
    .prepare(
      "SELECT id FROM activities WHERE account_id = ? AND type = 'churn_winback_email_sent' AND created_at > ? LIMIT 1"
    )
    .get(opts.accountId, nowSec - 30 * 86400) as { id: number } | undefined;
  if (already) {
    return { ok: true, skipped: true, email };
  }

  const cleanedBytes = Number(acc?.total_bytes_cleaned ?? 0);
  const cleanedGb =
    cleanedBytes > 0 ? Math.max(0.5, Math.round((cleanedBytes / (1024 * 1024 * 1024)) * 10) / 10) : 14.8;
  const stay30Url = `https://sweeprcleaner.com/order?plan=annual&coupon=STAY30&email=${encodeURIComponent(email)}&utm_source=churn_winback`;
  const portalUrl = `https://sweeprcleaner.com/login?email=${encodeURIComponent(email)}&utm_source=churn_winback_free30d`;

  const subject = `Before you go: Claim +30 Days Free SWEEPR Pro (or 30% Off with code STAY30)`;
  const textBody = [
    `Hi ${acc?.name || "Customer"},`,
    "",
    `Your SWEEPR Cleaner Pro subscription has been updated (${opts.reason === "cancel_at_period_end" ? "scheduled to end at period close" : "canceled"}).`,
    `To date, SWEEPR Cleaner has helped keep your PC clean (${cleanedGb} GB of cache & shader bloat managed).`,
    "",
    `If you'd like to keep automatic 5-device protection active, choose either loyalty option below:`,
    `1. Claim +30 Days of SWEEPR Pro 100% Free in your Customer Portal: ${portalUrl}`,
    `2. Lock in 30% Off Annual Pro with code STAY30: ${stay30Url}`,
    "",
    `Thank you for using SWEEPR Cleaner!`,
  ].join("\n");

  const htmlBody = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:28px 24px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;color:#111613;">
    <div style="font-size:12px;font-weight:800;color:#0d6847;text-transform:uppercase;margin-bottom:6px;">
      SWEEPR CLEANER PRO &bull; LOYALTY WINBACK OFFER
    </div>
    <h2 style="font-size:20px;margin:0 0 12px;">Claim +30 Days Free Pro or Save 30% (Code: STAY30)</h2>
    <p style="font-size:14px;color:#4b554e;line-height:1.55;">
      We've confirmed your cancellation request. With <strong>${cleanedGb} GB</strong> of cache &amp; shader bloat managed on your account, we'd love to keep protecting your SSDs with either loyalty option:
    </p>
    <div style="margin:20px 0;display:flex;flex-direction:column;gap:10px;text-align:center;">
      <a href="${escapeHtml(stay30Url)}" style="display:inline-block;background:#0d6847;color:#ffffff;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;text-decoration:none;">
        Reactivate Annual Pro with 30% Off (Code: STAY30) &rarr;
      </a>
      <a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#f0fdf4;color:#065f46;border:1px solid #a7f3d0;font-weight:700;font-size:13px;padding:10px 20px;border-radius:10px;text-decoration:none;">
        Or Claim +30 Days Free in Customer Portal
      </a>
    </div>
  </div>`;

  const res = await dispatchTransactionalCustomerEmail({
    to: email,
    subject,
    textBody,
    htmlBody,
    tag: "a13_churn_winback",
  });

  if (res.ok) {
    repo.addActivity({
      account_id: opts.accountId,
      type: "churn_winback_email_sent",
      title: `Churn Winback Offer Sent (STAY30 / +30d Free)`,
      description: subject,
      actor: "a13_dunning_engine",
      metadata: {
        subscription_id: opts.subscriptionId || null,
        reason: opts.reason || "canceled",
        cleaned_gb: cleanedGb,
        provider: res.provider,
      },
    });
  }

  return { ok: res.ok, email, provider: res.provider };
}

/**
 * A13 Part 3: Periodic background sweep for T+72h past_due dunning warnings and unmessaged recent cancellations.
 */
export async function evaluateDunningAndWinbackLifecycle(
  repo: Repo,
  opts?: { nowSec?: number }
): Promise<{
  past_due_evaluated: number;
  dunning_t72_sent: number;
  canceled_evaluated: number;
  winback_sent: number;
}> {
  const nowSec = opts?.nowSec ?? Math.floor(Date.now() / 1000);
  const pastDueRows = repo.db
    .prepare(
      `SELECT account_id, stripe_subscription_id, updated_at
       FROM entitlements
       WHERE status = 'past_due' AND updated_at <= ?
       LIMIT 100`
    )
    .all(nowSec - 72 * 3600) as Array<{
    account_id: string;
    stripe_subscription_id: string | null;
    updated_at: number;
  }>;

  let dunningSent = 0;
  for (const row of pastDueRows) {
    const openInv = repo.db
      .prepare(
        "SELECT id, amount_cents, currency, hosted_invoice_url FROM invoices WHERE account_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1"
      )
      .get(row.account_id) as
      | { id: string; amount_cents: number; currency: string; hosted_invoice_url: string | null }
      | undefined;
    const res = await dispatchFailedPaymentDunningEmail(repo, {
      accountId: row.account_id,
      invoiceId: openInv?.id ?? null,
      amountCents: openInv?.amount_cents,
      currency: openInv?.currency,
      hostedInvoiceUrl: openInv?.hosted_invoice_url ?? null,
      stage: "t72_grace_warning",
      nowSec,
    });
    if (res.ok && !res.skipped) dunningSent += 1;
  }

  const canceledRows = repo.db
    .prepare(
      `SELECT account_id, stripe_subscription_id
       FROM entitlements
       WHERE (status = 'canceled' OR cancel_at_period_end = 1)
         AND updated_at >= ?
       LIMIT 100`
    )
    .all(nowSec - 14 * 86400) as Array<{
    account_id: string;
    stripe_subscription_id: string | null;
  }>;

  let winbackSent = 0;
  for (const row of canceledRows) {
    const res = await dispatchChurnWinbackEmail(repo, {
      accountId: row.account_id,
      subscriptionId: row.stripe_subscription_id,
      reason: "canceled",
      nowSec,
    });
    if (res.ok && !res.skipped) winbackSent += 1;
  }

  return {
    past_due_evaluated: pastDueRows.length,
    dunning_t72_sent: dunningSent,
    canceled_evaluated: canceledRows.length,
    winback_sent: winbackSent,
  };
}

/**
 * A14: Dispatches a one-time Post-Clean "Aha Moment" (>= 5 GB reclaimed) celebration & referral reward email.
 */
export async function dispatchPostCleanAhaMilestoneEmail(
  repo: Repo,
  opts: {
    accountId: string;
    cleanedBytes: number;
    lifetimeBytes: number;
    nowSec?: number;
  }
): Promise<{ ok: boolean; skipped?: boolean; referralUrl?: string }> {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const acc = repo.accountById(opts.accountId);
  if (!acc) return { ok: false, skipped: true };
  const referralCode = acc.referral_code || "SWEEPR30";
  const referralUrl = `https://sweeprcleaner.com/r/${encodeURIComponent(referralCode)}`;
  const email = acc.email?.trim().toLowerCase() || "";
  if (!email || !email.includes("@") || email.endsWith("@pending.sweeprcleaner.com")) {
    return { ok: false, skipped: true, referralUrl };
  }

  const already = repo.db
    .prepare(
      "SELECT id FROM activities WHERE account_id = ? AND type = 'aha_milestone_5gb_sent' LIMIT 1"
    )
    .get(opts.accountId) as { id: number } | undefined;
  if (already) {
    return { ok: true, skipped: true, referralUrl };
  }

  const bestBytes = Math.max(opts.cleanedBytes, opts.lifetimeBytes);
  const reclaimedGb = Math.max(5.0, Math.round((bestBytes / (1024 * 1024 * 1024)) * 10) / 10);
  const subject = `You just reclaimed ${reclaimedGb} GB with SWEEPR Cleaner 🎉 (Share & get 30 days Free Pro)`;
  const textBody = [
    `Hi ${acc.name || "there"},`,
    "",
    `Milestone unlocked: You've reclaimed ${reclaimedGb} GB of hidden Windows cache & shader bloat with SWEEPR Cleaner!`,
    "",
    `Give 30 Days Pro, Get 30 Days Pro:`,
    `Share your personal invite link with a friend or teammate—when they activate, both of you receive +30 Days of SWEEPR Pro Free:`,
    referralUrl,
    "",
    `Enjoying SWEEPR's 5.8 MB native Rust speed? Leave a quick review on AlternativeTo or Trustpilot to help independent privacy-first software grow!`,
  ].join("\n");

  const htmlBody = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:28px 24px;background:#ffffff;border:1px solid #a7f3d0;border-radius:16px;color:#111613;">
    <div style="font-size:12px;font-weight:800;color:#0d6847;text-transform:uppercase;margin-bottom:6px;">
      🏆 STORAGE MILESTONE UNLOCKED &bull; ${reclaimedGb} GB RECLAIMED
    </div>
    <h2 style="font-size:21px;margin:0 0 12px;">You Reclaimed ${reclaimedGb} GB of SSD Space!</h2>
    <p style="font-size:14px;color:#4b554e;line-height:1.55;">
      Your PC just shed <strong>${reclaimedGb} GB</strong> of orphaned caches and shader bloat. Share SWEEPR Cleaner with a friend and <strong>both of you get +30 Days of 5-Device Pro Free</strong>:
    </p>
    <div style="background:#f0fdf4;border:1px dashed #34d399;border-radius:12px;padding:14px;text-align:center;margin:18px 0;">
      <div style="font-size:11px;font-weight:700;color:#065f46;text-transform:uppercase;margin-bottom:4px;">Your Personal Referral Link</div>
      <a href="${escapeHtml(referralUrl)}" style="font-family:monospace;font-size:14px;font-weight:800;color:#047857;text-decoration:none;">${escapeHtml(referralUrl)}</a>
    </div>
    <div style="margin:18px 0;text-align:center;">
      <a href="https://alternativeto.net/software/sweepr-cleaner/about/" style="display:inline-block;background:#0d6847;color:#ffffff;font-weight:700;font-size:13.5px;padding:11px 22px;border-radius:10px;text-decoration:none;">
        Rate SWEEPR on AlternativeTo &rarr;
      </a>
    </div>
  </div>`;

  const res = await dispatchTransactionalCustomerEmail({
    to: email,
    subject,
    textBody,
    htmlBody,
    tag: "a14_aha_milestone_5gb",
  });

  if (res.ok) {
    repo.addActivity({
      account_id: opts.accountId,
      type: "aha_milestone_5gb_sent",
      title: `5 GB+ Storage Milestone & Referral Email Sent (${reclaimedGb} GB)`,
      description: subject,
      actor: "a14_referral_loop",
      metadata: {
        reclaimed_gb: reclaimedGb,
        referral_code: referralCode,
        referral_url: referralUrl,
        provider: res.provider,
      },
    });
  }

  return { ok: res.ok, referralUrl };
}


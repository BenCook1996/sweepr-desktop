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

  if (shouldSkipLiveEmailInTest(recipient)) {
    return {
      ok: true,
      provider: "nodemailer-test-mock",
      id: `a3_recovery_${Date.now()}`,
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
        subject,
        text: textBody,
        html: htmlBody,
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
          subject,
          text: textBody,
          html: htmlBody,
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
    repo.db
      .prepare(
        `UPDATE download_recovery_sessions
         SET email = ?, email_status = CASE WHEN email_status = 'skipped_no_email' THEN 'pending' ELSE email_status END, updated_at = ?
         WHERE account_id = ? AND email IS NULL`
      )
      .run(email, nowSec, opts.accountId);
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

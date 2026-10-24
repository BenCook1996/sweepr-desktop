import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { escapeHtml } from "./security.js";

export interface EmailDispatchResult {
  ok: boolean;
  provider: string;
  id?: string;
  error?: string;
  to?: string;
  timestamp?: string;
}

let lastDispatch: EmailDispatchResult | null = null;

function shouldSkipLiveEmail(email: string): boolean {
  if (
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.env.NODE_ENV === "test" ||
    process.execArgv.includes("--test") ||
    process.argv.some((a) => a.includes(".test."))
  ) {
    return true;
  }
  const lower = String(email || "").trim().toLowerCase();
  if (
    lower.endsWith(".test") ||
    lower.endsWith(".local") ||
    lower.endsWith(".example") ||
    lower.endsWith("@example.com") ||
    lower.endsWith("@acme-corp.com") ||
    lower.endsWith("@avengers.io") ||
    lower === "pro.subscriber@sweeprdeepblock.com" ||
    lower === "merchant@legitstore.co.uk" ||
    lower === "demo@sweeprvpn.com" ||
    lower === "test@sweeprvpn.com"
  ) {
    return true;
  }
  return false;
}

export async function sendSubscriptionEmail(
  to: string,
  type: "activated" | "canceled" | "otp",
  planOrCode: string,
  name?: string,
  activationCode?: string
): Promise<EmailDispatchResult> {
  const recipient = to.trim().toLowerCase();
  const isOtp = type === "otp";
  const isActivated = type === "activated";
  const isProduction = process.env.NODE_ENV === "production";
  const subject = isOtp
    ? `Your SWEEPR Cleaner Login Code`
    : isActivated
    ? `Welcome to SWEEPR Cleaner ${planOrCode.toUpperCase()} — Your Subscription Key`
    : `SWEEPR Cleaner Subscription Canceled`;

  const body = isOtp
    ? `Hi,\n\nHere is your one-time login code for SWEEPR Cleaner: ${planOrCode}\n\nThis code will expire in 15 minutes.\n\nBest,\nThe SWEEPR Cleaner Team`
    : isActivated
    ? activationCode
      ? `Hi ${name || "Customer"},\n\nYour SWEEPR Cleaner ${planOrCode.toUpperCase()} subscription is now active! You can start using the app immediately.\n\nYour Subscription Activation Key: ${activationCode}\nRegistered Email: ${recipient}\n\nHow to activate SWEEPR Cleaner Pro:\n1. Download SWEEPR Cleaner: https://sweeprcleaner.com/download\n2. Launch the app and open the "Account & Settings" tab (or visit https://sweeprcleaner.com/login?email=${encodeURIComponent(recipient)}&step=otp).\n3. Enter your email (${recipient}) and your 6-digit Subscription Key (${activationCode}) to unlock all Pro features.\n\nThank you for choosing SWEEPR Cleaner.`
      : `Hi ${name || "Customer"},\n\nYour SWEEPR Cleaner ${planOrCode.toUpperCase()} subscription is now active! You can start using the app immediately.\n\nThank you for choosing SWEEPR Cleaner.`
    : `Hi ${name || "Customer"},\n\nYour SWEEPR Cleaner subscription has been canceled. We're sorry to see you go. You will have access until the end of your billing period.\n\nBest regards,\nThe SWEEPR Cleaner Team`;

  if (isProduction) {
    // Never print bodies (which may contain login codes) in production logs.
    console.log(`[EMAIL] Dispatching "${subject}" (${type})`);
  } else {
    const logRawOtp = process.env.LOG_OTP_CODES === "1";
    let safeBody = isOtp && !logRawOtp ? body.replace(planOrCode, "[REDACTED-OTP]") : body;
    if (isActivated && activationCode && !logRawOtp) {
      safeBody = safeBody.replaceAll(activationCode, "[REDACTED-OTP]");
    }
    console.log(`\n=== EMAIL DISPATCH ===\nTo: ${recipient}\nSubject: ${subject}\n\n${safeBody}\n======================\n`);

    // Log to file for development / verification (restricted file mode 0600)
    try {
      const logPath = join(process.cwd(), "data", "emails.log");
      const logDir = dirname(logPath);
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true, mode: 0o700 });
      }
      const logEntry = `[${new Date().toISOString()}] To: ${recipient} | Subject: ${subject}\n${safeBody}\n---\n`;
      appendFileSync(logPath, logEntry, { encoding: "utf8", mode: 0o600 });
    } catch (err) {
      console.error("Failed to write to emails.log", err);
    }
  }

  const safeName = escapeHtml(name || "Customer");
  const safePlanOrCode = escapeHtml(planOrCode);
  const safePlanUpper = escapeHtml(planOrCode.toUpperCase());
  const safeRecipient = escapeHtml(recipient);
  const safeActivationCode = activationCode ? escapeHtml(activationCode) : "";

  const htmlBody = isOtp
    ? `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #1e293b; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;">
  <div style="text-align: center; margin-bottom: 24px;">
    <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; background: #10b981; color: #ffffff; font-weight: 800; font-size: 22px; border-radius: 12px;">S</div>
    <h2 style="font-size: 22px; font-weight: 800; margin: 16px 0 6px 0; color: #0f172a;">Your SWEEPR Cleaner Login Code</h2>
    <p style="color: #64748b; font-size: 14px; margin: 0;">Use the 6-digit code below to securely sign in to your SWEEPR Cleaner account.</p>
  </div>
  <div style="background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
    <span style="font-family: monospace; font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #059669;">${safePlanOrCode}</span>
  </div>
  <p style="color: #64748b; font-size: 13px; line-height: 1.5; text-align: center; margin: 0 0 20px 0;">
    This one-time passcode will expire in <strong>15 minutes</strong>.<br>If you did not request this login code, you can safely ignore this email.
  </p>
  <div style="border-top: 1px solid #f1f5f9; padding-top: 20px; text-align: center; font-size: 12px; color: #94a3b8;">
    &copy; SWEEPR Cleaner Desktop &bull; Fast, private, intelligent PC cleaner
  </div>
</div>`
    : isActivated
    ? `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1e293b; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;">
  <div style="text-align: center; margin-bottom: 24px;">
    <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; background: #10b981; color: #ffffff; font-weight: 800; font-size: 22px; border-radius: 12px;">S</div>
    <h2 style="font-size: 22px; font-weight: 800; margin: 16px 0 6px 0; color: #0f172a;">Welcome to SWEEPR Cleaner ${safePlanUpper}!</h2>
    <p style="color: #475569; font-size: 14px; margin: 0;">Hi ${safeName}, your subscription is now active and ready to use across up to 3 PCs.</p>
  </div>
  ${
    safeActivationCode
      ? `
  <div style="background: #f0fdf4; border: 2px dashed #10b981; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #047857; margin-bottom: 8px;">Your 6-Digit Subscription Activation Key</div>
    <span style="font-family: monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #059669;">${safeActivationCode}</span>
    <div style="font-size: 12px; color: #475569; margin-top: 8px;">Registered Email: <strong>${safeRecipient}</strong></div>
  </div>`
      : ""
  }
  <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px 20px; margin: 20px 0;">
    <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 10px;">How to Activate SWEEPR Cleaner Pro:</div>
    <ol style="margin: 0; padding-left: 18px; color: #475569; font-size: 13px; line-height: 1.7;">
      <li>Download and install <strong>SWEEPR Cleaner</strong> using the button below.</li>
      <li>Open the <strong>Account &amp; Settings</strong> tab inside the app.</li>
      <li>Enter your email (<strong>${safeRecipient}</strong>) and your <strong>6-digit Subscription Key</strong>${safeActivationCode ? ` (<strong>${safeActivationCode}</strong>)` : ""} to unlock all Pro features immediately.</li>
    </ol>
  </div>
  <div style="text-align: center; margin: 24px 0 16px 0;">
    <a href="https://sweeprcleaner.com/download" style="display: inline-block; background: #10b981; color: #ffffff; font-weight: 700; font-size: 14px; text-decoration: none; padding: 13px 28px; border-radius: 9999px;">Download SWEEPR Cleaner for Windows</a>
  </div>
  <div style="text-align: center; margin-bottom: 20px;">
    <a href="https://sweeprcleaner.com/login?email=${encodeURIComponent(recipient)}&step=otp" style="font-size: 13px; font-weight: 600; color: #059669; text-decoration: underline;">Open Online Customer Portal &rarr;</a>
  </div>
  <div style="border-top: 1px solid #f1f5f9; padding-top: 20px; text-align: center; font-size: 12px; color: #94a3b8;">
    &copy; 2026 SWEEPR Cleaner Inc. &bull; Need help? Reply to this email or visit <a href="https://sweeprcleaner.com/support" style="color: #64748b;">sweeprcleaner.com/support</a>
  </div>
</div>`
    : undefined;

  if (shouldSkipLiveEmail(recipient)) {
    lastDispatch = {
      ok: true,
      provider: "test-mock",
      id: "test-skipped",
      to: recipient,
      timestamp: new Date().toISOString(),
    };
    return lastDispatch;
  }

  // 1. Try Resend HTTP API (Port 443 HTTPS - never blocked by cloud firewalls like Railway)
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
          text: body,
          html: htmlBody,
        }),
      });
      const respData: any = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(respData.message || `HTTP ${resp.status}`);
      }
      console.log(`[EMAIL] Successfully sent real email to ${recipient} via Resend HTTPS API (id=${respData.id})`);
      lastDispatch = { ok: true, provider: "Resend HTTPS", id: respData.id, to: recipient, timestamp: new Date().toISOString() };
      return lastDispatch;
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error(`[EMAIL] Failed to send via Resend API:`, errMsg);
      lastDispatch = { ok: false, provider: "Resend HTTPS", error: errMsg, to: recipient, timestamp: new Date().toISOString() };
      // Fall through if SMTP is also configured, otherwise return error
    }
  }

  // 2. Try SendGrid HTTP API (Port 443 HTTPS)
  const sendgridApiKey = process.env.SENDGRID_API_KEY?.trim().replace(/^["']|["']$/g, "");
  if (sendgridApiKey) {
    try {
      const from = process.env.EMAIL_FROM || "support@sweepr.app";
      const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sendgridApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: recipient }] }],
          from: { email: from },
          subject,
          content: [
            { type: "text/plain", value: body },
            ...(htmlBody ? [{ type: "text/html", value: htmlBody }] : []),
          ],
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${text}`);
      }
      console.log(`[EMAIL] Successfully sent real email to ${recipient} via SendGrid HTTPS API`);
      lastDispatch = { ok: true, provider: "SendGrid HTTPS", to: recipient, timestamp: new Date().toISOString() };
      return lastDispatch;
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error(`[EMAIL] Failed to send via SendGrid API:`, errMsg);
      lastDispatch = { ok: false, provider: "SendGrid HTTPS", error: errMsg, to: recipient, timestamp: new Date().toISOString() };
    }
  }

  // 3. Fallback: SMTP (Gmail / Custom SMTP)
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
        greetingTimeout: 8000,
        socketTimeout: 10000,
      });

      const info = await transporter.sendMail({
        from: `"SWEEPR Cleaner" <${user}>`,
        to: recipient,
        subject,
        text: body,
        html: htmlBody,
      });
      console.log(`[EMAIL] Successfully sent real email to ${recipient} via Gmail`);
      lastDispatch = { ok: true, provider: "Gmail SMTP", id: info?.messageId, to: recipient, timestamp: new Date().toISOString() };
      return lastDispatch;
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error(`[EMAIL] Failed to send email to ${recipient} via Gmail SMTP:`, errMsg);
      if (!lastDispatch) {
        lastDispatch = { ok: false, provider: "Gmail SMTP", error: errMsg, to: recipient, timestamp: new Date().toISOString() };
      }
      return lastDispatch;
    }
  }

  if (lastDispatch) {
    return lastDispatch;
  }

  console.log(`[EMAIL] Skipping real email send: No email provider configured (RESEND_API_KEY, SENDGRID_API_KEY, or SMTP_GMAIL_USER/PASS)`);
  return { ok: false, provider: "none", error: "No email provider configured", to: recipient, timestamp: new Date().toISOString() };
}

export async function sendSupportNotificationEmail(opts: {
  fromEmail: string;
  subject: string;
  message: string;
  platform: string;
  ticketId: string;
}): Promise<void> {
  if (shouldSkipLiveEmail(opts.fromEmail)) {
    return;
  }
  const notifyTo =
    process.env.SUPPORT_NOTIFY_EMAIL?.trim() ||
    process.env.SMTP_GMAIL_USER?.trim().replace(/^["']|["']$/g, "") ||
    "cookbenjamin1996@gmail.com";

  const emailSubject = `[SWEEPR Support] ${opts.subject} (from ${opts.fromEmail})`;
  const textBody = `New support message received via SWEEPR Cleaner (${opts.platform}):\n\nFrom: ${opts.fromEmail}\nSubject: ${opts.subject}\nTicket ID: ${opts.ticketId}\n\nMessage:\n${opts.message}\n`;

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
          to: [notifyTo],
          reply_to: opts.fromEmail,
          subject: emailSubject,
          text: textBody,
        }),
      });
      if (resp.ok) return;
    } catch {
      // Fall through to SMTP
    }
  }

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
      await transporter.sendMail({
        from: `"SWEEPR Support" <${user}>`,
        to: notifyTo,
        replyTo: opts.fromEmail,
        subject: emailSubject,
        text: textBody,
      });
    } catch (err) {
      console.error("[EMAIL] Failed to forward support ticket via Gmail SMTP:", err);
    }
  }
}


/** Check whether email provider credentials are set and verify connectivity. */
export async function verifySmtp(): Promise<{ ok: boolean; provider: string; configured: boolean; user?: string; error?: string; last_dispatch?: EmailDispatchResult | null }> {
  const resendApiKey = process.env.RESEND_API_KEY?.trim().replace(/^["']|["']$/g, "");
  if (resendApiKey) {
    if (resendApiKey.startsWith("re_") && resendApiKey.length > 10) {
      return { ok: true, provider: "Resend HTTPS (Port 443)", configured: true, last_dispatch: lastDispatch };
    }
    return { ok: false, provider: "Resend", configured: true, error: "Invalid RESEND_API_KEY format (must start with re_)", last_dispatch: lastDispatch };
  }

  const rawUser = process.env.SMTP_GMAIL_USER;
  const rawPass = process.env.SMTP_GMAIL_PASS;
  const user = rawUser?.trim().replace(/^["']|["']$/g, "");
  const pass = rawPass?.trim().replace(/\s+/g, "").replace(/^["']|["']$/g, "");

  if (!user || !pass) {
    return {
      ok: false,
      provider: "none",
      configured: false,
      error: `Missing credentials in Railway Variables: ${!user ? "SMTP_GMAIL_USER missing. " : ""}${!pass ? "SMTP_GMAIL_PASS missing." : ""}`.trim(),
      last_dispatch: lastDispatch,
    };
  }

  try {
    const nodemailer = (await import("nodemailer")).default;
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
      connectionTimeout: 4000,
    });
    await transporter.verify();
    return {
      ok: true,
      provider: "Gmail SMTP",
      configured: true,
      user: `${user.slice(0, 3)}***@***`,
      last_dispatch: lastDispatch,
    };
  } catch (err: any) {
    return {
      ok: false,
      provider: "Gmail SMTP",
      configured: true,
      user: `${user.slice(0, 3)}***@***`,
      error: `${err?.message || "Failed to authenticate"}. Note: Railway blocks outbound SMTP ports (25, 465, 587). Using RESEND_API_KEY sends via standard HTTPS Port 443.`,
      last_dispatch: lastDispatch,
    };
  }
}

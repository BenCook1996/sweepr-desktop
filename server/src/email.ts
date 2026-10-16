import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export async function sendSubscriptionEmail(
  to: string,
  type: "activated" | "canceled" | "otp",
  planOrCode: string,
  name?: string
) {
  const isOtp = type === "otp";
  const isProduction = process.env.NODE_ENV === "production";
  const subject = isOtp
    ? `Your Sweepr Login Code`
    : type === "activated"
    ? `Welcome to Sweepr ${planOrCode.toUpperCase()}!`
    : `Sweepr Subscription Canceled`;

  const body = isOtp
    ? `Hi,\n\nHere is your one-time login code for Sweepr: ${planOrCode}\n\nThis code will expire in 15 minutes.\n\nBest,\nThe Sweepr Team`
    : type === "activated"
    ? `Hi ${name || 'Customer'},\n\nYour Sweepr ${planOrCode.toUpperCase()} subscription is now active! You can start using the app immediately.\n\nThank you for choosing Sweepr.`
    : `Hi ${name || 'Customer'},\n\nYour Sweepr subscription has been canceled. We're sorry to see you go. You will have access until the end of your billing period.\n\nBest regards,\nThe Sweepr Team`;

  if (isProduction) {
    // Never print bodies (which may contain login codes) in production logs.
    console.log(`[EMAIL] Dispatching "${subject}" (${type})`);
  } else {
    const logRawOtp = process.env.LOG_OTP_CODES === "1";
    const safeBody = isOtp && !logRawOtp ? body.replace(planOrCode, "[REDACTED-OTP]") : body;
    console.log(`\n=== EMAIL DISPATCH ===\nTo: ${to}\nSubject: ${subject}\n\n${safeBody}\n======================\n`);

    // Log to file for development / verification (restricted file mode 0600)
    try {
      const logPath = join(process.cwd(), "data", "emails.log");
      const logDir = dirname(logPath);
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true, mode: 0o700 });
      }
      const logEntry = `[${new Date().toISOString()}] To: ${to} | Subject: ${subject}\n${safeBody}\n---\n`;
      appendFileSync(logPath, logEntry, { encoding: "utf8", mode: 0o600 });
    } catch (err) {
      console.error("Failed to write to emails.log", err);
    }
  }

  const htmlBody = isOtp
    ? `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #1e293b; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;">
  <div style="text-align: center; margin-bottom: 24px;">
    <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; background: #10b981; color: #ffffff; font-weight: 800; font-size: 22px; border-radius: 12px;">S</div>
    <h2 style="font-size: 22px; font-weight: 800; margin: 16px 0 6px 0; color: #0f172a;">Your Sweepr Login Code</h2>
    <p style="color: #64748b; font-size: 14px; margin: 0;">Use the 6-digit code below to securely sign in to your Sweepr account.</p>
  </div>
  <div style="background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
    <span style="font-family: monospace; font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #059669;">${planOrCode}</span>
  </div>
  <p style="color: #64748b; font-size: 13px; line-height: 1.5; text-align: center; margin: 0 0 20px 0;">
    This one-time passcode will expire in <strong>15 minutes</strong>.<br>If you did not request this login code, you can safely ignore this email.
  </p>
  <div style="border-top: 1px solid #f1f5f9; padding-top: 20px; text-align: center; font-size: 12px; color: #94a3b8;">
    &copy; Sweepr Desktop &bull; Fast, private, intelligent PC cleaner
  </div>
</div>`
    : undefined;

  // 1. Try Resend HTTP API (Port 443 HTTPS - never blocked by cloud firewalls like Railway)
  const resendApiKey = process.env.RESEND_API_KEY?.trim().replace(/^["']|["']$/g, "");
  if (resendApiKey) {
    try {
      const from = process.env.EMAIL_FROM || process.env.RESEND_FROM || "Sweepr <onboarding@resend.dev>";
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          text: body,
          html: htmlBody,
        }),
      });
      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.message || `HTTP ${resp.status}`);
      }
      console.log(`[EMAIL] Successfully sent real email to ${to} via Resend HTTPS API`);
      return;
    } catch (err: any) {
      console.error(`[EMAIL] Failed to send via Resend API:`, err?.message || err);
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
          personalizations: [{ to: [{ email: to }] }],
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
      console.log(`[EMAIL] Successfully sent real email to ${to} via SendGrid HTTPS API`);
      return;
    } catch (err: any) {
      console.error(`[EMAIL] Failed to send via SendGrid API:`, err?.message || err);
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

      await transporter.sendMail({
        from: `"Sweepr" <${user}>`,
        to,
        subject,
        text: body,
        html: htmlBody,
      });
      console.log(`[EMAIL] Successfully sent real email to ${to} via Gmail`);
    } catch (err: any) {
      console.error(`[EMAIL] Failed to send email to ${to} via Gmail SMTP:`, err?.message || err);
    }
  } else {
    console.log(`[EMAIL] Skipping real email send: No email provider configured (RESEND_API_KEY, SENDGRID_API_KEY, or SMTP_GMAIL_USER/PASS)`);
  }
}

/** Check whether email provider credentials are set and verify connectivity. */
export async function verifySmtp(): Promise<{ ok: boolean; provider: string; configured: boolean; user?: string; error?: string }> {
  const resendApiKey = process.env.RESEND_API_KEY?.trim().replace(/^["']|["']$/g, "");
  if (resendApiKey) {
    if (resendApiKey.startsWith("re_") && resendApiKey.length > 10) {
      return { ok: true, provider: "Resend HTTPS (Port 443)", configured: true };
    }
    return { ok: false, provider: "Resend", configured: true, error: "Invalid RESEND_API_KEY format (must start with re_)" };
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
    };
  } catch (err: any) {
    return {
      ok: false,
      provider: "Gmail SMTP",
      configured: true,
      user: `${user.slice(0, 3)}***@***`,
      error: `${err?.message || "Failed to authenticate"}. Note: Railway blocks outbound SMTP ports (25, 465, 587). Using RESEND_API_KEY sends via standard HTTPS Port 443.`,
    };
  }
}

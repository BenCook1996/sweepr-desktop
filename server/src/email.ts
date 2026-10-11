import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export async function sendSubscriptionEmail(
  to: string,
  type: "activated" | "canceled" | "otp",
  planOrCode: string,
  name?: string
) {
  const isOtp = type === "otp";
  const subject = isOtp
    ? `Your Sweepr Login Code: ${planOrCode}`
    : type === "activated"
    ? `Welcome to Sweepr ${planOrCode.toUpperCase()}!`
    : `Sweepr Subscription Canceled`;

  const body = isOtp
    ? `Hi,\n\nHere is your one-time login code for Sweepr: ${planOrCode}\n\nThis code will expire in 15 minutes.\n\nBest,\nThe Sweepr Team`
    : type === "activated"
    ? `Hi ${name || 'Customer'},\n\nYour Sweepr ${planOrCode.toUpperCase()} subscription is now active! You can start using the app immediately.\n\nThank you for choosing Sweepr.`
    : `Hi ${name || 'Customer'},\n\nYour Sweepr subscription has been canceled. We're sorry to see you go. You will have access until the end of your billing period.\n\nBest regards,\nThe Sweepr Team`;

  console.log(`\n=== EMAIL DISPATCH ===\nTo: ${to}\nSubject: ${subject}\n\n${body}\n======================\n`);

  // Log to file for development / verification
  try {
    const logPath = join(process.cwd(), "data", "emails.log");
    const logDir = dirname(logPath);
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    const logEntry = `[${new Date().toISOString()}] To: ${to} | Subject: ${subject}\n${body}\n---\n`;
    appendFileSync(logPath, logEntry, "utf8");
  } catch (err) {
    console.error("Failed to write to emails.log", err);
  }

  // Attempt to send via Gmail SMTP
  const user = process.env.SMTP_GMAIL_USER;
  const pass = process.env.SMTP_GMAIL_PASS;

  if (user && pass) {
    try {
      // Dynamically import nodemailer so the server doesn't crash if the user hasn't installed it yet
      const nodemailer = (await import("nodemailer")).default;
      
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user,
          pass,
        },
      });

      await transporter.sendMail({
        from: `"Sweepr Team" <${user}>`,
        to,
        subject,
        text: body,
      });
      console.log(`[EMAIL] Successfully sent real email to ${to} via Gmail`);
    } catch (err) {
      console.error(`[EMAIL] Failed to send email to ${to} via Gmail:`, err);
    }
  } else {
    console.log(`[EMAIL] Skipping real email send: SMTP_GMAIL_USER and SMTP_GMAIL_PASS are not set in .env`);
  }
}

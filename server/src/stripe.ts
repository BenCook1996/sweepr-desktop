import type Stripe from "stripe";
import type { EntStatus, Repo } from "./db.js";

// Stripe moved some fields between API versions (e.g. current_period_end moved
// onto subscription items; invoice.subscription moved under invoice.parent).
// These helpers read both shapes so the server works across SDK versions.

export function periodEnd(sub: any): number | null {
  return sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
}

export function invoiceSubscriptionId(inv: any): string | null {
  const s = inv.subscription ?? inv.parent?.subscription_details?.subscription ?? null;
  return typeof s === "string" ? s : s?.id ?? null;
}

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : v?.id ?? null);

export function syncSubscription(repo: Repo, sub: Stripe.Subscription, accountIdHint?: string | null) {
  const customerId = idOf(sub.customer as any);
  const metaAccountId = typeof sub.metadata?.account_id === "string" ? sub.metadata.account_id.trim() : "";
  const hint = typeof accountIdHint === "string" ? accountIdHint.trim() : "";
  if (metaAccountId && hint && metaAccountId !== hint) {
    throw new Error("account_id mismatch");
  }
  const account =
    (metaAccountId && repo.accountById(metaAccountId)) ||
    (hint && repo.accountById(hint)) ||
    (customerId && repo.accountByCustomer(customerId)) ||
    undefined;
  if (!account) {
    console.warn(`[stripe] no account for subscription ${sub.id}`);
    return;
  }
  if (customerId && !account.stripe_customer_id) repo.setCustomer(account.id, customerId);

  const existingEnt = repo.entitlement(account.id);
  // Never let a later webhook overwrite a dispute-based revocation.
  if (existingEnt?.status === "disputed") return;

  const price = sub.items?.data?.[0]?.price;
  const interval = price?.recurring?.interval ?? "month";
  const intervalCount = price?.recurring?.interval_count ?? 1;
  const currentPeriodEnd = periodEnd(sub);
  const planName = interval === "year" ? "annual" : intervalCount === 6 ? "six_month" : (sub.metadata?.plan || "monthly");
  const amountCents = price?.unit_amount ?? (interval === "year" ? 6499 : intervalCount === 6 ? 4799 : 1199);

  // Never let an abandoned checkout (incomplete / incomplete_expired) or a non-active webhook
  // for a different subscription ID overwrite an already active/trialing or lifetime entitlement.
  const isExistingActive = existingEnt?.status === "active" || existingEnt?.status === "trialing";
  const isIncomingActive = sub.status === "active" || sub.status === "trialing";
  const shouldUpdateEntitlement =
    !isExistingActive ||
    isIncomingActive ||
    (existingEnt?.stripe_subscription_id === sub.id &&
      existingEnt?.stripe_subscription_id !== "sub_owner_lifetime" &&
      sub.status !== "incomplete" &&
      sub.status !== "incomplete_expired");

  if (shouldUpdateEntitlement) {
    repo.upsertEntitlement({
      account_id: account.id,
      stripe_subscription_id: sub.id,
      status: sub.status as EntStatus,
      plan: planName,
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: sub.cancel_at_period_end ? 1 : 0,
    });
  }

  const refCode = typeof sub.metadata?.ref === "string" ? sub.metadata.ref.trim() : "";
  if (sub.status === "active" && refCode) {
    repo.applyReferral(account.id, refCode, Math.floor(Date.now() / 1000));
  }

  repo.upsertSubscription({
    id: sub.id,
    account_id: account.id,
    stripe_subscription_id: sub.id,
    status: sub.status as EntStatus,
    plan: planName,
    amount_cents: amountCents,
    currency: sub.currency || "usd",
    billing_interval: interval === "year" ? "year" : intervalCount === 6 ? "6-month" : "month",
    current_period_start: (sub as any).current_period_start ?? null,
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: sub.cancel_at_period_end ? 1 : 0,
    canceled_at: sub.canceled_at ?? null,
    trial_start: sub.trial_start ?? null,
    trial_end: sub.trial_end ?? null,
  });

  repo.addActivity({
    account_id: account.id,
    type: "subscription_synced",
    title: "Subscription Synchronized",
    description: `Status: ${sub.status}, Plan: ${planName}`,
    actor: "stripe",
    metadata: { subscription_id: sub.id, status: sub.status },
  });
}

export async function handleStripeEvent(stripe: Stripe, repo: Repo, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const accountId = s.client_reference_id;
      const customerId = idOf(s.customer as any);
      const email = s.customer_details?.email ?? (s.customer_email || undefined);
      if (accountId && customerId) repo.setCustomer(accountId, customerId, email);
      if (accountId && s.customer_details?.name) {
        repo.updateAccountProfile(accountId, { name: s.customer_details.name, email });
      }
      const subId = idOf(s.subscription as any);
      if (subId) syncSubscription(repo, await stripe.subscriptions.retrieve(subId), accountId);
      
      if (email) {
        const normEmail = email.trim().toLowerCase();
        const nowSec = Math.floor(Date.now() / 1000);
        const recentSent = accountId
          ? repo.db
              .prepare(
                "SELECT id FROM activities WHERE account_id = ? AND type = 'welcome_email_sent' AND created_at > ? LIMIT 1"
              )
              .get(accountId, nowSec - 300)
          : null;
        if (!recentSent) {
          const { randomInt } = await import("node:crypto");
          const { sha256 } = await import("./tokens.js");
          const activationKey = randomInt(100000, 1000000).toString();
          repo.setOtp(normEmail, sha256(activationKey), nowSec + 7 * 86400);
          if (accountId) {
            repo.addActivity({
              account_id: accountId,
              type: "welcome_email_sent",
              title: "Welcome & Subscription Key Sent",
              description: `6-digit Subscription Key sent to ${normEmail}`,
              actor: "stripe",
              metadata: { email: normEmail, plan: "Pro" },
            });
          }
          import("./email.js").then((m) => {
            m.sendSubscriptionEmail(normEmail, "activated", "Pro", s.customer_details?.name || undefined, activationKey).catch(
              console.error
            );
          });
        }
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed": {
      // Re-fetch so out-of-order delivery can't apply a stale state.
      const sub = event.data.object as Stripe.Subscription;
      const fresh = await stripe.subscriptions.retrieve(sub.id).catch(() => sub);
      syncSubscription(repo, fresh);
      break;
    }
    case "invoice.paid": {
      const inv = event.data.object as Stripe.Invoice;
      const subId = invoiceSubscriptionId(inv);
      if (subId) syncSubscription(repo, await stripe.subscriptions.retrieve(subId));
      const custId = idOf(inv.customer as any);
      const account = custId ? repo.accountByCustomer(custId) : undefined;
      if (account) {
        repo.upsertInvoice({
          id: inv.id,
          account_id: account.id,
          stripe_invoice_id: inv.id,
          amount_cents: inv.total,
          amount_paid_cents: inv.amount_paid,
          currency: inv.currency,
          status: "paid",
          due_date: inv.due_date ?? null,
          paid_at: (inv as any).status_transitions?.paid_at ?? Math.floor(Date.now() / 1000),
          hosted_invoice_url: inv.hosted_invoice_url ?? null,
          pdf_url: inv.invoice_pdf ?? null,
          created_at: inv.created,
        });
        repo.addActivity({
          account_id: account.id,
          type: "invoice_paid",
          title: "Payment Received",
          description: `Successfully paid ${(inv.amount_paid / 100).toFixed(2)} ${inv.currency.toUpperCase()}`,
          actor: "stripe",
          metadata: { invoice_id: inv.id, amount_paid: inv.amount_paid },
        });
      }
      break;
    }
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      const subId = invoiceSubscriptionId(inv);
      if (subId) syncSubscription(repo, await stripe.subscriptions.retrieve(subId));
      const custId = idOf(inv.customer as any);
      const account = custId ? repo.accountByCustomer(custId) : undefined;
      if (account) {
        repo.upsertInvoice({
          id: inv.id,
          account_id: account.id,
          stripe_invoice_id: inv.id,
          amount_cents: inv.total,
          amount_paid_cents: 0,
          currency: inv.currency,
          status: "open",
          due_date: inv.due_date ?? null,
          paid_at: null,
          hosted_invoice_url: inv.hosted_invoice_url ?? null,
          pdf_url: inv.invoice_pdf ?? null,
          created_at: inv.created,
        });
        repo.addActivity({
          account_id: account.id,
          type: "payment_failed",
          title: "Payment Failed",
          description: `Failed payment attempt of ${(inv.total / 100).toFixed(2)} ${inv.currency.toUpperCase()} - Dunning recovery triggered`,
          actor: "stripe",
          metadata: { invoice_id: inv.id },
        });
      }
      break;
    }
    case "customer.subscription.trial_will_end": {
      const sub = event.data.object as Stripe.Subscription;
      await sendRenewalReminder(sub);
      break;
    }
    case "charge.dispute.created": {
      const d = event.data.object as Stripe.Dispute;
      const charge = await stripe.charges.retrieve(idOf(d.charge as any)!);
      const customerId = idOf(charge.customer as any);
      const account = customerId ? repo.accountByCustomer(customerId) : undefined;
      if (account) {
        repo.setStatus(account.id, "disputed");
        repo.addActivity({
          account_id: account.id,
          type: "charge_dispute",
          title: "Chargeback / Dispute Created",
          description: `Dispute created on charge ${charge.id}. Access suspended.`,
          actor: "stripe",
          metadata: { dispute_id: d.id, charge_id: charge.id },
        });
      }
      break;
    }
    default:
      break;
  }
}

/** Hook up your email provider (Postmark, Resend, SES...) here. */
async function sendRenewalReminder(sub: Stripe.Subscription) {
  console.log(`[reminder] email customer ${String(sub.customer)}: Trial ending. Paid renewal starts on ${new Date((sub.trial_end ?? 0) * 1000).toISOString()}.`);
}

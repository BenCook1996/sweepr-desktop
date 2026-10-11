import type { Repo } from "./db.js";
import { randomToken, sha256 } from "./tokens.js";

/**
 * Handle incoming webhooks from RevenueCat.
 * RevenueCat sends events for mobile subscriptions (iOS StoreKit 2 & Android Google Play Billing).
 */
export async function handleRevenueCatWebhook(repo: Repo, payload: any) {
  const event = payload.event;
  if (!event) return;

  const appUserId = event.app_user_id; // This is the CRM ID linked from the mobile app
  if (!appUserId) return;

  // The Android app is free to download and buys in-app with an anonymous RevenueCat ID
  // ($RCAnonymousID:...). The first time we hear about a mobile customer, create a CRM
  // account for them so in-app subscribers show up next to the Stripe/web customers.
  const email: string | undefined = event.subscriber_attributes?.$email?.value || undefined;
  let account = repo.accountById(appUserId);
  if (!account) {
    repo.createAccount(appUserId, sha256(randomToken(32)), email);
    repo.updateAccountProfile(appUserId, {
      name: email ? undefined : `Mobile user (${event.store ?? "app"})`,
      lifecycle_stage: "customer",
    });
    account = repo.accountById(appUserId);
    if (!account) {
      console.warn(`[revenuecat] Could not create CRM account for ${appUserId}`);
      return;
    }
    console.log(`[revenuecat] Created CRM account for new mobile subscriber ${appUserId}`);
  }

  const statusMap: Record<string, string> = {
    INITIAL_PURCHASE: "active",
    RENEWAL: "active",
    CANCELLATION: "active", // Cancellation just turns off auto-renew, entitlement remains active until expiration
    EXPIRATION: "canceled",
    BILLING_ISSUE: "past_due",
  };

  const newStatus = statusMap[event.type] ?? "active";
  const expirationAt = event.expiration_at_ms ? Math.floor(event.expiration_at_ms / 1000) : null;
  const isTrial = event.period_type === "TRIAL";

  // Upsert the entitlement based on RevenueCat state
  repo.upsertEntitlement({
    account_id: account.id,
    stripe_subscription_id: event.original_transaction_id, // Map RC transaction ID here
    status: isTrial && newStatus === "active" ? "trialing" : newStatus as any,
    plan: event.product_id.includes("annual") ? "annual" : "monthly",
    current_period_end: expirationAt,
    cancel_at_period_end: event.type === "CANCELLATION" ? 1 : 0,
  });

  // Log activity in the CRM
  repo.addActivity({
    account_id: account.id,
    type: `rc_${event.type.toLowerCase()}`,
    title: `Mobile App: ${event.type}`,
    description: `Product: ${event.product_id} (${event.environment})`,
    actor: "revenuecat",
    metadata: { 
      event_id: event.id,
      store: event.store, 
      product_id: event.product_id,
      entitlement_ids: event.entitlement_ids
    },
  });

  console.log(`[revenuecat] Processed ${event.type} for account ${account.id}. Status: ${newStatus}`);
}

import type { EntStatus, Repo } from "./db.js";
import { randomToken, sha256 } from "./tokens.js";
import { normalizeEmail } from "./security.js";

/** RevenueCat event types we act on, mapped to the entitlement status they imply. */
const STATUS_MAP: Record<string, EntStatus> = {
  INITIAL_PURCHASE: "active",
  RENEWAL: "active",
  UNCANCELLATION: "active",
  PRODUCT_CHANGE: "active",
  CANCELLATION: "active", // Cancellation just turns off auto-renew, entitlement remains active until expiration
  EXPIRATION: "canceled",
  BILLING_ISSUE: "past_due",
};

export class RevenueCatPayloadError extends Error {}

/**
 * Handle incoming webhooks from RevenueCat.
 * RevenueCat sends events for mobile subscriptions (iOS StoreKit 2 & Android Google Play Billing).
 * Throws RevenueCatPayloadError for malformed payloads; returns silently for event types we ignore.
 */
export async function handleRevenueCatWebhook(repo: Repo, payload: any) {
  const event = payload?.event;
  if (!event || typeof event !== "object") throw new RevenueCatPayloadError("missing event");

  const appUserId = event.app_user_id; // This is the CRM ID linked from the mobile app
  if (typeof appUserId !== "string" || appUserId.length === 0 || appUserId.length > 200) {
    throw new RevenueCatPayloadError("invalid app_user_id");
  }
  if (typeof event.type !== "string") throw new RevenueCatPayloadError("invalid type");

  const environment = typeof event.environment === "string" ? event.environment.slice(0, 50) : "unknown";
  if (process.env.NODE_ENV === "production" && environment.toUpperCase() === "SANDBOX") {
    console.warn(`[revenuecat] Ignoring SANDBOX event ${event.type} for ${appUserId} in production`);
    return;
  }

  // Ignore anything we don't explicitly understand (TEST, TRANSFER, SUBSCRIBER_ALIAS, ...).
  if (!Object.prototype.hasOwnProperty.call(STATUS_MAP, event.type)) {
    console.log(`[revenuecat] Ignoring unsupported event type ${String(event.type).slice(0, 50)}`);
    return;
  }

  const productId: string = typeof event.product_id === "string" ? event.product_id.slice(0, 200) : "";
  const rawEmail = event.subscriber_attributes?.$email?.value;

  // The Android app is free to download and buys in-app with an anonymous RevenueCat ID
  // ($RCAnonymousID:...). The first time we hear about a mobile customer, create a CRM
  // account for them so in-app subscribers show up next to the Stripe/web customers.
  const email: string | undefined = normalizeEmail(rawEmail) ?? undefined;
  const store = typeof event.store === "string" ? event.store.slice(0, 50) : "app";
  let account = repo.accountById(appUserId);
  if (!account) {
    repo.createAccount(appUserId, sha256(randomToken(32)), email);
    repo.updateAccountProfile(appUserId, {
      name: email ? undefined : `Mobile user (${store})`,
      lifecycle_stage: "customer",
    });
    account = repo.accountById(appUserId);
    if (!account) {
      console.warn(`[revenuecat] Could not create CRM account for ${appUserId}`);
      return;
    }
    console.log(`[revenuecat] Created CRM account for new mobile subscriber ${appUserId}`);
  }

  const mapped = STATUS_MAP[event.type];
  const expirationAt = typeof event.expiration_at_ms === "number" ? Math.floor(event.expiration_at_ms / 1000) : null;
  const isTrial = event.period_type === "TRIAL";

  // A disputed (charged-back) entitlement must not be silently reinstated or overwritten by RC lifecycle events.
  const existing = repo.entitlement(account.id);
  const newStatus: EntStatus =
    existing?.status === "disputed" ? "disputed" : isTrial && mapped === "active" ? "trialing" : mapped;

  // Upsert the entitlement based on RevenueCat state
  const rcAddons: string[] = [];
  if (productId.toLowerCase().includes("battery") || (Array.isArray(event.entitlement_ids) && event.entitlement_ids.some((id: any) => String(id).toLowerCase().includes("battery")))) {
    rcAddons.push("battery_care");
  }
  if (
    productId.toLowerCase().includes("cloud") ||
    productId.toLowerCase().includes("vault") ||
    (Array.isArray(event.entitlement_ids) &&
      event.entitlement_ids.some((id: any) => {
        const lower = String(id).toLowerCase();
        return lower.includes("cloud") || lower.includes("vault");
      }))
  ) {
    rcAddons.push("cloud_vault");
  }
  repo.upsertEntitlement({
    account_id: account.id,
    stripe_subscription_id: typeof event.original_transaction_id === "string" ? event.original_transaction_id : null, // Map RC transaction ID here
    status: newStatus,
    plan: productId.includes("annual") ? "annual" : "monthly",
    addons_list: rcAddons,
    current_period_end: expirationAt,
    cancel_at_period_end: event.type === "CANCELLATION" ? 1 : 0,
  });

  // Log activity in the CRM
  repo.addActivity({
    account_id: account.id,
    type: `rc_${event.type.toLowerCase()}`,
    title: `Mobile App: ${event.type}`,
    description: `Product: ${productId || "unknown"} (${environment})`,
    actor: "revenuecat",
    metadata: { 
      event_id: typeof event.id === "string" ? event.id : undefined,
      store, 
      product_id: productId || undefined,
      entitlement_ids: Array.isArray(event.entitlement_ids) ? event.entitlement_ids.slice(0, 20) : undefined
    },
  });

  console.log(`[revenuecat] Processed ${event.type} for account ${account.id}. Status: ${newStatus}`);
}

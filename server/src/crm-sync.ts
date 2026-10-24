/**
 * Real-time License Verification & Bi-Directional Sync Bridge from SWEEPR Cleaner (`sweepr-desktop/server`)
 * to the centralized SWEEPR Multi-Project CRM Hub (`sweepr-crm`, `project_id: "cleaner"`).
 *
 * Ensures that subscriptions, 6-digit activation keys, cross-project bundles (`sweepr_secure_bundle`),
 * OTP codes, RevenueCat mobile purchases, and Stripe subscriptions are managed and verified centrally
 * across all SWEEPR products (`cleaner`, `vpn`, `deepblock`, `shopsafe`).
 */

export const PROJECT_ID = "cleaner";

let crmConsecutiveFailures = 0;
let crmCircuitOpenUntil = 0;
const CRM_CIRCUIT_THRESHOLD = 3;
const CRM_CIRCUIT_COOLDOWN_MS = 60_000;

function isCrmCircuitOpen(): boolean {
  return Date.now() < crmCircuitOpenUntil;
}

function recordCrmSuccess(): void {
  crmConsecutiveFailures = 0;
  crmCircuitOpenUntil = 0;
}

function recordCrmFailure(): void {
  crmConsecutiveFailures += 1;
  if (crmConsecutiveFailures >= CRM_CIRCUIT_THRESHOLD) {
    crmCircuitOpenUntil = Date.now() + CRM_CIRCUIT_COOLDOWN_MS;
  }
}

function getCrmUrl(): string {
  return (process.env.SWEEPR_CRM_URL || "").trim().replace(/\/+$/, "");
}

function getCrmApiKey(): string {
  return (process.env.SWEEPR_CRM_API_KEY || "").trim();
}

export function isCentralCrmConfigured(): boolean {
  return Boolean(getCrmUrl());
}

function crmHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const apiKey = getCrmApiKey();
  const h: Record<string, string> = {
    "content-type": "application/json",
    "x-sweepr-project": PROJECT_ID,
    ...extra,
  };
  if (apiKey) {
    h["x-crm-api-key"] = apiKey;
    h["x-sweepr-api-key"] = apiKey;
  }
  return h;
}

export function syncToCentralCrm(path: string, body: Record<string, unknown>): void {
  const crmUrl = getCrmUrl();
  if (!crmUrl) return;
  try {
    fetch(`${crmUrl}${path}`, {
      method: "POST",
      headers: crmHeaders(),
      body: JSON.stringify({ project_id: PROJECT_ID, ...body }),
      signal: AbortSignal.timeout(4000),
    }).catch(() => {});
  } catch {
    // Non-blocking fire-and-forget sync
  }
}

export interface CentralEntitlementResult {
  valid: boolean;
  account_id?: string;
  email?: string;
  activation_code?: string;
  license_key?: string;
  status?: "active" | "trialing" | "past_due" | "canceled" | "expired" | "none";
  plan?: string;
  addons?: string[];
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  token?: string;
  refresh_token?: string;
}

/**
 * Queries the centralized `sweepr-crm` hub (`/v1/license/verify-key`) to verify if an email,
 * account_id, 6-digit activation code, or prefixed license key holds an active entitlement for
 * `cleaner` (or a cross-project bundle like `sweepr_secure_bundle`).
 */
export async function verifyCentralEntitlement(
  lookup: string,
  deviceId?: string
): Promise<CentralEntitlementResult | null> {
  const crmUrl = getCrmUrl();
  const cleanLookup = String(lookup || "").trim();
  if (!crmUrl || !cleanLookup || isCrmCircuitOpen()) return null;

  try {
    const res = await fetch(`${crmUrl}/v1/license/verify-key`, {
      method: "POST",
      headers: crmHeaders(),
      body: JSON.stringify({
        project_id: PROJECT_ID,
        key: cleanLookup,
        device_id: deviceId || undefined,
      }),
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) {
      if (res.status >= 500) recordCrmFailure();
      return null;
    }
    recordCrmSuccess();
    const data = (await res.json()) as Record<string, any>;
    return {
      valid: Boolean(data.valid || data.ok),
      account_id: typeof data.account_id === "string" ? data.account_id : undefined,
      email: typeof data.email === "string" ? data.email : undefined,
      activation_code: typeof data.activation_code === "string" ? data.activation_code : undefined,
      license_key: typeof data.license_key === "string" ? data.license_key : undefined,
      status: data.status,
      plan: typeof data.plan === "string" ? data.plan.replace(/^pro_/, "") : undefined,
      addons: Array.isArray(data.addons) ? data.addons.map(String) : [],
      current_period_end:
        typeof data.current_period_end === "number" ? data.current_period_end : undefined,
      cancel_at_period_end: Boolean(data.cancel_at_period_end ?? data.cancelAtPeriodEnd),
      token: typeof data.token === "string" ? data.token : undefined,
    };
  } catch {
    recordCrmFailure();
    return null;
  }
}

/**
 * Verifies a 6-digit OTP or permanent 6-digit Subscription Key against the centralized `sweepr-crm`
 * hub (`/v1/account/verify-otp`), registering the device in the central CRM as well.
 */
export async function verifyCentralOtp(params: {
  email: string;
  code: string;
  deviceId?: string;
  deviceType?: string;
  platform?: string;
  deviceLabel?: string;
}): Promise<CentralEntitlementResult | null> {
  const crmUrl = getCrmUrl();
  if (!crmUrl || !params.email || !params.code) return null;

  try {
    const res = await fetch(`${crmUrl}/v1/account/verify-otp`, {
      method: "POST",
      headers: crmHeaders(),
      body: JSON.stringify({
        project_id: PROJECT_ID,
        email: params.email.trim().toLowerCase(),
        code: params.code.trim(),
        device_id: params.deviceId || `web_cleaner_${Date.now()}`,
        device_type: params.deviceType || "pc",
        platform: params.platform,
        device_label: params.deviceLabel,
      }),
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, any>;
      if (data.error || data.ok === false) return null;
      return {
        valid: Boolean(data.account_id && !data.error && data.ok !== false),
        account_id: typeof data.account_id === "string" ? data.account_id : undefined,
        email: typeof data.email === "string" ? data.email : params.email.trim().toLowerCase(),
        status: data.status,
        plan: typeof data.plan === "string" ? data.plan.replace(/^pro_/, "") : undefined,
        addons: Array.isArray(data.addons) ? data.addons.map(String) : [],
        current_period_end: typeof data.expires_at === "number" ? data.expires_at : undefined,
        token: typeof data.token === "string" ? data.token : undefined,
        refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
      };
    }
  } catch {
    // Fall through to verify-key check
  }

  // Also check if `code` matches the account's 6-digit activation_code in central CRM
  const byKey = await verifyCentralEntitlement(params.code, params.deviceId);
  if (
    byKey &&
    byKey.valid &&
    byKey.email &&
    byKey.email.trim().toLowerCase() === params.email.trim().toLowerCase()
  ) {
    return byKey;
  }
  return null;
}

/**
 * Synchronizes a subscription or entitlement change from SWEEPR Cleaner to the centralized `sweepr-crm` hub.
 */
export function syncSubscriptionToCentralCrm(params: {
  email?: string | null;
  accountId?: string;
  name?: string | null;
  country?: string | null;
  plan?: string | null;
  status: string;
  days?: number;
  amountCents?: number;
  currency?: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  activationCode?: string;
  addons?: string[];
  notes?: string;
  ref?: string | null;
  affiliateCode?: string | null;
}): void {
  const email = (params.email || "").trim().toLowerCase();
  if (!email || email.endsWith("@pending.sweeprcleaner.com")) return;
  const rawPlan = (params.plan || "annual").replace(/^pro_/, "");
  const affiliateRef = (params.ref || params.affiliateCode || "").trim().toLowerCase();
  syncToCentralCrm("/api/crm/subscriptions?project=cleaner", {
    project_id: PROJECT_ID,
    email,
    name: params.name ?? undefined,
    country: params.country ?? undefined,
    plan: `pro_${rawPlan}`,
    status:
      params.status === "active" || params.status === "trialing" || params.status === "past_due"
        ? params.status
        : "canceled",
    days: params.days,
    amount_cents: params.amountCents,
    currency: params.currency,
    stripe_customer_id: params.stripeCustomerId ?? undefined,
    stripe_subscription_id: params.stripeSubscriptionId ?? undefined,
    activation_code: params.activationCode,
    addons: params.addons ?? [],
    notes: params.notes,
    ...(affiliateRef ? { ref: affiliateRef, affiliate_code: affiliateRef } : {}),
  });
}

export function reportAffiliateClickToCentralCrm(params: {
  code: string;
  landingPath?: string | null;
  referrer?: string | null;
  country?: string | null;
}): void {
  const code = (params.code || "").trim().toLowerCase();
  if (!code) return;
  syncToCentralCrm("/v1/affiliate/click", {
    project_id: PROJECT_ID,
    code,
    landing_path: params.landingPath ?? "/",
    referrer: params.referrer ?? null,
    country: params.country ?? null,
  });
}

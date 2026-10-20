/**
 * Non-blocking sync bridge from SWEEPR Cleaner (`sweepr-desktop/server`) to the central
 * SWEEPR Multi-Project CRM Hub (`sweepr-crm`, `project_id: "cleaner"`).
 */

const CRM_URL = (process.env.SWEEPR_CRM_URL || "").trim().replace(/\/+$/, "");
const CRM_API_KEY = (process.env.SWEEPR_CRM_API_KEY || "").trim();

function crmHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    "x-sweepr-project": "cleaner",
  };
  if (CRM_API_KEY) {
    h["x-crm-api-key"] = CRM_API_KEY;
    h["x-sweepr-api-key"] = CRM_API_KEY;
  }
  return h;
}

export function syncToCentralCrm(path: string, body: Record<string, unknown>): void {
  if (!CRM_URL) return;
  try {
    fetch(`${CRM_URL}${path}`, {
      method: "POST",
      headers: crmHeaders(),
      body: JSON.stringify({ project_id: "cleaner", ...body }),
      signal: AbortSignal.timeout(4000),
    }).catch(() => {});
  } catch {
    // Non-blocking fire-and-forget sync
  }
}

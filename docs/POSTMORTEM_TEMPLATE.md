# SWEEPR Cleaner — Incident Response & Postmortem Template

## 1. Incident Summary
- **Incident ID / Date (UTC):** `INC-YYYY-MM-DD`
- **Severity:** `SEV-1 (Critical)` | `SEV-2 (Major)` | `SEV-3 (Minor)`
- **Affected Surface:** `Desktop Engine (Windows/macOS/Linux)` | `Stripe Checkout & Webhooks` | `Licensing / Offline JWS` | `Edge / Railway Origin`
- **Duration:** `HH:MM UTC -> HH:MM UTC`
- **Customer Impact:** (e.g., number of affected devices, failed checkouts, or quarantined files)

---

## 2. Immediate Mitigation Runbook (Emergency Controls)
1. **Remote Cleaning Rule Kill-Switch (`DISABLED_CLEAN_RULES`):**
   - If a third-party application update alters its cache directory layout, set the `DISABLED_CLEAN_RULES` environment variable on Railway (comma-separated rule IDs, e.g., `discord_cache,chrome_cache`).
   - All connected desktop clients immediately receive `disabledRules` via `POST /v1/entitlement` and `GET /v1/updates/latest.json` and persist `disabled_rules.json` locally, skipping those rules without requiring a binary reinstall.
2. **Webhook Dead-Letter Queue (`webhook_dlq`) Inspection & Replay:**
   - Query failed Stripe or RevenueCat webhooks via `GET /api/crm/backup-db` (under `webhook_dlq`).
   - Note that `findOrSyncEntitledAccountByEmail` automatically reconciles entitlements live against both the Central CRM (`sweepr-crm`) and Stripe API even if a webhook delivery was delayed.
3. **7-Day Safety Undo Vault Recovery:**
   - Quarantined user files reside in `%LOCALAPPDATA%\com.sweepr.app\quarantine\files\` with atomic manifest writes in `quarantine\manifest.json`.

---

## 3. Root Cause Analysis (Five Whys)
1. **Why did the issue occur?**
2. **Why was it not caught by unit/integration tests or CI?**
3. **Why did monitoring/alerts not flag it earlier?**
4. **Why did the blast radius reach users?**
5. **What structural guardrail prevents this class of bug permanently?**

---

## 4. Remediation & Prevention Action Items
| Action Item | Owner | File / Component | Status |
| :--- | :--- | :--- | :--- |
| Add regression test covering failure mode | Engineering | `server/test/api.test.ts` / `cargo test` | `[ ]` |
| Deploy fix & verify `/health` SLI | Engineering | Railway / Cloudflare | `[ ]` |

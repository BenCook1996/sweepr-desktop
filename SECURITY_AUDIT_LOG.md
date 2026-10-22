# SWEEPR Cleaner (`sweeprcleaner.com`) — Daily White-Hat Security Audit & Auto-Remediation Log

## 2026-10-21 — Initial Baseline Audit & Hardening Pass
- **Finding 1 (Admin Basic Auth Rate-Limit Counter Reset on Valid Login)**: In `server/src/security.ts` (`adminBasicAuth`), the per-IP failure counter (`failures`) was not reset after a successful authentication, meaning transient typos over a 15-minute window could accumulate toward a `429` lockout for a legitimate administrator.
  - **Remediation Implemented**: Added `failures.reset(ip)` immediately following constant-time `safeEqual` credential verification in `server/src/security.ts`.
- **Finding 2 (HSTS Preload Directive)**: Upgraded `Strict-Transport-Security` header in `server/src/security.ts` (`securityHeaders`) to `max-age=31536000; includeSubDomains; preload`.

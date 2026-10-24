# SWEEPR Cleaner (`sweeprcleaner.com`) — Daily White-Hat Security Audit & Auto-Remediation Log

## 2026-10-23 — Daily White-Hat Security Audit & Auto-Remediation Pass
- **Scope**: Server/website (`server`), Desktop app (`app/src-tauri` & `app/src`), and Shared CRM (`sweepr_crm`).
- **Finding 1 (Rate Limiter DoS / Lockout Eviction Flush Prevention)**: In `server/src/security.ts` (`createRateLimiter`), cache eviction on `hits.size > maxKeys` operated in FIFO order. A high-frequency key-flooding attack could evict active administrative or brute-force lockouts.
  - **Remediation Implemented**: Prioritized eviction of low-hit (non-blocked, `v.n < limit`) keys so active lockout state is preserved across key flushes. Added regression test asserting blocked key survival.
- **Finding 2 (Strict CSRF Form Submission Guard)**: In `server/src/security.ts` (`isSameOriginRequest` and `adminBasicAuth`), requests omitting both `Origin` and `Sec-Fetch-Site` lacked explicit form content-type validation, allowing potential HTML `<form>` CSRF from privacy clients or legacy browsers.
  - **Remediation Implemented**: Enforced that standard HTML form types (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`) require explicit same-origin/same-site metadata. Added test asserting form post rejection.
- **Finding 3 (HSTS Preload Directive Parity in Shared CRM)**: In `sweepr_crm/src/security.ts` (`securityHeaders`), the `Strict-Transport-Security` header lacked the `preload` directive.
  - **Remediation Implemented**: Upgraded header to `max-age=31536000; includeSubDomains; preload` for full browser HSTS preload list eligibility.
- **Finding 4 (CRM Auth Middleware Route Path Boundary & Slash Normalization)**: In `sweepr_crm/src/app.ts`, routes were guarded using prefix strings (`/crm`, `/crm/*`, `/admin`, `/api/crm/*`). Requests without a trailing slash (`/api/crm`) or with multiple/URL-encoded slashes could bypass route guards.
  - **Remediation Implemented**: Replaced with unified regex router middleware `ADMIN_PATH_RE = /^\/+(api\/+crm|crm|admin)(\/|$)/i` combined with `decodeURIComponent` and slash collapsing.
- **Finding 5 (PowerShell Execution Path Defense in Device ID Detection)**: In `server/src/crm.ts` (`getLocalWindowsDeviceId`), `execSync('powershell -Command ...')` called an unquoted `powershell` command without resolving the system root directory, presenting potential PATH/CWD hijacking vulnerabilities on Windows host environments.
  - **Remediation Implemented**: Resolved canonical system path `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` with `-NoProfile -NonInteractive` flags.
- **Finding 6 (Desktop App Native Dialog Environment Isolation)**: In `app/src-tauri/src/commands.rs` (`pick_folder` and `pick_file`), dialog prompts were sanitized via single-quote doubling and interpolated directly into PowerShell script strings.
  - **Remediation Implemented**: Passed prompts strictly via process environment variable `$env:SWEEPR_PROMPT` with `-NoProfile -NonInteractive -STA`, eliminating script string concatenation.
- **Finding 7 (Desktop App Portable Binary / Uninstaller Hijacking Defense)**: In `app/src-tauri/src/commands.rs` (`uninstall_self`), when executed in portable mode, the process checked `parent.join("uninstall.exe")` and spawned it. If running from user-writable directories (Downloads, Desktop, Temp), an attacker could drop a rogue `uninstall.exe`.
  - **Remediation Implemented**: Added safety check preventing execution of `uninstall.exe` if located inside `download_dir()`, `desktop_dir()`, or `temp_dir()`.
- **Finding 8 (Shared CRM VPN Revocation Outbound SSRF & API Key Leakage Guard)**: In `sweepr_crm/src/app.ts` (`notifyVpnPeerRevocation`), notification POSTs containing `x-sweepr-api-key` were dispatched to `vpnProj.siteUrl/api/vpn/revoke` without verifying if the target was a public URL.
  - **Remediation Implemented**: Enforced `isPublicHttpUrl` validation before making outbound HTTP calls to remote project site URLs, preventing API key exposure to private networks or cloud metadata.
- **Finding 9 (SSRF IP Filter Range Hardening)**: In `server/src/seo/backlinks.ts` and `sweepr_crm/src/seo/backlinks.ts` (`isPublicHttpUrl`), IPv4 checks lacked explicit exclusion for multicast/Class E (`a >= 224`), TEST-NET blocks (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), and benchmarking (198.18.0.0/15).
  - **Remediation Implemented**: Extended IPv4 filtering to block all reserved, multicast, documentation, and benchmarking blocks. Added regression test assertions.
- **Test Verification**:
  - `desktop_cleaner/server`: 39/39 unit & integration tests passing (`npm test`).
  - `desktop_cleaner/app/src-tauri`: 50/50 Rust tests passing (`cargo test`) + `cargo check` clean.
  - `sweepr_crm`: 18/18 test suites passing (`npm test`).

## 2026-10-21 — Initial Baseline Audit & Hardening Pass
- **Finding 1 (Admin Basic Auth Rate-Limit Counter Reset on Valid Login)**: In `server/src/security.ts` (`adminBasicAuth`), the per-IP failure counter (`failures`) was not reset after a successful authentication, meaning transient typos over a 15-minute window could accumulate toward a `429` lockout for a legitimate administrator.
  - **Remediation Implemented**: Added `failures.reset(ip)` immediately following constant-time `safeEqual` credential verification in `server/src/security.ts`.
- **Finding 2 (HSTS Preload Directive)**: Upgraded `Strict-Transport-Security` header in `server/src/security.ts` (`securityHeaders`) to `max-age=31536000; includeSubDomains; preload`.

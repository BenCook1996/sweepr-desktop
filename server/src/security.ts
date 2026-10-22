import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

/** Constant-time string comparison (compares sha256 digests so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

/** Escape a value for safe interpolation into HTML text or quoted attributes. */
export function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const EMAIL_RE = /^[^\s@<>"'`;,()]+@[^\s@<>"'`;,()]+\.[^\s@<>"'`;,()]{2,}$/;

/** Trim + lowercase + validate an email address. Returns null when invalid. */
export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  if (e.length < 6 || e.length > 254 || !EMAIL_RE.test(e)) return null;
  return e;
}

export interface RateLimiter {
  /** Records a hit; returns false once the key has exceeded `limit` in the current window. */
  hit(key: string): boolean;
  /** True if the key is currently over the limit (does not record a hit). */
  isBlocked(key: string): boolean;
  /** Clears a key (e.g. after a successful login). */
  reset(key: string): void;
  readonly size: number;
}

/**
 * Very small fixed-window in-memory rate limiter. Use Redis/Cloudflare rules in production.
 * Expired keys are swept lazily (at most once per window) and whenever the map grows past `maxKeys`,
 * so memory stays bounded without a background timer.
 */
export function createRateLimiter(limit: number, windowMs: number, maxKeys = 10_000): RateLimiter {
  const hits = new Map<string, { n: number; reset: number }>();
  let lastSweep = Date.now();

  const sweep = (t: number) => {
    for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
    lastSweep = t;
    // Still too big (e.g. under a distributed flood): drop oldest entries (Map preserves insertion order).
    if (hits.size > maxKeys) {
      let excess = hits.size - maxKeys;
      for (const k of hits.keys()) {
        if (excess-- <= 0) break;
        hits.delete(k);
      }
    }
  };

  return {
    hit(key) {
      const t = Date.now();
      if (t - lastSweep > windowMs || hits.size > maxKeys) sweep(t);
      const h = hits.get(key);
      if (!h || h.reset <= t) {
        hits.set(key, { n: 1, reset: t + windowMs });
        return limit >= 1;
      }
      return ++h.n <= limit;
    },
    isBlocked(key) {
      const h = hits.get(key);
      return !!h && h.reset > Date.now() && h.n >= limit;
    },
    reset(key) {
      hits.delete(key);
    },
    get size() {
      return hits.size;
    },
  };
}

/**
 * Client IP for rate limiting. Proxy headers are spoofable, so they are only honoured when the
 * server is explicitly configured to sit behind a trusted proxy (TRUST_PROXY=1).
 */
export function makeClientIp(trustProxy: boolean) {
  const trustCloudflare = process.env.TRUST_CLOUDFLARE === "1";
  return (c: Context): string => {
    if (trustProxy) {
      if (trustCloudflare) {
        const cfIp = c.req.header("cf-connecting-ip")?.trim();
        if (cfIp) return cfIp;
      }
      const xff = c.req.header("x-forwarded-for");
      if (xff) {
        const hops = xff
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const rightmost = hops.at(-1);
        if (rightmost) return rightmost;
      }
    }
    try {
      return getConnInfo(c).remote.address ?? "local";
    } catch {
      return "local"; // e.g. app.request() in tests has no socket
    }
  };
}

export interface AdminAuthOptions {
  user: string;
  password: string;
  realm?: string;
  clientIp: (c: Context) => string;
  /** Allowed origins for state-changing requests (CSRF defence, since browsers auto-send Basic creds). */
  allowedOrigins: string[];
  trustProxy: boolean;
}

/** HTTP Basic auth for the admin CRM with per-IP lockout after repeated failures. */
export function adminBasicAuth(opts: AdminAuthOptions): MiddlewareHandler {
  const failures = createRateLimiter(10, 15 * 60 * 1000);
  const realm = opts.realm ?? "Sweepr CRM";
  const challenge = { "WWW-Authenticate": `Basic realm="${realm}", charset="UTF-8"` };

  return async (c, next) => {
    if (!opts.password) {
      return c.text("CRM disabled: set CRM_ADMIN_PASSWORD", 503);
    }
    const ip = opts.clientIp(c);
    if (failures.isBlocked(ip)) {
      return c.text("Too many failed login attempts. Try again later.", 429, { "Retry-After": "900" });
    }

    const header = c.req.header("authorization") ?? "";
    let user = "";
    let pass = "";
    if (header.slice(0, 6).toLowerCase() === "basic ") {
      try {
        const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
        const i = decoded.indexOf(":");
        if (i >= 0) {
          user = decoded.slice(0, i);
          pass = decoded.slice(i + 1);
        }
      } catch {
        /* treated as missing credentials */
      }
    }
    // Evaluate both comparisons (no short-circuit) to avoid leaking which part was wrong.
    const userOk = safeEqual(user, opts.user);
    const passOk = safeEqual(pass, opts.password);
    if (!(userOk && passOk)) {
      if (header) failures.hit(ip); // only count actual attempts, not the browser's first unauthenticated probe
      return c.text("Authentication required", 401, challenge);
    }
    failures.reset(ip);

    // CSRF: browsers replay Basic credentials on cross-site requests, so reject foreign origins on writes.
    const method = c.req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      if (c.req.header("sec-fetch-site") === "cross-site") return c.text("Forbidden (cross-site)", 403);
      const origin = c.req.header("origin");
      if (origin && origin !== "null") {
        const host = (opts.trustProxy && c.req.header("x-forwarded-host")) || c.req.header("host") || "";
        let ok = opts.allowedOrigins.includes(origin);
        try {
          ok ||= new URL(origin).host === host || origin === new URL(c.req.url).origin;
        } catch {
          ok = false;
        }
        if (!ok) return c.text("Forbidden (bad origin)", 403);
      } else if (origin === "null") {
        return c.text("Forbidden (bad origin)", 403);
      }
    }

    await next();
  };
}

/**
 * CSRF check for cookie-authenticated endpoints. Rejects explicit cross-site Fetch Metadata
 * (`Sec-Fetch-Site: cross-site`) and foreign `Origin` headers when present.
 */
export function isSameOriginRequest(c: Context, publicUrl: string, trustProxy: boolean): boolean {
  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const origin = c.req.header("origin");
  if (origin === "null") return false;
  if (origin) {
    const host = (trustProxy && c.req.header("x-forwarded-host")) || c.req.header("host") || "";
    try {
      const originUrl = new URL(origin);
      if (host && originUrl.host === host) return true;
      if (origin === new URL(c.req.url).origin) return true;
      if (publicUrl && origin === new URL(publicUrl).origin) return true;
    } catch {
      return false;
    }
    return false;
  }
  return true;
}

/** Baseline security headers with explicit CSP directives for scripts, styles, and frames. */
export function securityHeaders(opts: { hsts: boolean }): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const set = (k: string, v: string) => {
      try {
        if (!c.res.headers.has(k)) c.res.headers.set(k, v);
      } catch {
        /* immutable headers (e.g. proxied responses) */
      }
    };
    set("X-Frame-Options", "DENY");
    set("X-Content-Type-Options", "nosniff");
    set("Referrer-Policy", "strict-origin-when-cross-origin");
    set("Permissions-Policy", 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com" "https://pay.google.com"), usb=()');
    set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://js.stripe.com https://pay.google.com https://translate.google.com https://translate.googleapis.com https://www.googletagmanager.com https://connect.facebook.net https://www.clarity.ms; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://pay.google.com https://www.gstatic.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https://api.stripe.com https://r.stripe.com https://q.stripe.com https://m.stripe.com https://pay.google.com https://www.google.com https://translate.googleapis.com https://www.google-analytics.com https://www.clarity.ms https://api.country.is https://get.geojs.io https://ipapi.co; frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://pay.google.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'"
    );
    set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    if (opts.hsts) set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  };
}

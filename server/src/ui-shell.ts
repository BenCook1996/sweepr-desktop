import { escapeHtml } from "./security.js";

export const ORGANIZATION_SAME_AS: readonly string[] = [
  "https://github.com/BenCook1996",
  "https://github.com/BenCook1996/sweepr-desktop",
  "https://github.com/BenCook1996/scoop-sweepr",
  "https://github.com/microsoft/winget-pkgs/tree/master/manifests/s/Sweepr/SweeprCleaner",
  "https://alternativeto.net/software/sweeprcleaner/",
  "https://www.saashub.com/sweepr-cleaner",
  "https://sourceforge.net/software/product/SWEEPR-Cleaner/",
  "https://www.softpedia.com/get/Tweak/System-Tweak/SWEEPR-Cleaner.shtml",
  "https://community.chocolatey.org/packages/sweepr-cleaner/0.1.0",
  "https://www.producthunt.com/products/sweepr-cleaner",
  "https://www.indiehackers.com/product/sweepr-cleaner",
  "https://devhunt.org/tool/sweepr-cleaner",
];

export const ORGANIZATION_LOGO_URL = "https://sweeprcleaner.com/icon-512.png";

export const BRAND_SVG_MARK = `<svg width="34" height="34" viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <linearGradient id="hdrBrandBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#145c3e" />
      <stop offset="50%" stop-color="#0d6847" />
      <stop offset="100%" stop-color="#073825" />
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="92" height="92" rx="22" fill="url(#hdrBrandBg)" stroke="rgba(255,255,255,0.22)" stroke-width="2" />
  <line x1="76" y1="24" x2="53" y2="47" stroke="#9adbc0" stroke-width="8" stroke-linecap="round" />
  <path d="M 42 40 L 60 58 L 55 64 L 36 45 Z" fill="#ffffff" />
  <path d="M 34 48 L 52 66 L 38 82 C 30 78, 22 70, 18 62 Z" fill="#ffffff" />
  <line x1="34" y1="76" x2="43" y2="63" stroke="#073825" stroke-width="3" stroke-linecap="round" />
  <line x1="27" y1="69" x2="36" y2="56" stroke="#073825" stroke-width="3" stroke-linecap="round" />
  <path d="M 74 56 Q 74 65 83 65 Q 74 65 74 74 Q 74 65 65 65 Q 74 65 74 56 Z" fill="#ffffff" />
  <circle cx="62" cy="79" r="3.5" fill="#9adbc0" />
</svg>`;

export function renderEditorialHead(opts: {
  title: string;
  description: string;
  canonical: string;
  robots?: string;
  ogType?: string;
  jsonLd?: unknown;
  extraStyles?: string;
}): string {
  const safeTitle = escapeHtml(opts.title);
  const safeDesc = escapeHtml(opts.description);
  const safeCanon = escapeHtml(opts.canonical);
  const robots = escapeHtml(opts.robots || "index, follow, max-image-preview:large, max-snippet:-1");
  const ogType = escapeHtml(opts.ogType || "website");
  const schemaHtml = opts.jsonLd
    ? `<script type="application/ld+json">${typeof opts.jsonLd === "string" ? opts.jsonLd : JSON.stringify(opts.jsonLd)}</script>`
    : "";

  return `<head>
  <meta name="color-scheme" content="light" />
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}" />
  <meta name="robots" content="${robots}">
  <link rel="canonical" href="${safeCanon}" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20261031b" />
  <link rel="icon" type="image/png" sizes="64x64" href="/favicon.png?v=20261031b" />
  <link rel="shortcut icon" href="/favicon.ico?v=20261031b" />
  <link rel="apple-touch-icon" href="/icon-192.png?v=20261031b" />

  <meta property="og:type" content="${ogType}" />
  <meta property="og:site_name" content="SWEEPR Cleaner" />
  <meta property="og:locale" content="en_GB" />
  <meta property="og:url" content="${safeCanon}" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:image" content="https://sweeprcleaner.com/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${safeCanon}" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDesc}" />
  <meta name="twitter:image" content="https://sweeprcleaner.com/og-image.png" />

  ${schemaHtml}

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&amp;family=JetBrains+Mono:wght@400;500;600;700&amp;family=Plus+Jakarta+Sans:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/sweepr-editorial.css" />
  ${opts.extraStyles ? `<style>${opts.extraStyles}</style>` : ""}
  <script src="/attribution.js" defer></script>
  <script src="/analytics.js" defer></script>
</head>`;
}

export type ActiveNavSection = "guides" | "tools" | "pricing" | "about" | "compare" | "study" | "support" | "none";

export function renderSiteHeader(active: ActiveNavSection = "none"): string {
  const link = (href: string, label: string, id: ActiveNavSection) =>
    `<a href="${href}" class="nav-link"${active === id ? ' aria-current="page"' : ""}>${label}</a>`;

  return `<a href="#main-content" class="skip-link">Skip to main content</a>
  <header class="site-header">
    <div class="site-header-inner">
      <a href="/" class="brand-link" aria-label="SWEEPR Cleaner Home">
        <span class="brand-mark" aria-hidden="true">${BRAND_SVG_MARK}</span>
        <span>SWEEPR Cleaner</span>
      </a>

      <nav class="header-nav" aria-label="Primary Navigation">
        ${link("/clean", "Guides", "guides")}
        ${link("/tools", "Tools", "tools")}
        ${link("/pricing", "Pricing", "pricing")}
        ${link("/about", "About", "about")}
        ${link("/dashboard", "My Account", "none")}
      </nav>

      <div class="header-controls">
        <a href="/download" class="header-cta btn-press">Free Download</a>
        <button type="button" id="siteMobileMenuBtn" class="mobile-nav-toggle" aria-expanded="false" aria-controls="siteMobileDrawer">Menu</button>
      </div>
    </div>
    <div id="siteMobileDrawer" class="mobile-nav-drawer" aria-label="Mobile Navigation">
      <div class="mobile-nav-links">
        <a href="/clean">Storage Guides</a>
        <a href="/tools">Cleaner Tools</a>
        <a href="/safe-to-delete">Path Safety Checker</a>
        <a href="/tools/pc-cache-calculator">PC Cache Calculator</a>
        <a href="/state-of-windows-storage">2026 Storage Study</a>
        <a href="/pricing">Pricing</a>
        <a href="/about">About</a>
        <a href="/dashboard">My Account</a>
      </div>
    </div>
    <script>
      (function(){
        var btn = document.getElementById('siteMobileMenuBtn');
        var drawer = document.getElementById('siteMobileDrawer');
        if (!btn || !drawer) return;
        btn.addEventListener('click', function(){
          var isOpen = drawer.classList.toggle('open');
          btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
          btn.textContent = isOpen ? 'Close' : 'Menu';
        });
      })();
    </script>
  </header>`;
}

export function renderSiteFooter(): string {
  return `<footer class="site-footer">
    <div class="footer-inner">
      <div>
        <strong>SWEEPR Cleaner</strong> (Benjamin Cook) &middot; Storage cleanup for Windows, Mac, Android &amp; iOS (Safari web companion / TestFlight beta).<br />
        <span>&copy; 2026 Benjamin Cook t/a SWEEPR Cleaner. All rights reserved.</span>
      </div>
      <div class="footer-links">
        <a href="/clean">Storage Guides</a>
        <a href="/tools">Tools</a>
        <a href="/safe-to-delete">Path Checker</a>
        <a href="/tools/pc-cache-calculator">Cache Calculator</a>
        <a href="/state-of-windows-storage">2026 Storage Study</a>
        <a href="/vs/ccleaner">vs CCleaner</a>
        <a href="/alternatives/ccleaner">CCleaner Alternatives</a>
        <a href="/vs/cleanmymac">vs CleanMyMac</a>
        <a href="/alternatives/cleanmymac">CleanMyMac Alternatives</a>
        <a href="/pricing">Pricing</a>
        <a href="/about">About</a>
        <a href="/support">Support</a>
        <a href="/privacy">Privacy Policy</a>
        <a href="/terms">Terms of Service</a>
        <a href="/refund">Refund Policy</a>
        <a href="#cookie-preferences" data-cookie-preferences="true" onclick="if(window.sweeprOpenCookiePreferences){window.sweeprOpenCookiePreferences();return false;}">Cookie Preferences</a>
      </div>
    </div>
  </footer>`;
}

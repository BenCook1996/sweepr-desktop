/**
 * Sweepr Cleaner Unified Analytics & Interaction Engine
 * Powers Google Analytics 4, Meta Pixel (Facebook / Instagram), and Microsoft Clarity (Heatmaps & Session Replays).
 *
 * Configuration:
 * 1. Define GA_MEASUREMENT_ID, META_PIXEL_ID, CLARITY_PROJECT_ID in server/.env, OR
 * 2. Paste your IDs directly into window.SWEEPR_ANALYTICS_CONFIG below.
 */

(function () {
  // Global config fallback
  window.SWEEPR_ANALYTICS_CONFIG = Object.assign(
    {
      gaMeasurementId: 'G-CM9FPJV4C2',
      metaPixelId: '',       // e.g. '123456789012345'
      clarityProjectId: '',  // e.g. 'abcdef1234'
      debug: false
    },
    window.SWEEPR_ANALYTICS_CONFIG || {}
  );

  let isInitialized = false;

  function isBotOrAutomatedVisitor() {
    try {
      if (navigator.webdriver === true) return true;
      const ua = navigator.userAgent || '';
      if (
        /(HeadlessChrome|PhantomJS|Playwright|Puppeteer|Slurp|bingbot|Googlebot|AhrefsBot|SemrushBot|PTST|Lighthouse|Chrome-Lighthouse|PageSpeed|GTmetrix|Pingdom|UptimeRobot|SweeprSEOAudit)/i.test(
          ua
        )
      ) {
        return true;
      }
      if (
        window.location.search.includes('no_track=1') ||
        localStorage.getItem('sweepr_ignore_analytics') === '1'
      ) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  function log(...args) {
    if (window.SWEEPR_ANALYTICS_CONFIG.debug || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      console.log('%c[Sweepr Analytics]', 'color: #10b981; font-weight: bold;', ...args);
    }
  }

  // Safe stubs so calls never fail even before third-party scripts load
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () {
    window.dataLayer.push(arguments);
  };

  if (!window.fbq) {
    const fbq = function () {
      if (fbq.callMethod) {
        fbq.callMethod.apply(fbq, arguments);
      } else {
        fbq.queue.push(arguments);
      }
    };
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];
    window.fbq = fbq;
    window._fbq = fbq;
  }

  window.clarity = window.clarity || function () {
    (window.clarity.q = window.clarity.q || []).push(arguments);
  };

  /**
   * Universal Event Tracker
   * Dispatches events to GA4, Meta Pixel, Microsoft Clarity, and local attribution engine.
   */
  window.sweeprTrack = function (eventName, params = {}) {
    if (isBotOrAutomatedVisitor()) return;
    const attr = window.sweeprAttribution ? window.sweeprAttribution.getPayload() : {};
    const enrichedParams = Object.assign(
      {
        page_path: window.location.pathname,
        page_title: document.title,
        timestamp: new Date().toISOString(),
        utm_source: attr.utm_source || '',
        utm_medium: attr.utm_medium || '',
        utm_campaign: attr.utm_campaign || '',
        gclid: attr.gclid || '',
        fbclid: attr.fbclid || '',
        ref: attr.ref || ''
      },
      params
    );

    log('Event tracked:', eventName, enrichedParams);

    // 1. Google Analytics 4
    try {
      window.gtag('event', eventName, enrichedParams);
    } catch (e) {
      log('GA track error:', e);
    }

    // 2. Meta Pixel (Map standard events)
    try {
      if (window.fbq) {
        switch (eventName) {
          case 'page_view':
            window.fbq('track', 'PageView');
            break;
          case 'view_pricing':
            window.fbq('trackCustom', 'ViewPricing', enrichedParams);
            break;
          case 'begin_checkout':
          case 'initiate_checkout':
            window.fbq('track', 'InitiateCheckout', {
              content_name: enrichedParams.plan || 'Sweepr Cleaner Pro',
              currency: enrichedParams.currency || 'GBP',
              value: enrichedParams.value || 49.99
            });
            break;
          case 'generate_lead':
          case 'lead':
            window.fbq('track', 'Lead', enrichedParams);
            break;
          case 'purchase':
            window.fbq('track', 'Purchase', {
              content_name: enrichedParams.plan || 'Sweepr Cleaner Pro',
              currency: enrichedParams.currency || 'GBP',
              value: enrichedParams.value || 49.99
            });
            break;
          case 'download_click':
            window.fbq('trackCustom', 'DownloadClick', enrichedParams);
            break;
          default:
            window.fbq('trackCustom', eventName, enrichedParams);
        }
      }
    } catch (e) {
      log('Meta Pixel track error:', e);
    }

    // 3. Microsoft Clarity Custom Tags
    try {
      if (window.clarity) {
        window.clarity('set', eventName, 'true');
      }
    } catch (e) {}

    // 4. First-party Telemetry Bridge for A/B Experiments (A9)
    try {
      if (eventName === 'experiment_exposure' || eventName === 'experiment_conversion') {
        fetch('/v1/telemetry/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          body: JSON.stringify({
            event_name: eventName,
            platform: 'web',
            attribution_id: enrichedParams.attribution_id || undefined,
            metadata: enrichedParams
          })
        }).catch(function () {});
      }
    } catch (e) {}
  };

  /**
   * Initializes GA4, Meta Pixel, and Microsoft Clarity once IDs are available
   */
  function initProviders(cfg) {
    if (isInitialized) return;
    isInitialized = true;

    if (isBotOrAutomatedVisitor()) {
      log('Skipping analytics initialization for bot or automated visitor.');
      return;
    }

    const attr = window.sweeprAttribution ? window.sweeprAttribution.getPayload() : {};

    // 1. Google Analytics 4
    if (cfg.gaMeasurementId && cfg.gaMeasurementId.startsWith('G-')) {
      log('Initializing Google Analytics 4 with ID:', cfg.gaMeasurementId);
      const gaScript = document.createElement('script');
      gaScript.async = true;
      gaScript.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(cfg.gaMeasurementId)}`;
      document.head.appendChild(gaScript);

      window.gtag('js', new Date());
      window.gtag('config', cfg.gaMeasurementId, {
        send_page_view: true,
        campaign_source: attr.utm_source || undefined,
        campaign_medium: attr.utm_medium || undefined,
        campaign_name: attr.utm_campaign || undefined,
        campaign_term: attr.utm_term || undefined,
        campaign_content: attr.utm_content || undefined
      });
    }

    // 2. Meta Pixel
    if (cfg.metaPixelId && /^\d+$/.test(cfg.metaPixelId.trim())) {
      log('Initializing Meta Pixel with ID:', cfg.metaPixelId);
      const fbScript = document.createElement('script');
      fbScript.async = true;
      fbScript.src = 'https://connect.facebook.net/en_US/fbevents.js';
      document.head.appendChild(fbScript);

      window.fbq('init', cfg.metaPixelId.trim());
      window.fbq('track', 'PageView');
    }

    // 3. Microsoft Clarity (Heatmaps & Session Replays)
    if (cfg.clarityProjectId && cfg.clarityProjectId.trim().length >= 4) {
      log('Initializing Microsoft Clarity with Project ID:', cfg.clarityProjectId);
      const clarityScript = document.createElement('script');
      clarityScript.async = true;
      clarityScript.src = `https://www.clarity.ms/tag/${encodeURIComponent(cfg.clarityProjectId.trim())}`;
      document.head.appendChild(clarityScript);

      if (attr.utm_source) window.clarity('set', 'utm_source', attr.utm_source);
      if (attr.utm_campaign) window.clarity('set', 'utm_campaign', attr.utm_campaign);
      if (attr.ref) window.clarity('set', 'referral', attr.ref);
    }

    // Note: Do NOT call window.sweeprTrack('page_view') here because gtag('config', ..., { send_page_view: true })
    // and fbq('track', 'PageView') above already send the initial page view. Calling sweeprTrack('page_view')
    // here previously caused duplicate page_view events (2.00 views/user) on every page load.

    // 4. Fire page-entry funnel events AFTER providers are initialized
    const path = window.location.pathname || '/';
    if (/^\/(?:de\/|fr\/|es\/)?pricing(?:\.html)?$/i.test(path)) {
      window.sweeprTrack('view_pricing', { transport_type: 'beacon' });
    }
    if (/^\/(?:de\/|fr\/|es\/)?(?:order|checkout)(?:\.html)?$/i.test(path)) {
      const urlParams = new URLSearchParams(window.location.search);
      const selectedPlan = urlParams.get('plan') || 'annual';
      const activePricing = window.__SWEEPR_PRICING__ || {};
      const activeCurrency = String(window.SWEEPR_CHECKOUT_CURRENCY || activePricing.currencyCode || activePricing.currency || urlParams.get('currency') || 'GBP').toUpperCase();
      const divisor = activePricing.zeroDecimal ? 1 : 100;
      const pricingPlanVal = selectedPlan === 'monthly'
        ? (activePricing.monthly ? Number(activePricing.monthly) : activePricing.monthlyAmount ? +(Number(activePricing.monthlyAmount) / divisor).toFixed(2) : 9.99)
        : (selectedPlan === 'six_month' || selectedPlan === '6month')
        ? (activePricing.sixMonth ? Number(activePricing.sixMonth) : activePricing.sixMonthAmount ? +(Number(activePricing.sixMonthAmount) / divisor).toFixed(2) : 38.99)
        : (activePricing.annual ? Number(activePricing.annual) : activePricing.annualAmount ? +(Number(activePricing.annualAmount) / divisor).toFixed(2) : 49.99);
      const defaultVal = Number(window.SWEEPR_CHECKOUT_PRICE) || pricingPlanVal;
      window.sweeprTrack('begin_checkout', {
        plan: selectedPlan,
        currency: activeCurrency,
        value: defaultVal,
        items: [{ item_id: `sweepr_${selectedPlan}`, item_name: `SWEEPR Cleaner Pro (${selectedPlan})`, price: defaultVal, quantity: 1 }],
        transport_type: 'beacon'
      });
      window.sweeprTrack('initiate_checkout', {
        plan: `SWEEPR Cleaner Pro (${selectedPlan})`,
        currency: activeCurrency,
        value: defaultVal,
        transport_type: 'beacon'
      });
    }

    // 5. Fire purchase event on /checkout/success if server injected window.SWEEPR_PURCHASE_EVENT
    if (window.SWEEPR_PURCHASE_EVENT && typeof window.SWEEPR_PURCHASE_EVENT === 'object') {
      const p = window.SWEEPR_PURCHASE_EVENT;
      const txId = String(p.transaction_id || p.subscription_id || ('tx_' + Date.now()));
      const dedupKey = 'sweepr_ga4_purchased_' + txId;
      let alreadyTracked = false;
      try {
        alreadyTracked = sessionStorage.getItem(dedupKey) === '1';
        if (!alreadyTracked) sessionStorage.setItem(dedupKey, '1');
      } catch (e) {}
      if (!alreadyTracked) {
        const val = Number(p.value) || 49.99;
        const curr = String(p.currency || 'GBP').toUpperCase();
        const planTier = String(p.plan || 'annual');
        const planName = String(p.plan_label || p.plan || 'SWEEPR Cleaner Pro');
        window.sweeprTrack('purchase', {
          transaction_id: txId,
          value: val,
          currency: curr,
          plan: planTier,
          items: [{ item_id: `sweepr_${planTier}`, item_name: planName, price: val, quantity: 1 }],
          transport_type: 'beacon'
        });
      }
    }
  }

  /**
   * Fetch configuration from server or use window defaults
   */
  async function loadConfigAndStart() {
    try {
      const res = await fetch('/api/analytics-config');
      if (res.ok) {
        const serverConfig = await res.json();
        if (serverConfig.gaMeasurementId && !window.SWEEPR_ANALYTICS_CONFIG.gaMeasurementId) {
          window.SWEEPR_ANALYTICS_CONFIG.gaMeasurementId = serverConfig.gaMeasurementId;
        }
        if (serverConfig.metaPixelId && !window.SWEEPR_ANALYTICS_CONFIG.metaPixelId) {
          window.SWEEPR_ANALYTICS_CONFIG.metaPixelId = serverConfig.metaPixelId;
        }
        if (serverConfig.clarityProjectId && !window.SWEEPR_ANALYTICS_CONFIG.clarityProjectId) {
          window.SWEEPR_ANALYTICS_CONFIG.clarityProjectId = serverConfig.clarityProjectId;
        }
      }
    } catch (e) {
      log('Could not fetch /api/analytics-config, using inline config.');
    }

    initProviders(window.SWEEPR_ANALYTICS_CONFIG);
  }

  /**
   * Setup Automatic Interaction Tracking across the DOM
   */
  function setupInteractionListeners() {
    // 1. Scroll Depth Tracking (25%, 50%, 75%, 90%)
    const scrollMilestones = { 25: false, 50: false, 75: false, 90: false };
    window.addEventListener(
      'scroll',
      function () {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        if (docHeight <= 0) return;
        const percent = Math.floor((scrollTop / docHeight) * 100);

        for (const threshold of [25, 50, 75, 90]) {
          if (percent >= threshold && !scrollMilestones[threshold]) {
            scrollMilestones[threshold] = true;
            window.sweeprTrack('scroll_depth', { depth_percent: threshold });
          }
        }
      },
      { passive: true }
    );

    // 2. Dwell Time Engagement (30s, 60s, 120s)
    setTimeout(() => window.sweeprTrack('dwell_time', { seconds: 30 }), 30000);
    setTimeout(() => window.sweeprTrack('dwell_time', { seconds: 60 }), 60000);
    setTimeout(() => window.sweeprTrack('dwell_time', { seconds: 120 }), 120000);

    // 3. Click Interactions (CTAs, Downloads, Navigation)
    document.addEventListener('click', function (e) {
      const target = e.target.closest('a, button');
      if (!target) return;

      const href = target.getAttribute('href') || '';
      const text = (target.innerText || target.textContent || '').trim().slice(0, 50);

      // Download Buttons (matches /download, /download?platform=*, direct installer links, and Play Beta)
      if (
        href === '/download' ||
        href.startsWith('/download?') ||
        href.includes('SWEEPRCleaner.') ||
        href.includes('Sweepr_Setup.') ||
        href.includes('.apk') ||
        href.includes('.dmg') ||
        href.includes('play.google.com/apps/testing/com.sweepr.app')
      ) {
        const platMatch = href.match(/[?&]platform=([a-z0-9_-]+)/i);
        const platform = platMatch
          ? platMatch[1].toLowerCase()
          : href.includes('play.google.com') || href.includes('.apk')
          ? 'android'
          : href.includes('.dmg')
          ? 'mac'
          : 'windows';
        window.sweeprTrack('download_click', {
          button_text: text,
          button_id: target.id || '',
          href: href,
          platform: platform,
          transport_type: 'beacon'
        });
        window.sweeprTrack('file_download', {
          file_name: href,
          file_extension: platform,
          link_text: text,
          link_url: href,
          transport_type: 'beacon'
        });

        // A3 (Action 1.8): Record pending Windows installer download & schedule SmartScreen recovery banner
        if (platform === 'windows') {
          const attrId =
            window.sweeprAttribution && typeof window.sweeprAttribution.getAttributionId === 'function'
              ? window.sweeprAttribution.getAttributionId()
              : '';
          try {
            localStorage.setItem(
              'sweepr_dl_pending',
              JSON.stringify({ ts: Date.now(), href: href, page: window.location.pathname, attribution_id: attrId })
            );
            localStorage.removeItem('sweepr_smartscreen_recovery_dismissed');
          } catch (err) {}
          try {
            fetch('/v1/telemetry/event', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event_name: 'installer_downloaded',
                platform: 'windows',
                attribution_id: attrId || undefined,
                metadata: { href: href, page: window.location.pathname, attribution_id: attrId || undefined }
              }),
              keepalive: true
            }).catch(function () {});
          } catch (err) {}
          // If the user is still on this browser tab 12 seconds after downloading without completing install,
          // surface the non-intrusive SmartScreen walkthrough & web-checkout recovery bar immediately.
          setTimeout(function () {
            checkAndShowSmartScreenRecovery(true);
          }, 12000);
        }
      }

      // Order / Checkout CTAs
      else if (
        href.startsWith('/order') ||
        href.includes('/order?') ||
        target.id === 'checkoutBtn' ||
        target.id === 'submitBtn'
      ) {
        window.sweeprTrack('checkout_cta_click', {
          button_text: text,
          button_id: target.id || '',
          href: href,
          transport_type: 'beacon'
        });
      }

      // Pricing Page Navigation
      else if (href === '/pricing' || href.endsWith('/pricing')) {
        window.sweeprTrack('view_pricing_click', {
          button_text: text,
          transport_type: 'beacon'
        });
      }

      // Exit Modal CTA: CLAIM DISCOUNT
      else if (target.onclick && target.onclick.toString().includes('activateDiscountOffer')) {
        window.sweeprTrack('discount_modal_claimed', { button_text: text });
      }
    });

    // 4. Checkout Email Lead Listener
    const path = window.location.pathname || '/';
    if (/^\/(?:de\/|fr\/|es\/)?(?:order|checkout)(?:\.html)?$/i.test(path)) {
      const emailInput = document.getElementById('email');
      if (emailInput) {
        emailInput.addEventListener(
          'blur',
          function () {
            if (emailInput.value && emailInput.value.includes('@')) {
              const attrId =
                window.sweeprAttribution && typeof window.sweeprAttribution.getAttributionId === 'function'
                  ? window.sweeprAttribution.getAttributionId()
                  : '';
              const activePricing = window.__SWEEPR_PRICING__ || {};
              const activeCurrency = String(window.SWEEPR_CHECKOUT_CURRENCY || activePricing.currencyCode || activePricing.currency || 'GBP').toUpperCase();
              const leadValue = Number(window.SWEEPR_CHECKOUT_PRICE) || (activePricing.annual ? Number(activePricing.annual) : activePricing.annualAmount ? +(Number(activePricing.annualAmount) / (activePricing.zeroDecimal ? 1 : 100)).toFixed(2) : 49.99);
              window.sweeprTrack('generate_lead', {
                form: 'checkout_email',
                currency: activeCurrency,
                value: leadValue,
                transport_type: 'beacon'
              });
              window.sweeprTrack('lead', {
                form: 'checkout_email',
                transport_type: 'beacon'
              });
              try {
                fetch('/api/lead', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    email: emailInput.value.trim(),
                    attribution_id: attrId || undefined
                  }),
                  keepalive: true
                }).catch(function () {});
              } catch (err) {}
            }
          },
          { once: true }
        );
      }
    }
  }

  /**
   * A3 (Action 1.8): Download-Without-Install SmartScreen Recovery Banner
   * Detects visitors who clicked a Windows .exe/.msi download (`sweepr_dl_pending`)
   * without marking `sweepr_app_installed`, and renders a non-intrusive recovery bar
   * with the 2-step "More info -> Run anyway" guide, SHA-256 verification, and instant /order fallback.
   */
  function renderSmartScreenRecoveryBanner() {
    if (typeof document === 'undefined' || !document.body) return;
    if (document.getElementById('sweepr-smartscreen-recovery-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'sweepr-smartscreen-recovery-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Windows Installation Assistant');
    banner.style.cssText =
      'position:fixed;bottom:16px;right:16px;left:16px;max-width:680px;margin:0 auto;z-index:99999;' +
      'background:#111613;color:#f4f5f3;border:2px solid #0d6847;border-radius:16px;padding:14px 18px;' +
      'box-shadow:0 16px 40px rgba(0,0,0,0.35);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;line-height:1.45;';

    const attrId =
      window.sweeprAttribution && typeof window.sweeprAttribution.getAttributionId === 'function'
        ? window.sweeprAttribution.getAttributionId()
        : '';

    banner.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">' +
        '<div>' +
          '<div style="font-weight:800;color:#9adbc0;font-size:13.5px;margin-bottom:4px;">' +
            '🛡️ Did Windows stop the install? (SWEEPRCleaner.exe)' +
          '</div>' +
          '<div style="color:#e2e8f0;margin-bottom:8px;">' +
            'Because v0.1.0 is a freshly compiled 5 MB native Rust binary: <strong>Step 1: Click &ldquo;More info&rdquo;</strong> &rarr; <strong>Step 2: Click &ldquo;Run anyway&rdquo;</strong>. ' +
            '<span title="38E5CDF33C813709C0B4124334CD10EA797C70AAED0C598F4CCB5A5F477544AA" style="color:#94a3b8;font-family:ui-monospace,Consolas,monospace;font-size:11px;">(SHA-256: 38E5CDF3...F77544AA)</span>' +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">' +
            '<button type="button" id="sweepr-recovery-installed-btn" style="background:#0d6847;color:#ffffff;border:none;border-radius:9px;padding:7px 13px;font-weight:800;font-size:12px;cursor:pointer;">' +
              'I Installed It ✓' +
            '</button>' +
            '<a href="/order?plan=annual&utm_source=smartscreen_recovery" id="sweepr-recovery-order-link" style="background:#ffffff;color:#111613;text-decoration:none;border-radius:9px;padding:7px 13px;font-weight:800;font-size:12px;display:inline-block;">' +
              'Activate Web Pro License First (/order) &rarr;' +
            '</a>' +
            '<a href="/download?platform=windows" id="sweepr-recovery-redownload-link" style="color:#9adbc0;text-decoration:underline;font-weight:700;font-size:12px;padding:4px 6px;">' +
              'Re-download .exe' +
            '</a>' +
          '</div>' +
        '</div>' +
        '<button type="button" id="sweepr-recovery-dismiss-btn" aria-label="Dismiss installation helper" style="background:transparent;border:none;color:#94a3b8;font-size:16px;font-weight:700;cursor:pointer;padding:2px 6px;">✕</button>' +
      '</div>';

    document.body.appendChild(banner);

    window.sweeprTrack('smartscreen_recovery_shown', { page_path: window.location.pathname });
    try {
      fetch('/v1/telemetry/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_name: 'smartscreen_recovery_shown',
          platform: 'windows',
          attribution_id: attrId || undefined,
          metadata: { page: window.location.pathname, attribution_id: attrId || undefined }
        }),
        keepalive: true
      }).catch(function () {});
    } catch (err) {}

    const installedBtn = document.getElementById('sweepr-recovery-installed-btn');
    if (installedBtn) {
      installedBtn.addEventListener('click', function () {
        try {
          localStorage.setItem('sweepr_app_installed', '1');
          localStorage.removeItem('sweepr_dl_pending');
        } catch (err) {}
        window.sweeprTrack('smartscreen_recovery_clicked', { action: 'installed_confirmed' });
        try {
          fetch('/v1/telemetry/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event_name: 'app_installed',
              platform: 'windows',
              attribution_id: attrId || undefined,
              metadata: { source: 'smartscreen_recovery_confirmed', attribution_id: attrId || undefined }
            }),
            keepalive: true
          }).catch(function () {});
        } catch (err) {}
        banner.remove();
      });
    }

    const orderLink = document.getElementById('sweepr-recovery-order-link');
    if (orderLink) {
      orderLink.addEventListener('click', function () {
        window.sweeprTrack('smartscreen_recovery_clicked', { action: 'web_checkout_fallback' });
        try {
          fetch('/v1/telemetry/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event_name: 'smartscreen_recovery_clicked',
              platform: 'windows',
              attribution_id: attrId || undefined,
              metadata: { action: 'web_checkout_fallback', attribution_id: attrId || undefined }
            }),
            keepalive: true
          }).catch(function () {});
        } catch (err) {}
      });
    }

    const dismissBtn = document.getElementById('sweepr-recovery-dismiss-btn');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () {
        try {
          localStorage.setItem('sweepr_smartscreen_recovery_dismissed', '1');
        } catch (err) {}
        try {
          fetch('/v1/telemetry/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event_name: 'smartscreen_recovery_clicked',
              platform: 'windows',
              attribution_id: attrId || undefined,
              metadata: { action: 'dismissed', attribution_id: attrId || undefined }
            }),
            keepalive: true
          }).catch(function () {});
        } catch (err) {}
        banner.remove();
      });
    }
  }

  function checkAndShowSmartScreenRecovery(forceImmediate) {
    if (isBotOrAutomatedVisitor()) return;
    try {
      if (localStorage.getItem('sweepr_app_installed') === '1') return;
      if (localStorage.getItem('sweepr_smartscreen_recovery_dismissed') === '1') return;
      const rawPending = localStorage.getItem('sweepr_dl_pending');
      if (rawPending) {
        const parsed = JSON.parse(rawPending);
        const ageMs = Date.now() - Number(parsed.ts || 0);
        if (ageMs >= 0 && ageMs <= 7 * 86400 * 1000 && (forceImmediate || ageMs >= 1500)) {
          renderSmartScreenRecoveryBanner();
          return;
        }
      }
      // Step 2: Also check server-side attribution recovery status (for visitors flagged at T+30m returning on a new session)
      const attrId =
        window.sweeprAttribution && typeof window.sweeprAttribution.getAttributionId === 'function'
          ? window.sweeprAttribution.getAttributionId()
          : '';
      if (attrId) {
        fetch('/api/telemetry/recovery-status?attribution_id=' + encodeURIComponent(attrId))
          .then(function (r) {
            return r.ok ? r.json() : null;
          })
          .then(function (data) {
            if (data && data.should_show_banner) {
              renderSmartScreenRecoveryBanner();
            }
          })
          .catch(function () {});
      }
    } catch (err) {}
  }

  window.sweeprShowSmartScreenRecovery = renderSmartScreenRecoveryBanner;

  // Bootstrapping
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      loadConfigAndStart();
      setupInteractionListeners();
      checkAndShowSmartScreenRecovery(false);
    });
  } else {
    loadConfigAndStart();
    setupInteractionListeners();
    checkAndShowSmartScreenRecovery(false);
  }
})();

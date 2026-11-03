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
      const defaultVal = selectedPlan === 'monthly' ? 9.99 : selectedPlan === 'six_month' ? 29.99 : 49.99;
      window.sweeprTrack('begin_checkout', {
        plan: selectedPlan,
        currency: 'GBP',
        value: defaultVal,
        items: [{ item_id: `sweepr_${selectedPlan}`, item_name: `SWEEPR Cleaner Pro (${selectedPlan})`, price: defaultVal, quantity: 1 }],
        transport_type: 'beacon'
      });
      window.sweeprTrack('initiate_checkout', {
        plan: `SWEEPR Cleaner Pro (${selectedPlan})`,
        currency: 'GBP',
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
        const planName = String(p.plan || 'SWEEPR Cleaner Pro');
        window.sweeprTrack('purchase', {
          transaction_id: txId,
          value: val,
          currency: curr,
          plan: planName,
          items: [{ item_id: 'sweepr_pro', item_name: planName, price: val, quantity: 1 }],
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
              window.sweeprTrack('generate_lead', {
                form: 'checkout_email',
                currency: 'GBP',
                value: 49.99,
                transport_type: 'beacon'
              });
              window.sweeprTrack('lead', {
                form: 'checkout_email',
                transport_type: 'beacon'
              });
            }
          },
          { once: true }
        );
      }
    }
  }

  // Bootstrapping
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      loadConfigAndStart();
      setupInteractionListeners();
    });
  } else {
    loadConfigAndStart();
    setupInteractionListeners();
  }
})();

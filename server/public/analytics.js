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
          case 'initiate_checkout':
            window.fbq('track', 'InitiateCheckout', {
              content_name: enrichedParams.plan || 'Sweepr Cleaner Pro',
              currency: enrichedParams.currency || 'GBP',
              value: enrichedParams.value || 1.99
            });
            break;
          case 'lead':
            window.fbq('track', 'Lead', enrichedParams);
            break;
          case 'purchase':
            window.fbq('track', 'Purchase', {
              content_name: enrichedParams.plan || 'Sweepr Cleaner Pro',
              currency: enrichedParams.currency || 'GBP',
              value: enrichedParams.value || 1.99
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

    // Fire initial page view
    window.sweeprTrack('page_view');
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

      // Download Buttons
      if (href === '/download' || href.includes('SWEEPRCleaner.exe') || href.includes('Sweepr_Setup.exe') || href.includes('.apk')) {
        window.sweeprTrack('download_click', {
          button_text: text,
          href: href
        });
      }

      // Order / Checkout CTAs
      else if (href.startsWith('/order') || target.id === 'checkoutBtn' || target.id === 'submitBtn') {
        window.sweeprTrack('checkout_cta_click', {
          button_text: text,
          href: href
        });
      }

      // Pricing Page Navigation
      else if (href === '/pricing') {
        window.sweeprTrack('view_pricing_click', { button_text: text });
      }

      // Exit Modal CTA: CLAIM DISCOUNT
      else if (target.onclick && target.onclick.toString().includes('activateDiscountOffer')) {
        window.sweeprTrack('discount_modal_claimed', { button_text: text });
      }
    });

    // 4. Special Page Detectors
    const path = window.location.pathname;

    // Pricing Page view
    if (path === '/pricing') {
      window.sweeprTrack('view_pricing');
    }

    // Checkout Page view -> Initiate Checkout
    if (path === '/order') {
      window.sweeprTrack('initiate_checkout', {
        plan: 'Sweepr Cleaner Pro',
        currency: 'GBP',
        value: 1.99
      });

      // Track email input completion
      const emailInput = document.getElementById('email');
      if (emailInput) {
        emailInput.addEventListener(
          'blur',
          function () {
            if (emailInput.value && emailInput.value.includes('@')) {
              window.sweeprTrack('lead', { form: 'checkout_email' });
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

/**
 * Sweepr First-Party Marketing Attribution Engine
 * Captures UTM parameters, ad click IDs (Google Ads, Meta, Microsoft/Bing, TikTok, Impact),
 * and Sweepr referral codes across user sessions with 90-day persistence.
 */
(function () {
  const STORAGE_KEY_FIRST = 'sweepr_first_touch';
  const STORAGE_KEY_LAST = 'sweepr_last_touch';
  const COOKIE_DAYS = 90;

  function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
  }

  function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    const expires = 'expires=' + d.toUTCString();
    document.cookie = name + '=' + encodeURIComponent(JSON.stringify(value)) + ';' + expires + ';path=/;SameSite=Lax';
  }

  function getCookie(name) {
    const cname = name + '=';
    const decoded = decodeURIComponent(document.cookie);
    const ca = decoded.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i].trim();
      if (c.indexOf(cname) === 0) {
        try {
          return JSON.parse(c.substring(cname.length));
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  function captureCurrentTouch() {
    const params = new URLSearchParams(window.location.search);
    const touch = {
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
      utm_content: params.get('utm_content') || '',
      utm_term: params.get('utm_term') || '',
      gclid: params.get('gclid') || '',
      gbraid: params.get('gbraid') || '',
      wbraid: params.get('wbraid') || '',
      fbclid: params.get('fbclid') || '',
      msclkid: params.get('msclkid') || '',
      ttclid: params.get('ttclid') || '',
      irclickid: params.get('irclickid') || '',
      ref: params.get('ref') || params.get('referral') || '',
      referrer: document.referrer || '',
      landing_page: window.location.pathname,
      timestamp: new Date().toISOString()
    };

    const hasMarketingParams =
      touch.utm_source ||
      touch.utm_medium ||
      touch.utm_campaign ||
      touch.gclid ||
      touch.fbclid ||
      touch.msclkid ||
      touch.ref;

    // First touch: Set once and keep permanently for 90 days
    let firstTouch = null;
    try {
      firstTouch = JSON.parse(localStorage.getItem(STORAGE_KEY_FIRST));
    } catch {}
    if (!firstTouch) {
      firstTouch = getCookie(STORAGE_KEY_FIRST);
    }
    if (!firstTouch) {
      firstTouch = touch;
      try {
        localStorage.setItem(STORAGE_KEY_FIRST, JSON.stringify(firstTouch));
      } catch {}
      setCookie(STORAGE_KEY_FIRST, firstTouch, COOKIE_DAYS);
    }

    // Last touch: Update whenever new campaign params arrive or on direct entry
    if (hasMarketingParams || !getCookie(STORAGE_KEY_LAST)) {
      try {
        localStorage.setItem(STORAGE_KEY_LAST, JSON.stringify(touch));
      } catch {}
      setCookie(STORAGE_KEY_LAST, touch, COOKIE_DAYS);
    }
  }

  captureCurrentTouch();

  window.sweeprAttribution = {
    getFirstTouch: function () {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY_FIRST)) || getCookie(STORAGE_KEY_FIRST) || {};
      } catch {
        return getCookie(STORAGE_KEY_FIRST) || {};
      }
    },
    getLastTouch: function () {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY_LAST)) || getCookie(STORAGE_KEY_LAST) || {};
      } catch {
        return getCookie(STORAGE_KEY_LAST) || {};
      }
    },
    getPayload: function () {
      const last = this.getLastTouch();
      const first = this.getFirstTouch();
      return {
        utm_source: last.utm_source || first.utm_source || '',
        utm_medium: last.utm_medium || first.utm_medium || '',
        utm_campaign: last.utm_campaign || first.utm_campaign || '',
        utm_content: last.utm_content || first.utm_content || '',
        utm_term: last.utm_term || first.utm_term || '',
        gclid: last.gclid || first.gclid || '',
        fbclid: last.fbclid || first.fbclid || '',
        msclkid: last.msclkid || first.msclkid || '',
        irclickid: last.irclickid || first.irclickid || '',
        ref: last.ref || first.ref || '',
        referrer: last.referrer || first.referrer || '',
        landing_page: first.landing_page || ''
      };
    }
  };

  // Helper: auto-append ref to order links if present
  document.addEventListener('DOMContentLoaded', function () {
    const attr = window.sweeprAttribution.getPayload();
    if (!attr.ref) return;
    const orderLinks = document.querySelectorAll('a[href="/order"], a[href^="/order?"]');
    orderLinks.forEach(function (link) {
      try {
        const u = new URL(link.href, window.location.origin);
        if (!u.searchParams.has('ref')) {
          u.searchParams.set('ref', attr.ref);
          link.href = u.pathname + u.search;
        }
      } catch {}
    });
  });
})();

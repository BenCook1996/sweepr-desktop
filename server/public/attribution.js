/**
 * Sweepr First-Party Marketing Attribution Engine
 * Captures UTM parameters, ad click IDs (Google Ads, Meta, Microsoft/Bing, TikTok, Impact),
 * persistent first-party attribution_id (for A3 Download-Without-Install Recovery),
 * and Sweepr referral codes across user sessions with 90-day persistence.
 */
(function () {
  const STORAGE_KEY_FIRST = 'sweepr_first_touch';
  const STORAGE_KEY_LAST = 'sweepr_last_touch';
  const STORAGE_KEY_ATTR_ID = 'sweepr_attr_id';
  const COOKIE_DAYS = 90;

  function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
  }

  function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    const expires = 'expires=' + d.toUTCString();
    const secureAttr = window.location.protocol === 'https:' ? ';Secure' : '';
    const encoded = typeof value === 'string' ? encodeURIComponent(value) : encodeURIComponent(JSON.stringify(value));
    document.cookie = name + '=' + encoded + ';' + expires + ';path=/;SameSite=Lax' + secureAttr;
  }

  function getCookie(name) {
    const cname = name + '=';
    const decoded = decodeURIComponent(document.cookie);
    const ca = decoded.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i].trim();
      if (c.indexOf(cname) === 0) {
        const raw = c.substring(cname.length);
        try {
          return JSON.parse(raw);
        } catch {
          return raw || null;
        }
      }
    }
    return null;
  }

  function ensureAttributionId() {
    const urlAttr = getQueryParam('attribution_id').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80);
    let attrId = urlAttr.length >= 6 ? urlAttr : '';
    if (!attrId) {
      try {
        attrId = (localStorage.getItem(STORAGE_KEY_ATTR_ID) || '').trim();
      } catch {}
    }
    if (!attrId) {
      const ck = getCookie(STORAGE_KEY_ATTR_ID);
      if (typeof ck === 'string' && ck.length >= 6) attrId = ck;
    }
    if (!attrId) {
      const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8);
      attrId = 'attr_' + Date.now().toString(36) + '_' + rand;
    }
    try {
      localStorage.setItem(STORAGE_KEY_ATTR_ID, attrId);
    } catch {}
    setCookie(STORAGE_KEY_ATTR_ID, attrId, COOKIE_DAYS);
    return attrId;
  }

  function captureCurrentTouch() {
    const params = new URLSearchParams(window.location.search);
    const touch = {
      attribution_id: ensureAttributionId(),
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
      ref: params.get('ref') || params.get('aff') || params.get('referral') || '',
      referrer: document.referrer || '',
      landing_page: window.location.pathname,
      timestamp: new Date().toISOString()
    };

    if (touch.ref) {
      try {
        fetch('/api/affiliate/click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: touch.ref,
            landing_path: touch.landing_page,
            referrer: touch.referrer
          }),
          keepalive: true
        }).catch(function () {});
      } catch (e) {}
    }

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
    if (!firstTouch || typeof firstTouch !== 'object') {
      const ckFirst = getCookie(STORAGE_KEY_FIRST);
      if (ckFirst && typeof ckFirst === 'object') firstTouch = ckFirst;
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

  const activeAttributionId = ensureAttributionId();
  captureCurrentTouch();

  window.sweeprAttribution = {
    getAttributionId: function () {
      return ensureAttributionId() || activeAttributionId;
    },
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
        attribution_id: this.getAttributionId(),
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

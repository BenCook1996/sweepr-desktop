#!/usr/bin/env node
/**
 * Zero-Dependency Google Cloud Service Account API Client (RS256 JWT via node:crypto)
 *
 * Authenticates headlessly using a single free Google Cloud Service Account JSON key
 * provided via:
 *   1. `process.env.GCP_SERVICE_ACCOUNT_JSON` (raw JSON string, base64-encoded JSON, or file path)
 *   2. `.gcp-service-account.json` in the repository root
 *
 * Supported Free Google APIs:
 *   - Google Search Console API (`webmasters/v3` & `searchconsole/v1`):
 *       • `searchAnalytics.query` (7d/28d clicks, impressions, CTR, position by query/page)
 *       • `sitemaps.submit` & `sitemaps.list`
 *       • `urlInspection.index.inspect` (live index coverage state & 404 verification)
 *   - Google Analytics Data API v1 (`analyticsdata.googleapis.com/v1beta`):
 *       • `properties/{propertyId}:runReport` (activeUsers, sessions, engagementRate, key events)
 *   - Content API for Shopping / Merchant API (`shoppingcontent.googleapis.com/v2.1`):
 *       • `productstatuses.list` (GMC Free Listings approval & disapproval diagnostics)
 *   - Google Play Android Developer API (`androidpublisher.googleapis.com/v3`):
 *       • `edits` & `tracks.list` (Alpha/Production release status)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_KEY_FILE = path.resolve(__dirname, '..', '..', '.gcp-service-account.json');

const tokenCache = new Map();

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function loadServiceAccountCredentials() {
  const rawEnv = (process.env.GCP_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '').trim();
  if (rawEnv) {
    try {
      if (rawEnv.startsWith('{')) {
        return JSON.parse(rawEnv);
      }
      if (fs.existsSync(rawEnv)) {
        return JSON.parse(fs.readFileSync(rawEnv, 'utf8'));
      }
      const decoded = Buffer.from(rawEnv, 'base64').toString('utf8');
      if (decoded.trim().startsWith('{')) {
        return JSON.parse(decoded);
      }
    } catch (err) {
      console.warn(`[GCP Service Account] Failed to parse GCP_SERVICE_ACCOUNT_JSON: ${err.message}`);
    }
  }

  const credFileEnv = (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (credFileEnv && fs.existsSync(credFileEnv)) {
    try {
      return JSON.parse(fs.readFileSync(credFileEnv, 'utf8'));
    } catch {}
  }

  if (fs.existsSync(DEFAULT_KEY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DEFAULT_KEY_FILE, 'utf8'));
    } catch {}
  }

  return null;
}

export function hasServiceAccountCredentials() {
  const creds = loadServiceAccountCredentials();
  return Boolean(creds && creds.client_email && creds.private_key);
}

export function getServiceAccountEmail() {
  const creds = loadServiceAccountCredentials();
  return creds?.client_email || null;
}

export function createSignedJwtAssertion(creds, scopes = ['https://www.googleapis.com/auth/webmasters']) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: creds.client_email,
    scope: Array.isArray(scopes) ? scopes.join(' ') : String(scopes),
    aud: creds.token_uri || 'https://oauth2.googleapis.com/token',
    iat: nowSec - 30,
    exp: nowSec + 3500
  };
  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const normalizedPem = String(creds.private_key).replace(/\\n/g, '\n');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(normalizedPem);
  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

export async function getGoogleAccessToken(
  scopes = [
    'https://www.googleapis.com/auth/webmasters',
    'https://www.googleapis.com/auth/analytics.readonly'
  ]
) {
  const creds = loadServiceAccountCredentials();
  if (!creds || !creds.client_email || !creds.private_key) {
    throw new Error('No Google Cloud Service Account credentials found in GCP_SERVICE_ACCOUNT_JSON.');
  }

  const scopeKey = Array.isArray(scopes) ? [...scopes].sort().join(' ') : String(scopes);
  const cached = tokenCache.get(scopeKey);
  if (cached && cached.expiresAtMs > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const assertion = createSignedJwtAssertion(creds, scopes);
  const tokenUri = creds.token_uri || 'https://oauth2.googleapis.com/token';
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion
  });

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Google OAuth2 token exchange failed (HTTP ${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const expiresAtMs = Date.now() + Number(data.expires_in || 3500) * 1000;
  tokenCache.set(scopeKey, { accessToken: data.access_token, expiresAtMs });
  return data.access_token;
}

/**
 * 1. Google Search Console: Search Analytics Query
 */
export async function fetchGscSearchAnalytics({
  siteUrl,
  startDate,
  endDate,
  dimensions = ['page'],
  rowLimit = 500,
  dimensionFilterGroups = undefined
}) {
  const token = await getGoogleAccessToken(['https://www.googleapis.com/auth/webmasters.readonly']);
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const payload = {
    startDate,
    endDate,
    dimensions,
    rowLimit
  };
  if (dimensionFilterGroups) payload.dimensionFilterGroups = dimensionFilterGroups;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000)
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GSC searchAnalytics.query failed for ${siteUrl} (HTTP ${res.status}): ${txt.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.rows || [];
}

/**
 * 2. Google Search Console: List Sitemaps & Indexed Counts
 */
export async function listGscSitemaps({ siteUrl }) {
  const token = await getGoogleAccessToken(['https://www.googleapis.com/auth/webmasters.readonly']);
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`;
  const res = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GSC sitemaps.list failed for ${siteUrl} (HTTP ${res.status}): ${txt.slice(0, 240)}`);
  }
  const json = await res.json();
  return json.sitemap || [];
}

/**
 * 3. Google Search Console: Submit Sitemap
 */
export async function submitGscSitemap({ siteUrl, feedpath }) {
  const token = await getGoogleAccessToken(['https://www.googleapis.com/auth/webmasters']);
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`;
  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0' },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok && res.status !== 204) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GSC sitemaps.submit failed for ${feedpath} (HTTP ${res.status}): ${txt.slice(0, 240)}`);
  }
  return { ok: true, siteUrl, feedpath, submittedAt: new Date().toISOString() };
}

/**
 * 4. Google Search Console: URL Inspection API (`urlInspection.index.inspect`)
 * Quota: 2,000 requests/day per property (Free)
 */
export async function inspectGscUrl({ siteUrl, inspectionUrl, languageCode = 'en-GB' }) {
  const token = await getGoogleAccessToken(['https://www.googleapis.com/auth/webmasters.readonly']);
  const endpoint = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ inspectionUrl, siteUrl, languageCode }),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GSC urlInspection failed for ${inspectionUrl} (HTTP ${res.status}): ${txt.slice(0, 240)}`);
  }
  const json = await res.json();
  const idx = json?.inspectionResult?.indexStatusResult || {};
  return {
    inspectionUrl,
    verdict: idx.verdict || 'UNKNOWN',
    coverageState: idx.coverageState || 'Unknown',
    robotsTxtState: idx.robotsTxtState || 'UNKNOWN',
    indexingState: idx.indexingState || 'UNKNOWN',
    lastCrawlTime: idx.lastCrawlTime || null,
    pageFetchState: idx.pageFetchState || 'UNKNOWN',
    googleCanonical: idx.googleCanonical || null,
    userCanonical: idx.userCanonical || null
  };
}

/**
 * 5. Google Analytics 4 Data API v1beta (`properties/{propertyId}:runReport`)
 */
export async function fetchGa4FunnelReport({
  propertyId,
  startDate = '28daysAgo',
  endDate = 'today',
  keyEventNames = [
    'file_download',
    'installer_download',
    'checkout_cta_click',
    'view_pricing',
    'begin_checkout',
    'generate_lead',
    'add_payment_info',
    'purchase',
    'leak_test_completed',
    'throttling_test_completed'
  ]
}) {
  const token = await getGoogleAccessToken(['https://www.googleapis.com/auth/analytics.readonly']);
  const endpoint = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;

  // 1. Property summary metrics
  const summaryRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'sessions' },
        { name: 'engagedSessions' },
        { name: 'engagementRate' },
        { name: 'eventCount' }
      ]
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!summaryRes.ok) {
    const txt = await summaryRes.text().catch(() => '');
    throw new Error(`GA4 runReport summary failed for ${propertyId} (HTTP ${summaryRes.status}): ${txt.slice(0, 240)}`);
  }
  const summaryJson = await summaryRes.json();
  const sVals = summaryJson?.rows?.[0]?.metricValues || [];
  const summary = {
    activeUsers: Number(sVals[0]?.value || 0),
    sessions: Number(sVals[1]?.value || 0),
    engagedSessions: Number(sVals[2]?.value || 0),
    engagementRate: Number((Number(sVals[3]?.value || 0) * 100).toFixed(2)),
    totalEvents: Number(sVals[4]?.value || 0)
  };

  // 2. Event breakdown
  const eventsRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: { values: keyEventNames }
        }
      }
    }),
    signal: AbortSignal.timeout(15000)
  });

  const events = {};
  if (eventsRes.ok) {
    const eventsJson = await eventsRes.json();
    for (const row of eventsJson.rows || []) {
      const evName = row.dimensionValues?.[0]?.value;
      if (evName) {
        events[evName] = {
          count: Number(row.metricValues?.[0]?.value || 0),
          users: Number(row.metricValues?.[1]?.value || 0)
        };
      }
    }
  }

  // 3. Page-level sessions & conversions
  const pagesRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagementRate' }],
      limit: 250
    }),
    signal: AbortSignal.timeout(15000)
  });

  const pages = {};
  if (pagesRes.ok) {
    const pagesJson = await pagesRes.json();
    for (const row of pagesJson.rows || []) {
      const pagePath = row.dimensionValues?.[0]?.value;
      if (pagePath) {
        pages[pagePath] = {
          sessions: Number(row.metricValues?.[0]?.value || 0),
          activeUsers: Number(row.metricValues?.[1]?.value || 0),
          engagementRatePct: Number((Number(row.metricValues?.[2]?.value || 0) * 100).toFixed(1))
        };
      }
    }
  }

  return { propertyId, startDate, endDate, summary, events, pages };
}

/**
 * 6. Google Merchant Center Content API v2.1 (`productstatuses.list`)
 */
export async function fetchGmcProductStatuses({ merchantId, maxResults = 250 }) {
  const token = await getGoogleAccessToken(['https://www.googleapis.com/auth/content']);
  const statuses = [];
  let pageToken = '';
  for (let page = 0; page < 15; page++) {
    const url = new URL(`https://shoppingcontent.googleapis.com/content/v2.1/${merchantId}/productstatuses`);
    url.searchParams.set('maxResults', String(maxResults));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`GMC productstatuses.list failed for ${merchantId} (HTTP ${res.status}): ${txt.slice(0, 240)}`);
    }
    const json = await res.json();
    if (Array.isArray(json.resources)) statuses.push(...json.resources);
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return statuses;
}

/**
 * 7. Google Play Developer API v3 (`edits` -> `tracks.list`)
 */
export async function fetchPlayAppTrackStatus({ packageName = 'com.sweepr.vpn' }) {
  const token = await getGoogleAccessToken(['https://www.googleapis.com/auth/androidpublisher']);
  const baseUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`;
  const editRes = await fetch(`${baseUrl}/edits`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15000)
  });
  if (!editRes.ok) {
    const txt = await editRes.text().catch(() => '');
    throw new Error(`Google Play edits.insert failed for ${packageName} (HTTP ${editRes.status}): ${txt.slice(0, 240)}`);
  }
  const editJson = await editRes.json();
  const editId = editJson.id;
  const tracksRes = await fetch(`${baseUrl}/edits/${editId}/tracks`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000)
  });
  const tracksJson = tracksRes.ok ? await tracksRes.json() : { tracks: [] };
  // Clean up read-only edit
  await fetch(`${baseUrl}/edits/${editId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000)
  }).catch(() => {});
  return tracksJson.tracks || [];
}

export function formatIsoDateDaysAgo(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// Self-Test CLI (`node scripts/lib/google-cloud-api.mjs --self-test`)
if (process.argv[1] && path.resolve(process.argv[1]) === __filename && process.argv.includes('--self-test')) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const testPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const jwt = createSignedJwtAssertion(
    {
      client_email: 'self-test@sweepr-cloud-automations.iam.gserviceaccount.com',
      private_key: testPem,
      token_uri: 'https://oauth2.googleapis.com/token'
    },
    ['https://www.googleapis.com/auth/webmasters']
  );
  const parts = jwt.split('.');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  const sigBuf = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const valid = verifier.verify(publicKey, sigBuf);
  if (!valid) {
    console.error('❌ [GCP Service Account Self-Test] RS256 JWT signature verification failed');
    process.exit(1);
  }
  console.log('✅ [GCP Service Account Self-Test] Zero-dependency RS256 JWT signer verified (3-part JWS valid).');
  if (hasServiceAccountCredentials()) {
    console.log(`✅ [GCP Service Account Self-Test] Found credentials for: ${getServiceAccountEmail()}`);
  } else {
    console.log('ℹ️  [GCP Service Account Self-Test] GCP_SERVICE_ACCOUNT_JSON not set in local env — cloud scripts will run in local-snapshot fallback mode until secret is added.');
  }
}

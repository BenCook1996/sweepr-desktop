#!/usr/bin/env node
/**
 * SWEEPR Cleaner (sweeprcleaner.com) — Headless Cloud GSC & GA4 Sync
 *
 * Pulls live 28d Search Analytics (`sc-domain:sweeprcleaner.com`), submits `sitemap.xml`,
 * and updates `server/src/data/gsc-seed.json` & `server/src/data/indexing-queue.json`
 * when `GCP_SERVICE_ACCOUNT_JSON` is configured in GitHub Actions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hasServiceAccountCredentials,
  getServiceAccountEmail,
  fetchGscSearchAnalytics,
  submitGscSitemap,
  inspectGscUrl,
  fetchGa4FunnelReport,
  formatIsoDateDaysAgo
} from './lib/google-cloud-api.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(SERVER_DIR, 'src', 'data');
const GSC_SEED_PATH = path.join(DATA_DIR, 'gsc-seed.json');
const INDEXING_QUEUE_PATH = path.join(DATA_DIR, 'indexing-queue.json');
const GSC_SITE_URL = process.env.GSC_SITE_URL || 'sc-domain:sweeprcleaner.com';
const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || '559447184';

async function runCleanerCloudGscSync() {
  if (!hasServiceAccountCredentials()) {
    console.log('ℹ️  [SWEEPR Cleaner Cloud GSC Sync] GCP_SERVICE_ACCOUNT_JSON not set — keeping existing gsc-seed.json.');
    return;
  }

  console.log(`[SWEEPR Cleaner Cloud GSC Sync] Authenticated as ${getServiceAccountEmail()}`);
  const endDate = formatIsoDateDaysAgo(2);
  const start28d = formatIsoDateDaysAgo(30);

  let seed = { updatedAt: new Date().toISOString(), rows: [] };
  if (fs.existsSync(GSC_SEED_PATH)) {
    try {
      seed = { ...seed, ...JSON.parse(fs.readFileSync(GSC_SEED_PATH, 'utf8')) };
    } catch {}
  }

  try {
    const rows = await fetchGscSearchAnalytics({
      siteUrl: GSC_SITE_URL,
      startDate: start28d,
      endDate,
      dimensions: ['query', 'page'],
      rowLimit: 500
    });
    if (rows.length > 0) {
      seed.updatedAt = new Date().toISOString();
      seed.liveGscRows = rows.map((r) => ({
        query: r.keys?.[0] || '',
        page: r.keys?.[1] || '',
        clicks: Number(r.clicks || 0),
        impressions: Number(r.impressions || 0),
        ctr: Number(r.ctr || 0),
        position: Number(Number(r.position || 0).toFixed(1))
      }));
      fs.writeFileSync(GSC_SEED_PATH, JSON.stringify(seed, null, 2) + '\n', 'utf8');
      console.log(`✅ [SWEEPR Cleaner Cloud GSC Sync] Updated gsc-seed.json with ${rows.length} live query/page rows.`);
    }
  } catch (err) {
    console.warn(`[SWEEPR Cleaner Cloud GSC Sync] Notice: ${err.message}`);
  }

  try {
    await submitGscSitemap({ siteUrl: GSC_SITE_URL, feedpath: 'https://sweeprcleaner.com/sitemap.xml' });
    console.log('✅ [SWEEPR Cleaner Cloud GSC Sync] Submitted https://sweeprcleaner.com/sitemap.xml');
  } catch (err) {
    console.warn(`[SWEEPR Cleaner Sitemap Submit] Notice: ${err.message}`);
  }

  if (fs.existsSync(INDEXING_QUEUE_PATH)) {
    try {
      const q = JSON.parse(fs.readFileSync(INDEXING_QUEUE_PATH, 'utf8'));
      const batch = (q.pending_urls || []).slice(0, 6);
      for (const u of batch) {
        await inspectGscUrl({ siteUrl: GSC_SITE_URL, inspectionUrl: u });
      }
      if (batch.length > 0) {
        console.log(`✅ [SWEEPR Cleaner URL Inspection] Inspected ${batch.length} priority canonical URLs.`);
      }
    } catch {}
  }

  try {
    const ga4Report = await fetchGa4FunnelReport({
      propertyId: GA4_PROPERTY_ID,
      startDate: '28daysAgo',
      endDate: 'today'
    });
    seed.ga4Summary = ga4Report.summary;
    seed.ga4Events = ga4Report.events;
    seed.ga4UpdatedAt = new Date().toISOString();
    fs.writeFileSync(GSC_SEED_PATH, JSON.stringify(seed, null, 2) + '\n', 'utf8');
    console.log(`✅ [SWEEPR Cleaner Cloud GA4 Sync] Synced GA4 Property ${GA4_PROPERTY_ID}: ${JSON.stringify(ga4Report.summary)}`);
  } catch (err) {
    console.warn(`[SWEEPR Cleaner Cloud GA4 Sync] Notice (Property ${GA4_PROPERTY_ID}): ${err.message}`);
  }
}

runCleanerCloudGscSync().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { parseHtml, parseSitemap } from "../src/seo/html.js";
import { detectBot } from "../src/seo/bots.js";
import { isPublicHttpUrl, checkBacklink } from "../src/seo/backlinks.js";
import { ctrForPosition } from "../src/seo/router.js";
import { SeoStore } from "../src/seo/store.js";

const { privateKey } = generateKeyPairSync("ed25519");
const ADMIN_PASSWORD = "test-admin-password";
const auth = { authorization: `Basic ${Buffer.from(`admin:${ADMIN_PASSWORD}`).toString("base64")}` };

function setup() {
  const repo = openDb(":memory:");
  const app = createApp({
    repo,
    signingKey: privateKey,
    stripe: null,
    config: {
      publicUrl: "http://test",
      stripeWebhookSecret: "",
      priceActivation: "",
      priceMonthly: "",
      trialDays: 7,
      tokenTtlHours: 72,
      maxDevicesPc: 2,
      maxDevicesMobile: 2,
      devEndpoints: false,
      pastDueGraceDays: 3,
      crmAdminUser: "admin",
      crmAdminPassword: ADMIN_PASSWORD,
    },
  });
  const get = (p: string) => app.request(p, { headers: auth });
  const post = (p: string, body?: unknown) =>
    app.request(p, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  return { repo, app, get, post };
}

async function waitForJob(get: (p: string) => Response | Promise<Response>, id: string) {
  for (let i = 0; i < 200; i++) {
    const j = (await (await get(`/api/crm/seo/jobs/${id}`)).json()) as any;
    if (j.job.status !== "running") return j.job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("job timeout");
}

test("SEO: endpoints require admin auth", async () => {
  const { app } = setup();
  assert.equal((await app.request("/api/crm/seo/overview")).status, 401);
});

test("SEO: html parser extracts on-page signals", () => {
  const p = parseHtml(`<!doctype html><html lang="en"><head><title>Hello &amp; World</title>
    <meta name="description" content="Desc here"><meta name="viewport" content="width=device-width">
    <link rel="canonical" href="https://sweeprcleaner.com/x">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"FAQPage"},{"@type":"HowTo"}]}</script>
    <script type="application/ld+json">{bad json</script></head>
    <body><h1>One</h1><h2>a</h2><p>some words here</p><img src="a.png"><img src="b.png" alt="b">
    <a href="/clean" rel="nofollow">Clean</a><script>var hidden = "not counted";</script></body></html>`);
  assert.equal(p.title, "Hello & World");
  assert.equal(p.metaDescription, "Desc here");
  assert.equal(p.canonical, "https://sweeprcleaner.com/x");
  assert.deepEqual(p.h1, ["One"]);
  assert.equal(p.h2Count, 1);
  assert.equal(p.imagesMissingAlt, 1);
  assert.deepEqual(p.jsonLdTypes.sort(), ["FAQPage", "HowTo"]);
  assert.equal(p.jsonLdErrors, 1);
  assert.equal(p.links[0].rel, "nofollow");
  assert.ok(p.wordCount >= 5 && p.wordCount < 10, `wordCount ${p.wordCount}`);
  assert.deepEqual(parseSitemap("<urlset><url><loc>https://a.com/</loc></url><url><loc> https://a.com/b </loc></url></urlset>"), ["https://a.com/", "https://a.com/b"]);
});

test("SEO: bot detection, SSRF guard and CTR curve", async () => {
  assert.equal(detectBot("Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)"), "ClaudeBot");
  assert.equal(detectBot("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0)"), "OAI-SearchBot");
  assert.equal(detectBot("Mozilla/5.0 (compatible; Googlebot/2.1)"), "Googlebot");
  assert.equal(detectBot("Mozilla/5.0 (Windows NT 10.0) Chrome/128"), null);
  assert.equal(isPublicHttpUrl("http://localhost:8787/"), false);
  assert.equal(isPublicHttpUrl("http://192.168.1.10/"), false);
  assert.equal(isPublicHttpUrl("http://[::ffff:7f00:1]/"), false);
  assert.equal(isPublicHttpUrl("http://[::]/"), false);
  assert.equal(isPublicHttpUrl("http://0.0.0.0/"), false);
  assert.equal(isPublicHttpUrl("http://224.0.0.1/"), false);
  assert.equal(isPublicHttpUrl("http://240.0.0.1/"), false);
  assert.equal(isPublicHttpUrl("http://192.0.2.1/"), false);
  assert.equal(isPublicHttpUrl("http://198.51.100.1/"), false);
  assert.equal(isPublicHttpUrl("http://203.0.113.1/"), false);
  assert.equal(isPublicHttpUrl("http://metadata.google.internal/"), false);
  assert.equal(isPublicHttpUrl("http://0x7f000001/"), false);
  assert.equal(isPublicHttpUrl("http://2130706433/"), false);
  assert.equal(isPublicHttpUrl("http://[ff02::1]/"), false);
  assert.equal(isPublicHttpUrl("http://[fe80::1]/"), false);
  assert.equal(isPublicHttpUrl("http://[fe90::1]/"), false);
  assert.equal(isPublicHttpUrl("http://[fec0::1]/"), false);
  assert.equal(isPublicHttpUrl("http://[100::1]/"), false);
  assert.equal(isPublicHttpUrl("http://[2001:db8::1]/"), false);
  assert.equal(isPublicHttpUrl("http://[0:0:0:0:0:0:0:1]/"), false);
  assert.equal(isPublicHttpUrl("http://[0000:0000:0000:0000:0000:0000:0000:0001]/"), false);
  assert.equal(isPublicHttpUrl("http://[0:0:0:0:0:0:0:0]/"), false);
  assert.equal(isPublicHttpUrl("http://[0:0:0:0:0:0:127.0.0.1]/"), false);
  assert.equal(isPublicHttpUrl("http://[0:0:0:0:0:ffff:127.0.0.1]/"), false);
  assert.equal(isPublicHttpUrl("http://0177.0.0.1/"), false);
  assert.equal(isPublicHttpUrl("http://127.1/"), false);
  assert.equal(isPublicHttpUrl("http://0x7f.0.0.1/"), false);
  assert.equal(isPublicHttpUrl("http://example.com:25/"), false);
  assert.equal(isPublicHttpUrl("http://example.com:22/"), false);
  assert.equal(isPublicHttpUrl("http://example.com:6379/"), false);
  assert.equal(isPublicHttpUrl("http://example.com:3306/"), false);
  assert.equal(isPublicHttpUrl("http://example.com:80/"), true);
  assert.equal(isPublicHttpUrl("https://example.com:443/"), true);
  assert.equal(isPublicHttpUrl("http://example.com:8080/"), true);
  assert.equal(isPublicHttpUrl("https://example.com:8443/"), true);
  assert.equal(isPublicHttpUrl("file:///etc/passwd"), false);
  assert.equal(isPublicHttpUrl("https://www.majorgeeks.com/"), true);
  const blocked = await checkBacklink("http://127.0.0.1/", "sweeprcleaner.com");
  assert.equal(blocked.status, "unreachable");
  assert.equal(ctrForPosition(1), 0.28);
  assert.equal(ctrForPosition(null), 0);
  assert.equal(ctrForPosition(15), 0.01);
});

test("SEO: in-process site audit crawls pSEO pages and records evidence-backed issues", async () => {
  const { get, post } = setup();
  const start = await post("/api/crm/seo/audit/run", { source: "local" });
  assert.equal(start.status, 202);
  const { job } = (await start.json()) as any;
  const done = await waitForJob(get, job.id);
  assert.equal(done.status, "done", done.error ?? "");
  assert.ok(done.result.pages >= 10, `crawled ${done.result.pages}`);

  const audit = (await (await get("/api/crm/seo/audit")).json()) as any;
  const paths = audit.pages.map((p: any) => p.path);
  assert.ok(paths.includes("/clean/folder/winsxs"));
  assert.ok(paths.includes("/pricing"));
  assert.ok(!paths.some((p: string) => p.startsWith("/crm") || p.startsWith("/api")), "must not crawl admin/api");
  const home = audit.pages.find((p: any) => p.path === "/");
  assert.equal(home.http_status, 200);
  assert.ok(home.title);
  for (const p of audit.pages) {
    for (const i of p.issues) {
      assert.ok(i.evidence !== undefined && i.fix, `issue ${i.code} needs evidence + fix`);
      assert.notEqual(i.code, "jsonld_invalid", `page ${p.path} must not have invalid JSON-LD: ${i.evidence}`);
    }
  }
  assert.ok(typeof audit.run.health_score === "number");
});

test("SEO: bot visits are logged and summarised", async () => {
  const { app, get } = setup();
  await app.request("/clean", { headers: { "user-agent": "Mozilla/5.0 (compatible; PerplexityBot/1.0)" } });
  await app.request("/favicon.svg", { headers: { "user-agent": "Mozilla/5.0 (compatible; PerplexityBot/1.0)" } });
  await app.request("/", { headers: { "user-agent": "Mozilla/5.0 Chrome/128" } });
  const bots = (await (await get("/api/crm/seo/bots")).json()) as any;
  assert.equal(bots.by_bot.length, 1);
  assert.equal(bots.by_bot[0].bot, "PerplexityBot");
  assert.equal(bots.by_bot[0].hits, 1, "assets are not logged");
  assert.equal(bots.by_bot[0].type, "ai");
});

test("SEO: keywords seeded; rankings come only from GSC rows", async () => {
  const { repo, get, post } = setup();
  const k1 = (await (await get("/api/crm/seo/keywords")).json()) as any;
  assert.ok(k1.keywords.some((k: any) => k.keyword === "winsxs folder"));
  assert.ok(k1.keywords.every((k: any) => k.position === null), "no GSC data -> no fabricated positions");

  const store = new SeoStore(repo.db);
  store.upsertGscRows([
    { date: "2026-10-10", query: "winsxs folder", page: "https://sweeprcleaner.com/clean/folder/winsxs", clicks: 4, impressions: 100, ctr: 0.04, position: 8 },
    { date: "2026-10-11", query: "winsxs folder", page: "https://sweeprcleaner.com/clean/folder/winsxs", clicks: 6, impressions: 100, ctr: 0.06, position: 6 },
  ]);
  const k2 = (await (await get("/api/crm/seo/keywords")).json()) as any;
  const w = k2.keywords.find((k: any) => k.keyword === "winsxs folder");
  assert.equal(w.position, 7);
  assert.equal(w.clicks, 10);
  assert.equal(w.impressions, 200);
  assert.equal(w.ranking_url, "https://sweeprcleaner.com/clean/folder/winsxs");
  assert.equal(w.potential_clicks_at_1, 56);

  const ov = (await (await get("/api/crm/seo/overview")).json()) as any;
  assert.equal(ov.traffic.current.clicks, 10);
  assert.equal(ov.keywords.distribution.top10, 1);
  assert.equal(ov.authority.own, null, "no OPR key -> no authority number");

  const add = await post("/api/crm/seo/keywords", { keyword: "Disk Cleanup Windows 11", cluster: "head" });
  assert.equal(add.status, 200);
});

test("SEO: outreach rows import as backlinks; homepages flagged instead of faked", async () => {
  const { repo, post, get } = setup();
  repo.addOutreachLog({ who: "x", website: "example.com", url: "https://example.com", how: "Email", category: null, status: "listed" } as any);
  const r = (await (await post("/api/crm/seo/backlinks/import-outreach")).json()) as any;
  assert.ok(r.added >= 1);
  const list = (await (await get("/api/crm/seo/backlinks")).json()) as any;
  assert.ok(list.backlinks.every((b: any) => b.status === "unverified"));
  assert.equal(list.summary.referring_domains, 0, "nothing counts until verified live");
  const bad = await post("/api/crm/seo/backlinks", { source_url: "http://10.0.0.1/admin" });
  assert.equal(bad.status, 400);
});

test("SEO Phase 3: DataForSEO syncs keywords, domain overview, backlinks, link gap & enforces spend cap", async () => {
  const repo = openDb(":memory:");
  const store = new SeoStore(repo.db);
  store.addKeyword("winsxs folder", "pseo-folder", "/clean/folder/winsxs");
  store.addKeyword("pc cleaner", "head", "/");

  const mockDfsFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const ok = (cost: number, result: unknown[]) =>
      new Response(
        JSON.stringify({
          status_code: 20000,
          status_message: "Ok.",
          cost,
          tasks: [{ status_code: 20000, status_message: "Ok.", cost, result }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    if (url.endsWith("/v3/appendix/user_data")) {
      return ok(0, [{ login: "test_user", money: { total: 50, balance: 0.91 } }]);
    }
    if (url.endsWith("/v3/keywords_data/google_ads/search_volume/live")) {
      assert.equal(body[0].location_code, 2840);
      return ok(0.075, [
        {
          keyword: "winsxs folder",
          search_volume: 5400,
          cpc: 1.85,
          competition: "LOW",
          competition_index: 18,
          monthly_searches: [{ year: 2026, month: 9, search_volume: 5400 }],
        },
        {
          keyword: "pc cleaner",
          search_volume: 40500,
          cpc: 4.2,
          competition: "HIGH",
          competition_index: 82,
          monthly_searches: [{ year: 2026, month: 9, search_volume: 40500 }],
        },
      ]);
    }
    if (url.endsWith("/v3/dataforseo_labs/google/bulk_keyword_difficulty/live")) {
      return ok(0.011, [
        {
          items: [
            { keyword: "winsxs folder", keyword_difficulty: 22 },
            { keyword: "pc cleaner", keyword_difficulty: 74 },
          ],
        },
      ]);
    }
    if (url.endsWith("/v3/dataforseo_labs/google/ranked_keywords/live")) {
      return ok(0.015, [
        {
          metrics: {
            organic: {
              pos_1: 1,
              pos_2_3: 2,
              pos_4_10: 5,
              pos_11_20: 9,
              etv: 680.4,
              count: 42,
              estimated_paid_traffic_cost: 1240.5,
            },
          },
          items: [
            {
              keyword_data: {
                keyword: "winsxs folder",
                keyword_info: { search_volume: 5400, cpc: 1.85, competition_level: "LOW", competition: 0.18 },
                keyword_properties: { keyword_difficulty: 22 },
                search_intent_info: { main_intent: "informational" },
              },
              ranked_serp_element: {
                serp_item: {
                  rank_group: 6,
                  url: "https://sweeprcleaner.com/clean/folder/winsxs",
                  etv: 290.5,
                },
              },
            },
            {
              keyword_data: {
                keyword: "delete windows.old safely",
                keyword_info: { search_volume: 1900, cpc: 0.9, competition_level: "LOW", competition: 0.1 },
                keyword_properties: { keyword_difficulty: 15 },
                search_intent_info: { main_intent: "informational" },
              },
              ranked_serp_element: {
                serp_item: {
                  rank_group: 11,
                  url: "https://sweeprcleaner.com/clean/folder/windows-old",
                  etv: 38.0,
                },
              },
            },
          ],
        },
      ]);
    }
    if (url.endsWith("/v3/dataforseo_labs/google/domain_rank_overview/live")) {
      return ok(0.0101, [
        {
          items: [
            {
              metrics: {
                organic: {
                  pos_1: 120,
                  pos_2_3: 240,
                  pos_4_10: 800,
                  pos_11_20: 1500,
                  etv: 185000,
                  count: 24000,
                  estimated_paid_traffic_cost: 410000,
                },
              },
            },
          ],
        },
      ]);
    }
    if (url.endsWith("/v3/backlinks/summary/live")) {
      return ok(0.02, [
        {
          rank: 34,
          backlinks: 128,
          referring_domains: 41,
          referring_domains_nofollow: 11,
          referring_ips: 38,
          broken_backlinks: 2,
          backlinks_spam_score: 4,
          referring_links_attributes: { nofollow: 28 },
        },
      ]);
    }
    if (url.endsWith("/v3/backlinks/bulk_ranks/live")) {
      return ok(0.02, [
        {
          items: [
            { target: "sweeprcleaner.com", rank: 34 },
            { target: "ccleaner.com", rank: 81 },
            { target: "bleachbit.org", rank: 68 },
          ],
        },
      ]);
    }
    if (url.endsWith("/v3/backlinks/backlinks/live")) {
      return ok(0.022, [
        {
          items: [
            {
              domain_from: "majorgeeks.com",
              url_from: "https://www.majorgeeks.com/files/details/sweepr_cleaner.html",
              url_to: "https://sweeprcleaner.com/",
              anchor: "Sweepr Cleaner",
              dofollow: true,
              domain_from_rank: 72,
              page_from_rank: 41,
              first_seen: "2026-09-01 12:00:00 +00:00",
              last_seen: "2026-10-18 12:00:00 +00:00",
            },
          ],
        },
      ]);
    }
    if (url.endsWith("/v3/backlinks/domain_intersection/live")) {
      return ok(0.023, [
        {
          items: [
            {
              domain_intersection: {
                "1": { target: "majorgeeks.com", backlinks: 18, referring_domains: 1, rank: 77, backlinks_spam_score: 2, first_seen: "2024-01-01" },
                "2": { target: "majorgeeks.com", backlinks: 6, referring_domains: 1, rank: 77, backlinks_spam_score: 2, first_seen: "2024-03-01" },
              },
              summary: { intersections_count: 2 },
            },
          ],
        },
      ]);
    }
    throw new Error(`Unexpected URL in mockDfsFetch: ${url}`);
  };

  const { syncDfsKeywords, syncDfsDomainOverview, syncDfsBacklinks, syncDfsCompetitorLinkGap, fetchDfsAccountStatus } = await import("../src/seo/dataforseo.js");
  const cfg = {
    siteUrl: "https://sweeprcleaner.com",
    dataForSeoLogin: "test_user",
    dataForSeoPassword: "test_password",
    dataForSeoLocationCode: 2840,
    dataForSeoLanguageCode: "en",
  };
  const comps = ["ccleaner.com", "bleachbit.org"];

  const status = await fetchDfsAccountStatus(store, cfg, mockDfsFetch);
  assert.equal(status.configured, true);
  assert.equal(status.balance_usd, 0.91);

  const kwRes = await syncDfsKeywords(store, cfg, mockDfsFetch);
  assert.equal(kwRes.search_volume_updated, 2);
  assert.equal(kwRes.kd_updated, 2);
  const winsxs = store.listKeywords().find((k) => k.keyword === "winsxs folder")!;
  assert.equal(winsxs.search_volume, 5400);
  assert.equal(winsxs.kd, 22);
  assert.equal(winsxs.cpc, 1.85);

  const domRes = await syncDfsDomainOverview(store, cfg, comps, true, mockDfsFetch);
  assert.equal(domRes.ranked_keywords_synced, 2);
  const winsxsAfter = store.listKeywords().find((k) => k.keyword === "winsxs folder")!;
  assert.equal(winsxsAfter.serp_position, 6);
  assert.equal(winsxsAfter.search_intent, "informational");

  const blRes = await syncDfsBacklinks(store, cfg, comps, mockDfsFetch);
  assert.equal(blRes.discovered_backlinks_added, 1);
  const ownMetric = store.domainMetrics(["sweeprcleaner.com"])[0];
  assert.equal(ownMetric.dfs_rank, 34);
  assert.equal(ownMetric.dfs_referring_domains, 41);
  assert.equal(ownMetric.dfs_dofollow_rd, 30);
  assert.equal(ownMetric.dfs_dofollow_backlinks, 100);
  assert.equal(ownMetric.dfs_organic_etv, 680.4);

  const gapRes = await syncDfsCompetitorLinkGap(store, cfg, comps, 50, mockDfsFetch);
  assert.equal(gapRes.opportunities_found, 1);
  const pushed = store.pushLinkGapToOutreach("majorgeeks.com");
  assert.equal(pushed.already_existed, false);
  const pushedDup = store.pushLinkGapToOutreach("majorgeeks.com");
  assert.equal(pushedDup.already_existed, true);

  // Spend cap guard prevents accidental overrun
  store.setSetting("dfs_spend_cap_usd", 0.05);
  await assert.rejects(() => syncDfsKeywords(store, cfg, mockDfsFetch), /spend cap reached/i);
});

test("SEO GSC Growth Plan: 301 variant consolidation, competitor pages, and index hygiene", async () => {
  const { app } = setup();

  // 1. Retired 5-variant boilerplate slugs 301-redirect to canonical parent guides
  const retiredChecks: Array<[string, string]> = [
    ["/clean/app/opera-gx-service-worker-cachestorage", "/clean/app/opera-gx-cache"],
    ["/clean/app/medal-tv-media-blob-storage", "/clean/app/medal-tv-cache"],
    ["/clean/app/capcut-pc-service-worker-cachestorage", "/clean/app/capcut-desktop-cache"],
    ["/clean/app/adobe-creative-cloud-service-worker-cachestorage", "/clean/app/creative-cloud-installer-cache"],
    ["/clean/app/elgato-stream-deck-crashpad-dump-logs", "/clean/app/elgato-streamdeck-cache"],
    ["/clean/folder/nvidia-shader-cache", "/clean/app/nvidia-dxcache"],
    ["/clean/folder/package-cache-programdata", "/clean/folder/programdata-package-cache"],
  ];
  for (const [oldPath, expectedTarget] of retiredChecks) {
    const res = await app.request(oldPath);
    assert.equal(res.status, 301, `${oldPath} should 301 redirect`);
    assert.equal(res.headers.get("location"), expectedTarget);
    const targetRes = await app.request(expectedTarget);
    assert.equal(targetRes.status, 200, `${expectedTarget} should return 200 OK`);
  }

  // 2. New competitor comparison and alternative pages return 200 OK with valid schema
  const compPaths = [
    "/vs/ccleaner",
    "/vs/bleachbit",
    "/vs/cleanmypc",
    "/vs/avast-cleanup",
    "/vs/wise-disk-cleaner",
    "/vs/glary-utilities",
    "/alternatives/ccleaner",
    "/alternatives/bleachbit",
    "/alternatives/cleanmypc",
    "/alternatives/avast-cleanup",
    "/alternatives/wise-disk-cleaner",
    "/alternatives/glary-utilities",
  ];
  for (const p of compPaths) {
    const res = await app.request(p);
    assert.equal(res.status, 200, `${p} should return 200`);
    const parsed = parseHtml(await res.text());
    assert.ok(parsed.title && parsed.title.length >= 40, `${p} title present`);
    assert.ok(parsed.canonical?.endsWith(p), `${p} canonical matches`);
    assert.equal(parsed.jsonLdErrors, 0, `${p} JSON-LD valid`);
  }

  // 3. Checkout parameter URLs carry X-Robots-Tag: noindex, nofollow & Cloudflare email link 301s
  const orderRes = await app.request("/order?plan=annual");
  assert.equal(orderRes.headers.get("x-robots-tag"), "noindex, nofollow");
  const cfRes = await app.request("/cdn-cgi/l/email-protection");
  assert.equal(cfRes.status, 301);
  assert.equal(cfRes.headers.get("location"), "/support");

  // 4. 100% Catalog-Wide Title & Meta Description Uniqueness + Sub-Folders Breakdown Table Assertion
  const { getCleanItems, buildPseoTitle, buildPseoDescription, renderPseoPage } = await import("../src/pseo.js");
  const allItems = getCleanItems();
  assert.ok(allItems.length >= 350, `Expected at least 350 canonical clean items, found ${allItems.length}`);

  const seenTitles = new Map<string, string>();
  const seenDescs = new Map<string, string>();
  for (const item of allItems) {
    const title = buildPseoTitle(item);
    const desc = buildPseoDescription(item);
    assert.ok(
      title.length >= 30 && title.length <= 60,
      `Item ${item.slug} title length ${title.length} out of bounds [30..60]: "${title}"`
    );
    assert.ok(
      desc.length >= 70 && desc.length <= 160,
      `Item ${item.slug} description length ${desc.length} out of bounds [70..160]: "${desc}"`
    );
    assert.equal(
      seenTitles.has(title),
      false,
      `Duplicate pSEO title "${title}" between ${seenTitles.get(title)} and ${item.slug}`
    );
    seenTitles.set(title, item.slug);
    assert.equal(
      seenDescs.has(desc),
      false,
      `Duplicate pSEO description "${desc}" between ${seenDescs.get(desc)} and ${item.slug}`
    );
    seenDescs.set(desc, item.slug);
  }

  // Verify Consolidated Master Pages render the Sub-Folders & Cache Locations Breakdown Table
  const operaItem = allItems.find((i) => i.slug === "opera-gx-cache")!;
  assert.ok(operaItem, "opera-gx-cache master guide must exist");
  const operaHtml = renderPseoPage(operaItem);
  assert.ok(
    operaHtml.includes('id="subfolders-breakdown-table"'),
    "Consolidated master page must include id=\"subfolders-breakdown-table\""
  );
  assert.ok(
    operaHtml.includes("Sub-Folders &amp; Cache Locations Breakdown"),
    "Consolidated master page must include Sub-Folders & Cache Locations Breakdown heading"
  );

  // 5. Localized routes (/de, /fr, /es, /:loc/pricing) serve self-referencing canonicals & native metadata
  for (const [locPath, expectedCanon] of [
    ["/de", "https://sweeprcleaner.com/de"],
    ["/fr", "https://sweeprcleaner.com/fr"],
    ["/es", "https://sweeprcleaner.com/es"],
    ["/de/pricing", "https://sweeprcleaner.com/de/pricing"],
    ["/fr/pricing", "https://sweeprcleaner.com/fr/pricing"],
    ["/es/pricing", "https://sweeprcleaner.com/es/pricing"],
  ] as const) {
    const locRes = await app.request(locPath);
    assert.equal(locRes.status, 200);
    const parsedLoc = parseHtml(await locRes.text());
    assert.equal(parsedLoc.canonical, expectedCanon, `${locPath} must self-canonicalize to ${expectedCanon}`);
    assert.ok(
      parsedLoc.title && parsedLoc.title.length >= 30 && parsedLoc.title.length <= 60,
      `${locPath} title length in bounds: "${parsedLoc.title}"`
    );
    assert.ok(
      parsedLoc.metaDescription && parsedLoc.metaDescription.length >= 70 && parsedLoc.metaDescription.length <= 160,
      `${locPath} description length in bounds`
    );
  }

  // 6. /download picker and /checkout/success include canonical/noindex & GA4 purchase event
  const dlPickerRes = await app.request("/download?platform=picker");
  assert.equal(dlPickerRes.status, 200);
  assert.equal(dlPickerRes.headers.get("x-robots-tag"), "noindex, nofollow");
  const dlPickerHtml = await dlPickerRes.text();
  const parsedDl = parseHtml(dlPickerHtml);
  assert.equal(parsedDl.canonical, "https://sweeprcleaner.com/download");
  assert.ok(/noindex/i.test(parsedDl.metaRobots ?? ""), "/download picker must include meta noindex");
  assert.ok(dlPickerHtml.includes('/analytics.js'), "/download picker must load /analytics.js");

  const successRes = await app.request("/checkout/success?web=1&subscription_id=sub_ga4_test");
  assert.equal(successRes.status, 200);
  const successHtml = await successRes.text();
  assert.ok(successHtml.includes('/analytics.js'), "/checkout/success must load /analytics.js");
  assert.ok(successHtml.includes("SWEEPR_PURCHASE_EVENT"), "/checkout/success must inject SWEEPR_PURCHASE_EVENT");
});

test("SEO GSC Server Connection & Inpages S1/S2 Intent-Gap Automation", async () => {
  const { app, get, post } = setup();

  // 1. Runtime GSC config endpoint accepts site_url and validates credentials
  const cfgRes = await post("/api/crm/seo/gsc/config", {
    site_url: "sc-domain:sweeprcleaner.com",
    service_account_json: {
      client_email: "gsc-bot@sweepr-seo.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC\n-----END PRIVATE KEY-----\n",
    },
  });
  assert.equal(cfgRes.status, 200);
  const cfgJson = (await cfgRes.json()) as any;
  assert.equal(cfgJson.ok, true);
  assert.equal(cfgJson.gsc.configured, true);
  assert.equal(cfgJson.gsc.api_credentials_configured, true);
  assert.equal(cfgJson.gsc.auth_mode, "service_account");
  assert.equal(cfgJson.gsc.site_url, "sc-domain:sweeprcleaner.com");
  assert.equal(cfgJson.gsc.service_account, "gsc-bot@sweepr-seo.iam.gserviceaccount.com");

  // 2. Ingest verified sc-domain:sweeprcleaner.com seed rows & run Intent-Gap classifier
  const ingestRes = await post("/api/crm/seo/gsc/ingest", {
    use_seed: true,
    run_intent_gap: true,
    persist_state: false,
  });
  assert.equal(ingestRes.status, 200);
  const ingestJson = (await ingestRes.json()) as any;
  assert.equal(ingestJson.ok, true);
  assert.ok(ingestJson.ingested >= 30, `Expected >= 30 seeded GSC rows, got ${ingestJson.ingested}`);
  assert.equal(ingestJson.gsc.configured, true);

  // 3. Verify GET /api/crm/seo/gsc/intent-gap returns 4-intent distribution & queues
  const gapRes = await get("/api/crm/seo/gsc/intent-gap");
  assert.equal(gapRes.status, 200);
  const gap = (await gapRes.json()) as any;
  assert.equal(gap.configured, true);
  assert.equal(gap.intent_distribution.length, 4);
  const intents = gap.intent_distribution.map((d: any) => d.intent);
  assert.deepEqual(intents, ["informational", "navigational", "commercial", "transactional"]);

  // Verify 14-day CTR cooldown guard is respected
  const steamItem = gap.ctr_rewrite_queue.find((q: any) => q.slug === "steam-depotcache");
  assert.ok(steamItem, "steam-depotcache should appear in CTR rewrite queue");
  assert.equal(steamItem.on_cooldown, true, "steam-depotcache was recently optimized and must be on 14d cooldown");

  const obsItem = gap.ctr_rewrite_queue.find((q: any) => q.slug === "obs-studio-logs-crashes");
  assert.ok(obsItem, "obs-studio-logs-crashes should appear in CTR rewrite queue");
  if (!obsItem.on_cooldown) {
    assert.equal(obsItem.eligible_for_rewrite, true, "obs-studio-logs-crashes is off cooldown and eligible for rewrite");
  } else {
    assert.ok(obsItem.cooldown_days_remaining > 0, "obs-studio-logs-crashes cooldown active");
  }
  const eligibleItem = gap.ctr_rewrite_queue.find((q: any) => q.eligible_for_rewrite === true);
  assert.ok(eligibleItem, "striking distance queue must have items eligible for rewrite");

  // Verify commercial comparison gap & Microsoft Ads cid=255115583 exact-match queue
  assert.ok(gap.commercial_gap_queue.length >= 2, "commercial gap queue populated");
  assert.ok(gap.transactional_ad_queue.length >= 5, "Microsoft Ads exact-match queue populated");
  assert.equal(gap.transactional_ad_queue[0].microsoft_ads_customer_id, "255115583");

  // 4. Verify POST /api/crm/seo/gsc/intent-gap/execute syncs search_intent to seo_keywords
  const execRes = await post("/api/crm/seo/gsc/intent-gap/execute", { persist_state: false });
  assert.equal(execRes.status, 200);
  const execJson = (await execRes.json()) as any;
  assert.equal(execJson.ok, true);
  assert.ok(execJson.keywords_classified_and_synced >= 25);

  const ovRes = await get("/api/crm/seo/overview");
  const ov = (await ovRes.json()) as any;
  assert.equal(ov.providers.gsc.configured, true);
  assert.ok(ov.gsc.intent_gap_last_run !== null);
});

test("SEO A4 Bloat Watch Detector & A5 Listing Freshness Monitor", async () => {
  const { app, get, post } = setup();

  // --- A4: Bloat Watch Detector ---
  // 1. Public /bloat-watch hub and published post return 200 OK with valid JSON-LD
  const hubRes = await app.request("/bloat-watch");
  assert.equal(hubRes.status, 200);
  const parsedHub = parseHtml(await hubRes.text());
  assert.equal(parsedHub.jsonLdErrors, 0);
  assert.ok(parsedHub.title?.includes("Bloat Watch"));

  const postRes = await app.request("/bloat-watch/windows-11-24h2-8gb-update-cache-bug");
  assert.equal(postRes.status, 200);
  const parsedPost = parseHtml(await postRes.text());
  assert.equal(parsedPost.jsonLdErrors, 0);
  assert.deepEqual(parsedPost.jsonLdTypes.sort(), ["Dataset", "Organization", "TechArticle"]);

  // Draft post is not publicly visible before approval/publish
  const draftPublicRes = await app.request("/bloat-watch/logitech-ghub-2026-media-blob-leak");
  assert.equal(draftPublicRes.status, 404);

  // 2. Scan incoming signal -> scores >= 7 -> creates draft with 5-step VM checklist
  const scanRes = await post("/api/crm/seo/bloat-watch/scan", {
    signals: [
      {
        title: "Discord Update Leaves 12.4 GB GPUCache & Code Cache on C Drive After Patch",
        summary: "Users report C: drive full after update due to orphaned %AppData%\\discord\\Cache and GPUCache files.",
        source_name: "Reddit r/discordapp",
        source_url: "https://www.reddit.com/r/discordapp/",
      },
    ],
    fetch_live_feeds: false,
  });
  assert.equal(scanRes.status, 200);
  const scanJson = (await scanRes.json()) as any;
  assert.equal(scanJson.ok, true);
  assert.equal(scanJson.drafts_created, 1);
  assert.ok(scanJson.evaluated[0].relevance_score >= 7);
  const createdSlug = scanJson.evaluated[0].slug;

  // 3. Record VM measurements -> interpolates numbers into article, Reddit reply, and press pitch
  const measureRes = await post(`/api/crm/seo/bloat-watch/${createdSlug}/measure`, {
    before_gb: 12.4,
    after_gb: 0.5,
    tested_os_build: "Windows 11 24H2 (Build 26100)",
    app_version: "Discord Stable 2026.11",
    safe_verdict: "SAFE TO DELETE",
  });
  assert.equal(measureRes.status, 200);
  const measureJson = (await measureRes.json()) as any;
  assert.equal(measureJson.post.measurements.reclaimed_gb, 11.9);
  assert.ok(measureJson.post.reddit_reply_draft.includes("11.9 GB"));
  assert.ok(measureJson.post.press_pitch_draft.includes("11.9 GB"));

  // 4. Publish draft -> now live at /bloat-watch/:slug
  const pubRes = await post(`/api/crm/seo/bloat-watch/${createdSlug}/publish`, { ping_indexnow: false });
  assert.equal(pubRes.status, 200);
  const pubLiveRes = await app.request(`/bloat-watch/${createdSlug}`);
  assert.equal(pubLiveRes.status, 200);

  // --- A5: Listing Freshness & Auto-Publish Monitor ---
  const listRes = await get("/api/crm/seo/listings");
  assert.equal(listRes.status, 200);
  const listJson = (await listRes.json()) as any;
  assert.equal(listJson.expected_version, "0.1.0");
  assert.ok(listJson.listings.length >= 8);

  // Check pad_xml (current v0.1.0) and simulated stale listing on alternativeto (v0.0.9)
  const checkPadRes = await post("/api/crm/seo/listings/check", {
    platform_id: "pad_xml",
    expected_version: "0.1.0",
  });
  assert.equal(checkPadRes.status, 200);
  const checkPadJson = (await checkPadRes.json()) as any;
  assert.equal(checkPadJson.listings[0].version_status, "current");
  assert.equal(checkPadJson.listings[0].detected_version, "0.1.0");

  const checkStaleRes = await post("/api/crm/seo/listings/check", {
    platform_id: "alternativeto",
    expected_version: "0.1.0",
    mock_html: {
      alternativeto: {
        html: '<html><body><h1>SWEEPR Cleaner v0.0.9</h1><a href="https://sweeprcleaner.com">Website</a></body></html>',
        httpStatus: 200,
        hasBacklink: true,
      },
    },
  });
  assert.equal(checkStaleRes.status, 200);
  const checkStaleJson = (await checkStaleRes.json()) as any;
  assert.equal(checkStaleJson.listings[0].version_status, "stale");
  assert.equal(checkStaleJson.listings[0].detected_version, "0.0.9");
  assert.equal(checkStaleJson.listings[0].crm_task_status, "open");
  assert.ok(checkStaleJson.listings[0].crm_task_note.includes("v0.0.9"));

  // Check "v0.1.0 unsigned" detection on softpedia -> even if version string is 0.1.0, unsigned flag triggers stale + open CRM task
  const checkUnsignedRes = await post("/api/crm/seo/listings/check", {
    platform_id: "softpedia",
    expected_version: "0.1.0",
    mock_html: {
      softpedia: {
        html: '<html><body><h1>SWEEPR Cleaner v0.1.0 unsigned</h1><p>Note: Unknown Publisher warning</p><span itemprop="ratingValue">4.8</span><a href="https://sweeprcleaner.com">Website</a></body></html>',
        httpStatus: 200,
        hasBacklink: true,
      },
    },
  });
  assert.equal(checkUnsignedRes.status, 200);
  const checkUnsignedJson = (await checkUnsignedRes.json()) as any;
  assert.equal(checkUnsignedJson.listings[0].version_status, "stale");
  assert.equal(checkUnsignedJson.listings[0].detected_version, "0.1.0");
  assert.equal(checkUnsignedJson.listings[0].detected_rating, "4.8/5");
  assert.equal(checkUnsignedJson.listings[0].crm_task_status, "open");
  assert.ok(checkUnsignedJson.listings[0].crm_task_note.includes("STALE UNSIGNED LISTING"));

  // Verify CRM tasks endpoint returns both open listing rows and synced outreach_logs rows
  const tasksRes = await get("/api/crm/seo/listings/tasks");
  assert.equal(tasksRes.status, 200);
  const tasksJson = (await tasksRes.json()) as any;
  assert.ok(tasksJson.open_count >= 2);
  assert.ok(tasksJson.crm_outreach_tasks.some((t: any) => t.who.includes("[A5 Listing: softpedia]")));

  // Resolve softpedia once updated to signed v0.1.0
  const checkResolvedRes = await post("/api/crm/seo/listings/check", {
    platform_id: "softpedia",
    expected_version: "0.1.0",
    mock_html: {
      softpedia: {
        html: '<html><body><h1>SWEEPR Cleaner v0.1.0 (Authenticode Signed)</h1><span itemprop="ratingValue">4.9</span><a href="https://sweeprcleaner.com">Website</a></body></html>',
        httpStatus: 200,
        hasBacklink: true,
      },
    },
  });
  assert.equal(checkResolvedRes.status, 200);
  const checkResolvedJson = (await checkResolvedRes.json()) as any;
  assert.equal(checkResolvedJson.listings[0].version_status, "current");
  assert.equal(checkResolvedJson.listings[0].crm_task_status, "resolved");
});

test("Phase 1 Actions 1.1, 1.5, 1.6, 1.7, and 1.8 end-to-end verification", async () => {
  const { app, get, post } = setup();

  // Action 1.1: End-to-End Measurement & £0 Probe Verification
  const verifyRes = await post("/api/crm/verify-measurement", {
    utm_source: "bing",
    utm_medium: "cpc",
    msclkid: "msclkid_test_phase1",
  });
  assert.equal(verifyRes.status, 200);
  const verifyJson = (await verifyRes.json()) as any;
  assert.equal(verifyJson.ok, true);
  assert.equal(verifyJson.zero_pound_probe_verified, true);
  assert.equal(verifyJson.ga4_purchase_event_contract.verified, true);
  assert.ok(verifyJson.attribution_fields_verified.includes("msclkid"));

  // Action 1.5: Top 30+ Strike-Zone Title & Meta Rewrite (10 new off-cooldown GSC pages added -> 37 total)
  const webviewRes = await app.request("/clean/folder/localappdata-webview2-ebwebview-cache");
  assert.equal(webviewRes.status, 200);
  const parsedWebview = parseHtml(await webviewRes.text());
  assert.equal(parsedWebview.title, "WebView2 EBWebView Cache: Safe to Delete? (2026) | SWEEPR");
  assert.ok((parsedWebview.title?.length ?? 0) >= 30 && (parsedWebview.title?.length ?? 0) <= 60);
  assert.ok((parsedWebview.metaDescription?.length ?? 0) >= 70 && (parsedWebview.metaDescription?.length ?? 0) <= 160);

  const genshinRes = await app.request("/clean/app/genshin-impact-update-cache");
  assert.equal(genshinRes.status, 200);
  const parsedGenshin = parseHtml(await genshinRes.text());
  assert.equal(parsedGenshin.title, "Genshin Impact Update Cache: Safe to Delete? | SWEEPR");

  // Action 1.6: /safe-to-delete Interactive Checker (Campaign 1 MVP)
  const stdPageRes = await app.request("/safe-to-delete");
  assert.equal(stdPageRes.status, 200);
  const parsedStd = parseHtml(await stdPageRes.text());
  assert.equal(parsedStd.jsonLdErrors, 0);
  assert.ok((parsedStd.title?.length ?? 0) >= 30 && (parsedStd.title?.length ?? 0) <= 60);
  assert.ok((parsedStd.metaDescription?.length ?? 0) >= 70 && (parsedStd.metaDescription?.length ?? 0) <= 160);
  assert.ok(parsedStd.jsonLdTypes.includes("WebApplication"));

  const stdApiRes = await app.request("/api/safe-to-delete/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: [
        "C:\\Program Files (x86)\\Steam\\depotcache, 14.5 GB",
        "C:\\Users\\Benjamin\\AppData\\Local\\NVIDIA\\DXCache, 6.2 GB",
        "C:\\ProgramData\\Package Cache, 9.0 GB",
        "C:\\Windows\\System32",
      ].join("\n"),
    }),
  });
  assert.equal(stdApiRes.status, 200);
  const stdApiJson = (await stdApiRes.json()) as any;
  assert.equal(stdApiJson.ok, true);
  assert.equal(stdApiJson.total_inputs, 4);
  assert.equal(stdApiJson.safe_count, 2);
  assert.equal(stdApiJson.caution_count, 1);
  assert.equal(stdApiJson.danger_count, 1);
  assert.equal(stdApiJson.estimated_reclaimable_gb, 29.7);

  // Action 1.7: Campaign 3 Wave 1 Submission Pack
  const packRes = await get("/api/crm/seo/listings/submission-pack");
  assert.equal(packRes.status, 200);
  const packJson = (await packRes.json()) as any;
  assert.equal(packJson.release_version, "0.1.0");
  assert.equal(
    packJson.hashes.windows_exe_sha256,
    "38E5CDF33C813709C0B4124334CD10EA797C70AAED0C598F4CCB5A5F477544AA"
  );
  assert.equal(
    packJson.hashes.windows_msi_sha256,
    "33E5427E84AB8FC4F3D01DFD17404F7CB38B70B9731A8C2CCFBB62876711933A"
  );
  assert.ok(packJson.wave_1_channels.length >= 7);

  // Action 1.8: A3 Download-Without-Install SmartScreen Recovery Telemetry
  const recoveryEventRes = await app.request("/v1/telemetry/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_name: "smartscreen_recovery_shown",
      platform: "windows",
      metadata: { page: "/download" },
    }),
  });
  assert.equal(recoveryEventRes.status, 200);
  const recoveryClickRes = await app.request("/v1/telemetry/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_name: "smartscreen_recovery_clicked",
      platform: "windows",
      metadata: { action: "web_checkout_fallback" },
    }),
  });
  assert.equal(recoveryClickRes.status, 200);
});

test("A3 Download-Without-Install Recovery: T+30m flag, Step 2 banner, T+2h transactional email & Step 4 outcome logging", async () => {
  const { app, get, post } = setup();

  // 1. Visitor A downloads SWEEPRCleaner.exe and also has an email known from a started checkout (/api/lead)
  const attrA = "attr_a3_prospect_alpha";
  const dlResA = await app.request("/v1/telemetry/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_name: "installer_downloaded",
      platform: "windows",
      attribution_id: attrA,
      metadata: { installer: "SWEEPRCleaner.exe", page: "/download" },
    }),
  });
  assert.equal(dlResA.status, 200);

  const leadResA = await app.request("/api/lead", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "prospect.alpha@example.com",
      attribution_id: attrA,
    }),
  });
  assert.equal(leadResA.status, 200);

  // 2. Visitor B downloads and installs within 5 minutes (< 30m) -> never flagged, email skipped
  const attrB = "attr_a3_fast_beta";
  await app.request("/v1/telemetry/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_name: "installer_downloaded",
      platform: "windows",
      attribution_id: attrB,
    }),
  });
  await app.request("/v1/telemetry/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_name: "app_installed",
      platform: "windows",
      attribution_id: attrB,
    }),
  });

  const statusBRes = await app.request(`/api/telemetry/recovery-status?attribution_id=${attrB}`);
  assert.equal(statusBRes.status, 200);
  const statusB = (await statusBRes.json()) as any;
  assert.equal(statusB.installed, true);
  assert.equal(statusB.should_show_banner, false);
  assert.equal(statusB.recovery_outcome, "installed_within_30m");

  // 3. Step 1: Evaluate at T+31m -> Visitor A is flagged (no app_installed within 30 min)
  const eval30mRes = await post("/api/crm/recovery/evaluate", {
    advance_seconds: 31 * 60,
    send_emails: true,
  });
  assert.equal(eval30mRes.status, 200);
  const eval30m = (await eval30mRes.json()) as any;
  assert.equal(eval30m.newly_flagged_30m, 1);
  assert.equal(eval30m.emails_sent_2h, 0);

  // 4. Step 2: On Visitor A's next site visit, recovery-status triggers the "Did Windows stop the install?" banner
  const statusARes = await app.request(`/api/telemetry/recovery-status?attribution_id=${attrA}`);
  assert.equal(statusARes.status, 200);
  const statusA = (await statusARes.json()) as any;
  assert.equal(statusA.tracked, true);
  assert.equal(statusA.flagged, true);
  assert.equal(statusA.should_show_banner, true);
  assert.equal(statusA.recovery_outcome, "flagged_uninstalled");
  assert.equal(statusA.sha256_exe, "38E5CDF33C813709C0B4124334CD10EA797C70AAED0C598F4CCB5A5F477544AA");
  assert.ok(Array.isArray(statusA.smartscreen_steps) && statusA.smartscreen_steps.length === 2);

  // Banner shown on next site visit
  await app.request("/v1/telemetry/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_name: "smartscreen_recovery_shown",
      platform: "windows",
      attribution_id: attrA,
      metadata: { page: "/pricing" },
    }),
  });

  // 5. Step 3: Evaluate at T+2h (125m) -> sends ONE transactional help email to prospect.alpha@example.com
  const eval2hRes = await post("/api/crm/recovery/evaluate", {
    advance_seconds: 125 * 60,
    send_emails: true,
  });
  assert.equal(eval2hRes.status, 200);
  const eval2h = (await eval2hRes.json()) as any;
  assert.equal(eval2h.emails_sent_2h, 1);

  // Calling evaluate again at T+3h sends 0 duplicate emails
  const eval3hRes = await post("/api/crm/recovery/evaluate", {
    advance_seconds: 180 * 60,
    send_emails: true,
  });
  const eval3h = (await eval3hRes.json()) as any;
  assert.equal(eval3h.emails_sent_2h, 0);

  // 6. Step 4: Visitor A launches the installer after the recovery flow -> logs outcome `recovered_after_email`
  await app.request("/v1/telemetry/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_name: "app_installed",
      platform: "windows",
      attribution_id: attrA,
    }),
  });

  const statsRes = await get("/api/crm/recovery/stats");
  assert.equal(statsRes.status, 200);
  const statsJson = (await statsRes.json()) as any;
  assert.equal(statsJson.summary.tracked_recovery_sessions, 2);
  assert.equal(statsJson.summary.flagged_30m_count, 1);
  assert.equal(statsJson.summary.banner_shown_count, 1);
  assert.equal(statsJson.summary.transactional_emails_sent_2h, 1);
  assert.equal(statsJson.summary.installed_within_30m, 1);
  assert.equal(statsJson.summary.recovered_after_email, 1);
  assert.equal(statsJson.summary.total_activated_or_recovered, 2);
  assert.equal(statsJson.summary.activation_rate_pct, 100);
});

test("GSC Merchant Listings JSON-LD validation: pricing, index, and safe-to-delete include image, hasMerchantReturnPolicy, and shippingDetails", async () => {
  const { app } = setup();

  // 1. Verify all pages emitting Product / SoftwareApplication / WebApplication with Offers have zero Merchant Listing issues
  const offerPages = ["/", "/pricing", "/de/pricing", "/fr/pricing", "/es/pricing", "/safe-to-delete"];
  for (const path of offerPages) {
    const res = await app.request(path);
    assert.equal(res.status, 200, `${path} should return 200 OK`);
    const parsed = parseHtml(await res.text());
    assert.equal(parsed.jsonLdErrors, 0, `${path} must have 0 JSON-LD syntax errors`);
    assert.deepEqual(
      parsed.merchantListingIssues,
      [],
      `${path} must have 0 GSC Merchant Listings issues, got: ${parsed.merchantListingIssues.join("; ")}`
    );
  }

  // 2. Verify parseHtml detects missing image, hasMerchantReturnPolicy, and shippingDetails when an Offer is incomplete
  const brokenProductHtml = `<!doctype html><html><head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Broken Product",
        "offers": {
          "@type": "Offer",
          "price": "9.99",
          "priceCurrency": "GBP"
        }
      }
    </script>
  </head><body></body></html>`;
  const brokenParsed = parseHtml(brokenProductHtml);
  assert.equal(brokenParsed.merchantListingIssues.length, 5);
  assert.ok(brokenParsed.merchantListingIssues.some((msg) => msg.includes('Missing field "image"')));
  assert.ok(brokenParsed.merchantListingIssues.some((msg) => msg.includes('Missing field "aggregateRating"')));
  assert.ok(brokenParsed.merchantListingIssues.some((msg) => msg.includes('Missing field "review"')));
  assert.ok(brokenParsed.merchantListingIssues.some((msg) => msg.includes('Missing field "hasMerchantReturnPolicy"')));
  assert.ok(brokenParsed.merchantListingIssues.some((msg) => msg.includes('Missing field "shippingDetails"')));
});

test("Giveaway of the Day 24-hour activation engine: /giveaway page, 6-month 1-PC license key 662026, 1-PC device limit, and window closure", async () => {
  const { app, get, post } = setup();

  // 1. Public /giveaway and /giveaway/readme.txt routes render 200 OK
  const pageRes = await app.request("/giveaway");
  assert.equal(pageRes.status, 200);
  const pageHtml = await pageRes.text();
  assert.ok(pageHtml.includes("Giveaway of the Day"), "/giveaway page mentions Giveaway of the Day");
  assert.ok(pageHtml.includes("662026"), "/giveaway page displays 6-digit key 662026");
  assert.ok(pageHtml.includes("GOTD50"), "/giveaway page includes 50% off upgrade coupon GOTD50");

  const readmeRes = await app.request("/giveaway/readme.txt");
  assert.equal(readmeRes.status, 200);
  const readmeTxt = await readmeRes.text();
  assert.ok(readmeTxt.includes("662026") && readmeTxt.includes("GOTD50"), "readme.txt contains key and upgrade coupon");

  // 2. Redeem via Desktop App OTP endpoint (/v1/account/verify-otp) using 6-digit Giveaway key 662026
  const dev1 = "a".repeat(32);
  const dev2 = "b".repeat(32);
  const verifyDev1Res = await app.request("/v1/account/verify-otp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "gotd.user1@example.com",
      code: "662026",
      device_id: dev1,
      platform: "windows",
    }),
  });
  assert.equal(verifyDev1Res.status, 200);
  const verifyDev1 = (await verifyDev1Res.json()) as any;
  assert.equal(verifyDev1.active, true);
  assert.equal(verifyDev1.plan, "giveaway_6m");
  assert.ok(verifyDev1.token, "Issues signed Ed25519 entitlement token for PC #1");

  // 3. Enforce 1-PC device limit on giveaway_6m plan (2nd PC is rejected with 403 device_limit)
  const verifyDev2Res = await app.request("/v1/account/verify-otp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "gotd.user1@example.com",
      code: "662026",
      device_id: dev2,
      platform: "windows",
    }),
  });
  assert.equal(verifyDev2Res.status, 403);
  const verifyDev2 = (await verifyDev2Res.json()) as any;
  assert.equal(verifyDev2.error, "device_limit");

  // 4. Close the 24-hour window via CRM endpoint and verify new redemptions are rejected with giveaway_window_closed
  const closeWinRes = await post("/api/crm/giveaway/window", {
    window_start_ts: 1000,
    window_end_ts: 2000,
    allow_preview_redemption: false,
  });
  assert.equal(closeWinRes.status, 200);

  const expiredRes = await app.request("/api/giveaway/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "late.visitor@example.com",
      code: "662026",
    }),
  });
  assert.equal(expiredRes.status, 400);
  const expiredJson = (await expiredRes.json()) as any;
  assert.equal(expiredJson.error, "giveaway_window_closed");

  // 5. Verify CRM giveaway status endpoint reports total redemptions
  const statusRes = await get("/api/crm/giveaway/status");
  assert.equal(statusRes.status, 200);
  const statusJson = (await statusRes.json()) as any;
  assert.equal(statusJson.total_redemptions, 1);
  assert.equal(statusJson.window_open, false);
});

test("Marketing Strategy Updates 1–5: Desktop Telemetry + A1 Truth Loop (n>=30), 301 Sub-Variant Modules, CTR Rescue Titles, Bloat Watch Benchmarks & Inline Safe-to-Delete Widget", async () => {
  const { app, get, post } = setup();

  // --- Update 1A: Desktop POST /v1/accounts records app_installed & links to recent Windows download ---
  const dlAttr = "attr_desktop_bridge_test";
  await app.request("/v1/telemetry/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_name: "installer_downloaded",
      platform: "windows",
      attribution_id: dlAttr,
    }),
  });

  // Desktop app launches and calls POST /v1/accounts (without browser cookie attribution_id)
  const acctRes = await app.request("/v1/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device_id: "c".repeat(32),
      device_type: "pc",
      platform: "windows",
      version: "0.2.0",
    }),
  });
  assert.equal(acctRes.status, 200);

  // Verify A3 recovery session was matched via allowRecentWindowsFallback
  const recStatusRes = await app.request(`/api/telemetry/recovery-status?attribution_id=${dlAttr}`);
  assert.equal(recStatusRes.status, 200);
  const recStatus = (await recStatusRes.json()) as any;
  assert.equal(recStatus.installed, true, "POST /v1/accounts should mark the recent Windows download session as installed");

  // --- Update 1B: A1 Telemetry -> Content Truth Loop enforces k-anonymity floor (n >= 30) ---
  // Ingest 29 scan samples for steam-depotcache -> below n=30 floor, badge must NOT render
  const samples29 = Array.from({ length: 29 }, (_, idx) => ({
    slug: "steam-depotcache",
    bytes: (4 + (idx % 12)) * 1024 * 1024 * 1024, // 4 GB to 15 GB
  }));
  const ingest29Res = await post("/api/crm/seo/telemetry-truth/ingest", {
    samples: samples29,
  });
  assert.equal(ingest29Res.status, 200);
  const ingest29Json = (await ingest29Res.json()) as any;
  assert.equal(ingest29Json.ingested, 29);
  assert.equal(ingest29Json.summaries[0].sample_count, 29);
  assert.equal(ingest29Json.summaries[0].qualifies_k_anonymity, false, "Below k-anonymity floor (29 < 30), stat must not be active");

  const steamBefore30Html = await (await app.request("/clean/app/steam-depotcache")).text();
  assert.ok(!steamBefore30Html.includes('id="telemetry-truth-badge"'), "Must not render telemetry badge when n < 30");

  // Ingest 30th sample via live POST /v1/telemetry/event (scan_completed)
  const scanEventRes = await app.request("/v1/telemetry/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_name: "scan_completed",
      platform: "windows",
      attribution_id: "anon_client_29",
      metadata: {
        total_bytes: 9 * 1024 * 1024 * 1024,
        rule_bytes: {
          "steam-depotcache": 9 * 1024 * 1024 * 1024,
        },
      },
    }),
  });
  assert.equal(scanEventRes.status, 200);

  const steamAfter30Html = await (await app.request("/clean/app/steam-depotcache")).text();
  assert.ok(steamAfter30Html.includes('id="telemetry-truth-badge"'), "Renders telemetry badge once n >= 30");
  assert.ok(
    steamAfter30Html.includes("Measured across 30 Sweepr scans: median"),
    "Displays live median & p90 callout once n >= 30"
  );

  // --- Update 2: 301 Sub-Variant Keyword Preservation on canonical pSEO pages ---
  const logiHtml = await (await app.request("/clean/app/logitech-options-plus-cache")).text();
  assert.ok(logiHtml.includes('id="consolidated-subcache-modules"'), "Logitech Options+ page renders consolidated sub-cache section");
  assert.ok(logiHtml.includes("Media Blob Storage"), "Covers -media-blob sub-variant");
  assert.ok(logiHtml.includes("Service Worker CacheStorage"), "Covers -service-worker sub-variant");
  assert.ok(logiHtml.includes("Code & Bytecode Cache"), "Covers -code-cache sub-variant");
  assert.ok(logiHtml.includes("GPU Shader Cache"), "Covers -gpu-cache sub-variant");
  assert.ok(logiHtml.includes("Crashpad Dump Logs"), "Covers -crashpad sub-variant");

  // --- Update 3: CTR Rescue Titles & Descriptions + Dual-Intent Stream Deck FAQ ---
  const ctrTargets = [
    {
      path: "/clean/app/steam-depotcache",
      expectedTitle: "What Is Steam depotcache? Safe to Delete? (2026 Guide)",
    },
    {
      path: "/clean/app/riot-client-logs",
      expectedTitle: "How to Clear Valorant & Riot Client Cache Files (2026)",
    },
    {
      path: "/clean/app/elgato-streamdeck-cache",
      expectedTitle: "How to Clean Stream Deck (App Cache & LCD Keys Guide)",
    },
    {
      path: "/clean/folder/windows-livekernelreports",
      expectedTitle: "LiveKernelReports WATCHDOG Dumps: Safe to Delete? (2026)",
    },
    {
      path: "/clean/app/vivaldi-browser-cache",
      expectedTitle: "Clear Vivaldi WebGPU, Shader & Browser Cache on Windows",
    },
    {
      path: "/clean/app/jetbrains-intellij-cache",
      expectedTitle: "IntelliJ Clean Launcher, Logs & IDE Caches Guide (2026)",
    },
  ];

  for (const target of ctrTargets) {
    const res = await app.request(target.path);
    assert.equal(res.status, 200, `${target.path} should return 200`);
    const html = await res.text();
    const parsed = parseHtml(html);
    const titleStr = parsed.title ?? "";
    const descStr = parsed.metaDescription ?? "";
    assert.equal(titleStr, target.expectedTitle, `${target.path} title matches CTR rescue title`);
    assert.ok(
      titleStr.length >= 30 && titleStr.length <= 60,
      `${target.path} title length (${titleStr.length}) within 30-60 chars`
    );
    assert.ok(
      descStr.length >= 70 && descStr.length <= 160,
      `${target.path} description length (${descStr.length}) within 70-160 chars`
    );
  }

  // Verify redirect aliases for vivaldi-cache and intellij-idea-caches
  const vivaldiRedirect = await app.request("/clean/app/vivaldi-cache", { redirect: "manual" });
  assert.equal(vivaldiRedirect.status, 301);
  assert.equal(vivaldiRedirect.headers.get("location"), "/clean/app/vivaldi-browser-cache");

  const intellijRedirect = await app.request("/clean/app/intellij-idea-caches", { redirect: "manual" });
  assert.equal(intellijRedirect.status, 301);
  assert.equal(intellijRedirect.headers.get("location"), "/clean/app/jetbrains-intellij-cache");

  // Verify Stream Deck page includes physical LCD hardware cleaning guidance alongside software cache
  const streamDeckHtml = await (await app.request("/clean/app/elgato-streamdeck-cache")).text();
  assert.ok(
    streamDeckHtml.includes("physical Elgato Stream Deck LCD keys") && streamDeckHtml.includes("70% isopropyl alcohol"),
    "Stream Deck page addresses both software cache and physical LCD key cleaning intent"
  );

  // --- Update 4: Bloat Watch Published Gamer/AI/Dev Benchmarks ---
  const bloatSlugs = [
    "/bloat-watch/logitech-ghub-options-plus-depots-media-blob-benchmark-2026",
    "/bloat-watch/elgato-streamdeck-cef-media-blob-cache-bloat-2026",
    "/bloat-watch/comfyui-cursor-ai-developer-cache-bloat-2026",
  ];
  for (const bPath of bloatSlugs) {
    const bRes = await app.request(bPath);
    assert.equal(bRes.status, 200, `${bPath} should be published and return 200 OK`);
    const bParsed = parseHtml(await bRes.text());
    assert.equal(bParsed.jsonLdErrors, 0, `${bPath} must have valid JSON-LD`);
  }

  // --- Update 5: Above-the-Fold Interactive "Safe-to-Delete + 1-Click Clean" Conversion Widget ---
  assert.ok(
    steamAfter30Html.includes('id="sweepr-inline-checker-widget"') &&
      steamAfter30Html.includes('id="inlineSafeCheckInput"') &&
      steamAfter30Html.includes('id="inlineSafeCheckBtn"'),
    "pSEO pages render the above-the-fold interactive Safe-to-Delete + 1-Click Clean widget"
  );
});

test("Phase 2 & 3 Builds: Action 2.7 (10 Transactional Tool Pages), Action 2.2 (A2 One-Click Approve), Action 3.1 (A/B Experiments) & Action 3.4 (A6 Annual Renewal Recap)", async () => {
  const { app, get, post } = setup();

  // --- Action 2.7: 10 App-Specific Transactional Cleaner Tool Pages (/tools & /tools/:slug) ---
  const hubRes = await app.request("/tools");
  assert.equal(hubRes.status, 200);
  const hubHtml = await hubRes.text();

  const toolSlugs = [
    "discord-cache-cleaner",
    "steam-cache-cleaner",
    "logitech-ghub-cleaner",
    "elgato-streamdeck-cleaner",
    "valorant-logs-cleaner",
    "nvidia-shader-cleaner",
    "adobe-media-cache-cleaner",
    "jetbrains-gradle-cleaner",
    "windows-24h2-update-cleaner",
    "ai-model-cache-cleaner",
  ];

  for (const slug of toolSlugs) {
    assert.ok(hubHtml.includes(`/tools/${slug}`), `/tools hub links to /tools/${slug}`);
    const tRes = await app.request(`/tools/${slug}`);
    assert.equal(tRes.status, 200, `/tools/${slug} returns 200 OK`);
    const tHtml = await tRes.text();
    const parsed = parseHtml(tHtml);
    const title = parsed.title ?? "";
    const desc = parsed.metaDescription ?? "";
    assert.ok(title.length >= 30 && title.length <= 60, `/tools/${slug} title length (${title.length}) in 30-60 chars`);
    assert.ok(desc.length >= 70 && desc.length <= 160, `/tools/${slug} description length (${desc.length}) in 70-160 chars`);
    assert.equal(parsed.jsonLdErrors, 0, `/tools/${slug} has valid JSON-LD`);
    assert.deepEqual(parsed.merchantListingIssues, [], `/tools/${slug} has 0 GSC Merchant Listing issues`);
    assert.ok(tHtml.includes('id="interactive-tool-auditor"'), `/tools/${slug} renders interactive path auditor`);
  }

  // --- Action 2.2: A2 Intent-Gap One-Click Approve & Microsoft Ads Export ---
  const approveCtrRes = await post("/api/crm/seo/gsc/intent-gap/approve", {
    action_type: "ctr_rewrite",
    decision: "approve",
    slug: "vrchat-cache",
    title: "VRChat Cache Folder: Safe to Delete? Free 10–30 GB Fast",
    meta_description:
      "Is %LocalAppData%Low\\VRChat\\VRChat\\Cache-WindowsPlayer safe to delete? Yes—reclaim 10–30 GB of cached VRChat worlds & avatars in 1 click without sign-outs.",
    persist_state: false,
  });
  assert.equal(approveCtrRes.status, 200);
  const vrchatHtml = await (await app.request("/clean/app/vrchat-cache")).text();
  const vrchatParsed = parseHtml(vrchatHtml);
  assert.equal(
    vrchatParsed.title,
    "VRChat Cache Folder: Safe to Delete? Free 10–30 GB Fast",
    "Approving a ctr_rewrite in A2 immediately updates the live pSEO page title"
  );

  const approveAdRes = await post("/api/crm/seo/gsc/intent-gap/approve", {
    action_type: "transactional_ad",
    decision: "approve",
    query: "discord cache cleaner",
    max_cpc_gbp: 0.45,
    target_url: "https://sweeprcleaner.com/tools/discord-cache-cleaner",
  });
  assert.equal(approveAdRes.status, 200);

  const adsExportRes = await get("/api/crm/seo/gsc/intent-gap/ads-export");
  assert.equal(adsExportRes.status, 200);
  const adsExportJson = (await adsExportRes.json()) as any;
  assert.equal(adsExportJson.approved_count, 1);
  assert.ok(adsExportJson.csv.includes('"discord cache cleaner",Exact,0.45'));

  const approveCommRes = await post("/api/crm/seo/gsc/intent-gap/approve", {
    action_type: "commercial_gap",
    decision: "approve",
    query: "ccleaner alternative windows 11",
    target_url: "/vs/ccleaner",
  });
  assert.equal(approveCommRes.status, 200);

  // --- Action 3.1: Conversion A/B Testing Engine ---
  const assignRes = await app.request("/api/experiments/assign?visitor_id=vis_alpha_101");
  assert.equal(assignRes.status, 200);
  const assignJson = (await assignRes.json()) as any;
  const assignedVariant = assignJson.assignments.checker_cta_copy_v1.variant;
  assert.ok(assignedVariant === "A" || assignedVariant === "B");

  await app.request("/v1/telemetry/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_name: "experiment_conversion",
      platform: "windows",
      metadata: {
        experiment: "checker_cta_copy_v1",
        variant: assignedVariant,
        action: "order_annual",
      },
    }),
  });

  const expSummaryRes = await get("/api/crm/experiments");
  assert.equal(expSummaryRes.status, 200);
  const expSummary = (await expSummaryRes.json()) as any;
  const checkerExp = expSummary.experiments.find((e: any) => e.id === "checker_cta_copy_v1");
  assert.ok(checkerExp, "checker_cta_copy_v1 is returned in /api/crm/experiments");
  assert.equal(checkerExp.variants[assignedVariant].conversions, 1);
  assert.equal(checkerExp.winning_variant, assignedVariant);

  // --- Action 3.4: A6 Annual-Renewal Value Recap (Active vs Dormant Segmentation & Idempotency) ---
  // Create an account and simulate scan + clean telemetry (18.5 GB reclaimed)
  const acctRes = await app.request("/v1/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device_id: "d".repeat(32),
      device_type: "pc",
      email: "annual.active@example.com",
    }),
  });
  assert.equal(acctRes.status, 200);
  const acctJson = (await acctRes.json()) as any;
  const activeAccountId = acctJson.account_id;

  await app.request("/v1/telemetry/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_name: "scan_completed",
      platform: "windows",
      account_id: activeAccountId,
      metadata: { total_bytes: 20 * 1024 * 1024 * 1024 },
    }),
  });
  await app.request("/v1/telemetry/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_name: "clean_completed",
      platform: "windows",
      account_id: activeAccountId,
      metadata: { cleaned_bytes: 18.5 * 1024 * 1024 * 1024, files_removed: 4120 },
    }),
  });

  const triggerRecapRes = await post("/api/crm/renewal-recap/trigger", {
    account_id: activeAccountId,
  });
  assert.equal(triggerRecapRes.status, 200);
  const triggerRecap = (await triggerRecapRes.json()) as any;
  assert.equal(triggerRecap.skipped_duplicate, false);
  assert.equal(triggerRecap.recap.segment, "active");
  assert.equal(triggerRecap.recap.total_cleaned_gb, 18.5);
  assert.ok(triggerRecap.subject.includes("You reclaimed 18.5 GB this year"));

  // Second trigger within 25 days is skipped via idempotency guard
  const dupRecapRes = await post("/api/crm/renewal-recap/trigger", {
    account_id: activeAccountId,
  });
  assert.equal(dupRecapRes.status, 200);
  const dupRecap = (await dupRecapRes.json()) as any;
  assert.equal(dupRecap.skipped_duplicate, true);
});

test("Automated Keyword Research & Low-Competition Opportunity Engine: 4-source discovery, OpportunityScore (0-100), 4-stage anti-cannibalization, 6 quality gates & CRM endpoints", async () => {
  const {
    scoreKeywordOpportunity,
    resolveKeywordAgainstCorpus,
    validateCandidateCleanItem,
    WINDOWS_ECOSYSTEM_OPPORTUNITY_REGISTRY,
    LOCKED_TEST_TITLE_SLUGS,
  } = await import("../src/seo/keywords.js");
  const { getCleanItems } = await import("../src/pseo.js");

  // 1. Mathematical OpportunityScore calibration: low-comp transactional/problem queries vs high-KD head terms
  const lowCompToolScore = scoreKeywordOpportunity({
    keyword: "marvel rivals shader cache cleaner",
    googleAutocompleteRank: 2,
    bingAutocompleteRank: 1,
    avgSpaceGb: 12,
    isCuratedEcosystemSeed: true,
  });
  assert.ok(
    lowCompToolScore.opportunity_score >= 90,
    `Expected low-comp tool query >= 90, got ${lowCompToolScore.opportunity_score}`
  );
  assert.equal(lowCompToolScore.is_low_competition, true);

  const strikeZoneScore = scoreKeywordOpportunity({
    keyword: "can i delete steam depotcache",
    gscImpressions28d: 12,
    gscPosition: 11.0,
    dfsKd: 18,
  });
  assert.ok(
    strikeZoneScore.opportunity_score >= 85,
    `Expected strike-zone query >= 85, got ${strikeZoneScore.opportunity_score}`
  );

  const headTermScore = scoreKeywordOpportunity({
    keyword: "pc cleaner",
    dfsSearchVolume: 40500,
    dfsKd: 74,
  });
  assert.ok(
    headTermScore.opportunity_score < 75,
    `Expected high-KD head term < 75, got ${headTermScore.opportunity_score}`
  );
  assert.equal(headTermScore.is_low_competition, false);

  // 2. 4-Stage Anti-Cannibalization & Entity Resolver
  const discordRes = resolveKeywordAgainstCorpus(
    "clear discord gpu cache",
    "%AppData%\\discord\\Cache\\Cache_Data"
  );
  assert.equal(discordRes.matched, true);
  assert.equal(discordRes.recommendedAction, "enrich_existing_page");

  // Catches category-prefixed redirect ("app:nuget-package-cache" -> "/clean/app/nuget-packages-http-cache")
  const nugetRes = resolveKeywordAgainstCorpus("nuget package cache");
  assert.equal(nugetRes.matched, true);
  assert.equal(nugetRes.matchType, "SLUG_OR_REDIRECT_FAMILY");
  assert.equal(nugetRes.recommendedAction, "enrich_existing_page");

  // Routes net-new uncaptured 2025/2026 app to create_pseo_app
  const marvelRes = resolveKeywordAgainstCorpus("marvel rivals shader cache");
  assert.equal(marvelRes.matched, false);
  assert.equal(marvelRes.recommendedAction, "create_pseo_app");

  // 3. 6 Mandatory Pre-Write Quality Gates
  assert.equal(LOCKED_TEST_TITLE_SLUGS.has("steam-depotcache"), true);
  assert.equal(WINDOWS_ECOSYSTEM_OPPORTUNITY_REGISTRY.length, 32);

  const baseCleanItems = getCleanItems();
  for (const spec of WINDOWS_ECOSYSTEM_OPPORTUNITY_REGISTRY) {
    const existingWithoutSelf = baseCleanItems.filter((i) => i.slug.toLowerCase() !== spec.slug.toLowerCase());
    const gate = validateCandidateCleanItem(spec, existingWithoutSelf);
    assert.equal(
      gate.valid,
      true,
      `Registry candidate ${spec.slug} failed quality gates: ${gate.errors.join(", ")}`
    );
    assert.ok(gate.computedTitle.length >= 30 && gate.computedTitle.length <= 60);
    assert.ok(gate.computedDescription.length >= 70 && gate.computedDescription.length <= 158);
  }

  // Blocks OS-critical C:\Windows\System32 path
  const badCandidate = validateCandidateCleanItem({
    slug: "delete-system32-dlls",
    category: "folder",
    name: "Windows System32 Core DLLs",
    path: "C:\\Windows\\System32",
    safeToDelete: true,
    avgSpace: "10 GB",
    whatIsIt: "Core operating system binaries required for Windows boot and kernel execution.",
    whatHappens: "Deleting System32 destroys the Windows installation immediately.",
    manualSteps: ["Do not delete System32.", "Use sfc /scannow instead."],
  });
  assert.equal(badCandidate.valid, false);
  assert.ok(badCandidate.errors.some((e) => e.startsWith("critical_os_path_blocked")));

  // 4. End-to-End CRM Router Endpoints (/keywords/discover, /keywords/opportunities, /keywords/opportunities/publish)
  const { get, post } = setup();

  const discRes = await post("/api/crm/seo/keywords/discover", {
    seeds: ["marvel rivals shader", "windsurf ide"],
    fetch_autocomplete: true,
    enrich_dfs: false,
    limit: 25,
    persist_report: false,
  });
  assert.equal(discRes.status, 200);
  const discJson = (await discRes.json()) as any;
  assert.equal(discJson.ok, true);
  assert.ok(discJson.summary.total_evaluated >= 32);
  const ungeneratedRegistryCount = WINDOWS_ECOSYSTEM_OPPORTUNITY_REGISTRY.filter(
    (spec) => !baseCleanItems.some((i) => i.slug.toLowerCase() === spec.slug.toLowerCase())
  ).length;
  assert.equal(discJson.summary.new_pseo_ready_count, ungeneratedRegistryCount);
  assert.ok(discJson.top_opportunities.length > 0);
  assert.ok(discJson.ctr_enrichment_candidates.length > 0);

  const oppRes = await get("/api/crm/seo/keywords/opportunities?min_score=75&low_comp_only=true");
  assert.equal(oppRes.status, 200);
  const oppJson = (await oppRes.json()) as any;
  assert.equal(oppJson.ok, true);
  assert.ok(oppJson.opportunities.length > 0);
  assert.ok(oppJson.opportunities.every((o: any) => o.opportunity_score >= 75));

  const pubDryRes = await post("/api/crm/seo/keywords/opportunities/publish", {
    slug: "marvel-rivals-shader-cache",
    dry_run: true,
  });
  assert.equal(pubDryRes.status, 200);
  const pubDryJson = (await pubDryRes.json()) as any;
  assert.equal(pubDryJson.ok, true);
  assert.equal(pubDryJson.target_url, "/clean/app/marvel-rivals-shader-cache");
  assert.equal(pubDryJson.validation.valid, true);
});

test("CMO Automations v2: A1 23 Rust Rules, A7 90d Retirement/Noindex, A8 ROAS 65% Reinvestment, A9 Z-Test, A10 Giveaway/Abandonment, A11 State of Windows Storage & Unified Status", async () => {
  const { repo, app, get, post } = setup();

  // 1. A1 Telemetry Truth: Verify all 23 Windows + macOS Rust rules map to valid CleanItems & A11 /state-of-windows-storage renders
  const { RULE_ID_TO_CLEAN_SLUG, computeStateOfWindowsStorageReport } = await import("../src/seo/telemetry-truth.js");
  const { getCleanItems } = await import("../src/pseo.js");
  const allSlugs = new Set(getCleanItems().map((i) => i.slug));
  for (const [ruleId, mappedSlug] of Object.entries(RULE_ID_TO_CLEAN_SLUG)) {
    assert.equal(allSlugs.has(mappedSlug), true, `Rule ${ruleId} mapped to unknown slug ${mappedSlug}`);
  }
  assert.ok(Object.keys(RULE_ID_TO_CLEAN_SLUG).length >= 23);

  const storageRes = await app.request("/state-of-windows-storage");
  assert.equal(storageRes.status, 200);
  const storageHtml = await storageRes.text();
  assert.ok(storageHtml.includes("State of Windows Storage"));
  assert.ok(storageHtml.includes('"@type":"Dataset"'));
  assert.ok(storageHtml.includes("copyCitationMarkdownBtn"));

  const storageApiRes = await get("/api/crm/seo/state-of-windows-storage");
  assert.equal(storageApiRes.status, 200);
  const storageApiJson = (await storageApiRes.json()) as any;
  assert.equal(storageApiJson.ok, true);
  assert.ok(storageApiJson.silos.length >= 6);
  assert.ok(storageApiJson.top_15_heaviest_folders.length === 15);

  // 2. A7 (Action 3.6): 90-Day Zero-Impression Page Retirement (retire_noindex / retire_merge) + Sitemap Exclusion
  const execGapRes = await post("/api/crm/seo/gsc/intent-gap/execute", {
    use_seed: true,
    persist_state: false,
  });
  assert.equal(execGapRes.status, 200);
  const execGapJson = (await execGapRes.json()) as any;
  assert.equal(execGapJson.ok, true);
  assert.ok(Array.isArray(execGapJson.report.retirement_candidates_90d));
  assert.ok(Array.isArray(execGapJson.report.winner_promotion_queue));
  assert.ok(execGapJson.report.retirement_candidates_90d.length > 0);

  const retireTarget = execGapJson.report.retirement_candidates_90d[0];
  const approveMergeRes = await post("/api/crm/seo/gsc/intent-gap/approve", {
    action_type: "retire_merge",
    decision: "approved",
    slug: retireTarget.slug,
    merge_into_slug: retireTarget.suggested_merge_into_slug || "discord-cache",
    reason: "Zero GSC impressions over 90 days — consolidated into cluster anchor",
  });
  assert.equal(approveMergeRes.status, 200);

  const retiredPageRes = await app.request(retireTarget.url);
  assert.equal(retiredPageRes.status, 200);
  const retiredHtml = await retiredPageRes.text();
  assert.ok(retiredHtml.includes('<meta name="robots" content="noindex, follow">'));
  assert.ok(retiredHtml.includes('id="soft-merge-consolidation-banner"'));

  const sitemapRes = await app.request("/sitemap.xml");
  assert.equal(sitemapRes.status, 200);
  const sitemapXml = await sitemapRes.text();
  assert.equal(sitemapXml.includes(retireTarget.url), false, "Noindexed slug should be dynamically filtered from /sitemap.xml");

  // Clean up override so subsequent tests aren't affected
  const { setApprovedIntentGapSeoOverride } = await import("../src/pseo.js");
  setApprovedIntentGapSeoOverride(retireTarget.slug, null);

  // 3. A8 (Action 3.2): Paid Ads ROAS & v3 65% Reinvestment Engine
  const reallocateRes = await post("/api/crm/ads/reallocate", {
    auto_adjust_bids: true,
    keyword_overrides: [
      {
        query: "sweepr cleaner pro",
        channel: "bing",
        clicks: 45,
        installs: 20,
        scans: 16,
        checkouts: 6,
        conversions: 3,
        spend_gbp: 22.5,
        revenue_gbp: 71.97,
        max_cpc_gbp: 0.55,
      },
      {
        query: "generic free disk utility",
        channel: "bing",
        clicks: 40,
        installs: 4,
        scans: 1,
        checkouts: 0,
        conversions: 0,
        spend_gbp: 24.0,
        revenue_gbp: 0,
        max_cpc_gbp: 0.6,
      },
    ],
  });
  assert.equal(reallocateRes.status, 200);
  const reallocateJson = (await reallocateRes.json()) as any;
  assert.equal(reallocateJson.ok, true);
  assert.ok(reallocateJson.bids_adjusted >= 1);
  assert.ok(reallocateJson.losers_paused >= 1);
  assert.equal(reallocateJson.report.totals.qualifies_for_65pct_reinvestment, true);
  assert.ok(reallocateJson.report.totals.reinvestment_unlock_gbp > 0);

  // 4. A9 (Action 3.1): Two-Proportion Z-Test Statistical Significance & Auto-Promotion at n >= 100
  const { computeTwoProportionZTest } = await import("../src/experiments.js");
  const lowSampleZ = computeTwoProportionZTest(20, 2, 20, 8);
  assert.equal(lowSampleZ.sample_size_reached, false);
  assert.equal(lowSampleZ.is_statistically_significant, false);
  assert.equal(lowSampleZ.statistically_significant_winner, null);

  const highSampleZ = computeTwoProportionZTest(150, 12, 150, 33);
  assert.equal(highSampleZ.sample_size_reached, true);
  assert.equal(highSampleZ.is_statistically_significant, true);
  assert.equal(highSampleZ.statistically_significant_winner, "B");
  assert.ok(highSampleZ.confidence_pct >= 95);

  // 5. A10: High-Intent Scan/Checkout Abandonment & Giveaway GOTD50 Lifecycle Sweep + /v1/conversion/offer
  const nowSec = Math.floor(Date.now() / 1000);
  const redeemRes = await app.request("/api/giveaway/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "gotd-lifecycle@example.com",
      code: "662026",
    }),
  });
  assert.equal(redeemRes.status, 200);
  const redeemJson = (await redeemRes.json()) as any;
  assert.equal(redeemJson.ok, true);

  // Backdate giveaway activation to 4 days ago so T+3d multi-device upsell triggers
  repo.db
    .prepare("UPDATE giveaway_redemptions SET created_at = ? WHERE email = ?")
    .run(nowSec - 4 * 86400, "gotd-lifecycle@example.com");

  const convEvalRes = await post("/api/crm/conversion/evaluate", { now_sec: nowSec });
  assert.equal(convEvalRes.status, 200);
  const convEvalJson = (await convEvalRes.json()) as any;
  assert.equal(convEvalJson.ok, true);
  assert.equal(convEvalJson.giveaway.nurture_3d_sent, 1);

  const offerRes = await app.request(
    `/v1/conversion/offer?email=${encodeURIComponent("gotd-lifecycle@example.com")}&bytes_found=${12 * 1024 * 1024 * 1024}`
  );
  assert.equal(offerRes.status, 200);
  const offerJson = (await offerRes.json()) as any;
  assert.equal(offerJson.ok, true);
  assert.equal(offerJson.offer_type, "giveaway_5device_upgrade");
  assert.equal(offerJson.coupon, "GOTD50");

  // 6. Unified CMO Automations Status & Runner (/api/crm/automations/status & /api/crm/automations/run)
  const runAutoRes = await post("/api/crm/automations/run", { job_id: "A1_telemetry_truth" });
  assert.equal(runAutoRes.status, 200);
  const statusRes = await get("/api/crm/automations/status");
  assert.equal(statusRes.status, 200);
  const statusJson = (await statusRes.json()) as any;
  assert.equal(statusJson.ok, true);
  assert.equal(statusJson.total_jobs, 18);
  const a1Job = statusJson.jobs.find((j: any) => j.id === "A1_telemetry_truth");
  assert.equal(a1Job.last_status, "ok");
});

test("CMO Automations v3: Persistent Storage Ledger, GEO llms.txt, Dunning/Winback, Post-Clean Aha Referral & Leaf-to-Tool Crosslinks", async () => {
  const { app, repo, get, post } = setup();

  // 1. R1 & A14: Persistent Account Storage Ledger survives 90-day analytics_events TTL & triggers 5 GB Aha referral
  const ahaDeviceId = "e".repeat(32);
  const acctRes = await app.request("/v1/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device_id: ahaDeviceId,
      device_type: "pc",
      email: "aha-milestone@example.com",
    }),
  });
  assert.equal(acctRes.status, 200);
  const acctJson = (await acctRes.json()) as any;
  const ahaAccountId = acctJson.account_id as string;
  const cleanBytes = 6.5 * 1024 * 1024 * 1024; // 6.5 GB

  const telRes = await app.request("/v1/telemetry/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_name: "clean_completed",
      platform: "windows",
      device_id: ahaDeviceId,
      metadata: {
        bytes_cleaned: cleanBytes,
        files_cleaned: 1420,
      },
    }),
  });
  assert.equal(telRes.status, 200);
  const telJson = (await telRes.json()) as any;
  assert.equal(telJson.ok, true);
  assert.equal(telJson.milestone_unlocked, true);
  assert.ok(telJson.referral_url);

  // Simulate 90-day analytics_events TTL pruning all events and verify renewal recap retains lifetime bytes
  repo.db.prepare("DELETE FROM analytics_events WHERE account_id = ?").run(ahaAccountId);
  const { getAccountStorageRecap } = await import("../src/renewal-recap.js");
  const recap = getAccountStorageRecap(repo, ahaAccountId);
  assert.ok(recap);
  assert.ok(recap.total_cleaned_bytes >= cleanBytes);
  assert.equal(recap.clean_count, 1);

  // 2. R4: Promo Coupons (GOTD50, SCAN5GB20, STAY30) + Hardware ID Offer Lookup
  const { resolveCheckoutPromoCoupon } = await import("../src/app.js");
  assert.deepEqual(resolveCheckoutPromoCoupon("GOTD50"), { code: "GOTD50", discountPct: 50, multiplier: 0.5 });
  assert.deepEqual(resolveCheckoutPromoCoupon("scan5gb20"), { code: "SCAN5GB20", discountPct: 20, multiplier: 0.8 });
  assert.deepEqual(resolveCheckoutPromoCoupon("STAY30"), { code: "STAY30", discountPct: 30, multiplier: 0.7 });

  const hwOfferRes = await app.request(
    `/v1/conversion/offer?hardware_id=${ahaDeviceId}&bytes_found=${8 * 1024 * 1024 * 1024}`
  );
  assert.equal(hwOfferRes.status, 200);
  const hwOfferJson = (await hwOfferRes.json()) as any;
  assert.equal(hwOfferJson.ok, true);
  assert.equal(hwOfferJson.coupon, "SCAN5GB20");
  assert.equal(hwOfferJson.coupon_code, "SCAN5GB20");
  assert.equal(hwOfferJson.discount_pct, 20);

  // 3. A12: Dynamic GEO /llms.txt and /llms-full.txt
  const llmsRes = await app.request("/llms.txt");
  assert.equal(llmsRes.status, 200);
  const llmsText = await llmsRes.text();
  assert.ok(llmsText.includes("SWEEPR Cleaner"));
  assert.ok(llmsText.includes("/state-of-windows-storage"));
  assert.ok(llmsText.includes("/safe-to-delete"));

  const llmsFullRes = await app.request("/llms-full.txt");
  assert.equal(llmsFullRes.status, 200);
  const llmsFullText = await llmsFullRes.text();
  assert.ok(llmsFullText.includes("Complete Windows 10 & 11 Storage & Cache Encyclopedia"));
  assert.ok(llmsFullText.includes("/clean/app/discord-cache"));

  // 4. A15: Leaf-to-Tool & Switcher Commercial Crosslinks + Brand Fact Drift Audit
  const leafRes = await app.request("/clean/app/discord-cache");
  assert.equal(leafRes.status, 200);
  const leafHtml = await leafRes.text();
  assert.ok(leafHtml.includes('id="pseo-commercial-crosslinks"'));
  assert.ok(leafHtml.includes('/tools/discord-cache-cleaner'));
  assert.ok(leafHtml.includes('/vs/ccleaner'));

  const { auditInternalBrandFactConsistency } = await import("../src/seo/listings.js");
  const auditReport = auditInternalBrandFactConsistency({ autoFix: true });
  assert.equal(auditReport.checked_count, 12);
  const verifyClean = auditInternalBrandFactConsistency({ autoFix: false });
  assert.equal(verifyClean.drift_detected_count, 0);

  // 5. A13: Failed-Payment Dunning & Churn Winback Lifecycle
  repo.createAccount("acc_dunning_1", "hash_dunning", "dunning-user@example.com");
  const nowSec = Math.floor(Date.now() / 1000);
  repo.db
    .prepare(
      "INSERT OR REPLACE INTO entitlements (account_id, status, plan, current_period_end, updated_at) VALUES (?, 'past_due', 'annual', ?, ?)"
    )
    .run("acc_dunning_1", nowSec - 2 * 86400, nowSec - 2 * 86400);

  repo.createAccount("acc_churn_1", "hash_churn", "churned-user@example.com");
  repo.db
    .prepare(
      "INSERT OR REPLACE INTO entitlements (account_id, status, plan, current_period_end, updated_at) VALUES (?, 'canceled', 'annual', ?, ?)"
    )
    .run("acc_churn_1", nowSec - 15 * 86400, nowSec - 15 * 86400);
  repo.recordAccountScanAndCleanProgress("acc_churn_1", {
    isClean: true,
    cleanedBytes: 12 * 1024 * 1024 * 1024,
    cleanedFiles: 950,
    tsSec: nowSec - 20 * 86400,
  });

  const dunningEvalRes = await post("/api/crm/automations/run", { job_id: "A13_dunning_winback" });
  assert.equal(dunningEvalRes.status, 200);
  const dunningEvalJson = (await dunningEvalRes.json()) as any;
  assert.equal(dunningEvalJson.ok, true);

  // 6. R7: A2 Rejection Isolation (rejecting ctr_rewrite preserves retire_noindex, and vice versa)
  const { getCleanItems } = await import("../src/pseo.js");
  const items = getCleanItems();
  const targetItem = items[2];
  const approveRetireRes = await post("/api/crm/seo/gsc/intent-gap/approve", {
    slug: targetItem.slug,
    action_type: "retire_noindex",
    decision: "approved",
  });
  assert.equal(approveRetireRes.status, 200);
  const rejectCtrRes = await post("/api/crm/seo/gsc/intent-gap/approve", {
    slug: targetItem.slug,
    action_type: "ctr_rewrite",
    decision: "rejected",
  });
  assert.equal(rejectCtrRes.status, 200);
  const checkLeafRes = await app.request(`/clean/${targetItem.category}/${targetItem.slug}`);
  const checkLeafHtml = await checkLeafRes.text();
  assert.ok(checkLeafHtml.includes('name="robots" content="noindex, follow"'));

  // Clean up noindex override so subsequent audits see 100% indexable leaves
  await post("/api/crm/seo/gsc/intent-gap/approve", {
    slug: targetItem.slug,
    action_type: "retire_noindex",
    decision: "rejected",
  });
});

test("A16 Competitor Organic SEO Replication, 5-Tier Transactional Forecaster & A17 Strategy Forecast Ledger", async () => {
  const { get, post } = setup();

  // 1. Verify 5-Tier Transactional Classifier & Time-to-Rank Forecaster
  const { classifyTransactionalTier, computeKeywordForecast, scoreKeywordOpportunity } = await import("../src/seo/keywords.js");
  const switcherClass = classifyTransactionalTier("ccleaner alternative without bloatware windows 11");
  assert.equal(switcherClass.tier, "BOFU_Switcher");
  assert.equal(switcherClass.buyerStage, "BOFU");
  assert.ok(switcherClass.expectedCvrPct >= 5.0);

  const toolClass = classifyTransactionalTier("discord cache cleaner tool windows 11");
  assert.equal(toolClass.tier, "BOFU_Tool_Intent");
  assert.equal(toolClass.buyerStage, "BOFU");

  const scoredTool = scoreKeywordOpportunity({
    keyword: "marvel rivals shader cache cleaner tool windows 11",
    googleAutocompleteRank: 1,
    bingAutocompleteRank: 1,
    avgSpaceGb: 8.5,
    isCuratedEcosystemSeed: true,
    competitorSourceDomain: "wisecleaner.com",
  });
  assert.equal(scoredTool.buyer_stage, "BOFU");
  assert.equal(scoredTool.transactional_tier, "BOFU_Tool_Intent");
  assert.ok(scoredTool.forecast.forecast_kd >= 5 && scoredTool.forecast.forecast_kd <= 50);
  assert.ok(scoredTool.forecast.forecast_est_days_to_top10 >= 7 && scoredTool.forecast.forecast_est_days_to_top10 <= 90);
  assert.ok(scoredTool.forecast.forecast_monthly_volume >= 50);
  assert.ok(scoredTool.forecast.forecast_monthly_clicks >= 4);
  assert.ok(scoredTool.forecast.forecast_monthly_downloads > 0);
  assert.ok(scoredTool.forecast.forecast_monthly_conversions > 0);

  // 2. Verify A16 Competitor Organic Gap Harvester & On-Page Structural Teardown
  const compGapRes = await get("/api/crm/seo/competitor-organic-gap");
  assert.equal(compGapRes.status, 200);
  const compGapJson = (await compGapRes.json()) as any;
  assert.equal(compGapJson.ok, true);
  assert.ok(compGapJson.total_tracked_pages >= 8);
  assert.ok(Array.isArray(compGapJson.competitor_pages));
  assert.ok(Array.isArray(compGapJson.teardowns) && compGapJson.teardowns.length >= 8);

  const teardownRes = await post("/api/crm/seo/competitor-organic-teardown", {
    url: "https://www.wisecleaner.com/think-tank/999-How-to-Clear-NVIDIA-DXCache-Windows-11.html",
    target_keyword: "clear nvidia dxcache shader cache cleaner windows 11",
    raw_html: `<!doctype html><html><head><title>How to Clear NVIDIA DXCache in Windows 11</title><meta name="description" content="Step-by-step guide to clear %LocalAppData%\\NVIDIA\\DXCache safely."></head><body><h1>How to Clear NVIDIA DXCache in Windows 11</h1><h2>Where Is %LocalAppData%\\NVIDIA\\DXCache Located?</h2><h2>Is It Safe to Delete NVIDIA Shader Cache?</h2><ol><li>Open Run dialog</li><li>Delete stale shader files</li></ol></body></html>`,
    create_ledger_entry: true,
  });
  assert.equal(teardownRes.status, 200);
  const teardownJson = (await teardownRes.json()) as any;
  assert.equal(teardownJson.ok, true);
  assert.equal(teardownJson.teardown.competitor_domain, "wisecleaner.com");
  assert.ok(teardownJson.teardown.extracted_win_paths.includes("%LocalAppData%\\NVIDIA\\DXCache"));
  assert.ok(teardownJson.teardown.weaknesses.length >= 2);
  assert.ok(teardownJson.teardown.replication_blueprint.superiority_elements_to_inject.length >= 3);

  // 3. Verify A17 Persistent Strategy Forecast Ledger & Closed-Loop Weight Calibration
  const ledgerGetRes = await get("/api/crm/seo/strategy-ledger");
  assert.equal(ledgerGetRes.status, 200);
  const ledgerGetJson = (await ledgerGetRes.json()) as any;
  assert.equal(ledgerGetJson.ok, true);
  assert.ok(ledgerGetJson.entries.length >= 10);
  assert.ok(ledgerGetJson.summary.evaluated_count >= 1);
  assert.ok(ledgerGetJson.scoring_weights.low_comp_weight > 0);

  const ledgerPostRes = await post("/api/crm/seo/strategy-ledger", {
    recalibrate_weights: true,
    entry: {
      slug: "steam-depotcache",
      target_path: "/clean/app/steam-depotcache",
      primary_keyword: "steam depotcache safe to delete cleaner",
      buyer_stage: "BOFU",
      transactional_tier: "BOFU_Tool_Intent",
      difficulty_tier: "very_easy",
      forecast_kd: 16,
      forecast_est_days_to_top10: 18,
      forecast_monthly_volume: 1200,
      forecast_monthly_clicks: 85,
      status: "published",
    },
  });
  assert.equal(ledgerPostRes.status, 200);
  const ledgerPostJson = (await ledgerPostRes.json()) as any;
  assert.equal(ledgerPostJson.ok, true);
  assert.ok(Array.isArray(ledgerPostJson.recommendations) && ledgerPostJson.recommendations.length >= 1);

  // 4. Verify A16 & A17 execute cleanly via /api/crm/automations/run
  const runA16 = await post("/api/crm/automations/run", { job_id: "A16_competitor_organic_intel" });
  assert.equal(runA16.status, 200);
  const runA16Json = (await runA16.json()) as any;
  assert.equal(runA16Json.ok, true);
  assert.equal(runA16Json.results.A16_competitor_organic_intel.last_status, "ok");

  const runA17 = await post("/api/crm/automations/run", { job_id: "A17_strategy_forecast_ledger" });
  assert.equal(runA17.status, 200);
  const runA17Json = (await runA17.json()) as any;
  assert.equal(runA17Json.ok, true);
  assert.equal(runA17Json.results.A17_strategy_forecast_ledger.last_status, "ok");

  // 5. Verify interactive CRM Keyword Forecaster endpoint (/api/crm/seo/forecast-keyword)
  const fcRes = await post("/api/crm/seo/forecast-keyword", {
    keyword: "discord cache cleaner tool windows 11",
    competitor_domain: "ccleaner.com",
    log_to_ledger: true,
  });
  assert.equal(fcRes.status, 200);
  const fcJson = (await fcRes.json()) as any;
  assert.equal(fcJson.ok, true);
  assert.equal(fcJson.logged_to_ledger, true);
  assert.equal(fcJson.scored.buyer_stage, "BOFU");
  assert.equal(fcJson.scored.transactional_tier, "BOFU_Tool_Intent");
  assert.ok(fcJson.scored.forecast.forecast_est_days_to_top10 >= 7);
  assert.ok(fcJson.scored.forecast.forecast_monthly_volume >= 50);

  // 6. Verify Pre- vs. Post-Optimization Baseline Snapshot & Lift Calibration + A18 Underperformer Auto-Refresh
  const baselineRes = await post("/api/crm/seo/strategy-ledger/baseline", {
    slug: "discord-cache",
    target_path: "/clean/app/discord-cache",
    optimization_type: "a2_ctr_rewrite",
    pre_impressions_28d: 800,
    pre_clicks_28d: 16,
    pre_ctr_28d: 2.0,
    pre_avg_position: 9.2,
    pre_downloads_28d: 1,
    overwrite_baseline: true,
  });
  assert.equal(baselineRes.status, 200);
  const baselineJson = (await baselineRes.json()) as any;
  assert.equal(baselineJson.ok, true);
  assert.equal(baselineJson.entry.pre_clicks_28d, 16);
  assert.equal(baselineJson.entry.pre_ctr_28d, 2.0);
  assert.equal(baselineJson.entry.pre_avg_position, 9.2);
  assert.equal(baselineJson.entry.last_optimization_type, "a2_ctr_rewrite");

  // Reconcile actuals where discord-cache now has higher clicks/CTR and improved position
  const reconcileRes = await post("/api/crm/seo/strategy-ledger/reconcile", {
    persist_json: false,
    actuals_override: [
      {
        slug: "discord-cache",
        impressions_28d: 1200,
        clicks_28d: 48,
        ctr_28d: 4.0,
        avg_position: 4.5,
        downloads_28d: 3,
        paid_conversions_28d: 1,
      },
    ],
    paid_keyword_cvr_by_tier: {
      BOFU_Switcher: { clicks: 120, conversions: 8 },
    },
  });
  assert.equal(reconcileRes.status, 200);
  const reconcileJson = (await reconcileRes.json()) as any;
  assert.equal(reconcileJson.ok, true);
  assert.ok(reconcileJson.pre_vs_post_summary.optimized_pages_count >= 1);
  const discordRow = reconcileJson.entries.find((e: any) => e.slug === "discord-cache");
  assert.ok(discordRow);
  assert.equal(discordRow.post_clicks_lift_pct, 200); // (48 - 16) / 16 = +200%
  assert.equal(discordRow.post_ctr_lift_pct, 100); // (4.0 - 2.0) / 2.0 = +100%
  assert.equal(discordRow.post_position_delta, 4.7); // 9.2 - 4.5 = +4.7 spots gained
  assert.ok(reconcileJson.scoring_weights.calibrated_ctr_lift_multiplier >= 1.0);

  // 7. Verify A18 Self-Healing Underperformer Auto-Refresher (/api/crm/seo/underperformer-refresh & A18 automation job)
  await post("/api/crm/seo/strategy-ledger", {
    recalibrate_weights: false,
    entry: {
      slug: "slack-cache",
      target_path: "/clean/app/slack-cache",
      primary_keyword: "clear slack cache windows 11",
      buyer_stage: "MOFU",
      transactional_tier: "MOFU_Action_Cleanup",
      difficulty_tier: "easy",
      forecast_kd: 22,
      forecast_est_days_to_top10: 14,
      forecast_monthly_volume: 900,
      forecast_monthly_clicks: 55,
      actual_impressions_28d: 650,
      actual_clicks_28d: 5,
      actual_ctr_28d: 0.77,
      actual_avg_position: 8.4,
      variance_status: "underperforming_ctr",
      status: "published",
    },
  });
  const a18Res = await post("/api/crm/seo/underperformer-refresh", {
    max_pages: 3,
    persist_disk: false,
  });
  assert.equal(a18Res.status, 200);
  const a18Json = (await a18Res.json()) as any;
  assert.equal(a18Json.ok, true);
  assert.ok(a18Json.refreshed_count >= 1);
  for (const rp of a18Json.refreshed_pages) {
    if (rp.applied_title) {
      assert.ok(rp.applied_title.length >= 30 && rp.applied_title.length <= 60, `Clean title length 30-60: ${rp.applied_title}`);
      assert.ok(!/\(\s*:/.test(rp.applied_title), `No unclosed parenthesis before colon: ${rp.applied_title}`);
    }
  }

  // Verify cross-project backlinks return 200 OK skipped instead of 400 error
  const crossBacklinkRes = await post("/api/crm/seo/backlinks", {
    source_url: "https://example.com/wireguard-vpn-drip-guide",
  });
  assert.equal(crossBacklinkRes.status, 200);
  const crossBacklinkJson = (await crossBacklinkRes.json()) as any;
  assert.equal(crossBacklinkJson.ok, true);
  assert.equal(crossBacklinkJson.skipped, "cross_project_ignored");

  const runA18Job = await post("/api/crm/automations/run", { job_id: "A18_underperformer_auto_refresh" });
  assert.equal(runA18Job.status, 200);
  const runA18JobJson = (await runA18Job.json()) as any;
  assert.equal(runA18JobJson.ok, true);
  assert.equal(runA18JobJson.results.A18_underperformer_auto_refresh.last_status, "ok");

  // 8. Verify A9 Experiment Evaluation endpoint (/api/crm/experiments/evaluate)
  const expEvalRes = await post("/api/crm/experiments/evaluate", {});
  assert.equal(expEvalRes.status, 200);
  const expEvalJson = (await expEvalRes.json()) as any;
  assert.equal(expEvalJson.ok, true);
  assert.ok(Array.isArray(expEvalJson.experiments));
});














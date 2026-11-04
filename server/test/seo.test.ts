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
  assert.equal(obsItem.eligible_for_rewrite, true, "obs-studio-logs-crashes is off cooldown and eligible for rewrite");

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






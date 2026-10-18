import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
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


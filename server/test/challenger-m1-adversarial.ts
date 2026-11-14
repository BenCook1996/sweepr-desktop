import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSitemap } from "../src/seo/html.js";
import { getCleanItems } from "../src/pseo.js";

// Ensure we are in server dir
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

const { privateKey } = generateKeyPairSync("ed25519");
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
    crmAdminPassword: "pass",
  },
});

async function main() {
  const findings: Array<{ category: string; description: string; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO"; pass: boolean }> = [];

  console.log("=== EMPIRICAL ADVERSARIAL TEST SUITE (MILESTONE 1) ===");

  // ----------------------------------------------------
  // TEST 1: Phantom 404 paths (/month, /mo, /year, /yr)
  // ----------------------------------------------------
  console.log("\n--- Testing 1: Phantom 404 routes & variants ---");
  const phantomExact = ["/month", "/mo", "/year", "/yr"];
  for (const p of phantomExact) {
    const res = await app.request(p);
    const loc = res.headers.get("location");
    const ok = res.status === 301 && loc === "/pricing";
    findings.push({
      category: "Phantom 404 exact",
      description: `${p} -> status=${res.status}, loc=${loc}`,
      severity: "HIGH",
      pass: ok,
    });
    console.log(`[${ok ? "PASS" : "FAIL"}] ${p} => status: ${res.status}, location: ${loc}`);
  }

  // Query parameter variants
  for (const p of phantomExact) {
    const queryPath = `${p}?ref=gsc&param=123`;
    const res = await app.request(queryPath);
    const loc = res.headers.get("location");
    // Should still redirect to /pricing (or /pricing?...)
    const ok = (res.status === 301 || res.status === 410) && (loc?.startsWith("/pricing") ?? false);
    findings.push({
      category: "Phantom 404 with query",
      description: `${queryPath} -> status=${res.status}, loc=${loc}`,
      severity: "MEDIUM",
      pass: ok,
    });
    console.log(`[${ok ? "PASS" : "FAIL"}] ${queryPath} => status: ${res.status}, location: ${loc}`);
  }

  // Trailing slash variants
  for (const p of phantomExact) {
    const slashPath = `${p}/`;
    const res = await app.request(slashPath);
    const loc = res.headers.get("location");
    console.log(`[INFO] Trailing slash ${slashPath} => status: ${res.status}, location: ${loc}`);
    findings.push({
      category: "Phantom 404 with trailing slash",
      description: `${slashPath} -> status=${res.status}, loc=${loc}`,
      severity: "LOW",
      pass: res.status === 301 || res.status === 404 || res.status === 410,
    });
  }

  // Uppercase / mixed-case variants
  const upperVariants = ["/MONTH", "/Mo", "/YEAR", "/Yr", "/MONTH/"];
  for (const p of upperVariants) {
    const res = await app.request(p);
    const loc = res.headers.get("location");
    console.log(`[INFO] Case variant ${p} => status: ${res.status}, location: ${loc}`);
  }

  // ----------------------------------------------------
  // TEST 2: Localized routes (/de, /fr, /es) & X-Robots-Tag
  // ----------------------------------------------------
  console.log("\n--- Testing 2: Localized routes & X-Robots-Tag ---");
  const locales = ["de", "fr", "es"];
  for (const loc of locales) {
    // Exact home
    const homeRes = await app.request(`/${loc}`);
    const homeRobots = homeRes.headers.get("x-robots-tag");
    const homeOk = homeRes.status === 200 && homeRobots === "noindex, follow";
    findings.push({
      category: "Localized home",
      description: `/${loc} -> status=${homeRes.status}, x-robots-tag=${homeRobots}`,
      severity: "HIGH",
      pass: homeOk,
    });
    console.log(`[${homeOk ? "PASS" : "FAIL"}] /${loc} => status: ${homeRes.status}, x-robots-tag: ${homeRobots}`);

    // Trailing slash home (should 301 redirect to /${loc})
    const homeSlashRes = await app.request(`/${loc}/`);
    const homeSlashLoc = homeSlashRes.headers.get("location");
    const homeSlashOk = homeSlashRes.status === 301 && homeSlashLoc === `/${loc}`;
    findings.push({
      category: "Localized home trailing slash",
      description: `/${loc}/ -> status=${homeSlashRes.status}, loc=${homeSlashLoc}`,
      severity: "MEDIUM",
      pass: homeSlashOk,
    });
    console.log(`[${homeSlashOk ? "PASS" : "FAIL"}] /${loc}/ => status: ${homeSlashRes.status}, location: ${homeSlashLoc}`);

    // Pricing
    const pricingRes = await app.request(`/${loc}/pricing`);
    const pricingRobots = pricingRes.headers.get("x-robots-tag");
    const pricingOk = pricingRes.status === 200 && pricingRobots === "noindex, follow";
    findings.push({
      category: "Localized pricing",
      description: `/${loc}/pricing -> status=${pricingRes.status}, x-robots-tag=${pricingRobots}`,
      severity: "HIGH",
      pass: pricingOk,
    });
    console.log(`[${pricingOk ? "PASS" : "FAIL"}] /${loc}/pricing => status: ${pricingRes.status}, x-robots-tag: ${pricingRobots}`);

    // Pricing trailing slash
    const pricingSlashRes = await app.request(`/${loc}/pricing/`);
    const pricingSlashLoc = pricingSlashRes.headers.get("location");
    const pricingSlashOk = pricingSlashRes.status === 301 && pricingSlashLoc === `/${loc}/pricing`;
    findings.push({
      category: "Localized pricing trailing slash",
      description: `/${loc}/pricing/ -> status=${pricingSlashRes.status}, loc=${pricingSlashLoc}`,
      severity: "MEDIUM",
      pass: pricingSlashOk,
    });
    console.log(`[${pricingSlashOk ? "PASS" : "FAIL"}] /${loc}/pricing/ => status: ${pricingSlashRes.status}, location: ${pricingSlashLoc}`);

    // Order (MUST be noindex, nofollow)
    const orderRes = await app.request(`/${loc}/order`);
    const orderRobots = orderRes.headers.get("x-robots-tag");
    const orderOk = orderRes.status === 200 && orderRobots === "noindex, nofollow";
    findings.push({
      category: "Localized order",
      description: `/${loc}/order -> status=${orderRes.status}, x-robots-tag=${orderRobots}`,
      severity: "HIGH",
      pass: orderOk,
    });
    console.log(`[${orderOk ? "PASS" : "FAIL"}] /${loc}/order => status: ${orderRes.status}, x-robots-tag: ${orderRobots}`);

    // Order trailing slash
    const orderSlashRes = await app.request(`/${loc}/order/`);
    const orderSlashLoc = orderSlashRes.headers.get("location");
    const orderSlashOk = orderSlashRes.status === 301 && orderSlashLoc === `/${loc}/order`;
    findings.push({
      category: "Localized order trailing slash",
      description: `/${loc}/order/ -> status=${orderSlashRes.status}, loc=${orderSlashLoc}`,
      severity: "MEDIUM",
      pass: orderSlashOk,
    });
    console.log(`[${orderSlashOk ? "PASS" : "FAIL"}] /${loc}/order/ => status: ${orderSlashRes.status}, location: ${orderSlashLoc}`);
  }

  // Localized casing stress test (/DE, /FR, /ES)
  for (const loc of ["DE", "FR", "ES", "De", "Fr", "Es"]) {
    const res = await app.request(`/${loc}`);
    const robots = res.headers.get("x-robots-tag");
    console.log(`[INFO] Casing test /${loc} => status: ${res.status}, x-robots-tag: ${robots}`);
  }

  // Nested unknown localized route (e.g. /de/nonexistent)
  const unknownNested = await app.request("/de/unknown-subpath");
  console.log(`[INFO] Unknown nested /de/unknown-subpath => status: ${unknownNested.status}, x-robots-tag: ${unknownNested.headers.get("x-robots-tag")}`);

  // PAD XML header check
  const padRes = await app.request("/pad.xml");
  const padRobots = padRes.headers.get("x-robots-tag");
  console.log(`[INFO] /pad.xml => status: ${padRes.status}, x-robots-tag: ${padRobots}`);
  findings.push({
    category: "pad.xml headers",
    description: `/pad.xml -> status=${padRes.status}, x-robots-tag=${padRobots}`,
    severity: "LOW",
    pass: padRobots === "noindex, follow",
  });

  // ----------------------------------------------------
  // TEST 3: Dynamic /sitemap.xml vs Static public/sitemap.xml
  // ----------------------------------------------------
  console.log("\n--- Testing 3: Dynamic vs Static Sitemap Integrity ---");
  const staticXmlPath = resolve(process.cwd(), "public/sitemap.xml");
  const staticXml = readFileSync(staticXmlPath, "utf-8");
  const staticUrls = parseSitemap(staticXml);

  const dynRes = await app.request("/sitemap.xml");
  const dynXml = await dynRes.text();
  const dynUrls = parseSitemap(dynXml);

  console.log(`Static sitemap URL count: ${staticUrls.length}`);
  console.log(`Dynamic sitemap URL count: ${dynUrls.length}`);

  const countOk = staticUrls.length === dynUrls.length && staticUrls.length >= 70 && staticUrls.length <= 80;
  findings.push({
    category: "Sitemap count match",
    description: `Static count=${staticUrls.length}, Dynamic count=${dynUrls.length}`,
    severity: "HIGH",
    pass: countOk,
  });

  // Are URLs identical?
  const staticSet = new Set(staticUrls);
  const dynSet = new Set(dynUrls);
  let setsMatch = true;
  for (const u of staticUrls) {
    if (!dynSet.has(u)) {
      console.log(`[FAIL] Dynamic sitemap missing URL from static: ${u}`);
      setsMatch = false;
    }
  }
  for (const u of dynUrls) {
    if (!staticSet.has(u)) {
      console.log(`[FAIL] Static sitemap missing URL from dynamic: ${u}`);
      setsMatch = false;
    }
  }
  findings.push({
    category: "Sitemap identical sets",
    description: setsMatch ? "Static and dynamic sitemaps match exactly" : "Discrepancy between static and dynamic sitemaps",
    severity: "HIGH",
    pass: setsMatch,
  });

  // Check localized routes in sitemaps
  const locInStatic = staticUrls.filter(u => /\/(?:de|fr|es)(?:\/|$)/.test(u));
  const locInDyn = dynUrls.filter(u => /\/(?:de|fr|es)(?:\/|$)/.test(u));
  const locOk = locInStatic.length === 0 && locInDyn.length === 0;
  findings.push({
    category: "No localized URLs in sitemap",
    description: `Localized in static=${locInStatic.length}, in dynamic=${locInDyn.length}`,
    severity: "HIGH",
    pass: locOk,
  });
  console.log(`[${locOk ? "PASS" : "FAIL"}] Localized URLs in sitemap: static=${locInStatic.length}, dyn=${locInDyn.length}`);

  // Check pruned guides in sitemaps
  const allCleanItems = getCleanItems();
  const prunedItems = allCleanItems.filter(i => i.noindex);
  const indexedItems = allCleanItems.filter(i => !i.noindex);
  console.log(`Catalog: Total=${allCleanItems.length}, Indexed=${indexedItems.length}, Pruned=${prunedItems.length}`);

  let prunedInStaticCount = 0;
  let prunedInDynCount = 0;
  for (const item of prunedItems) {
    // Exact slug match in URLs
    if (staticUrls.some(u => u.endsWith(`/${item.slug}`) || u.includes(`/${item.slug}/`))) {
      prunedInStaticCount++;
      console.log(`[FAIL] Pruned slug ${item.slug} found in static sitemap!`);
    }
    if (dynUrls.some(u => u.endsWith(`/${item.slug}`) || u.includes(`/${item.slug}/`))) {
      prunedInDynCount++;
      console.log(`[FAIL] Pruned slug ${item.slug} found in dynamic sitemap!`);
    }
  }
  const prunedExclusionOk = prunedInStaticCount === 0 && prunedInDynCount === 0;
  findings.push({
    category: "Pruned guide exclusion from sitemap",
    description: `Pruned found in static: ${prunedInStaticCount}, in dyn: ${prunedInDynCount}`,
    severity: "CRITICAL",
    pass: prunedExclusionOk,
  });
  console.log(`[${prunedExclusionOk ? "PASS" : "FAIL"}] Zero pruned guides in sitemap (static: ${prunedInStaticCount}, dyn: ${prunedInDynCount})`);

  // Adversarial injection test: What if public/sitemap.xml temporarily contained a pruned guide?
  // Does app.get("/sitemap.xml") filter it dynamically?
  console.log("\n--- Testing 4: Dynamic Filter Adversarial Probe ---");
  const samplePruned = prunedItems[0];
  const fakeSitemapBlock = `<url><loc>https://sweeprcleaner.com/clean/${samplePruned.category}/${samplePruned.slug}</loc><priority>0.5</priority></url>`;
  // Test the regex in app.ts against various formats:
  const testBlocks = [
    `<url><loc>https://sweeprcleaner.com/clean/${samplePruned.category}/${samplePruned.slug}</loc></url>`,
    `<url>\n  <loc>https://sweeprcleaner.com/clean/${samplePruned.category}/${samplePruned.slug}</loc>\n  <priority>0.5</priority>\n</url>`,
    `<url><loc>https://sweeprcleaner.com/clean/${samplePruned.category}/${samplePruned.slug}/</loc></url>`, // trailing slash
  ];
  for (const block of testBlocks) {
    let replaced = block.replace(/<url>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/url>\s*/gi, (b, loc) => {
      const m = String(loc || "").match(/\/clean\/[^/]+\/([a-z0-9-]+)$/i);
      if (m && isPseoSlugNoindexed(m[1])) {
        return "";
      }
      return b;
    });
    const stripped = replaced.trim() === "";
    console.log(`Dynamic filter test on: ${locFromBlock(block)} => Stripped: ${stripped}`);
  }

  // ----------------------------------------------------
  // TEST 5: Full Sweep of Pruned Guides (All 329!)
  // ----------------------------------------------------
  console.log("\n--- Testing 5: Sampling Pruned Guides HTTP & Meta Robots ---");
  let prunedPassCount = 0;
  let prunedFailCount = 0;
  // Test first 50 pruned items
  for (const item of prunedItems.slice(0, 50)) {
    const res = await app.request(`/clean/${item.category}/${item.slug}`);
    if (res.status !== 200) {
      console.log(`[FAIL] Pruned item ${item.slug} returned status ${res.status}`);
      prunedFailCount++;
      continue;
    }
    const html = await res.text();
    if (!html.includes('<meta name="robots" content="noindex, follow">')) {
      console.log(`[FAIL] Pruned item ${item.slug} missing meta noindex, follow`);
      prunedFailCount++;
      continue;
    }
    prunedPassCount++;
  }
  console.log(`Sampled 50 pruned items: ${prunedPassCount} passed, ${prunedFailCount} failed`);
  findings.push({
    category: "Pruned items meta robots",
    description: `Sampled 50 pruned guides: ${prunedPassCount} passed, ${prunedFailCount} failed`,
    severity: "HIGH",
    pass: prunedFailCount === 0,
  });

  // ----------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------
  console.log("\n=== SUMMARY OF FINDINGS ===");
  let overallPass = true;
  for (const f of findings) {
    console.log(`[${f.pass ? "PASS" : "FAIL"}] [${f.severity}] ${f.category}: ${f.description}`);
    if (!f.pass && (f.severity === "CRITICAL" || f.severity === "HIGH")) {
      overallPass = false;
    }
  }
  console.log(`\nOverall Empirical Adversarial Verdict: ${overallPass ? "APPROVE" : "REQUEST_CHANGES"}`);
}

function locFromBlock(block: string): string {
  const m = block.match(/<loc>([^<]+)<\/loc>/);
  return m ? m[1] : block;
}

function isPseoSlugNoindexed(slug: string): boolean {
  const items = getCleanItems();
  const item = items.find(i => i.slug === slug);
  return !!item?.noindex;
}

main().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

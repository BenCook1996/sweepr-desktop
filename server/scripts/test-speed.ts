import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { generateKeyPairSync } from "node:crypto";

async function runBenchmark() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const repo = openDb(":memory:");
  const app = createApp({
    repo,
    signingKey: privateKey,
    stripe: null,
    config: {
      publicUrl: "https://sweeprcleaner.com",
      stripeWebhookSecret: "",
      priceActivation: "",
      priceMonthly: "",
      trialDays: 7,
      tokenTtlHours: 72,
      maxDevicesPc: 2,
      maxDevicesMobile: 2,
      devEndpoints: false,
      pastDueGraceDays: 3,
    },
  });

  const routes = [
    "/",
    "/pricing",
    "/support",
    "/refund",
    "/privacy",
    "/terms",
    "/vs/ccleaner",
    "/alternatives/ccleaner",
    "/clean",
    "/clean", // 2nd hit to check cache speed
    "/clean/app/standard-notes-media-blob-storage",
    "/clean/folder/delivery-optimization-cache",
    "/robots.txt",
    "/sitemap.xml",
    "/llms.txt",
    "/pad.xml",
  ];

  console.log("=== PageSpeed & TTFB Latency Benchmark ===");
  for (const r of routes) {
    const t0 = performance.now();
    const res = await app.request(r);
    const ms = (performance.now() - t0).toFixed(2);
    const cacheControl = res.headers.get("cache-control") || "none";
    const contentType = res.headers.get("content-type") || "unknown";
    console.log(`${r.padEnd(52)} | HTTP ${res.status} | ${ms.padStart(6)} ms | Cache: ${cacheControl}`);
  }
}

runBenchmark().catch(console.error);

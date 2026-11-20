#!/usr/bin/env node
/**
 * Live Production Security Headers, SEO Endpoints & Binary SHA-256 / Ed25519 Integrity Audit
 * Zero external npm dependencies.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const BASE_URL = (process.env.SWEEPR_PUBLIC_URL || "https://sweeprcleaner.com").replace(/\/+$/, "");

function appendSummary(md) {
  const p = process.env.GITHUB_STEP_SUMMARY;
  if (!p) return;
  try {
    fs.appendFileSync(p, md + "\n", "utf8");
  } catch {}
}

async function fetchBufferWithHash(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!res.ok) {
    throw new Error(`GET ${url} returned HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  const sha256 = createHash("sha256").update(buf).digest("hex").toUpperCase();
  return { status: res.status, bytes: buf.length, sha256, buf };
}

async function main() {
  const failures = [];
  const reportLines = [`## Live Production Security & Binary Integrity (${BASE_URL})`];

  // 1. Live security headers on homepage
  const homeRes = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(15_000) });
  if (homeRes.status !== 200) {
    failures.push(`GET ${BASE_URL}/ returned HTTP ${homeRes.status}`);
  }
  const h = homeRes.headers;
  const hsts = h.get("strict-transport-security") || "";
  const csp = h.get("content-security-policy") || "";
  const xcto = (h.get("x-content-type-options") || "").toLowerCase();
  const refPol = h.get("referrer-policy") || "";
  const xfo = h.get("x-frame-options") || "";

  if (!/max-age=\d+/i.test(hsts)) failures.push(`Missing/invalid Strict-Transport-Security header (${hsts})`);
  if (!csp) failures.push("Missing Content-Security-Policy header");
  if (xcto !== "nosniff") failures.push(`Expected X-Content-Type-Options: nosniff, got '${xcto}'`);
  if (!refPol) failures.push("Missing Referrer-Policy header");
  if (!xfo && !/frame-ancestors/i.test(csp)) failures.push("Missing X-Frame-Options or CSP frame-ancestors");

  reportLines.push(
    `- Homepage & Security Headers: HTTP ${homeRes.status} (HSTS=${Boolean(hsts)}, CSP=${Boolean(csp)}, XCTO=${xcto}, Referrer=${refPol}, XFO=${xfo})`
  );

  // 2. Core SEO & discovery endpoints
  for (const route of ["/sitemap.xml", "/robots.txt", "/llms.txt", "/pad.xml"]) {
    const r = await fetch(`${BASE_URL}${route}`, { signal: AbortSignal.timeout(15_000) });
    if (r.status !== 200) failures.push(`GET ${route} returned HTTP ${r.status}`);
    reportLines.push(`- \`GET ${route}\`: HTTP ${r.status}`);
  }

  // 3. Repo vs live manifest, PAD XML size, binary SHA-256 & Ed25519 .sig parity
  const repoManifestPath = path.join(REPO_ROOT, "server/public/release-manifest.json");
  const repoManifest = JSON.parse(fs.readFileSync(repoManifestPath, "utf8"));
  const repoPadXml = fs.readFileSync(path.join(REPO_ROOT, "server/public/pad.xml"), "utf8");
  const padBytes = Number((repoPadXml.match(/<File_Size_Bytes>([^<]+)<\/File_Size_Bytes>/) || [])[1] || 0);

  const liveManifestRes = await fetch(`${BASE_URL}/release-manifest.json`, { signal: AbortSignal.timeout(15_000) });
  if (!liveManifestRes.ok) {
    failures.push(`GET /release-manifest.json returned HTTP ${liveManifestRes.status}`);
  } else {
    const liveManifest = await liveManifestRes.json();
    if (liveManifest.version !== repoManifest.version) {
      failures.push(`Manifest version mismatch: live=${liveManifest.version}, repo=${repoManifest.version}`);
    }

    for (const [key, binPath, sigPath] of [
      ["exe", "/SWEEPRCleaner.exe", "/SWEEPRCleaner.exe.sig"],
      ["msi", "/Sweepr_Setup.msi", "/Sweepr_Setup.msi.sig"],
    ]) {
      const repoEntry = repoManifest[key] || {};
      const liveEntry = liveManifest[key] || {};
      if (liveEntry.sha256 !== repoEntry.sha256) {
        failures.push(`${key} manifest SHA-256 mismatch: live=${liveEntry.sha256}, repo=${repoEntry.sha256}`);
      }
      if (liveEntry.signature !== repoEntry.signature) {
        failures.push(`${key} manifest Ed25519 signature mismatch vs repo`);
      }

      const downloaded = await fetchBufferWithHash(`${BASE_URL}${binPath}`);
      if (downloaded.sha256 !== liveEntry.sha256 || downloaded.sha256 !== repoEntry.sha256) {
        failures.push(
          `${binPath} actual SHA-256 ${downloaded.sha256} != manifest SHA-256 (live=${liveEntry.sha256}, repo=${repoEntry.sha256})`
        );
      }
      if (downloaded.bytes !== Number(repoEntry.bytes)) {
        failures.push(`${binPath} byte size ${downloaded.bytes} != repo manifest ${repoEntry.bytes}`);
      }
      if (key === "exe" && padBytes > 0 && downloaded.bytes !== padBytes) {
        failures.push(`${binPath} byte size ${downloaded.bytes} != pad.xml <File_Size_Bytes> ${padBytes}`);
      }

      const sigRes = await fetch(`${BASE_URL}${sigPath}`, { signal: AbortSignal.timeout(15_000) });
      if (!sigRes.ok) {
        failures.push(`GET ${sigPath} returned HTTP ${sigRes.status}`);
      } else {
        const sigText = (await sigRes.text()).trim();
        const sigBufLen = Buffer.from(sigText, "base64").length;
        if (sigBufLen !== 64) {
          failures.push(`${sigPath} decoded Ed25519 signature is ${sigBufLen} bytes (expected 64)`);
        }
        if (sigText !== repoEntry.signature) {
          failures.push(`${sigPath} signature does not match repo release-manifest.json`);
        }
      }

      reportLines.push(
        `- \`${binPath}\`: HTTP ${downloaded.status}, ${downloaded.bytes} bytes, SHA-256 \`${downloaded.sha256.slice(0, 12)}...\`, Ed25519 \`.sig\` 64B OK`
      );
    }
  }

  if (failures.length > 0) {
    reportLines.push("", "### Failures", ...failures.map((f) => `- ${f}`));
  }
  const output = reportLines.join("\n");
  console.log(output);
  appendSummary(output);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[live-security-binary-audit] Fatal error:", err);
  process.exit(1);
});

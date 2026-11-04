import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBacklink, fetchPublicUrlSafe } from "./backlinks.js";
import type { SeoStore } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAD_XML_PATH = resolve(__dirname, "../../public/pad.xml");
const TAURI_CONF_PATH = resolve(__dirname, "../../../app/src-tauri/tauri.conf.json");

export interface DirectoryListingRow {
  platform_id: string;
  platform_name: string;
  listing_url: string;
  expected_version: string;
  detected_version: string | null;
  version_status: "current" | "stale" | "pending_submission" | "blocked" | "unverified";
  detected_rating: string | null;
  backlink_status: string;
  found_href: string | null;
  http_status: number | null;
  crm_task_status: "none" | "open" | "resolved";
  crm_task_note: string | null;
  last_checked_at: number | null;
  updated_at: number;
}

export const DEFAULT_DIRECTORY_LISTINGS: Array<{
  platform_id: string;
  platform_name: string;
  listing_url: string;
}> = [
  {
    platform_id: "pad_xml",
    platform_name: "Official PAD XML 4.0 Syndication Feed",
    listing_url: "https://sweeprcleaner.com/pad.xml",
  },
  {
    platform_id: "winget",
    platform_name: "Windows Package Manager (winget-pkgs)",
    listing_url: "https://github.com/microsoft/winget-pkgs",
  },
  {
    platform_id: "chocolatey",
    platform_name: "Chocolatey Community Repository",
    listing_url: "https://community.chocolatey.org/packages",
  },
  {
    platform_id: "microsoft_store",
    platform_name: "Microsoft Store (Windows 10/11)",
    listing_url: "https://apps.microsoft.com",
  },
  {
    platform_id: "majorgeeks",
    platform_name: "MajorGeeks System Utilities",
    listing_url: "https://www.majorgeeks.com",
  },
  {
    platform_id: "softpedia",
    platform_name: "Softpedia Windows System Cleaning",
    listing_url: "https://www.softpedia.com",
  },
  {
    platform_id: "alternativeto",
    platform_name: "AlternativeTo (CCleaner & BleachBit Alternatives)",
    listing_url: "https://alternativeto.net",
  },
  {
    platform_id: "saashub",
    platform_name: "SaaSHub Software Directory",
    listing_url: "https://www.saashub.com",
  },
];

export function readCurrentReleaseVersion(): string {
  if (existsSync(PAD_XML_PATH)) {
    try {
      const xml = readFileSync(PAD_XML_PATH, "utf8");
      const m = xml.match(/<Program_Version>\s*([^<\s]+)\s*<\/Program_Version>/i);
      if (m?.[1]) return m[1].trim();
    } catch {
      /* fallback */
    }
  }
  if (existsSync(TAURI_CONF_PATH)) {
    try {
      const conf = JSON.parse(readFileSync(TAURI_CONF_PATH, "utf8")) as { version?: string };
      if (conf.version) return conf.version.trim();
    } catch {
      /* fallback */
    }
  }
  return "0.1.0";
}

export function extractVersionAndRatingFromHtml(html: string): {
  detected_version: string | null;
  detected_rating: string | null;
} {
  let detectedVersion: string | null = null;
  let detectedRating: string | null = null;

  // 1. Check PAD XML <Program_Version>
  const padMatch = html.match(/<Program_Version>\s*([0-9]+\.[0-9]+\.[0-9]+)\s*<\/Program_Version>/i);
  if (padMatch?.[1]) {
    detectedVersion = padMatch[1];
  }

  // 2. Check JSON-LD softwareVersion / ratingValue
  if (!detectedVersion) {
    const svMatch = html.match(/"softwareVersion"\s*:\s*"v?([0-9]+\.[0-9]+\.[0-9]+)"/i);
    if (svMatch?.[1]) detectedVersion = svMatch[1];
  }
  const ratingMatch =
    html.match(/"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i) ||
    html.match(/([0-9]\.[0-9])\s*\/\s*5(?:\s*stars)?/i);
  if (ratingMatch?.[1]) {
    detectedRating = `${ratingMatch[1]}/5`;
  }

  // 3. Check visible version strings (e.g. "Version 0.1.0" or "SWEEPR Cleaner 0.1.0" or "v0.1.0")
  if (!detectedVersion) {
    const verMatch =
      html.match(/(?:version|release|sweepr(?:\s+cleaner)?)\s*[:\-]?\s*v?([0-9]+\.[0-9]+\.[0-9]+)/i) ||
      html.match(/\bv([0-9]+\.[0-9]+\.[0-9]+)\b/);
    if (verMatch?.[1]) detectedVersion = verMatch[1];
  }

  return { detected_version: detectedVersion, detected_rating: detectedRating };
}

export function ensureDirectoryListingsSeeded(store: SeoStore) {
  const expectedVersion = readCurrentReleaseVersion();
  const now = Math.floor(Date.now() / 1000);
  const existing = store.db.prepare("SELECT COUNT(*) AS c FROM seo_directory_listings").get() as { c: number };
  if (existing.c === 0) {
    const stmt = store.db.prepare(`
      INSERT OR IGNORE INTO seo_directory_listings (
        platform_id, platform_name, listing_url, expected_version,
        version_status, backlink_status, crm_task_status, updated_at
      ) VALUES (?, ?, ?, ?, 'unverified', 'unverified', 'none', ?)
    `);
    for (const item of DEFAULT_DIRECTORY_LISTINGS) {
      stmt.run(item.platform_id, item.platform_name, item.listing_url, expectedVersion, now);
    }
  } else {
    store.db
      .prepare("UPDATE seo_directory_listings SET expected_version = ? WHERE expected_version != ?")
      .run(expectedVersion, expectedVersion);
  }
}

export function listDirectoryListings(store: SeoStore): DirectoryListingRow[] {
  ensureDirectoryListingsSeeded(store);
  return store.db
    .prepare("SELECT * FROM seo_directory_listings ORDER BY platform_id ASC")
    .all() as unknown as DirectoryListingRow[];
}

export function upsertDirectoryListing(
  store: SeoStore,
  input: {
    platform_id: string;
    platform_name?: string;
    listing_url: string;
    expected_version?: string;
  }
): DirectoryListingRow {
  ensureDirectoryListingsSeeded(store);
  const now = Math.floor(Date.now() / 1000);
  const expected = input.expected_version?.trim() || readCurrentReleaseVersion();
  const id = input.platform_id.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const name = input.platform_name?.trim() || id;

  store.db
    .prepare(
      `INSERT INTO seo_directory_listings (
         platform_id, platform_name, listing_url, expected_version,
         version_status, backlink_status, crm_task_status, updated_at
       ) VALUES (?, ?, ?, ?, 'unverified', 'unverified', 'none', ?)
       ON CONFLICT(platform_id) DO UPDATE SET
         platform_name = COALESCE(?, seo_directory_listings.platform_name),
         listing_url = excluded.listing_url,
         expected_version = excluded.expected_version,
         updated_at = excluded.updated_at`
    )
    .run(id, name, input.listing_url.trim(), expected, now, input.platform_name?.trim() || null);

  return store.db.prepare("SELECT * FROM seo_directory_listings WHERE platform_id = ?").get(id) as unknown as DirectoryListingRow;
}

export async function checkDirectoryListings(
  store: SeoStore,
  opts: {
    targetDomain?: string;
    expectedVersion?: string;
    platformId?: string;
    customHtmlByPlatform?: Record<string, { html: string; httpStatus?: number; hasBacklink?: boolean; foundHref?: string }>;
  } = {}
) {
  ensureDirectoryListingsSeeded(store);
  const expectedVersion = opts.expectedVersion?.trim() || readCurrentReleaseVersion();
  const targetDomain = (opts.targetDomain || "sweeprcleaner.com").toLowerCase().replace(/^www\./, "");
  const all = listDirectoryListings(store).filter((r) => !opts.platformId || r.platform_id === opts.platformId);
  const now = Math.floor(Date.now() / 1000);

  const results: DirectoryListingRow[] = [];
  let staleCount = 0;
  let currentCount = 0;
  let tasksCreated = 0;

  for (const row of all) {
    let detectedVersion: string | null = null;
    let detectedRating: string | null = null;
    let backlinkStatus = row.backlink_status;
    let foundHref: string | null = row.found_href;
    let httpStatus: number | null = row.http_status;

    const injected = opts.customHtmlByPlatform?.[row.platform_id];
    if (injected) {
      const parsed = extractVersionAndRatingFromHtml(injected.html);
      detectedVersion = parsed.detected_version;
      detectedRating = parsed.detected_rating;
      httpStatus = injected.httpStatus ?? 200;
      backlinkStatus = injected.hasBacklink ? "live" : "missing";
      foundHref = injected.foundHref ?? (injected.hasBacklink ? `https://${targetDomain}` : null);
    } else if (row.platform_id === "pad_xml" && existsSync(PAD_XML_PATH)) {
      const xml = readFileSync(PAD_XML_PATH, "utf8");
      const parsed = extractVersionAndRatingFromHtml(xml);
      detectedVersion = parsed.detected_version;
      httpStatus = 200;
      backlinkStatus = xml.includes(targetDomain) ? "live" : "missing";
      foundHref = `https://${targetDomain}/SWEEPRCleaner.exe`;
    } else {
      const bl = await checkBacklink(row.listing_url, targetDomain, 10000);
      backlinkStatus = bl.status;
      foundHref = bl.found_href;
      httpStatus = bl.http_status;
      try {
        const { res } = await fetchPublicUrlSafe(row.listing_url, 8000, 3);
        if (res.ok) {
          const text = await res.text();
          const parsed = extractVersionAndRatingFromHtml(text);
          detectedVersion = parsed.detected_version;
          detectedRating = parsed.detected_rating;
        }
      } catch {
        /* ignore fetch error */
      }
    }

    let versionStatus: DirectoryListingRow["version_status"] = "unverified";
    let crmTaskStatus: DirectoryListingRow["crm_task_status"] = "none";
    let crmTaskNote: string | null = null;

    if (backlinkStatus === "blocked") {
      versionStatus = "blocked";
      crmTaskStatus = "open";
      crmTaskNote = `Verify ${row.platform_name} manually in browser (WAF challenge encountered) and confirm v${expectedVersion}.`;
    } else if (detectedVersion === expectedVersion) {
      versionStatus = "current";
      crmTaskStatus = "resolved";
      crmTaskNote = `${row.platform_name} is up to date on v${expectedVersion}.`;
      currentCount += 1;
    } else if (detectedVersion && detectedVersion !== expectedVersion) {
      versionStatus = "stale";
      crmTaskStatus = "open";
      crmTaskNote = `STALE VERSION on ${row.platform_name}: displaying v${detectedVersion} instead of v${expectedVersion}. Submit updated PAD XML (https://${targetDomain}/pad.xml) or signed installer.`;
      staleCount += 1;
      tasksCreated += 1;
    } else {
      versionStatus = "pending_submission";
      crmTaskStatus = "open";
      crmTaskNote =
        backlinkStatus === "needs_listing_url"
          ? `Submit SWEEPR Cleaner v${expectedVersion} to ${row.platform_name} using https://${targetDomain}/pad.xml and update listing_url to the deep product page.`
          : `Listing on ${row.platform_name} missing version string v${expectedVersion} or backlink (${backlinkStatus}).`;
      tasksCreated += 1;
    }

    store.db
      .prepare(
        `UPDATE seo_directory_listings SET
           expected_version = ?,
           detected_version = ?,
           version_status = ?,
           detected_rating = ?,
           backlink_status = ?,
           found_href = ?,
           http_status = ?,
           crm_task_status = ?,
           crm_task_note = ?,
           last_checked_at = ?,
           updated_at = ?
         WHERE platform_id = ?`
      )
      .run(
        expectedVersion,
        detectedVersion,
        versionStatus,
        detectedRating,
        backlinkStatus,
        foundHref,
        httpStatus,
        crmTaskStatus,
        crmTaskNote,
        now,
        now,
        row.platform_id
      );

    // Sync stale listings into outreach_logs as actionable CRM tasks
    if (versionStatus === "stale") {
      try {
        const existingLog = store.db
          .prepare("SELECT id FROM outreach_logs WHERE url = ? LIMIT 1")
          .get(row.listing_url) as { id: number } | undefined;
        if (existingLog) {
          store.db
            .prepare("UPDATE outreach_logs SET status = 'stale_version', category = ? WHERE id = ?")
            .run(crmTaskNote, existingLog.id);
        } else {
          store.db
            .prepare(
              `INSERT INTO outreach_logs (who, website, url, how, category, status, reached_out_at)
               VALUES (?, ?, ?, 'A5 Listing Freshness Monitor', ?, 'stale_version', ?)`
            )
            .run(row.platform_name, new URL(row.listing_url).hostname, row.listing_url, crmTaskNote, now);
        }
      } catch {
        /* ignore if outreach_logs schema differs */
      }
    }

    results.push({
      ...row,
      expected_version: expectedVersion,
      detected_version: detectedVersion,
      version_status: versionStatus,
      detected_rating: detectedRating,
      backlink_status: backlinkStatus,
      found_href: foundHref,
      http_status: httpStatus,
      crm_task_status: crmTaskStatus,
      crm_task_note: crmTaskNote,
      last_checked_at: now,
      updated_at: now,
    });
  }

  return {
    checked: results.length,
    expected_version: expectedVersion,
    current_count: currentCount,
    stale_count: staleCount,
    open_crm_tasks: tasksCreated,
    listings: results,
  };
}

export function getDirectorySubmissionPack(store: SeoStore) {
  const version = readCurrentReleaseVersion();
  const listings = listDirectoryListings(store);
  const sha256Msi = "38E5CDF3D69D53BBDAAEEB5CCDC12E222E0D4CD5DB3E214F93DF6F38D73CA172";

  return {
    release_version: version,
    pad_xml_url: "https://sweeprcleaner.com/pad.xml",
    installer_urls: {
      windows_exe: "https://sweeprcleaner.com/SWEEPRCleaner.exe",
      windows_msi: "https://sweeprcleaner.com/Sweepr_Setup.msi",
      macos_dmg: "https://sweeprcleaner.com/SWEEPRCleaner.dmg",
      android_apk: "https://sweeprcleaner.com/SWEEPRCleaner.apk",
    },
    hashes: {
      windows_msi_sha256: sha256Msi,
      product_code: "{07521DB8-EE40-4826-A28D-E29EC366DFBE}",
    },
    canonical_copy: {
      title_short: "SWEEPR Cleaner",
      tagline_80: "Privacy-first 5 MB native Rust PC & cross-platform disk cleaner with 7-day rollback.",
      description_250:
        "SWEEPR Cleaner is a lightweight 5 MB native Rust & Tauri v2 disk cleaner for Windows 11/10, macOS, Android, and iOS. Safely reclaim 10–65 GB across 367 audited AppData, Steam, NVIDIA DXCache, Adobe, and Windows Update caches with zero telemetry.",
      categories: ["System Utilities", "Disk Cleaners", "PC Optimization", "Privacy & Security"],
      competitor_alternatives: ["CCleaner", "BleachBit", "CleanMyPC", "Wise Disk Cleaner", "Avast Cleanup", "Glary Utilities"],
    },
    wave_1_channels: [
      {
        platform_id: "winget",
        name: "Windows Package Manager (Winget)",
        manifest_dir: `winget-manifests/m/Makeur/SweeprCleaner/${version}/`,
        command: `wingetcreate submit --token $GITHUB_TOKEN winget-manifests/m/Makeur/SweeprCleaner/${version}`,
        submission_url: "https://github.com/microsoft/winget-pkgs/pulls",
      },
      {
        platform_id: "chocolatey",
        name: "Chocolatey Community Repository",
        manifest_dir: "chocolatey/",
        command: `choco pack chocolatey/sweepr-cleaner.nuspec && choco push sweepr-cleaner.${version}.nupkg --source https://push.chocolatey.org/`,
        submission_url: "https://community.chocolatey.org/packages/sweepr-cleaner",
      },
      {
        platform_id: "microsoft_wdsi",
        name: "Microsoft Security Intelligence (WDSI SmartScreen File Submission)",
        submission_url: "https://www.microsoft.com/en-us/wdsi/filesubmission",
        instructions:
          "Submit SWEEPRCleaner.exe and Sweepr_Setup.msi as Software Developer -> Incorrectly detected as PUA/SmartScreen unknown publisher alongside SSL.com OV/EV ticket #151810941.",
      },
      {
        platform_id: "softpedia",
        name: "Softpedia Windows System Utilities (PAD XML Import)",
        submission_url: "https://www.softpedia.com/user/pad_submit.shtml",
        pad_feed: "https://sweeprcleaner.com/pad.xml",
      },
      {
        platform_id: "alternativeto",
        name: "AlternativeTo (CCleaner & BleachBit Alternatives)",
        submission_url: "https://alternativeto.net/software/sweepr-cleaner/about/",
        target_alternatives: ["ccleaner", "bleachbit", "cleanmypc", "wise-disk-cleaner"],
      },
      {
        platform_id: "saashub",
        name: "SaaSHub Software Directory",
        submission_url: "https://www.saashub.com/sweepr-cleaner-alternatives",
      },
      {
        platform_id: "majorgeeks",
        name: "MajorGeeks Drive Cleaners",
        submission_url: "https://www.majorgeeks.com/content/page/aboutcontact_us.html",
        pad_feed: "https://sweeprcleaner.com/pad.xml",
      },
    ],
    tracked_listings: listings,
  };
}

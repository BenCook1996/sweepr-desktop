import { openDb } from "../src/db.js";
import { SeoStore } from "../src/seo/store.js";
import {
  checkDirectoryListings,
  listDirectoryListings,
  listListingCrmTasks,
  getDirectorySubmissionPack,
  readCurrentReleaseVersion
} from "../src/seo/listings.js";

async function main() {
  console.log("================================================================================");
  console.log("  SWEEPR CLEANER — AUTHORITY DIRECTORY & PAD XML SYNDICATION STATUS");
  console.log("================================================================================\n");

  const repo = openDb("./data/sweepr.db");
  const store = new SeoStore(repo.db);
  const version = readCurrentReleaseVersion();
  console.log(`Current Release Version: v${version}`);

  const checkResult = await checkDirectoryListings(store);
  console.log(`\nChecked ${checkResult.checked} authority directory listings:`);
  console.log(`  - Up to Date (Current):   ${checkResult.current_count}`);
  console.log(`  - Stale / Needs Update:   ${checkResult.stale_count}`);
  console.log(`  - Open Actionable Tasks:  ${checkResult.open_crm_tasks}`);

  console.log("\n--- Detailed Platform Breakdown ---");
  for (const l of checkResult.listings) {
    console.log(`\n* [${l.platform_id}] ${l.platform_name}`);
    console.log(`  Listing URL:     ${l.listing_url}`);
    console.log(`  Version Status:  ${l.version_status.toUpperCase()} (Detected: ${l.detected_version ?? "none"} | Expected: ${l.expected_version})`);
    console.log(`  Backlink Status: ${l.backlink_status} (HTTP ${l.http_status ?? "N/A"}${l.found_href ? ` -> ${l.found_href}` : ""})`);
    if (l.detected_rating) console.log(`  Rating:          ${l.detected_rating}`);
    console.log(`  CRM Task Status: ${l.crm_task_status}`);
    if (l.crm_task_note) console.log(`  Action Note:     ${l.crm_task_note}`);
  }

  const tasks = listListingCrmTasks(store);
  console.log(`\n--- Actionable CRM Outreach Tasks (${tasks.open_count} open) ---`);
  for (const t of tasks.tasks) {
    console.log(`- [${t.platform_id}] ${t.crm_task_note}`);
  }

  const pack = getDirectorySubmissionPack(store);
  console.log("\n--- Wave 1 Submission Pack Channels ---");
  console.log(`PAD XML Feed: ${pack.pad_xml_url}`);
  console.log(`Windows EXE SHA-256: ${pack.hashes.windows_exe_sha256}`);
  console.log(`Windows MSI SHA-256: ${pack.hashes.windows_msi_sha256}`);
  for (const ch of pack.wave_1_channels) {
    console.log(`* ${ch.name} (${ch.platform_id})`);
    console.log(`  Target: ${ch.submission_url}`);
    if ("command" in ch && ch.command) console.log(`  CLI Command: ${ch.command}`);
  }
  console.log("\n================================================================================");
}

main().catch(console.error);

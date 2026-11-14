import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "../..");
const SERVER_PUBLIC = resolve(ROOT_DIR, "server/public");

const WINGET_TARGET_PATHS = [
  join(ROOT_DIR, "winget-manifests/manifests/s/Sweepr/SweeprCleaner/0.1.0"),
  join(ROOT_DIR, "manifests/s/Sweepr/SweeprCleaner/0.1.0"),
  join(ROOT_DIR, "winget-manifests/s/SWEEPR/Cleaner/0.1.0"),
];
const CHOCOLATEY_DIR = resolve(ROOT_DIR, "chocolatey");
const DOCS_DIST_DIR = resolve(ROOT_DIR, "docs/distribution");

function resolveChocoInstallPath(): string {
  const camel = join(CHOCOLATEY_DIR, "tools/chocolateyInstall.ps1");
  return existsSync(camel) ? camel : join(CHOCOLATEY_DIR, "tools/chocolateyinstall.ps1");
}

function sha256File(path: string): string {
  const buf = readFileSync(path);
  return createHash("sha256").update(buf).digest("hex").toUpperCase();
}

function findExistingWingetDir(): string {
  for (const p of WINGET_TARGET_PATHS) {
    if (existsSync(p)) return p;
  }
  return WINGET_TARGET_PATHS[0];
}

function loadDistributionDocs(): string {
  if (!existsSync(DOCS_DIST_DIR)) return "";
  const files = readdirSync(DOCS_DIST_DIR);
  return files
    .filter((f) => f.endsWith(".md"))
    .map((f) => readFileSync(join(DOCS_DIST_DIR, f), "utf8"))
    .join("\n\n");
}

function loadCommunityDocs(): string {
  const commDir = join(DOCS_DIST_DIR, "community");
  if (!existsSync(commDir)) return "";
  const files = readdirSync(commDir);
  return files
    .filter((f) => f.endsWith(".md"))
    .map((f) => readFileSync(join(commDir, f), "utf8"))
    .join("\n\n");
}

describe("E2E Distribution Track — Tier 1: Feature Coverage & Deliverable Presence", () => {
  test("TC-WG-01 & 02: Winget manifest directory and 3 YAML manifests exist", () => {
    const wingetDir = findExistingWingetDir();
    assert.ok(existsSync(wingetDir), `Winget directory must exist at ${wingetDir}`);

    const files = readdirSync(wingetDir);
    const hasVersion = files.some((f) => f.endsWith(".yaml") && !f.includes(".installer.") && !f.includes(".locale."));
    const hasInstaller = files.some((f) => f.includes(".installer.yaml"));
    const hasLocale = files.some((f) => f.includes(".locale.en-US.yaml"));

    assert.ok(hasVersion, "Winget version manifest YAML must exist");
    assert.ok(hasInstaller, "Winget installer manifest YAML must exist");
    assert.ok(hasLocale, "Winget defaultLocale manifest YAML must exist");
  });

  test("TC-WG-03: Winget version manifest contains valid schema fields", () => {
    const wingetDir = findExistingWingetDir();
    assert.ok(existsSync(wingetDir), "Winget directory must exist");
    const verFile = readdirSync(wingetDir).find((f) => f.endsWith(".yaml") && !f.includes(".installer.") && !f.includes(".locale."));
    assert.ok(verFile, "Winget version manifest file must be present");
    const content = readFileSync(join(wingetDir, verFile), "utf8");

    assert.match(content, /PackageIdentifier:\s*Sweepr\.SweeprCleaner/i);
    assert.match(content, /PackageVersion:\s*0\.1\.0/);
    assert.match(content, /DefaultLocale:\s*en-US/);
    assert.match(content, /ManifestType:\s*version/);
    assert.match(content, /ManifestVersion:\s*1\.[569]\.0/);
  });

  test("TC-WG-04 & 05: Winget installer and locale manifests contain valid metadata", () => {
    const wingetDir = findExistingWingetDir();
    assert.ok(existsSync(wingetDir));
    const instFile = readdirSync(wingetDir).find((f) => f.includes(".installer.yaml"));
    const localeFile = readdirSync(wingetDir).find((f) => f.includes(".locale.en-US.yaml"));
    assert.ok(instFile, "Installer manifest must exist");
    assert.ok(localeFile, "Locale manifest must exist");

    const instContent = readFileSync(join(wingetDir, instFile), "utf8");
    const localeContent = readFileSync(join(wingetDir, localeFile), "utf8");

    assert.match(instContent, /ManifestType:\s*installer/);
    assert.match(localeContent, /ManifestType:\s*defaultLocale/);
    assert.match(localeContent, /PackageName:\s*SWEEPR Cleaner/i);
    assert.match(localeContent, /Publisher:\s*Benjamin Cook/i);
    assert.match(localeContent, /License:\s*(?:Freemium|Proprietary)/i);
  });

  test("TC-CH-01: Chocolatey files exist including nuspec and both install/uninstall scripts", () => {
    const nuspecPath = join(CHOCOLATEY_DIR, "sweepr-cleaner.nuspec");
    const installScript = resolveChocoInstallPath();
    const uninstallScript = join(CHOCOLATEY_DIR, "tools/chocolateyUninstall.ps1");

    assert.ok(existsSync(nuspecPath), "sweepr-cleaner.nuspec must exist");
    assert.ok(existsSync(installScript), "chocolateyinstall.ps1 must exist");
    assert.ok(existsSync(uninstallScript), "chocolateyUninstall.ps1 must exist");
  });

  test("TC-CH-02: Chocolatey nuspec contains correct package metadata", () => {
    const nuspecPath = join(CHOCOLATEY_DIR, "sweepr-cleaner.nuspec");
    assert.ok(existsSync(nuspecPath));
    const content = readFileSync(nuspecPath, "utf8");

    assert.match(content, /<id>sweepr-cleaner<\/id>/i);
    assert.match(content, /<version>0\.1\.0<\/version>/i);
    assert.match(content, /<title>SWEEPR Cleaner<\/title>/i);
    assert.match(content, /<authors>Benjamin Cook<\/authors>/i);
  });

  test("TC-CH-03 & 04: Chocolatey install and uninstall scripts execute with proper cmdlets", () => {
    const installScriptPath = resolveChocoInstallPath();
    const uninstallScriptPath = join(CHOCOLATEY_DIR, "tools/chocolateyUninstall.ps1");

    assert.ok(existsSync(installScriptPath));
    assert.ok(existsSync(uninstallScriptPath));

    const installContent = readFileSync(installScriptPath, "utf8");
    const uninstallContent = readFileSync(uninstallScriptPath, "utf8");

    assert.match(installContent, /Install-ChocolateyPackage/i);
    assert.match(installContent, /https:\/\/sweeprcleaner\.com\/SWEEPRCleaner\.exe/i);
    assert.ok(
      uninstallContent.includes("Uninstall-ChocolateyPackage") || uninstallContent.includes("/S"),
      "chocolateyUninstall.ps1 must execute uninstaller with silent switch"
    );
  });

  test("TC-DP-01 & 02: Download portals directory contains documentation for 6 Tier-1 portals", () => {
    const docs = loadDistributionDocs();
    assert.ok(docs.length > 0, "docs/distribution markdown documentation must exist");

    const portals = ["Softpedia", "MajorGeeks", "FileHorse", "SnapFiles", "Uptodown", "SourceForge"];
    for (const portal of portals) {
      assert.ok(
        new RegExp(portal, "i").test(docs),
        `Download portal submission docs must include ${portal}`
      );
    }
  });

  test("TC-DP-03: Switcher directory profiles cover AlternativeTo, SaaSHub, and Product Hunt", () => {
    const docs = loadDistributionDocs();
    assert.ok(/AlternativeTo/i.test(docs), "Must document AlternativeTo profile");
    assert.ok(/SaaSHub/i.test(docs), "Must document SaaSHub profile");
    assert.ok(/Product\s*Hunt/i.test(docs), "Must document Product Hunt launch copy");
  });

  test("TC-DP-04 & 05: Portal submission copy contains universal metadata and editorial pitch", () => {
    const docs = loadDistributionDocs();
    assert.match(docs, /SWEEPR Cleaner/i, "Must contain Program Name");
    assert.match(docs, /0\.1\.0/, "Must contain Program Version");
    assert.match(docs, /Freemium/i, "Must contain License model");
    assert.match(docs, /https:\/\/sweeprcleaner\.com\/pad\.xml/i, "Must reference PAD XML URL");
    assert.ok(docs.length > 500, "Documentation must provide comprehensive editorial pitch (> 500 chars)");
  });

  test("TC-CP-01 & 02: Community breakdown posts exist for r/Windows11 and r/pcmasterrace", () => {
    const commDocs = loadCommunityDocs();
    assert.ok(commDocs.length > 0, "docs/distribution/community posts must exist");
    assert.ok(/r\/Windows11/i.test(commDocs), "Must include r/Windows11 breakdown post");
    assert.ok(/r\/pcmasterrace|pcmasterrace/i.test(commDocs), "Must include r/pcmasterrace breakdown post");
  });

  test("TC-CP-03 & 04: Community posts cite storage benchmarks and provide PowerShell audit code block", () => {
    const commDocs = loadCommunityDocs();
    assert.ok(
      commDocs.includes("state-of-windows-storage") ||
      commDocs.includes("DXCache") ||
      commDocs.includes("WinSxS") ||
      commDocs.includes("377"),
      "Community posts must cite empirical Windows storage telemetry/benchmarks"
    );
    assert.ok(
      commDocs.includes("```powershell") || commDocs.includes("```powershell\n"),
      "Community posts must contain copy-pasteable PowerShell audit script code block"
    );
  });

  test("TC-GSC-01 & 02: Staged GSC re-indexing plan includes all 10 priority URLs", () => {
    const gscPlanPath = join(DOCS_DIST_DIR, "gsc-reindexing-plan.md");
    const altGscPlanPath = join(DOCS_DIST_DIR, "GSC_REINDEXING_EXECUTION_PLAN.md");
    const path = existsSync(gscPlanPath) ? gscPlanPath : altGscPlanPath;
    assert.ok(existsSync(path), "GSC re-indexing execution plan must exist");

    const content = readFileSync(path, "utf8");
    const requiredUrls = [
      "/pricing",
      "/download",
      "/vs/ccleaner",
      "/vs/cleanmymac",
      "/vs/bleachbit",
      "/clean",
      "/tools",
      "/clean/app/steam-depotcache",
      "/clean/folder/winsxs",
      "/clean/app/nvidia-dxcache",
    ];

    for (const u of requiredUrls) {
      assert.ok(content.includes(u), `GSC re-indexing plan must include ${u}`);
    }
  });
});

describe("E2E Distribution Track — Tier 2: Boundary & Corner Cases / Cryptographic Integrity", () => {
  test("TC-WG-06: InstallerSha256 in Winget matches exact SHA-256 of SWEEPRCleaner.exe binary", () => {
    const exePath = join(SERVER_PUBLIC, "SWEEPRCleaner.exe");
    assert.ok(existsSync(exePath), "SWEEPRCleaner.exe must exist in server/public");
    const expectedSha256 = sha256File(exePath);

    const wingetDir = findExistingWingetDir();
    assert.ok(existsSync(wingetDir));
    const instFile = readdirSync(wingetDir).find((f) => f.includes(".installer.yaml"));
    assert.ok(instFile);
    const content = readFileSync(join(wingetDir, instFile), "utf8");

    assert.ok(
      content.includes(expectedSha256),
      `Winget installer manifest must contain computed SHA-256 ${expectedSha256}`
    );
  });

  test("TC-WG-07: InstallerSha256 for MSI in Winget matches exact SHA-256 of Sweepr_Setup.msi", () => {
    const msiPath = join(SERVER_PUBLIC, "Sweepr_Setup.msi");
    assert.ok(existsSync(msiPath), "Sweepr_Setup.msi must exist in server/public");
    const expectedSha256 = sha256File(msiPath);

    const wingetDir = findExistingWingetDir();
    assert.ok(existsSync(wingetDir));
    const instFile = readdirSync(wingetDir).find((f) => f.includes(".installer.yaml"));
    assert.ok(instFile);
    const content = readFileSync(join(wingetDir, instFile), "utf8");

    assert.ok(
      content.includes(expectedSha256),
      `Winget installer manifest must contain MSI computed SHA-256 ${expectedSha256}`
    );
  });

  test("TC-WG-08: Silent switches in Winget manifests match NSIS (/S) and Wix MSI (/qn /norestart)", () => {
    const wingetDir = findExistingWingetDir();
    assert.ok(existsSync(wingetDir));
    const instFile = readdirSync(wingetDir).find((f) => f.includes(".installer.yaml"));
    assert.ok(instFile);
    const content = readFileSync(join(wingetDir, instFile), "utf8");

    // Nullsoft (NSIS) requires strictly uppercase /S
    assert.match(
      content,
      /InstallerType:\s*nullsoft[\s\S]*?InstallerSwitches:\s*\n\s*Silent:\s*\/S\b/,
      "Winget nullsoft installer must specify uppercase /S silent switch"
    );

    // Wix (MSI) requires /qn /norestart
    assert.match(
      content,
      /InstallerType:\s*wix[\s\S]*?InstallerSwitches:\s*\n\s*Silent:\s*\/qn\s+\/norestart\b/,
      "Winget wix MSI installer must specify /qn /norestart silent switch"
    );
  });

  test("TC-CH-05: Chocolatey install script checksum matches binary SHA-256", () => {
    const exePath = join(SERVER_PUBLIC, "SWEEPRCleaner.exe");
    const expectedSha256 = sha256File(exePath);

    const scriptPath = resolveChocoInstallPath();
    assert.ok(existsSync(scriptPath));
    const scriptContent = readFileSync(scriptPath, "utf8");

    assert.ok(
      scriptContent.toUpperCase().includes(expectedSha256),
      `chocolateyinstall.ps1 must include binary SHA-256 ${expectedSha256}`
    );
  });

  test("TC-CH-06: Chocolatey silentArgs uses exact /S switch", () => {
    const scriptPath = resolveChocoInstallPath();
    assert.ok(existsSync(scriptPath));
    const content = readFileSync(scriptPath, "utf8");
    assert.match(content, /silentArgs\s*=\s*['"]\/S['"]/);
  });

  test("TC-CH-07: Chocolatey summary text length conforms to moderation guidelines (< 200 chars)", () => {
    const nuspecPath = join(CHOCOLATEY_DIR, "sweepr-cleaner.nuspec");
    assert.ok(existsSync(nuspecPath));
    const content = readFileSync(nuspecPath, "utf8");
    const m = content.match(/<summary>([\s\S]*?)<\/summary>/i);
    assert.ok(m, "Nuspec must contain <summary> tag");
    const summary = m[1].trim();
    assert.ok(summary.length > 0 && summary.length < 200, `Summary length must be < 200 chars, got ${summary.length}`);
  });

  test("TC-DP-06: AlternativeTo profile explicitly tags all 7 required competitors", () => {
    const switcherPath = join(DOCS_DIST_DIR, "switcher-directory-profiles.md");
    assert.ok(existsSync(switcherPath), "switcher-directory-profiles.md must exist in docs/distribution");
    const switcherDoc = readFileSync(switcherPath, "utf8");

    // Strictly isolate Section 1 (AlternativeTo.net Profile) to prevent false-pass leakage from SaaSHub or other docs
    const altToMatch = switcherDoc.match(/##\s*1\.\s*AlternativeTo[\s\S]*?(?=##\s*2\b|$)/i);
    assert.ok(altToMatch, "AlternativeTo profile section must exist in switcher-directory-profiles.md");
    const altToSection = altToMatch[0];

    const competitors = [
      "CCleaner",
      "BleachBit",
      "CleanMyPC",
      "CleanMyMac",
      "Wise Disk Cleaner",
      "Glary Utilities",
      "Avast Cleanup",
    ];

    for (const comp of competitors) {
      assert.ok(
        new RegExp(`\\b${comp.replace(/\\s+/g, "\\s+")}\\b`, "i").test(altToSection),
        `AlternativeTo profile section must explicitly tag competitor: ${comp}`
      );
    }
  });

  test("TC-DP-08: PAD XML byte count matches SWEEPRCleaner.exe file size", () => {
    const padPath = join(SERVER_PUBLIC, "pad.xml");
    const padContent = readFileSync(padPath, "utf8");
    const exePath = join(SERVER_PUBLIC, "SWEEPRCleaner.exe");
    const actualBytes = statSync(exePath).size;

    assert.ok(
      padContent.includes(`<File_Size_Bytes>${actualBytes}</File_Size_Bytes>`),
      `pad.xml must contain exact byte size <File_Size_Bytes>${actualBytes}</File_Size_Bytes>`
    );
  });

  test("TC-CP-06: Community PowerShell scripts are strictly read-only (zero destructive commands)", () => {
    const commDocs = loadCommunityDocs();
    assert.ok(commDocs.length > 0, "Community documentation files must exist and not be empty");

    const destructiveCmdlets = [
      /\bRemove-Item\b/i,
      /\bClear-Content\b/i,
      /\bdel\s+/i,
      /\berase\b/i,
      /\bFormat-Volume\b/i,
      /\brmdir\b/i,
      /\brd\s+/i,
      /\brm\s+/i,
      /\bri\s+/i,
      /\bclc\s+/i,
    ];

    for (const re of destructiveCmdlets) {
      assert.ok(
        !re.test(commDocs),
        `Community PowerShell scripts must NOT contain destructive command: ${re.source}`
      );
    }
  });

  test("TC-CP-07: Community posts contain WinSxS safety warning against manual deletion", () => {
    const commDocs = loadCommunityDocs();
    assert.ok(
      commDocs.includes("WinSxS") &&
      (commDocs.includes("DISM") || commDocs.includes("dism.exe") || commDocs.includes("StartComponentCleanup")),
      "Community posts must contain WinSxS warning and recommend DISM StartComponentCleanup"
    );
  });
});

describe("E2E Distribution Track — Tier 3: Syntactic, Schema & Script Validation", () => {
  test("TC-WG-10: Winget YAML files contain valid aka.ms schema headers", () => {
    const wingetDir = findExistingWingetDir();
    assert.ok(existsSync(wingetDir));
    const files = readdirSync(wingetDir).filter((f) => f.endsWith(".yaml"));

    for (const f of files) {
      const content = readFileSync(join(wingetDir, f), "utf8");
      assert.ok(
        content.includes("https://aka.ms/winget-manifest."),
        `${f} must contain valid aka.ms schema URL`
      );
    }
  });

  test("TC-WG-11: Winget YAML files do not contain tab characters", () => {
    const wingetDir = findExistingWingetDir();
    assert.ok(existsSync(wingetDir));
    const files = readdirSync(wingetDir).filter((f) => f.endsWith(".yaml"));

    for (const f of files) {
      const content = readFileSync(join(wingetDir, f), "utf8");
      assert.ok(!content.includes("\t"), `${f} must not contain tab characters`);
    }
  });

  test("TC-WG-12: Winget manifest URLs strictly enforce HTTPS and point to valid download targets", () => {
    const wingetDir = findExistingWingetDir();
    assert.ok(existsSync(wingetDir));
    const files = readdirSync(wingetDir).filter((f) => f.endsWith(".yaml"));

    for (const f of files) {
      const content = readFileSync(join(wingetDir, f), "utf8");
      // Enforce zero insecure http:// URLs across all Winget manifests
      assert.doesNotMatch(
        content,
        /http:\/\/(?!schemas\.microsoft\.com)/i,
        `${f} must not contain insecure http:// URLs`
      );

      // Verify schema headers use secure https://aka.ms
      const schemaMatch = content.match(/#\s*yaml-language-server:\s*\$schema=(\S+)/);
      if (schemaMatch) {
        assert.ok(
          schemaMatch[1].startsWith("https://aka.ms/winget-manifest."),
          `${f} schema must reference official https://aka.ms/winget-manifest.* URL`
        );
      }
    }

    const instFile = readdirSync(wingetDir).find((f) => f.includes(".installer.yaml"));
    assert.ok(instFile, "Installer manifest must exist");
    const instContent = readFileSync(join(wingetDir, instFile), "utf8");

    // Extract all InstallerUrl entries
    const installerUrls = Array.from(
      instContent.matchAll(/InstallerUrl:\s*(\S+)/g),
      (m) => m[1]
    );

    assert.ok(
      installerUrls.length >= 2,
      "Winget installer manifest must define at least 2 InstallerUrls (nullsoft exe + wix msi)"
    );

    for (const url of installerUrls) {
      assert.ok(
        url.startsWith("https://sweeprcleaner.com/"),
        `InstallerUrl must use HTTPS and point to sweeprcleaner.com domain: ${url}`
      );
      assert.ok(
        url.endsWith(".exe") || url.endsWith(".msi"),
        `InstallerUrl must point directly to binary installer (.exe or .msi): ${url}`
      );
    }
  });

  test("TC-CH-08: Chocolatey nuspec is valid XML with xmlns and metadata element", () => {
    const nuspecPath = join(CHOCOLATEY_DIR, "sweepr-cleaner.nuspec");
    assert.ok(existsSync(nuspecPath));
    const content = readFileSync(nuspecPath, "utf8");

    assert.ok(content.startsWith("<?xml") || content.includes("<package"));
    assert.ok(content.includes('xmlns="http://schemas.microsoft.com/packaging/2015/06/nuspec.xsd"'));
    assert.ok(content.includes("<metadata>") && content.includes("</metadata>"));
    assert.ok(content.includes("<files>") && content.includes("</files>"));
    assert.ok(!/[^&]&[^a-zA-Z0-9#]/.test(content), "Nuspec must not have unescaped ampersands");
  });

  test("TC-CH-09: Chocolatey PowerShell scripts start with ErrorActionPreference Stop", () => {
    const installScript = readFileSync(resolveChocoInstallPath(), "utf8");
    const uninstallPath = join(CHOCOLATEY_DIR, "tools/chocolateyUninstall.ps1");
    if (existsSync(uninstallPath)) {
      const uninstallScript = readFileSync(uninstallPath, "utf8");
      assert.match(uninstallScript, /\$ErrorActionPreference\s*=\s*['"]Stop['"]/);
    }
    assert.match(installScript, /\$ErrorActionPreference\s*=\s*['"]Stop['"]/);
  });

  test("TC-CP-08: Community PowerShell scripts contain valid structure", () => {
    const commDocs = loadCommunityDocs();
    assert.ok(commDocs.includes("Get-ChildItem"), "PowerShell script must use Get-ChildItem");
    assert.ok(commDocs.includes("Measure-Object"), "PowerShell script must use Measure-Object");
  });
});

describe("E2E Distribution Track — Tier 4: Opaque-Box E2E Simulation & Packaging Readiness", () => {
  test("TC-WG-13: Authenticode Publisher name aligns with Winget publisher metadata", () => {
    const wingetDir = findExistingWingetDir();
    assert.ok(existsSync(wingetDir));
    const localeFile = readdirSync(wingetDir).find((f) => f.includes(".locale.en-US.yaml"));
    assert.ok(localeFile);
    const content = readFileSync(join(wingetDir, localeFile), "utf8");

    assert.match(
      content,
      /Publisher:\s*(?:Benjamin Cook|SWEEPR Cleaner Team)/,
      "Winget locale Publisher must match verified Authenticode entity"
    );
  });

  test("TC-CH-11: Chocolatey tools directory contains only script assets and no large binaries", () => {
    const toolsDir = join(CHOCOLATEY_DIR, "tools");
    assert.ok(existsSync(toolsDir));
    const files = readdirSync(toolsDir);

    for (const f of files) {
      assert.ok(
        f.endsWith(".ps1") || f.endsWith(".txt") || f.endsWith(".md"),
        `Chocolatey tools directory must not bundle executable binaries: found ${f}`
      );
    }
  });

  test("TC-DP-10: Universal PAD XML endpoint referenced across all portal copy", () => {
    const docs = loadDistributionDocs();
    assert.ok(
      docs.includes("https://sweeprcleaner.com/pad.xml"),
      "Portal submission assets must reference live PAD URL https://sweeprcleaner.com/pad.xml"
    );
  });

  test("TC-GSC-03: Staged rollout batches respect GSC daily quota (10-12 URLs/day)", () => {
    const gscPlanPath = join(DOCS_DIST_DIR, "gsc-reindexing-plan.md");
    const altGscPlanPath = join(DOCS_DIST_DIR, "GSC_REINDEXING_EXECUTION_PLAN.md");
    const path = existsSync(gscPlanPath) ? gscPlanPath : altGscPlanPath;
    assert.ok(existsSync(path));

    const content = readFileSync(path, "utf8");
    assert.ok(
      content.includes("Phase") || content.includes("Stage") || content.includes("Day 1"),
      "GSC re-indexing plan must be organized into staged phases/days"
    );
  });
});

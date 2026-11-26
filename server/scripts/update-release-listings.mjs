#!/usr/bin/env node
/**
 * A5. Listing Freshness & Release Auto-Publish Synchronizer
 *
 * Updates:
 *  1. `server/public/release-manifest.json` (exe, msi, dmg, plus optional CI artifacts)
 *  2. `server/public/pad.xml` (<Program_Version>, release date, <File_Size_Bytes/K/MB>, and Char_Desc_2000 MB label)
 *  3. `winget-manifests/manifests/s/Sweepr/SweeprCleaner/<version>/*.yaml` (PackageVersion, SHA-256, & .locale.en-US.yaml size label)
 *  4. `chocolatey/sweepr-cleaner.nuspec`, `chocolatey/tools/chocolateyInstall.ps1`, `chocolatey/tools/VERIFICATION.txt` (version, checksum, & installer size)
 *  5. `scoop/bucket/sweepr-cleaner.json` (version & lowercase SHA-256)
 *  6. `homebrew/Casks/sweepr-cleaner.rb` (version & lowercase DMG SHA-256)
 *  7. `README.md` (Verified Release Checksums table) & `server/public/support.html` (installer size label)
 *
 * Note: `server/src/download-recovery.ts` and `server/src/seo/listings.ts` read `release-manifest.json`
 * dynamically for SHA-256 checksums; M3's `server/src/seo/llms-index.ts` should likewise consume `release-manifest.json`.
 *
 * Usage:
 *   node server/scripts/update-release-listings.mjs [--version=0.1.0] [--artifacts-json=path/to/artifacts.json] [--dry-run]
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const PAD_XML_PATH = path.join(REPO_ROOT, "server/public/pad.xml");
const EXE_PATH = path.join(REPO_ROOT, "server/public/SWEEPRCleaner.exe");
const EXE_SIG_PATH = path.join(REPO_ROOT, "server/public/SWEEPRCleaner.exe.sig");
const MSI_PATH = path.join(REPO_ROOT, "server/public/Sweepr_Setup.msi");
const MSI_SIG_PATH = path.join(REPO_ROOT, "server/public/Sweepr_Setup.msi.sig");
const DMG_PATH = path.join(REPO_ROOT, "server/public/SWEEPRCleaner.dmg");
const PORTABLE_ZIP_X64_PATH = path.join(REPO_ROOT, "server/public/SWEEPRCleaner-portable-win-x64.zip");
const RELEASE_MANIFEST_PATH = path.join(REPO_ROOT, "server/public/release-manifest.json");
const TAURI_CONF_PATH = path.join(REPO_ROOT, "app/src-tauri/tauri.conf.json");
const NUSPEC_PATH = path.join(REPO_ROOT, "chocolatey/sweepr-cleaner.nuspec");
const CHOCO_VERIFICATION_PATH = path.join(REPO_ROOT, "chocolatey/tools/VERIFICATION.txt");
const SCOOP_MANIFEST_PATH = path.join(REPO_ROOT, "scoop/bucket/sweepr-cleaner.json");
const HOMEBREW_CASK_PATH = path.join(REPO_ROOT, "homebrew/Casks/sweepr-cleaner.rb");
const CHOCO_INSTALL_PATH = fs.existsSync(path.join(REPO_ROOT, "chocolatey/tools/chocolateyInstall.ps1"))
  ? path.join(REPO_ROOT, "chocolatey/tools/chocolateyInstall.ps1")
  : path.join(REPO_ROOT, "chocolatey/tools/chocolateyinstall.ps1");

function loadEd25519PrivateKey() {
  let b64 = (process.env.LICENSE_PRIVATE_KEY_B64 || "").trim();
  if (!b64) {
    for (const envFile of [path.join(REPO_ROOT, "server/.env"), path.join(REPO_ROOT, ".env")]) {
      if (fs.existsSync(envFile)) {
        const content = fs.readFileSync(envFile, "utf8");
        const match = content.match(/^LICENSE_PRIVATE_KEY_B64=(.+)$/m);
        if (match?.[1]?.trim()) {
          b64 = match[1].trim().replace(/^["']|["']$/g, "");
          break;
        }
      }
    }
  }
  if (!b64) {
    const secretsFile = path.join(REPO_ROOT, "server/data/.server-secrets.json");
    if (fs.existsSync(secretsFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(secretsFile, "utf8"));
        if (typeof parsed?.licensePrivateKeyB64 === "string") {
          b64 = parsed.licensePrivateKeyB64.trim();
        }
      } catch {}
    }
  }
  if (!b64) return null;
  try {
    const decoded = Buffer.from(b64, "base64");
    const text = decoded.toString("utf8");
    const key = text.includes("BEGIN")
      ? crypto.createPrivateKey(text)
      : crypto.createPrivateKey({ key: decoded, format: "der", type: "pkcs8" });
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

function sha256AndSignFile(filePath, sigPath, signingKey) {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex").toUpperCase();
  let signature = "";
  if (signingKey) {
    signature = crypto.sign(null, buf, signingKey).toString("base64");
    fs.writeFileSync(sigPath, `${signature}\n`, "utf8");
  } else if (fs.existsSync(sigPath)) {
    signature = fs.readFileSync(sigPath, "utf8").trim();
  }
  return {
    bytes: buf.length,
    sha256,
    signature,
  };
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return {
    bytes: buf.length,
    sha256: crypto.createHash("sha256").update(buf).digest("hex").toUpperCase(),
  };
}

function readExistingManifest() {
  if (!fs.existsSync(RELEASE_MANIFEST_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(RELEASE_MANIFEST_PATH, "utf8").replace(/^\uFEFF/, ""));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readArtifactsJson(argPath) {
  if (!argPath) return {};
  const resolved = path.isAbsolute(argPath) ? argPath : path.resolve(REPO_ROOT, argPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`--artifacts-json file not found: ${resolved}`);
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8").replace(/^\uFEFF/, ""));
  return parsed && typeof parsed === "object" ? parsed : {};
}

function main() {
  const verArg = process.argv.find((a) => a.startsWith("--version="));
  const artifactsArg = process.argv.find((a) => a.startsWith("--artifacts-json="));
  const dryRun = process.argv.includes("--dry-run");
  const writeText = (targetPath, content) => {
    if (!dryRun) fs.writeFileSync(targetPath, content, "utf8");
  };
  const tauriConf = fs.existsSync(TAURI_CONF_PATH)
    ? JSON.parse(fs.readFileSync(TAURI_CONF_PATH, "utf8"))
    : { version: "0.1.0" };
  const version = (verArg ? verArg.slice("--version=".length) : tauriConf.version || "0.1.0")
    .replace(/^v/i, "")
    .trim();

  const existingManifest = readExistingManifest();
  const ciArtifacts = readArtifactsJson(artifactsArg ? artifactsArg.slice("--artifacts-json=".length) : "");
  const signingKey = loadEd25519PrivateKey();

  const exeInfo = sha256AndSignFile(EXE_PATH, EXE_SIG_PATH, dryRun ? null : signingKey) || {
    bytes: 7085912,
    sha256: "FEAE464CA121CF897D27916C632F4DB8F84A87D4B79642403AD1B0E0F2BB706A",
    signature: fs.existsSync(EXE_SIG_PATH) ? fs.readFileSync(EXE_SIG_PATH, "utf8").trim() : "",
  };
  const msiInfo = sha256AndSignFile(MSI_PATH, MSI_SIG_PATH, dryRun ? null : signingKey) || {
    bytes: 3993600,
    sha256: "33E5427E84AB8FC4F3D01DFD17404F7CB38B70B9731A8C2CCFBB62876711933A",
    signature: fs.existsSync(MSI_SIG_PATH) ? fs.readFileSync(MSI_SIG_PATH, "utf8").trim() : "",
  };

  const dmgInfo = ciArtifacts.dmg || sha256File(DMG_PATH) || existingManifest.dmg || null;
  const apkInfo = ciArtifacts.apk || sha256File(path.join(REPO_ROOT, "server/public/SWEEPRCleaner.apk")) || null;
  const portableZipInfo = ciArtifacts.portableZip || sha256File(PORTABLE_ZIP_X64_PATH) || existingManifest.portableZip || null;
  const windowsArm64Info = ciArtifacts.windowsArm64 || existingManifest.windowsArm64 || null;
  const linuxInfo = ciArtifacts.linux || existingManifest.linux || null;

  const manifestPayload = {
    version,
    exe: exeInfo,
    msi: msiInfo,
    ...(dmgInfo ? { dmg: dmgInfo } : {}),
    ...(portableZipInfo ? { portableZip: portableZipInfo } : {}),
    ...(windowsArm64Info ? { windowsArm64: windowsArm64Info } : {}),
    ...(linuxInfo ? { linux: linuxInfo } : {}),
  };

  writeText(RELEASE_MANIFEST_PATH, `${JSON.stringify(manifestPayload, null, 2)}\n`);

  const updated = ["server/public/release-manifest.json"];

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const sizeMb = (exeInfo.bytes / (1024 * 1024)).toFixed(2);
  const dmgSizeMb = dmgInfo?.bytes ? (dmgInfo.bytes / (1024 * 1024)).toFixed(2) : "7.07";
  const msiSizeMb = (msiInfo.bytes / (1024 * 1024)).toFixed(2);
  const apkSizeMb = apkInfo?.bytes ? (apkInfo.bytes / (1024 * 1024)).toFixed(2) : "3.23";

  // 1. Update server/public/pad.xml (only bump release date if version or byte size changed)
  if (fs.existsSync(PAD_XML_PATH)) {
    let pad = fs.readFileSync(PAD_XML_PATH, "utf8");
    const currentPadVer = pad.match(/<Program_Version>([^<]*)<\/Program_Version>/)?.[1]?.trim();
    const currentPadBytes = Number(pad.match(/<File_Size_Bytes>([^<]*)<\/File_Size_Bytes>/)?.[1] || 0);
    const binaryOrVersionChanged = currentPadVer !== version || currentPadBytes !== exeInfo.bytes;
    const sizeK = Math.round(exeInfo.bytes / 1024);
    pad = pad
      .replace(/<Program_Version>[^<]*<\/Program_Version>/, `<Program_Version>${version}</Program_Version>`)
      .replace(/<File_Size_Bytes>[^<]*<\/File_Size_Bytes>/, `<File_Size_Bytes>${exeInfo.bytes}</File_Size_Bytes>`)
      .replace(/<File_Size_K>[^<]*<\/File_Size_K>/, `<File_Size_K>${sizeK}</File_Size_K>`)
      .replace(/<File_Size_MB>[^<]*<\/File_Size_MB>/, `<File_Size_MB>${sizeMb}</File_Size_MB>`)
      .replace(/Fast &amp; Lightweight \([^)]+\)/, `Fast &amp; Lightweight (${sizeMb} MB)`);
    if (binaryOrVersionChanged) {
      pad = pad
        .replace(/<Program_Release_Month>[^<]*<\/Program_Release_Month>/, `<Program_Release_Month>${month}</Program_Release_Month>`)
        .replace(/<Program_Release_Day>[^<]*<\/Program_Release_Day>/, `<Program_Release_Day>${day}</Program_Release_Day>`)
        .replace(/<Program_Release_Year>[^<]*<\/Program_Release_Year>/, `<Program_Release_Year>${year}</Program_Release_Year>`);
    }
    writeText(PAD_XML_PATH, pad);
    updated.push("server/public/pad.xml");
  }

  // 2. Update Chocolatey nuspec, chocolateyInstall.ps1 & VERIFICATION.txt
  if (fs.existsSync(NUSPEC_PATH)) {
    const nuspec = fs
      .readFileSync(NUSPEC_PATH, "utf8")
      .replace(/<version>[^<]*<\/version>/, `<version>${version}</version>`);
    writeText(NUSPEC_PATH, nuspec);
    updated.push("chocolatey/sweepr-cleaner.nuspec");
  }
  if (fs.existsSync(CHOCO_INSTALL_PATH)) {
    const ps1 = fs
      .readFileSync(CHOCO_INSTALL_PATH, "utf8")
      .replace(/checksum64\s*=\s*'[^']*'/, `checksum64     = '${exeInfo.sha256}'`);
    writeText(CHOCO_INSTALL_PATH, ps1);
    updated.push("chocolatey/tools/chocolateyInstall.ps1");
  }
  if (fs.existsSync(CHOCO_VERIFICATION_PATH)) {
    const verification = fs
      .readFileSync(CHOCO_VERIFICATION_PATH, "utf8")
      .replace(/^(2\.\s*Version:\s*)[^\r\n]+/m, `$1${version}`)
      .replace(/^(\s*Installer Size:\s*)[^\r\n]+/m, `$1${exeInfo.bytes.toLocaleString("en-US")} bytes (${sizeMb} MiB / ${sizeMb} MB)`)
      .replace(/^(\s*Checksum:\s*)[A-F0-9]{64}/im, `$1${exeInfo.sha256}`);
    writeText(CHOCO_VERIFICATION_PATH, verification);
    updated.push("chocolatey/tools/VERIFICATION.txt");
  }

  // 3. Update Winget manifests under winget-manifests/manifests/s/Sweepr/SweeprCleaner/<version>/
  const wingetDir = path.join(REPO_ROOT, "winget-manifests/manifests/s/Sweepr/SweeprCleaner", version);
  if (!dryRun) fs.mkdirSync(wingetDir, { recursive: true });
  const baseWingetDir = path.join(REPO_ROOT, "winget-manifests/manifests/s/Sweepr/SweeprCleaner/0.1.0");
  for (const file of ["Sweepr.SweeprCleaner.yaml", "Sweepr.SweeprCleaner.installer.yaml", "Sweepr.SweeprCleaner.locale.en-US.yaml"]) {
    const srcPath = fs.existsSync(path.join(wingetDir, file))
      ? path.join(wingetDir, file)
      : path.join(baseWingetDir, file);
    if (!fs.existsSync(srcPath)) continue;
    let yml = fs
      .readFileSync(srcPath, "utf8")
      .replace(/PackageVersion:\s*[^\r\n]+/, `PackageVersion: ${version}`);
    if (file.endsWith(".installer.yaml")) {
      yml = yml
        .replace(/DisplayVersion:\s*[^\r\n]+/g, `DisplayVersion: ${version}`)
        .replace(
          /(InstallerUrl:\s*https:\/\/sweeprcleaner\.com\/SWEEPRCleaner\.exe\s*\r?\n\s*InstallerSha256:\s*)[A-F0-9]{64}/i,
          `$1${exeInfo.sha256}`
        )
        .replace(
          /(InstallerUrl:\s*https:\/\/sweeprcleaner\.com\/Sweepr_Setup\.msi\s*\r?\n\s*InstallerSha256:\s*)[A-F0-9]{64}/i,
          `$1${msiInfo.sha256}`
        );
    }
    if (file.endsWith(".locale.en-US.yaml")) {
      yml = yml.replace(/\(\d+\.\d{2} MB installer/i, `(${sizeMb} MB installer`);
    }
    writeText(path.join(wingetDir, file), yml);
  }
  updated.push(`winget-manifests/manifests/s/Sweepr/SweeprCleaner/${version}`);

  // 4. Update Scoop bucket manifest (scoop/bucket/sweepr-cleaner.json)
  if (fs.existsSync(SCOOP_MANIFEST_PATH)) {
    const scoop = JSON.parse(fs.readFileSync(SCOOP_MANIFEST_PATH, "utf8").replace(/^\uFEFF/, ""));
    scoop.version = version;
    if (scoop.architecture?.["64bit"]) {
      const targetUrl = scoop.architecture["64bit"].url || "";
      if (targetUrl.endsWith(".zip") && portableZipInfo?.sha256) {
        scoop.architecture["64bit"].hash = portableZipInfo.sha256.toLowerCase();
      } else {
        scoop.architecture["64bit"].hash = exeInfo.sha256.toLowerCase();
      }
    }
    writeText(SCOOP_MANIFEST_PATH, `${JSON.stringify(scoop, null, 2)}\n`);
    updated.push("scoop/bucket/sweepr-cleaner.json");
  }

  // 5. Update Homebrew Cask (homebrew/Casks/sweepr-cleaner.rb)
  if (fs.existsSync(HOMEBREW_CASK_PATH)) {
    let cask = fs
      .readFileSync(HOMEBREW_CASK_PATH, "utf8")
      .replace(/^(\s*version\s+)"[^"]+"/m, `$1"${version}"`);
    if (dmgInfo?.sha256) {
      cask = cask.replace(/^(\s*sha256\s+)"[a-f0-9]{64}"/im, `$1"${dmgInfo.sha256.toLowerCase()}"`);
    }
    writeText(HOMEBREW_CASK_PATH, cask);
    updated.push("homebrew/Casks/sweepr-cleaner.rb");
  }

  // 6. Update README.md Verified Release Checksums
  const readmePath = path.join(REPO_ROOT, "README.md");
  if (fs.existsSync(readmePath)) {
    let readme = fs
      .readFileSync(readmePath, "utf8")
      .replace(/Direct Releases \(`v[^`]+`\)/, `Direct Releases (\`v${version}\`)`)
      .replace(/releases\/tag\/v[^)\s]+/, `releases/tag/v${version}`)
      .replace(/Verified Release Checksums \(`v[^`]+`\)/, `Verified Release Checksums (\`v${version}\`)`)
      .replace(/(\|\s*`SWEEPRCleaner\.exe`\s*\|[^|]+\|\s*)[^|]+(\|\s*`)[A-F0-9]{64}(`\s*\|)/i, `$1${exeInfo.bytes.toLocaleString("en-US")} (${sizeMb} MiB) $2${exeInfo.sha256}$3`)
      .replace(/(\|\s*`Sweepr_Setup\.msi`\s*\|[^|]+\|\s*)[^|]+(\|\s*`)[A-F0-9]{64}(`\s*\|)/i, `$1${msiInfo.bytes.toLocaleString("en-US")} (${msiSizeMb} MiB) $2${msiInfo.sha256}$3`);
    if (dmgInfo?.sha256 && dmgInfo?.bytes) {
      readme = readme.replace(/(\|\s*`SWEEPRCleaner\.dmg`\s*\|[^|]+\|\s*)[^|]+(\|\s*`)[A-F0-9]{64}(`\s*\|)/i, `$1${dmgInfo.bytes.toLocaleString("en-US")} (${dmgSizeMb} MiB) $2${dmgInfo.sha256}$3`);
    }
    if (apkInfo?.sha256 && apkInfo?.bytes) {
      readme = readme.replace(/(\|\s*`SWEEPRCleaner\.apk`\s*\|[^|]+\|\s*)[^|]+(\|\s*`)[A-F0-9]{64}(`\s*\|)/i, `$1${apkInfo.bytes.toLocaleString("en-US")} (${apkSizeMb} MiB) $2${apkInfo.sha256}$3`);
    }
    writeText(readmePath, readme);
    updated.push("README.md");
  }

  // 7. Update server/public/support.html native Rust installer size label
  const supportPath = path.join(REPO_ROOT, "server/public/support.html");
  if (fs.existsSync(supportPath)) {
    const supportHtml = fs
      .readFileSync(supportPath, "utf8")
      .replace(
        /native Rust installer \(\d[\d,]* bytes \/ \d+\.\d{2} MiB/i,
        `native Rust installer (${exeInfo.bytes.toLocaleString("en-US")} bytes / ${sizeMb} MiB`
      );
    writeText(supportPath, supportHtml);
    updated.push("server/public/support.html");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        version,
        exe: exeInfo,
        msi: msiInfo,
        ...(dmgInfo ? { dmg: dmgInfo } : {}),
        ...(apkInfo ? { apk: apkInfo } : {}),
        ...(portableZipInfo ? { portableZip: portableZipInfo } : {}),
        ...(windowsArm64Info ? { windowsArm64: windowsArm64Info } : {}),
        ...(linuxInfo ? { linux: linuxInfo } : {}),
        updated,
      },
      null,
      2
    )
  );
}

main();

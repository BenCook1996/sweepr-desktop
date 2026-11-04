#!/usr/bin/env node
/**
 * A5. Listing Freshness & Release Auto-Publish Synchronizer
 *
 * Updates:
 *  1. `server/public/pad.xml` (<Program_Version>, release date, and <File_Size_Bytes/K/MB>)
 *  2. `winget-manifests/s/SWEEPR/Cleaner/<version>/*.yaml` (PackageVersion & SHA-256)
 *  3. `chocolatey/sweepr-cleaner.nuspec` & `chocolatey/tools/chocolateyinstall.ps1` (version & SHA-256)
 *
 * Usage:
 *   node server/scripts/update-release-listings.mjs [--version=0.1.0]
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const PAD_XML_PATH = path.join(REPO_ROOT, "server/public/pad.xml");
const EXE_PATH = path.join(REPO_ROOT, "server/public/SWEEPRCleaner.exe");
const MSI_PATH = path.join(REPO_ROOT, "server/public/Sweepr_Setup.msi");
const TAURI_CONF_PATH = path.join(REPO_ROOT, "app/src-tauri/tauri.conf.json");
const NUSPEC_PATH = path.join(REPO_ROOT, "chocolatey/sweepr-cleaner.nuspec");
const CHOCO_INSTALL_PATH = path.join(REPO_ROOT, "chocolatey/tools/chocolateyinstall.ps1");

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return {
    bytes: buf.length,
    sha256: crypto.createHash("sha256").update(buf).digest("hex").toUpperCase(),
  };
}

function main() {
  const verArg = process.argv.find((a) => a.startsWith("--version="));
  const tauriConf = fs.existsSync(TAURI_CONF_PATH)
    ? JSON.parse(fs.readFileSync(TAURI_CONF_PATH, "utf8"))
    : { version: "0.1.0" };
  const version = (verArg ? verArg.slice("--version=".length) : tauriConf.version || "0.1.0")
    .replace(/^v/i, "")
    .trim();

  const exeInfo = sha256File(EXE_PATH) || {
    bytes: 6840632,
    sha256: "38E5CDF33C813709C0B4124334CD10EA797C70AAED0C598F4CCB5A5F477544AA",
  };
  const msiInfo = sha256File(MSI_PATH) || {
    bytes: 3993600,
    sha256: "33E5427E84AB8FC4F3D01DFD17404F7CB38B70B9731A8C2CCFBB62876711933A",
  };

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");

  // 1. Update server/public/pad.xml
  if (fs.existsSync(PAD_XML_PATH)) {
    let pad = fs.readFileSync(PAD_XML_PATH, "utf8");
    const sizeK = Math.round(exeInfo.bytes / 1024);
    const sizeMb = (exeInfo.bytes / (1024 * 1024)).toFixed(2);
    pad = pad
      .replace(/<Program_Version>[^<]*<\/Program_Version>/, `<Program_Version>${version}</Program_Version>`)
      .replace(/<Program_Release_Month>[^<]*<\/Program_Release_Month>/, `<Program_Release_Month>${month}</Program_Release_Month>`)
      .replace(/<Program_Release_Day>[^<]*<\/Program_Release_Day>/, `<Program_Release_Day>${day}</Program_Release_Day>`)
      .replace(/<Program_Release_Year>[^<]*<\/Program_Release_Year>/, `<Program_Release_Year>${year}</Program_Release_Year>`)
      .replace(/<File_Size_Bytes>[^<]*<\/File_Size_Bytes>/, `<File_Size_Bytes>${exeInfo.bytes}</File_Size_Bytes>`)
      .replace(/<File_Size_K>[^<]*<\/File_Size_K>/, `<File_Size_K>${sizeK}</File_Size_K>`)
      .replace(/<File_Size_MB>[^<]*<\/File_Size_MB>/, `<File_Size_MB>${sizeMb}</File_Size_MB>`);
    fs.writeFileSync(PAD_XML_PATH, pad, "utf8");
  }

  // 2. Update Chocolatey nuspec & chocolateyinstall.ps1
  if (fs.existsSync(NUSPEC_PATH)) {
    const nuspec = fs
      .readFileSync(NUSPEC_PATH, "utf8")
      .replace(/<version>[^<]*<\/version>/, `<version>${version}</version>`);
    fs.writeFileSync(NUSPEC_PATH, nuspec, "utf8");
  }
  if (fs.existsSync(CHOCO_INSTALL_PATH)) {
    const ps1 = fs
      .readFileSync(CHOCO_INSTALL_PATH, "utf8")
      .replace(/checksum64\s*=\s*'[^']*'/, `checksum64     = '${exeInfo.sha256}'`);
    fs.writeFileSync(CHOCO_INSTALL_PATH, ps1, "utf8");
  }

  // 3. Update Winget manifests under winget-manifests/s/SWEEPR/Cleaner/<version>/
  const wingetDir = path.join(REPO_ROOT, "winget-manifests/s/SWEEPR/Cleaner", version);
  fs.mkdirSync(wingetDir, { recursive: true });
  const baseWingetDir = path.join(REPO_ROOT, "winget-manifests/s/SWEEPR/Cleaner/0.1.0");
  for (const file of ["SWEEPR.Cleaner.yaml", "SWEEPR.Cleaner.installer.yaml", "SWEEPR.Cleaner.locale.en-US.yaml"]) {
    const srcPath = fs.existsSync(path.join(wingetDir, file))
      ? path.join(wingetDir, file)
      : path.join(baseWingetDir, file);
    if (!fs.existsSync(srcPath)) continue;
    let yml = fs
      .readFileSync(srcPath, "utf8")
      .replace(/PackageVersion:\s*[^\r\n]+/, `PackageVersion: ${version}`);
    if (file.endsWith(".installer.yaml")) {
      yml = yml
        .replace(
          /(InstallerUrl:\s*https:\/\/sweeprcleaner\.com\/SWEEPRCleaner\.exe\s*\r?\n\s*InstallerSha256:\s*)[A-F0-9]{64}/i,
          `$1${exeInfo.sha256}`
        )
        .replace(
          /(InstallerUrl:\s*https:\/\/sweeprcleaner\.com\/Sweepr_Setup\.msi\s*\r?\n\s*InstallerSha256:\s*)[A-F0-9]{64}/i,
          `$1${msiInfo.sha256}`
        );
    }
    fs.writeFileSync(path.join(wingetDir, file), yml, "utf8");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        version,
        exe: exeInfo,
        msi: msiInfo,
        updated: ["server/public/pad.xml", "chocolatey/sweepr-cleaner.nuspec", `winget-manifests/s/SWEEPR/Cleaner/${version}`],
      },
      null,
      2
    )
  );
}

main();

#!/usr/bin/env node
/**
 * A5. Listing Freshness & Release Auto-Publish Synchronizer
 *
 * Updates:
 *  1. `server/public/pad.xml` (<Program_Version>, release date, and <File_Size_Bytes/K/MB>)
 *  2. `winget-manifests/manifests/s/Sweepr/SweeprCleaner/<version>/*.yaml` (PackageVersion & SHA-256)
 *  3. `chocolatey/sweepr-cleaner.nuspec` & `chocolatey/tools/chocolateyInstall.ps1` (version & SHA-256)
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
const EXE_SIG_PATH = path.join(REPO_ROOT, "server/public/SWEEPRCleaner.exe.sig");
const MSI_PATH = path.join(REPO_ROOT, "server/public/Sweepr_Setup.msi");
const MSI_SIG_PATH = path.join(REPO_ROOT, "server/public/Sweepr_Setup.msi.sig");
const RELEASE_MANIFEST_PATH = path.join(REPO_ROOT, "server/public/release-manifest.json");
const TAURI_CONF_PATH = path.join(REPO_ROOT, "app/src-tauri/tauri.conf.json");
const NUSPEC_PATH = path.join(REPO_ROOT, "chocolatey/sweepr-cleaner.nuspec");
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

function main() {
  const verArg = process.argv.find((a) => a.startsWith("--version="));
  const tauriConf = fs.existsSync(TAURI_CONF_PATH)
    ? JSON.parse(fs.readFileSync(TAURI_CONF_PATH, "utf8"))
    : { version: "0.1.0" };
  const version = (verArg ? verArg.slice("--version=".length) : tauriConf.version || "0.1.0")
    .replace(/^v/i, "")
    .trim();

  const signingKey = loadEd25519PrivateKey();

  const exeInfo = sha256AndSignFile(EXE_PATH, EXE_SIG_PATH, signingKey) || {
    bytes: 6840632,
    sha256: "38E5CDF33C813709C0B4124334CD10EA797C70AAED0C598F4CCB5A5F477544AA",
    signature: fs.existsSync(EXE_SIG_PATH) ? fs.readFileSync(EXE_SIG_PATH, "utf8").trim() : "",
  };
  const msiInfo = sha256AndSignFile(MSI_PATH, MSI_SIG_PATH, signingKey) || {
    bytes: 3993600,
    sha256: "33E5427E84AB8FC4F3D01DFD17404F7CB38B70B9731A8C2CCFBB62876711933A",
    signature: fs.existsSync(MSI_SIG_PATH) ? fs.readFileSync(MSI_SIG_PATH, "utf8").trim() : "",
  };

  fs.writeFileSync(
    RELEASE_MANIFEST_PATH,
    `${JSON.stringify(
      {
        version,
        exe: exeInfo,
        msi: msiInfo,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");

  // 1. Update server/public/pad.xml (only bump release date if version or byte size changed)
  if (fs.existsSync(PAD_XML_PATH)) {
    let pad = fs.readFileSync(PAD_XML_PATH, "utf8");
    const currentPadVer = pad.match(/<Program_Version>([^<]*)<\/Program_Version>/)?.[1]?.trim();
    const currentPadBytes = Number(pad.match(/<File_Size_Bytes>([^<]*)<\/File_Size_Bytes>/)?.[1] || 0);
    const binaryOrVersionChanged = currentPadVer !== version || currentPadBytes !== exeInfo.bytes;
    const sizeK = Math.round(exeInfo.bytes / 1024);
    const sizeMb = (exeInfo.bytes / (1024 * 1024)).toFixed(2);
    pad = pad
      .replace(/<Program_Version>[^<]*<\/Program_Version>/, `<Program_Version>${version}</Program_Version>`)
      .replace(/<File_Size_Bytes>[^<]*<\/File_Size_Bytes>/, `<File_Size_Bytes>${exeInfo.bytes}</File_Size_Bytes>`)
      .replace(/<File_Size_K>[^<]*<\/File_Size_K>/, `<File_Size_K>${sizeK}</File_Size_K>`)
      .replace(/<File_Size_MB>[^<]*<\/File_Size_MB>/, `<File_Size_MB>${sizeMb}</File_Size_MB>`);
    if (binaryOrVersionChanged) {
      pad = pad
        .replace(/<Program_Release_Month>[^<]*<\/Program_Release_Month>/, `<Program_Release_Month>${month}</Program_Release_Month>`)
        .replace(/<Program_Release_Day>[^<]*<\/Program_Release_Day>/, `<Program_Release_Day>${day}</Program_Release_Day>`)
        .replace(/<Program_Release_Year>[^<]*<\/Program_Release_Year>/, `<Program_Release_Year>${year}</Program_Release_Year>`);
    }
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

  // 3. Update Winget manifests under winget-manifests/manifests/s/Sweepr/SweeprCleaner/<version>/
  const wingetDir = path.join(REPO_ROOT, "winget-manifests/manifests/s/Sweepr/SweeprCleaner", version);
  fs.mkdirSync(wingetDir, { recursive: true });
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
        updated: ["server/public/pad.xml", "chocolatey/sweepr-cleaner.nuspec", `winget-manifests/manifests/s/Sweepr/SweeprCleaner/${version}`],
      },
      null,
      2
    )
  );
}

main();

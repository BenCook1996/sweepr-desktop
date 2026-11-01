import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");

console.log("=== SWEEPR Auto-Optimization: Technical SEO, Crawlability & PageSpeed ===");

// 1. Optimize server/public/index.html
const indexPath = path.join(SERVER_ROOT, "public", "index.html");
let indexHtml = fs.readFileSync(indexPath, "utf8");

// Shorten title to 53 chars (<= 60 chars, target 50-60, keyword early)
const oldIndexTitle = "<title>SWEEPR Cleaner: Fast PC, Mac &amp; Phone Cleaner (Windows 11, macOS, iOS, Android)</title>";
const newIndexTitle = "<title>SWEEPR Cleaner: Fast PC, Mac &amp; Phone Storage Cleaner</title>";
if (indexHtml.includes(oldIndexTitle)) {
  indexHtml = indexHtml.replace(oldIndexTitle, newIndexTitle);
  console.log("✓ Updated server/public/index.html title to 53 chars (SERP optimal)");
}

// Shorten meta description to 156 chars (target 150-160 chars)
const oldIndexMeta = '<meta name="description" content="Reclaim gigabytes of lost storage in 60 seconds across Windows 10/11, macOS, iPhone, and Android. Inspect every file path before cleaning, keep your sharpest photos, and protect battery health." />';
const newIndexMeta = '<meta name="description" content="Reclaim gigabytes of lost storage in 60 seconds across PC, Mac, iPhone &amp; Android. Inspect every file path safely with zero junkware or background slowdowns." />';
if (indexHtml.includes(oldIndexMeta)) {
  indexHtml = indexHtml.replace(oldIndexMeta, newIndexMeta);
  console.log("✓ Updated server/public/index.html meta description to 156 chars (SERP optimal)");
}

// Normalize hreflang trailing slashes to match clean canonical paths
indexHtml = indexHtml.replace('href="https://sweeprcleaner.com/de/"', 'href="https://sweeprcleaner.com/de"');
indexHtml = indexHtml.replace('href="https://sweeprcleaner.com/fr/"', 'href="https://sweeprcleaner.com/fr"');
indexHtml = indexHtml.replace('href="https://sweeprcleaner.com/es/"', 'href="https://sweeprcleaner.com/es"');
fs.writeFileSync(indexPath, indexHtml, "utf8");
console.log("✓ Normalized hreflang tags in index.html");

// 2. Optimize server/public/pricing.html
const pricingPath = path.join(SERVER_ROOT, "public", "pricing.html");
let pricingHtml = fs.readFileSync(pricingPath, "utf8");

// Shorten title to 51 chars (<= 60 chars)
const oldPricingTitle = "<title>SWEEPR Cleaner Pro Pricing | Clean, Accelerate &amp; Protect PC, Mac &amp; Phone</title>";
const newPricingTitle = "<title>SWEEPR Cleaner Pro Pricing: PC, Mac &amp; Phone Cleaner</title>";
if (pricingHtml.includes(oldPricingTitle)) {
  pricingHtml = pricingHtml.replace(oldPricingTitle, newPricingTitle);
  console.log("✓ Updated server/public/pricing.html title to 51 chars (SERP optimal)");
}

// Shorten meta description to 151 chars (target 150-160 chars)
const oldPricingMeta = '<meta name="description" content="Compare SWEEPR Cleaner Free vs. Pro plans. Choose Annual Pro (Save 58%) or £9.99/mo Monthly Plan. Clean up to 5 devices and optional £9.99 Battery &amp; Lockbox add-ons." />';
const newPricingMeta = '<meta name="description" content="Compare SWEEPR Cleaner Free vs. Pro plans. Choose Annual Pro (Save 58%) or £9.99/mo. Clean up to 5 devices with our 14-day 100% money-back guarantee." />';
if (pricingHtml.includes(oldPricingMeta)) {
  pricingHtml = pricingHtml.replace(oldPricingMeta, newPricingMeta);
  console.log("✓ Updated server/public/pricing.html meta description to 151 chars (SERP optimal)");
}
fs.writeFileSync(pricingPath, pricingHtml, "utf8");

// 3. Optimize server/src/pseo.ts (In-memory caching for directory + Map index for O(1) slug lookup)
const pseoPath = path.join(SERVER_ROOT, "src", "pseo.ts");
let pseoCode = fs.readFileSync(pseoPath, "utf8");

if (!pseoCode.includes("cleanItemsMap")) {
  const targetDef = `export const cleanItems: CleanItem[] = cleanItemsData as CleanItem[];\r\nlet lastMtimeMs = 0;`;
  const targetDefLf = `export const cleanItems: CleanItem[] = cleanItemsData as CleanItem[];\nlet lastMtimeMs = 0;`;

  const mapSnippet = `export const cleanItems: CleanItem[] = cleanItemsData as CleanItem[];
let lastMtimeMs = 0;
const cleanItemsMap = new Map<string, CleanItem>();
let cachedDirectoryHtml: string | null = null;
let cachedDirectoryMtime = 0;

function rebuildCleanItemsMap() {
  cleanItemsMap.clear();
  for (const item of cleanItems) {
    cleanItemsMap.set(\`\${item.category}:\${item.slug}\`, item);
  }
}
rebuildCleanItemsMap();

export function getCleanItemBySlug(category: string, slug: string): CleanItem | undefined {
  getCleanItems();
  return cleanItemsMap.get(\`\${category}:\${slug}\`);
}`;

  if (pseoCode.includes(targetDef)) {
    pseoCode = pseoCode.replace(targetDef, mapSnippet);
  } else if (pseoCode.includes(targetDefLf)) {
    pseoCode = pseoCode.replace(targetDefLf, mapSnippet);
  }

  // Update getCleanItems to rebuildMap and invalidate cache
  pseoCode = pseoCode.replace(
    "cleanItems.splice(0, cleanItems.length, ...fresh);",
    "cleanItems.splice(0, cleanItems.length, ...fresh);\n        rebuildCleanItemsMap();\n        cachedDirectoryHtml = null;"
  );

  // Update renderPseoDirectory to use cachedDirectoryHtml
  const oldDirStart = `export function renderPseoDirectory(): string {\r\n  const items = getCleanItems();`;
  const oldDirStartLf = `export function renderPseoDirectory(): string {\n  const items = getCleanItems();`;

  const cachedDirStart = `export function renderPseoDirectory(): string {
  getCleanItems();
  try {
    const st = statSync(CLEAN_ITEMS_FILE);
    if (cachedDirectoryHtml && st.mtimeMs === cachedDirectoryMtime) {
      return cachedDirectoryHtml;
    }
    cachedDirectoryMtime = st.mtimeMs;
  } catch {
    if (cachedDirectoryHtml) return cachedDirectoryHtml;
  }
  const items = cleanItems;`;

  if (pseoCode.includes(oldDirStart)) {
    pseoCode = pseoCode.replace(oldDirStart, cachedDirStart);
  } else if (pseoCode.includes(oldDirStartLf)) {
    pseoCode = pseoCode.replace(oldDirStartLf, cachedDirStart);
  }

  const oldDirEnd = `  </main>\r\n  <div id="google_translate_element" style="display:none !important;"></div>\r\n  <script src="/i18n.js" defer></script>\r\n  <script src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit" async defer></script>\r\n</body>\r\n</html>\`;\r\n}`;
  const oldDirEndLf = `  </main>\n  <div id="google_translate_element" style="display:none !important;"></div>\n  <script src="/i18n.js" defer></script>\n  <script src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit" async defer></script>\n</body>\n</html>\`;\n}`;

  const cachedDirEnd = `  </main>
  <div id="google_translate_element" style="display:none !important;"></div>
  <script src="/i18n.js" defer></script>
  <script src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit" async defer></script>
</body>
</html>\`;
  cachedDirectoryHtml = htmlResult;
  return htmlResult;
}`;

  // Let's replace `return \`<!DOCTYPE html>` with `const htmlResult = \`<!DOCTYPE html>` in renderPseoDirectory
  const dirReturn = `return \`<!DOCTYPE html>\r\n<html lang="en">\r\n<head>\r\n  <meta name="color-scheme" content="light">`;
  const dirReturnLf = `return \`<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta name="color-scheme" content="light">`;

  const dirConst = `const htmlResult = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta name="color-scheme" content="light">`;

  if (pseoCode.includes(dirReturn)) {
    pseoCode = pseoCode.replace(dirReturn, dirConst);
  } else if (pseoCode.includes(dirReturnLf)) {
    pseoCode = pseoCode.replace(dirReturnLf, dirConst);
  }

  if (pseoCode.includes(oldDirEnd)) {
    pseoCode = pseoCode.replace(oldDirEnd, cachedDirEnd);
  } else if (pseoCode.includes(oldDirEndLf)) {
    pseoCode = pseoCode.replace(oldDirEndLf, cachedDirEnd);
  }

  fs.writeFileSync(pseoPath, pseoCode, "utf8");
  console.log("✓ Added directory memoization & Map indexing to server/src/pseo.ts");
}

// 4. Update server/src/app.ts to use getCleanItemBySlug and handle localized route trailing slashes
const appPath = path.join(SERVER_ROOT, "src", "app.ts");
let appCode = fs.readFileSync(appPath, "utf8");

if (!appCode.includes("getCleanItemBySlug")) {
  appCode = appCode.replace(
    'import { cleanItems, getCleanItems, renderPseoDirectory, renderPseoPage } from "./pseo.js";',
    'import { cleanItems, getCleanItems, getCleanItemBySlug, renderPseoDirectory, renderPseoPage } from "./pseo.js";'
  );

  // Use getCleanItemBySlug in clean route
  appCode = appCode.replace(
    "const item = getCleanItems().find((i) => i.category === category && i.slug === cleanSlug);",
    "const item = getCleanItemBySlug(category, cleanSlug) ?? getCleanItems().find((i) => i.category === category && i.slug === cleanSlug);"
  );

  // Add trailing slash handlers for localized routes
  const oldLocBlock = `  for (const loc of ["de", "fr", "es"] as const) {
    app.get(\`/\${loc}\`, (c) => renderHtmlFileWithLocale(c, "./public/index.html", loc));
    app.get(\`/\${loc}/pricing\`, (c) => renderHtmlFileWithLocale(c, "./public/pricing.html", loc));
    app.get(\`/\${loc}/order\`, (c) => renderHtmlFileWithLocale(c, "./public/order.html", loc));
  }`;

  const oldLocBlockCrlf = `  for (const loc of ["de", "fr", "es"] as const) {\r\n    app.get(\`/\${loc}\`, (c) => renderHtmlFileWithLocale(c, "./public/index.html", loc));\r\n    app.get(\`/\${loc}/pricing\`, (c) => renderHtmlFileWithLocale(c, "./public/pricing.html", loc));\r\n    app.get(\`/\${loc}/order\`, (c) => renderHtmlFileWithLocale(c, "./public/order.html", loc));\r\n  }`;

  const newLocBlock = `  for (const loc of ["de", "fr", "es"] as const) {
    app.get(\`/\${loc}\`, (c) => renderHtmlFileWithLocale(c, "./public/index.html", loc));
    app.get(\`/\${loc}/\`, (c) => c.redirect(\`/\${loc}\`, 301));
    app.get(\`/\${loc}/pricing\`, (c) => renderHtmlFileWithLocale(c, "./public/pricing.html", loc));
    app.get(\`/\${loc}/pricing/\`, (c) => c.redirect(\`/\${loc}/pricing\`, 301));
    app.get(\`/\${loc}/order\`, (c) => renderHtmlFileWithLocale(c, "./public/order.html", loc));
    app.get(\`/\${loc}/order/\`, (c) => c.redirect(\`/\${loc}/order\`, 301));
  }`;

  if (appCode.includes(oldLocBlock)) {
    appCode = appCode.replace(oldLocBlock, newLocBlock);
  } else if (appCode.includes(oldLocBlockCrlf)) {
    appCode = appCode.replace(oldLocBlockCrlf, newLocBlock);
  }

  fs.writeFileSync(appPath, appCode, "utf8");
  console.log("✓ Updated server/src/app.ts with O(1) pSEO lookup & clean localized redirect handlers");
}

console.log("Optimization pass complete.");

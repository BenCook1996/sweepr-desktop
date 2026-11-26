import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { PRICING_BY_CURRENCY, formatCurrencyAmount } from "../src/pricing.js";
import { ACTIVE_EXPERIMENTS } from "../src/experiments.js";

const { privateKey } = generateKeyPairSync("ed25519");

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER_PUBLIC = resolve(ROOT_DIR, "server/public");

const GOOGLEBOT_SMARTPHONE_UA =
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const GOOGLEBOT_DESKTOP_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const WINDOWS_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ANDROID_PIXEL_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const LINUX_DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const ACTIVE_SWITCHER_ROUTES = [
  "/vs/ccleaner",
  "/vs/cleanmymac",
  "/vs/bleachbit",
  "/vs/avast-cleanup",
  "/vs/cleanmypc",
  "/vs/glary-utilities",
  "/vs/wise-disk-cleaner",
  "/vs/daisydisk",
  "/vs/pearcleaner",
  "/vs/onyx",
  "/alternatives/ccleaner",
  "/alternatives/cleanmymac",
  "/alternatives/bleachbit",
  "/alternatives/avast-cleanup",
  "/alternatives/cleanmypc",
  "/alternatives/glary-utilities",
  "/alternatives/wise-disk-cleaner",
  "/alternatives/daisydisk",
  "/alternatives/pearcleaner",
  "/alternatives/onyx",
] as const;

const ALL_9_TEMPLATE_ROUTES = [
  "/",
  "/clean",
  "/clean/app/steam-depotcache",
  "/safe-to-delete",
  "/tools/pc-cache-calculator",
  "/tools",
  "/state-of-windows-storage",
  "/vs/ccleaner",
  "/alternatives/ccleaner",
] as const;

const FORBIDDEN_ENTITY_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "SWEEPR Cleaner Inc.", re: /SWEEPR\s+Cleaner\s+Inc(?:\.(?=\s|$|[,;.)\]"'<])|(?=\s|$|[,;.)\]"'<]))/i },
  { label: "24/7 Support Desk", re: /24\/7\s+Support\s+Desk/i },
  { label: "24/7 support team", re: /24\/7\s+support\s+team/i },
  { label: "around the clock", re: /around\s+the\s+clock/i },
  { label: "under 2 hours", re: /under\s+2\s+hours/i },
  { label: "Data Protection Officer", re: /Data\s+Protection\s+Officer/i },
  { label: "SWEEPR Technologies", re: /SWEEPR\s+Technologies/i },
  { label: "SWEEPR Cleaner Team", re: /SWEEPR\s+Cleaner\s+Team/i },
];

function setup(overrides: Record<string, unknown> = {}) {
  const capturedSessions: any[] = [];
  const capturedUpdates: any[] = [];
  const mockStripe: any = {
    customers: {
      list: async () => ({ data: [] }),
    },
    coupons: {
      retrieve: async (id: string) => ({ id, valid: true }),
      create: async (params: any) => ({ id: params.id || "coup_test" }),
    },
    products: {
      list: async () => ({ data: [{ id: "prod_test_addon", name: "SWEEPR Add-on", active: true }] }),
      create: async (params: any) => ({ id: "prod_test_created", ...params }),
    },
    subscriptions: {
      retrieve: async (id: string) => ({
        id,
        items: {
          data: [
            {
              id: "si_test_1",
              price: { currency: "gbp", recurring: { interval: "year", interval_count: 1 } },
            },
          ],
        },
      }),
      update: async (id: string, params: any) => {
        capturedUpdates.push({ id, params });
        return { id, status: "active" };
      },
    },
    checkout: {
      sessions: {
        create: async (params: any) => {
          capturedSessions.push(params);
          return {
            id: `cs_test_${capturedSessions.length}`,
            url: `https://checkout.stripe.test/session/${capturedSessions.length}`,
          };
        },
      },
    },
  };

  const repo = openDb(":memory:");
  const app = createApp({
    repo,
    signingKey: privateKey,
    stripe: ("stripe" in overrides ? overrides.stripe : mockStripe) as any,
    config: {
      publicUrl: "https://sweeprcleaner.com",
      stripeWebhookSecret: "",
      priceActivation: "",
      priceMonthly: "",
      trialDays: 7,
      tokenTtlHours: 72,
      maxDevicesPc: 5,
      maxDevicesMobile: 5,
      devEndpoints: false,
      pastDueGraceDays: 3,
      sessionSecret: "test-session-secret",
      ...overrides,
    },
  });

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  const close = () => {
    try {
      repo.db.close();
    } catch {}
  };

  return { repo, app, post, capturedSessions, capturedUpdates, close };
}

function decodeBasicEntities(str: string): string {
  return str
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&rarr;/gi, "→")
    .replace(/&larr;/gi, "←")
    .replace(/&darr;/gi, "↓")
    .replace(/&uarr;/gi, "↑")
    .replace(/&middot;/gi, "·")
    .replace(/&pound;/gi, "£")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripTags(html: string): string {
  return decodeBasicEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function extractMainBody(html: string): string {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, " ");
  const m = withoutComments.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  assert.ok(m, "Expected <main>...</main> element in HTML");
  return m[1]
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ");
}

function extractAnchors(fragment: string): Array<{ href: string; rel: string; text: string; rawTag: string }> {
  const out: Array<{ href: string; rel: string; text: string; rawTag: string }> = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) {
    const attrs = m[1];
    const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const relMatch = attrs.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const href = decodeBasicEntities((hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "").trim());
    const rel = decodeBasicEntities((relMatch?.[1] ?? relMatch?.[2] ?? relMatch?.[3] ?? "").trim());
    out.push({
      href,
      rel,
      text: stripTags(m[2]),
      rawTag: m[0],
    });
  }
  return out;
}

function extractJsonLdObjects(html: string): any[] {
  const objs: any[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    objs.push(JSON.parse(m[1]));
  }
  return objs;
}

function assertNoEntityFluff(content: string, contextLabel: string) {
  for (const { label, re } of FORBIDDEN_ENTITY_PATTERNS) {
    const match = content.match(re);
    assert.equal(
      match,
      null,
      `Forbidden entity fluff "${label}" found in ${contextLabel}: ${match ? match[0] : ""}`
    );
  }
}

function stripNegatedLinuxPhrases(str: string): string {
  return str
    .replace(/\b(?:no|without|not\s+yet|no\s+native)\s+Linux(?:\s+(?:build|app|support|version|installer|client))?(?:\s+yet)?\b/gi, " ")
    .replace(/\bnot\s+(?:available\s+on\s+)?Linux\b/gi, " ");
}

function extractSweeprTableColumnRows(bodyHtml: string): Array<{ label: string; sweeprCell: string }> {
  const results: Array<{ label: string; sweeprCell: string }> = [];
  const tableMatches = bodyHtml.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi);
  for (const tm of tableMatches) {
    const tableHtml = tm[1];
    const rowMatches = [...tableHtml.matchAll(/<tr\b[^>]*>((?:(?!<\/tr>)[\s\S])*?)<\/tr>/gi)];
    if (rowMatches.length === 0) continue;

    // Resolve SWEEPR column indices from <thead> (or first row with <th>)
    const theadHtml = tableHtml.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] ?? rowMatches[0][1];
    const headerRow = theadHtml.match(/<tr\b[^>]*>((?:(?!<\/tr>)[\s\S])*?)<\/tr>/i)?.[1] ?? "";
    const headerCells = [...headerRow.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1]));
    const sweeprColIndices: number[] = [];
    for (let i = 0; i < headerCells.length; i++) {
      if (/\bSWEEPR\b/i.test(headerCells[i])) sweeprColIndices.push(i);
    }
    if (sweeprColIndices.length === 0) continue;

    const tbodyHtml = tableHtml.replace(/<thead\b[\s\S]*?<\/thead>/gi, " ");
    const dataRows = tbodyHtml.matchAll(/<tr\b[^>]*>((?:(?!<\/tr>)[\s\S])*?)<\/tr>/gi);
    for (const rm of dataRows) {
      const cells = [...rm[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1]));
      if (cells.length === 0) continue;
      for (const colIdx of sweeprColIndices) {
        if (colIdx < cells.length) {
          results.push({ label: cells[0], sweeprCell: cells[colIdx] });
        }
      }
    }
  }
  return results;
}

function collectJsonLdOperatingSystems(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdOperatingSystems(item, out);
    return out;
  }
  const obj = node as Record<string, unknown>;
  if ("operatingSystem" in obj && obj.operatingSystem !== undefined) {
    if (Array.isArray(obj.operatingSystem)) {
      for (const val of obj.operatingSystem) out.push(String(val));
    } else {
      out.push(String(obj.operatingSystem));
    }
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object") collectJsonLdOperatingSystems(val, out);
  }
  return out;
}

function assertNoSweeprLinuxClaim(html: string, routeLabel: string) {
  assert.equal(
    /\.AppImage\b/i.test(html),
    false,
    `Unshipped .AppImage claim found on ${routeLabel}`
  );

  // Inspect <head> metadata & JSON-LD operatingSystem fields for Linux claims
  const headHtml = html.replace(/<!--[\s\S]*?-->/g, " ").match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  for (const osVal of collectJsonLdOperatingSystems(extractJsonLdObjects(html))) {
    const cleanedOs = stripNegatedLinuxPhrases(osVal);
    assert.equal(
      /\bLinux\b/i.test(cleanedOs),
      false,
      `JSON-LD operatingSystem claims Linux on ${routeLabel}: "${osVal}"`
    );
  }
  for (const metaM of headHtml.matchAll(/<meta\b[^>]*content\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi)) {
    const metaContent = stripNegatedLinuxPhrases(decodeBasicEntities(metaM[1] ?? metaM[2] ?? ""));
    assert.equal(
      /\bSWEEPR(?:\s+Cleaner)?\b[^.\n]{0,80}\b(?:runs\s+on|supports?|available\s+(?:on|for)|for)\b[^.\n]{0,60}\bLinux\b/i.test(metaContent) ||
        /\bLinux\s+Computers\b/i.test(metaContent) ||
        /(?:Windows(?:\s*10\/11|\s*11|\s*10)?|Win\s*10\/11),\s*(?:macOS|Mac)[^.\n]{0,40}\bLinux\b/i.test(metaContent),
      false,
      `Head <meta> claims SWEEPR Linux support on ${routeLabel}: "${metaContent}"`
    );
  }

  const body = extractMainBody(html);

  // Check table cells strictly on the SWEEPR column index resolved from <thead>
  for (const { label, sweeprCell } of extractSweeprTableColumnRows(body)) {
    const cleanedCell = stripNegatedLinuxPhrases(sweeprCell);
    if (/Linux\s+Support|Platforms(?:\s+Covered)?|Computer\s+Cleaner|OS\s+Support|Operating\s+Systems/i.test(label)) {
      assert.equal(
        /\bLinux\b/i.test(cleanedCell),
        false,
        `SWEEPR table cell claims Linux support on ${routeLabel}: "${label} -> ${sweeprCell}"`
      );
    }
    assert.equal(
      /(?:Windows(?:\s*10\/11|\s*11|\s*10)?|Win\s*10\/11)[,\s/&]+(?:macOS|Mac)[^.\n]{0,50}\bLinux\b/i.test(cleanedCell) ||
        /\bLinux\s+Computers\b/i.test(cleanedCell) ||
        /\bSWEEPR(?:\s+Cleaner)?\b[^.\n]{0,80}\b(?:runs\s+on|supports?|available\s+(?:on|for)|for)\b[^.\n]{0,60}\bLinux\b/i.test(cleanedCell),
      false,
      `SWEEPR table cell claims Linux on ${routeLabel}: "${label} -> ${sweeprCell}"`
    );
  }

  // Strip tables before prose analysis so adjacent <td> cells never concatenate across columns
  const proseText = stripNegatedLinuxPhrases(stripTags(body.replace(/<table\b[\s\S]*?<\/table>/gi, " ")));
  const sentences = proseText.split(/(?<=[.!?])\s+|\n+/);
  const competitorSubjectRe = /\b(?:BleachBit|CCleaner|CleanMyMac|CleanMyPC|Avast|Glary|Wise|PrivaZer|DaisyDisk|Pearcleaner|OnyX)\b/i;

  for (const sentence of sentences) {
    assert.equal(
      /\bSWEEPR(?:\s+Cleaner)?\b[^.\n]{0,80}\b(?:runs\s+on|supports?|available\s+(?:on|for)|for|covering|covers)\b[^.\n]{0,60}\bLinux\b/i.test(sentence),
      false,
      `SWEEPR-subject Linux claim found on ${routeLabel}: "${sentence}"`
    );
    assert.equal(
      /\bSWEEPR(?:\s+Cleaner)?\b[^.\n]{0,80}\b(?:Windows(?:\s*10\/11|\s*11|\s*10)?|Win\s*10\/11)[^.\n]{0,40}(?:macOS|Mac)[^.\n]{0,40}\bLinux\b/i.test(sentence),
      false,
      `SWEEPR multi-OS Linux claim found on ${routeLabel}: "${sentence}"`
    );
    assert.equal(
      /\bLinux\s+Computers\b/i.test(sentence),
      false,
      `Linux Computers claim found on ${routeLabel}: "${sentence}"`
    );
    if (!competitorSubjectRe.test(sentence)) {
      assert.equal(
        /(?:Windows(?:\s*10\/11|\s*11|\s*10)?|Win\s*10\/11),\s*(?:macOS|Mac)[^.\n]{0,40}\bLinux\b/i.test(sentence),
        false,
        `Unattributed multi-OS Linux claim found on ${routeLabel}: "${sentence}"`
      );
    }
  }
}

function assertHonestIosFraming(htmlOrText: string, routeLabel: string) {
  const qualifierRe = /TestFlight|Safari|web\s+companion|no\s+App\s+Store|not\s+yet\s+on\s+the\s+App\s+Store/i;
  const checkSegment = (segmentText: string, scopeLabel: string) => {
    assert.equal(
      /\bApp\s+Store\s+release\s+live\b/i.test(segmentText),
      false,
      `Live App Store claim found in ${scopeLabel} on ${routeLabel}`
    );
    assert.equal(
      /\bDownload\s+(?:SWEEPR\s+)?on\s+the\s+App\s+Store\b/i.test(segmentText),
      false,
      `Live App Store download claim found in ${scopeLabel} on ${routeLabel}`
    );
    for (const m of segmentText.matchAll(/\bApp\s+Store\b/gi)) {
      const idx = m.index ?? 0;
      const windowText = segmentText.slice(Math.max(0, idx - 250), Math.min(segmentText.length, idx + m[0].length + 250));
      assert.match(
        windowText,
        qualifierRe,
        `Unqualified App Store mention in ${scopeLabel} on ${routeLabel} without nearby TestFlight/Safari companion framing: "${windowText}"`
      );
    }
  };

  if (/<main\b/i.test(htmlOrText)) {
    const mainText = stripTags(extractMainBody(htmlOrText));
    checkSegment(mainText, "<main>");
    const footerMatch = htmlOrText.replace(/<!--[\s\S]*?-->/g, " ").match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/i);
    if (footerMatch) {
      checkSegment(stripTags(footerMatch[1]), "<footer>");
    }
  } else {
    checkSegment(stripTags(htmlOrText), "body");
  }
}

// ============================================================================
// Lightweight Dependency-Free HTML-Node DOM + node:vm Execution Harness
// ============================================================================

const VOID_TAGS = new Set([
  "AREA", "BASE", "BR", "COL", "EMBED", "HR", "IMG", "INPUT", "LINK",
  "META", "PARAM", "SOURCE", "TRACK", "WBR", "PATH", "CIRCLE", "RECT",
  "LINE", "POLYGON", "POLYLINE", "ELLIPSE", "STOP", "USE",
]);

class FakeTextNode {
  nodeType = 3;
  parentNode: FakeElement | null = null;
  constructor(public nodeValue: string) {}
  get textContent(): string {
    return this.nodeValue;
  }
  set textContent(v: string) {
    this.nodeValue = String(v ?? "");
  }
}

class FakeClassList {
  constructor(private el: FakeElement) {}
  private getSet(): Set<string> {
    const raw = this.el.attributes.get("class") || "";
    return new Set(raw.split(/\s+/).filter(Boolean));
  }
  private saveSet(set: Set<string>) {
    const str = Array.from(set).join(" ");
    if (str) this.el.attributes.set("class", str);
    else this.el.attributes.delete("class");
  }
  add(...tokens: string[]) {
    const s = this.getSet();
    for (const t of tokens) if (t) s.add(t);
    this.saveSet(s);
  }
  remove(...tokens: string[]) {
    const s = this.getSet();
    for (const t of tokens) s.delete(t);
    this.saveSet(s);
  }
  toggle(token: string, force?: boolean): boolean {
    const s = this.getSet();
    const shouldHave = force !== undefined ? Boolean(force) : !s.has(token);
    if (shouldHave) s.add(token);
    else s.delete(token);
    this.saveSet(s);
    return shouldHave;
  }
  contains(token: string): boolean {
    return this.getSet().has(token);
  }
}

class FakeElement {
  nodeType = 1;
  tagName: string;
  attributes = new Map<string, string>();
  childNodes: Array<FakeElement | FakeTextNode> = [];
  parentNode: FakeElement | null = null;
  style: Record<string, string> = {};
  classList: FakeClassList;
  dataset: Record<string, string>;
  private listeners = new Map<string, Array<(ev: any) => void>>();
  private _value: string | null = null;
  private _checked: boolean | null = null;
  private _disabled = false;
  private _required = false;
  private _vmRunAttr: ((el: FakeElement, code: string, ev: any) => void) | null = null;

  constructor(tagName: string, vmRunAttr: ((el: FakeElement, code: string, ev: any) => void) | null = null) {
    this.tagName = tagName.toUpperCase();
    this._vmRunAttr = vmRunAttr;
    this.classList = new FakeClassList(this);
    const self = this;
    this.dataset = new Proxy(
      {},
      {
        get(_t, prop: string) {
          const kebab = prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
          return self.attributes.get(`data-${kebab}`);
        },
        set(_t, prop: string, val: unknown) {
          const kebab = prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
          self.attributes.set(`data-${kebab}`, String(val ?? ""));
          return true;
        },
      }
    );
  }

  setVmRunner(fn: (el: FakeElement, code: string, ev: any) => void) {
    this._vmRunAttr = fn;
    for (const ch of this.children) ch.setVmRunner(fn);
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement);
  }

  get lastElementChild(): FakeElement | null {
    const ch = this.children;
    return ch.length > 0 ? ch[ch.length - 1] : null;
  }

  get firstElementChild(): FakeElement | null {
    const ch = this.children;
    return ch.length > 0 ? ch[0] : null;
  }

  get id(): string {
    return this.attributes.get("id") ?? "";
  }
  set id(v: string) {
    this.attributes.set("id", String(v ?? ""));
  }

  get className(): string {
    return this.attributes.get("class") ?? "";
  }
  set className(v: string) {
    this.attributes.set("class", String(v ?? ""));
  }

  get type(): string {
    return (this.attributes.get("type") ?? "").toLowerCase();
  }
  set type(v: string) {
    this.attributes.set("type", String(v ?? ""));
  }

  get name(): string {
    return this.attributes.get("name") ?? "";
  }
  set name(v: string) {
    this.attributes.set("name", String(v ?? ""));
  }

  get href(): string {
    return this.attributes.get("href") ?? "";
  }
  set href(v: string) {
    this.attributes.set("href", String(v ?? ""));
  }

  get src(): string {
    return this.attributes.get("src") ?? "";
  }
  set src(v: string) {
    this.attributes.set("src", String(v ?? ""));
  }

  get disabled(): boolean {
    return this._disabled || this.attributes.has("disabled");
  }
  set disabled(v: boolean) {
    this._disabled = Boolean(v);
    if (v) this.attributes.set("disabled", "");
    else this.attributes.delete("disabled");
  }

  get required(): boolean {
    return this._required || this.attributes.has("required");
  }
  set required(v: boolean) {
    this._required = Boolean(v);
    if (v) this.attributes.set("required", "");
    else this.attributes.delete("required");
  }

  get checked(): boolean {
    if (this._checked !== null) return this._checked;
    return this.attributes.has("checked");
  }
  set checked(v: boolean) {
    this._checked = Boolean(v);
  }

  get options(): FakeElement[] {
    if (this.tagName !== "SELECT") return [];
    const opts: FakeElement[] = [];
    const walk = (node: FakeElement) => {
      for (const ch of node.children) {
        if (ch.tagName === "OPTION") opts.push(ch);
        else walk(ch);
      }
    };
    walk(this);
    return opts;
  }

  get value(): string {
    if (this.tagName === "SELECT") {
      const opts = this.options;
      if (this._value !== null) return this._value;
      const selectedOpt = opts.find((o) => o.attributes.has("selected")) ?? opts[0];
      return selectedOpt ? (selectedOpt.attributes.get("value") ?? selectedOpt.textContent) : "";
    }
    if (this.tagName === "OPTION") {
      return this.attributes.get("value") ?? this.textContent;
    }
    if (this._value !== null) return this._value;
    return this.attributes.get("value") ?? "";
  }

  set value(v: string) {
    const str = String(v ?? "");
    if (this.tagName === "SELECT") {
      const opts = this.options;
      const match = opts.find((o) => (o.attributes.get("value") ?? o.textContent) === str);
      if (match) {
        this._value = str;
      }
      return;
    }
    this._value = str;
  }

  getAttribute(name: string): string | null {
    const key = name.toLowerCase();
    if (key === "value" && this._value !== null) return this._value;
    return this.attributes.has(key) ? (this.attributes.get(key) ?? "") : null;
  }

  setAttribute(name: string, val: string) {
    const key = name.toLowerCase();
    this.attributes.set(key, String(val ?? ""));
    if (key === "value") this._value = String(val ?? "");
    if (key === "checked") this._checked = true;
    if (key === "disabled") this._disabled = true;
    if (key === "required") this._required = true;
  }

  removeAttribute(name: string) {
    const key = name.toLowerCase();
    this.attributes.delete(key);
    if (key === "checked") this._checked = false;
    if (key === "disabled") this._disabled = false;
    if (key === "required") this._required = false;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name.toLowerCase());
  }

  get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join("");
  }

  set textContent(v: string) {
    this.childNodes = [];
    if (v !== null && v !== undefined && String(v) !== "") {
      const tn = new FakeTextNode(String(v));
      this.childNodes.push(tn);
    }
  }

  get innerHTML(): string {
    return this.childNodes
      .map((n) => {
        if (n instanceof FakeTextNode) return n.nodeValue;
        const attrs = Array.from(n.attributes.entries())
          .map(([k, val]) => `${k}="${val.replace(/"/g, "&quot;")}"`)
          .join(" ");
        const open = attrs ? `<${n.tagName.toLowerCase()} ${attrs}>` : `<${n.tagName.toLowerCase()}>`;
        if (VOID_TAGS.has(n.tagName)) return open;
        return `${open}${n.innerHTML}</${n.tagName.toLowerCase()}>`;
      })
      .join("");
  }

  set innerHTML(html: string) {
    this.childNodes = [];
    const parsed = parseHtmlFragment(String(html ?? ""), this._vmRunAttr);
    for (const node of parsed) {
      if (node instanceof FakeElement) node.parentNode = this;
      else node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  appendChild<T extends FakeElement | FakeTextNode>(node: T): T {
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
    node.parentNode = this;
    if (node instanceof FakeElement && this._vmRunAttr) {
      node.setVmRunner(this._vmRunAttr);
    }
    this.childNodes.push(node);
    return node;
  }

  removeChild<T extends FakeElement | FakeTextNode>(node: T): T {
    const idx = this.childNodes.indexOf(node);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      node.parentNode = null;
    }
    return node;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  insertAdjacentElement(position: string, el: FakeElement) {
    if (position === "afterend" && this.parentNode) {
      const idx = this.parentNode.childNodes.indexOf(this);
      if (idx !== -1) {
        if (el.parentNode) el.parentNode.removeChild(el);
        el.parentNode = this.parentNode;
        if (this._vmRunAttr) el.setVmRunner(this._vmRunAttr);
        this.parentNode.childNodes.splice(idx + 1, 0, el);
        return el;
      }
    }
    if (position === "beforeend") {
      return this.appendChild(el);
    }
    return el;
  }

  contains(other: any): boolean {
    if (other === this) return true;
    for (const ch of this.childNodes) {
      if (ch === other) return true;
      if (ch instanceof FakeElement && ch.contains(other)) return true;
    }
    return false;
  }

  focus() {}
  blur() {}
  scrollIntoView() {}

  addEventListener(type: string, fn: (ev: any) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: (ev: any) => void) {
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(
      type,
      list.filter((f) => f !== fn)
    );
  }

  dispatchEvent(ev: any): boolean {
    const eventObj =
      typeof ev === "string"
        ? { type: ev, target: this, currentTarget: this, defaultPrevented: false, stopPropagation() {}, preventDefault() { this.defaultPrevented = true; } }
        : {
            ...ev,
            target: ev.target ?? this,
            currentTarget: this,
            defaultPrevented: Boolean(ev.defaultPrevented),
            stopPropagation: ev.stopPropagation ?? (() => {}),
            preventDefault:
              ev.preventDefault ??
              function (this: any) {
                this.defaultPrevented = true;
              },
          };

    const inlineAttr = this.attributes.get(`on${eventObj.type}`);
    if (inlineAttr && this._vmRunAttr) {
      this._vmRunAttr(this, inlineAttr, eventObj);
    }
    const list = [...(this.listeners.get(eventObj.type) ?? [])];
    for (const fn of list) {
      fn.call(this, eventObj);
    }
    return !eventObj.defaultPrevented;
  }

  click() {
    const isCheckbox = this.tagName === "INPUT" && this.type === "checkbox";
    const isRadio = this.tagName === "INPUT" && this.type === "radio";
    if (isCheckbox) {
      this.checked = !this.checked;
    } else if (isRadio) {
      this.checked = true;
    }
    const ev = {
      type: "click",
      target: this,
      currentTarget: this,
      defaultPrevented: false,
      stopPropagation() {},
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    this.dispatchEvent(ev);
    if ((isCheckbox || isRadio) && !ev.defaultPrevented) {
      this.dispatchEvent("change");
    }
  }

  querySelectorAll(selector: string): FakeElement[] {
    const parts = selector
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const results: FakeElement[] = [];
    const seen = new Set<FakeElement>();
    const walk = (node: FakeElement) => {
      for (const ch of node.children) {
        if (parts.some((p) => matchesSelectorChain(ch, p, this))) {
          if (!seen.has(ch)) {
            seen.add(ch);
            results.push(ch);
          }
        }
        walk(ch);
      }
    };
    walk(this);
    return results;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function matchesSimpleSelector(el: FakeElement, sel: string): boolean {
  let rest = sel.trim();
  if (!rest) return false;
  if (rest === "*") return true;

  // Tag prefix
  const tagMatch = rest.match(/^([a-zA-Z][a-zA-Z0-9_-]*)/);
  if (tagMatch) {
    if (el.tagName !== tagMatch[1].toUpperCase()) return false;
    rest = rest.slice(tagMatch[0].length);
  }

  while (rest.length > 0) {
    if (rest.startsWith("#")) {
      const m = rest.match(/^#([a-zA-Z0-9_-]+)/);
      if (!m || el.id !== m[1]) return false;
      rest = rest.slice(m[0].length);
    } else if (rest.startsWith(".")) {
      const m = rest.match(/^\.([a-zA-Z0-9_-]+)/);
      if (!m || !el.classList.contains(m[1])) return false;
      rest = rest.slice(m[0].length);
    } else if (rest.startsWith("[")) {
      const m = rest.match(/^\[([a-zA-Z0-9_:-]+)(?:(\^=|=)["']?([^\]"']*)["']?)?\]/);
      if (!m) return false;
      const attrName = m[1].toLowerCase();
      const op = m[2];
      const expected = m[3] ?? "";
      const actual = el.getAttribute(attrName);
      if (actual === null) return false;
      if (op === "=" && actual !== expected) return false;
      if (op === "^=" && !actual.startsWith(expected)) return false;
      rest = rest.slice(m[0].length);
    } else {
      return false;
    }
  }
  return true;
}

function matchesSelectorChain(el: FakeElement, chain: string, root: FakeElement): boolean {
  const segments = chain.trim().split(/\s+/).filter(Boolean);
  if (segments.length === 0) return false;
  if (!matchesSimpleSelector(el, segments[segments.length - 1])) return false;
  let curr: FakeElement | null = el.parentNode;
  for (let i = segments.length - 2; i >= 0; i--) {
    while (curr && curr !== root && !matchesSimpleSelector(curr, segments[i])) {
      curr = curr.parentNode;
    }
    if (!curr || (curr === root && !matchesSimpleSelector(curr, segments[i]))) {
      return false;
    }
    curr = curr.parentNode;
  }
  return true;
}

function parseAttributes(attrStr: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    const key = m[1].toLowerCase();
    const rawVal = m[2] ?? m[3] ?? m[4] ?? "";
    map.set(key, decodeBasicEntities(rawVal));
  }
  return map;
}

function parseHtmlFragment(
  html: string,
  vmRunAttr: ((el: FakeElement, code: string, ev: any) => void) | null = null
): Array<FakeElement | FakeTextNode> {
  const root = new FakeElement("FRAGMENT", vmRunAttr);
  const stack: FakeElement[] = [root];
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      const tail = html.slice(i);
      if (tail) stack[stack.length - 1].appendChild(new FakeTextNode(decodeBasicEntities(tail)));
      break;
    }
    if (lt > i) {
      const text = html.slice(i, lt);
      stack[stack.length - 1].appendChild(new FakeTextNode(decodeBasicEntities(text)));
    }
    if (html.startsWith("<!--", lt)) {
      const endComment = html.indexOf("-->", lt + 4);
      i = endComment === -1 ? html.length : endComment + 3;
      continue;
    }
    if (html.slice(lt, lt + 9).toUpperCase() === "<!DOCTYPE") {
      const gt = html.indexOf(">", lt);
      i = gt === -1 ? html.length : gt + 1;
      continue;
    }
    if (html.startsWith("</", lt)) {
      const gt = html.indexOf(">", lt + 2);
      if (gt === -1) break;
      const closeTag = html.slice(lt + 2, gt).trim().toUpperCase();
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s].tagName === closeTag) {
          stack.length = s;
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    // Parse opening tag respecting quoted attribute values containing '>'
    let pos = lt + 1;
    let quote: string | null = null;
    while (pos < html.length) {
      const ch = html[pos];
      if (quote) {
        if (ch === quote) quote = null;
      } else {
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === ">") break;
      }
      pos++;
    }
    if (pos >= html.length) break;

    let rawInside = html.slice(lt + 1, pos).trim();
    const selfClosing = rawInside.endsWith("/");
    if (selfClosing) rawInside = rawInside.slice(0, -1).trim();

    const spaceIdx = rawInside.search(/\s/);
    const tagName = (spaceIdx === -1 ? rawInside : rawInside.slice(0, spaceIdx)).toUpperCase();
    const attrStr = spaceIdx === -1 ? "" : rawInside.slice(spaceIdx + 1);

    const el = new FakeElement(tagName, vmRunAttr);
    el.attributes = parseAttributes(attrStr);
    stack[stack.length - 1].appendChild(el);

    if (tagName === "SCRIPT" || tagName === "STYLE") {
      const closeRe = new RegExp(`</${tagName}\\s*>`, "i");
      const rest = html.slice(pos + 1);
      const closeM = closeRe.exec(rest);
      if (closeM) {
        const rawBody = rest.slice(0, closeM.index);
        if (rawBody) el.childNodes.push(new FakeTextNode(rawBody));
        i = pos + 1 + closeM.index + closeM[0].length;
      } else {
        i = html.length;
      }
      continue;
    }

    if (!selfClosing && !VOID_TAGS.has(tagName)) {
      stack.push(el);
    }
    i = pos + 1;
  }

  return root.childNodes;
}

interface MountVmOptions {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  timeZone?: string;
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  headers?: Record<string, string>;
  mockFetch?: (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> } | null>;
}

async function mountHtmlInVm(
  app: ReturnType<typeof createApp>,
  pathWithQuery: string,
  opts: MountVmOptions = {}
) {
  const userAgent = opts.userAgent ?? WINDOWS_CHROME_UA;
  const res = await app.request(pathWithQuery, {
    headers: {
      "user-agent": userAgent,
      ...(opts.headers ?? {}),
    },
  });
  assert.equal(res.status, 200, `Expected 200 for ${pathWithQuery}, got ${res.status}`);
  const html = await res.text();

  const root = new FakeElement("DOCUMENT");
  const parsedNodes = parseHtmlFragment(html);
  for (const n of parsedNodes) {
    if (n instanceof FakeElement) n.parentNode = root;
    root.childNodes.push(n);
  }
  const headEl = root.querySelector("head") ?? root.appendChild(new FakeElement("HEAD"));
  const bodyEl = root.querySelector("body") ?? root.appendChild(new FakeElement("BODY"));

  const inlineScripts: Array<{ code: string; filename: string }> = [];
  const deferScriptSrcs: string[] = [];
  const allScripts = root.querySelectorAll("script");
  let scriptIdx = 0;
  for (const s of allScripts) {
    const typeAttr = (s.getAttribute("type") || "").toLowerCase();
    if (typeAttr === "application/ld+json") continue;
    const src = s.getAttribute("src");
    if (src) {
      if (src.startsWith("/")) deferScriptSrcs.push(src);
      continue;
    }
    scriptIdx += 1;
    inlineScripts.push({ code: s.textContent, filename: `${pathWithQuery}#inline-${scriptIdx}` });
  }

  const deferScripts: Array<{ code: string; filename: string }> = [];
  for (const src of deferScriptSrcs) {
    if (src === "/nav.js") {
      const navRes = await app.request(src);
      if (navRes.status === 200) {
        deferScripts.push({ code: await navRes.text(), filename: src });
      }
    }
  }

  const fetchCalls: Array<{ url: string; method: string; body?: string }> = [];
  const navigations: string[] = [];
  const activeTimers = new Set<ReturnType<typeof setTimeout>>();
  const vmErrors: unknown[] = [];
  let pendingFetches = 0;
  let nextFakeTimerId = 1000;

  const lsMap = new Map<string, string>(Object.entries(opts.localStorage ?? {}));
  const ssMap = new Map<string, string>(Object.entries(opts.sessionStorage ?? {}));
  const cookieMap = new Map<string, string>();

  const makeStorage = (map: Map<string, string>) => ({
    getItem: (k: string) => (map.has(String(k)) ? map.get(String(k))! : null),
    setItem: (k: string, v: string) => {
      map.set(String(k), String(v));
    },
    removeItem: (k: string) => {
      map.delete(String(k));
    },
    clear: () => map.clear(),
  });

  const parsedUrl = new URL(pathWithQuery, "https://sweeprcleaner.com");
  const locationObj: any = {
    origin: parsedUrl.origin,
    protocol: parsedUrl.protocol,
    host: parsedUrl.host,
    hostname: parsedUrl.hostname,
    pathname: parsedUrl.pathname,
    search: parsedUrl.search,
    hash: parsedUrl.hash,
    replace: (u: string) => {
      navigations.push(String(u));
    },
    assign: (u: string) => {
      navigations.push(String(u));
    },
  };
  Object.defineProperty(locationObj, "href", {
    get: () => parsedUrl.href,
    set: (u: string) => {
      navigations.push(String(u));
    },
    enumerable: true,
  });

  const docListeners = new Map<string, Array<(ev: any) => void>>();
  const winListeners = new Map<string, Array<(ev: any) => void>>();

  const documentObj: any = {
    head: headEl,
    body: bodyEl,
    getElementById: (id: string) => {
      if (!id) return null;
      const walk = (node: FakeElement): FakeElement | null => {
        for (const ch of node.children) {
          if (ch.id === id) return ch;
          const found = walk(ch);
          if (found) return found;
        }
        return null;
      };
      return walk(root);
    },
    querySelector: (sel: string) => root.querySelector(sel),
    querySelectorAll: (sel: string) => root.querySelectorAll(sel),
    createElement: (tag: string) => new FakeElement(tag, vmRunAttr),
    createTextNode: (txt: string) => new FakeTextNode(String(txt ?? "")),
    addEventListener: (type: string, fn: (ev: any) => void) => {
      const list = docListeners.get(type) ?? [];
      list.push(fn);
      docListeners.set(type, list);
    },
    removeEventListener: (type: string, fn: (ev: any) => void) => {
      const list = docListeners.get(type);
      if (list) docListeners.set(type, list.filter((f) => f !== fn));
    },
    dispatchEvent: (ev: any) => {
      const eventObj = typeof ev === "string" ? { type: ev, target: documentObj } : ev;
      for (const fn of [...(docListeners.get(eventObj.type) ?? [])]) {
        fn.call(documentObj, eventObj);
      }
    },
  };
  Object.defineProperty(documentObj, "cookie", {
    get: () =>
      Array.from(cookieMap.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    set: (raw: string) => {
      const pair = String(raw).split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq > 0) {
        const k = pair.slice(0, eq).trim();
        const v = pair.slice(eq + 1).trim();
        if (/max-age\s*=\s*0/i.test(String(raw))) {
          cookieMap.delete(k);
        } else {
          cookieMap.set(k, v);
        }
      }
    },
  });

  let vmContext: vm.Context;
  const vmRunAttr = (el: FakeElement, code: string, ev: any) => {
    try {
      const fn = vm.runInContext(`(function(event){ ${code} })`, vmContext);
      const ret = fn.call(el, ev);
      if (ret === false && ev && typeof ev.preventDefault === "function") {
        ev.preventDefault();
      }
    } catch (err) {
      throw err;
    }
  };
  root.setVmRunner(vmRunAttr);

  const sandbox: any = {
    document: documentObj,
    navigator: {
      userAgent,
      platform: opts.platform ?? "",
      maxTouchPoints: opts.maxTouchPoints ?? 0,
    },
    Intl: {
      DateTimeFormat: function () {
        return {
          resolvedOptions: () => ({ timeZone: opts.timeZone ?? "Europe/London" }),
        };
      },
    },
    localStorage: makeStorage(lsMap),
    sessionStorage: makeStorage(ssMap),
    URL,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    Math,
    JSON,
    Date,
    RegExp,
    Array,
    Object,
    Set,
    Map,
    Promise,
    Number,
    String,
    Boolean,
    Error,
    TypeError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
    confirm: () => true,
    open: () => null,
    scrollTo: () => {},
    screenX: 0,
    screenY: 0,
    outerWidth: 1280,
    outerHeight: 800,
    addEventListener: (type: string, fn: (ev: any) => void) => {
      const list = winListeners.get(type) ?? [];
      list.push(fn);
      winListeners.set(type, list);
    },
    removeEventListener: (type: string, fn: (ev: any) => void) => {
      const list = winListeners.get(type);
      if (list) winListeners.set(type, list.filter((f) => f !== fn));
    },
    dispatchEvent: (ev: any) => {
      const eventObj = typeof ev === "string" ? { type: ev, target: sandbox } : ev;
      for (const fn of [...(winListeners.get(eventObj.type) ?? [])]) {
        fn.call(sandbox, eventObj);
      }
    },
    setTimeout: (fn: () => void, ms = 0) => {
      const delay = Number(ms) || 0;
      if (delay <= 80) {
        const handle = setTimeout(() => {
          activeTimers.delete(handle);
          try {
            fn();
          } catch (err) {
            vmErrors.push(err);
          }
        }, delay);
        activeTimers.add(handle);
        return handle;
      }
      // Do not keep event loop alive for long UI timers (e.g. 90s inactivity or 350ms modal)
      return ++nextFakeTimerId;
    },
    clearTimeout: (handle: any) => {
      if (handle && typeof handle === "object") {
        clearTimeout(handle);
        activeTimers.delete(handle);
      }
    },
    setInterval: () => ++nextFakeTimerId,
    clearInterval: () => {},
    fetch: async (rawUrl: string, init: any = {}) => {
      const urlStr = String(rawUrl);
      const method = String(init?.method || "GET").toUpperCase();
      const bodyStr = init?.body ? String(init.body) : undefined;
      fetchCalls.push({ url: urlStr, method, body: bodyStr });

      pendingFetches += 1;
      try {
        if (opts.mockFetch) {
          const custom = await opts.mockFetch(urlStr, { method, headers: init?.headers, body: bodyStr });
          if (custom) return custom;
        }

        if (urlStr.startsWith("/")) {
          const reqHeaders: Record<string, string> = {
            "user-agent": userAgent,
            ...(opts.headers ?? {}),
            ...(init?.headers ?? {}),
          };
          const appRes = await app.request(urlStr, {
            method,
            headers: reqHeaders,
            body: bodyStr,
          });
          const textBody = await appRes.text();
          return {
            ok: appRes.status >= 200 && appRes.status < 300,
            status: appRes.status,
            json: async () => JSON.parse(textBody),
            text: async () => textBody,
          };
        }
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => "",
        };
      } finally {
        pendingFetches -= 1;
      }
    },
  };

  Object.defineProperty(sandbox, "location", {
    get: () => locationObj,
    set: (v: string) => {
      navigations.push(String(v));
    },
    enumerable: true,
  });
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  vmContext = vm.createContext(sandbox);

  for (const s of inlineScripts) {
    vm.runInContext(s.code, vmContext, { filename: s.filename });
  }
  for (const s of deferScripts) {
    vm.runInContext(s.code, vmContext, { filename: s.filename });
  }

  documentObj.dispatchEvent({ type: "DOMContentLoaded", target: documentObj });
  sandbox.dispatchEvent({ type: "DOMContentLoaded", target: sandbox });

  const flushAsync = async (ticks = 12) => {
    for (let i = 0; i < ticks || (pendingFetches > 0 && i < ticks + 50); i++) {
      await new Promise((r) => setTimeout(r, 2));
    }
  };

  await flushAsync();

  const dispose = () => {
    for (const t of activeTimers) clearTimeout(t);
    activeTimers.clear();
    assert.equal(
      vmErrors.length,
      0,
      `Uncaught async timer error(s) in VM on ${pathWithQuery}: ${vmErrors.map((e) => String(e)).join("; ")}`
    );
  };

  const getEl = (selector: string): FakeElement => {
    const el = selector.startsWith("#")
      ? documentObj.getElementById(selector.slice(1))
      : root.querySelector(selector);
    assert.ok(el, `Element not found for selector "${selector}" on ${pathWithQuery}`);
    return el;
  };

  return {
    html,
    root,
    document: documentObj,
    sandbox,
    fetchCalls,
    navigations,
    flushAsync,
    dispose,
    getEl,
    querySelectorAll: (sel: string) => root.querySelectorAll(sel),
    click: (selector: string) => {
      const el = getEl(selector);
      el.click();
    },
    setValue: (selector: string, val: string) => {
      const el = getEl(selector);
      el.value = val;
      el.dispatchEvent("input");
      el.dispatchEvent("change");
    },
    setChecked: (selector: string, val: boolean) => {
      const el = getEl(selector);
      el.checked = val;
      el.dispatchEvent("change");
    },
    submit: (selector: string) => {
      const el = getEl(selector);
      el.dispatchEvent("submit");
    },
  };
}

// ============================================================================
// TIER 1: Feature Coverage (>= 5 isolated checks per P0 area)
// ============================================================================

describe("Tier 1 — p0-1: Platform Availability & Store Links", () => {
  test("T1-P0-1.1: /pricing has zero SWEEPR Linux or .AppImage claims", async () => {
    const { app, close } = setup();
    try {
      const res = await app.request("/pricing");
      assert.equal(res.status, 200);
      const html = await res.text();
      assertNoSweeprLinuxClaim(html, "/pricing");
    } finally {
      close();
    }
  });

  test("T1-P0-1.2: All 20 active /vs/* and /alternatives/* pages have zero SWEEPR Linux/.AppImage claims", async () => {
    const { app, close } = setup();
    try {
      for (const route of ACTIVE_SWITCHER_ROUTES) {
        const res = await app.request(route);
        assert.equal(res.status, 200, `Expected 200 for active route ${route}`);
        const html = await res.text();
        assertNoSweeprLinuxClaim(html, route);
      }
    } finally {
      close();
    }
  });

  test("T1-P0-1.3: iOS is framed honestly as Safari web companion / TestFlight beta across core pages and /download?platform=ios", async () => {
    const { app, close } = setup();
    try {
      for (const route of ["/", "/pricing", "/support", "/terms", "/privacy", "/refund"]) {
        const res = await app.request(route);
        assert.equal(res.status, 200);
        const html = await res.text();
        assertHonestIosFraming(html, route);
      }
      const iosDlRes = await app.request("/download?platform=ios", {
        headers: { "user-agent": IPHONE_SAFARI_UA },
      });
      assert.equal(iosDlRes.status, 200);
      const iosHtml = await iosDlRes.text();
      assertHonestIosFraming(iosHtml, "/download?platform=ios");
      assert.match(stripTags(iosHtml), /TestFlight|Safari|web companion/i);
    } finally {
      close();
    }
  });

  test("T1-P0-1.4: GET /download?platform=ios&stream=1 never streams macOS .dmg", async () => {
    const { app, close } = setup();
    try {
      const res = await app.request("/download?platform=ios&stream=1", {
        headers: { "user-agent": IPHONE_SAFARI_UA },
      });
      const contentType = res.headers.get("content-type") || "";
      const disp = res.headers.get("content-disposition") || "";
      assert.notEqual(contentType, "application/x-apple-diskimage", "iOS stream must not return .dmg MIME type");
      assert.equal(/\.dmg/i.test(disp), false, "iOS stream must not set .dmg attachment filename");
      assert.match(contentType, /text\/html/i, "iOS stream should safely render honest HTML landing/picker");
    } finally {
      close();
    }
  });

  test("T1-P0-1.5: Windows download Winget command matches README.md (Sweepr.SweeprCleaner, never SWEEPR.Cleaner)", async () => {
    const readme = readFileSync(resolve(ROOT_DIR, "README.md"), "utf-8");
    assert.match(readme, /winget install Sweepr\.SweeprCleaner\b/);
    const { app, close } = setup();
    try {
      const res = await app.request("/download?platform=windows", {
        headers: { "user-agent": WINDOWS_CHROME_UA, accept: "text/html" },
      });
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /winget install Sweepr\.SweeprCleaner\b/);
      assert.equal(/SWEEPR\.Cleaner\b/.test(html), false, "Stale Winget ID SWEEPR.Cleaner must be removed");
    } finally {
      close();
    }
  });

  test("T1-P0-1.6: SWEEPRCleaner.mobileconfig states 5-device (not 3-device or SWEEPR Technologies) and HTTP route redirects safely", async () => {
    const mobileconfig = readFileSync(resolve(SERVER_PUBLIC, "SWEEPRCleaner.mobileconfig"), "utf-8");
    assert.match(mobileconfig, /5-device/i);
    assert.equal(/3-device/i.test(mobileconfig), false, "Stale 3-device text must be removed");
    assert.equal(/SWEEPR\s+Technologies/i.test(mobileconfig), false, "SWEEPR Technologies must be removed");

    const { app, close } = setup();
    try {
      const res = await app.request("/SWEEPRCleaner.mobileconfig", { redirect: "manual" });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), "/download?platform=ios");
    } finally {
      close();
    }
  });
});

describe("Tier 1 — p0-2: Pricing, Unlimited Free Temp & Browser Cache Clean, 30 Currencies & Checkout", () => {
  test("T1-P0-2.1: / and /pricing clearly document Unlimited Temp & Browser Cache Clean + unlimited free scan above the fold", async () => {
    const { app, close } = setup();
    try {
      for (const route of ["/", "/pricing"]) {
        const res = await app.request(route);
        assert.equal(res.status, 200);
        const mainBody = extractMainBody(await res.text());
        const mainText = stripTags(mainBody);
        assert.equal(/Basic\s+Temp\s+Only/i.test(mainText), false, `Ambiguous "Basic Temp Only" should be replaced on ${route}`);

        // Verify above-the-fold placement in the hero / first <section> of <main>
        const heroSectionMatch = mainBody.match(/<section\b[^>]*>([\s\S]*?)<\/section>/i);
        assert.ok(heroSectionMatch, `Expected hero/first <section> inside <main> on ${route}`);
        const heroText = stripTags(heroSectionMatch[1]);
        assert.match(heroText, /Unlimited\s+Temp\s+&(?:amp;)?\s*Browser\s+Cache\s+Clean/i, `Expected Unlimited Temp & Browser Cache Clean above the fold in hero <section> on ${route}`);
        assert.match(heroText, /unlimited.*scan|free.*scan/i, `Expected unlimited/free scan above the fold in hero <section> on ${route}`);
      }
    } finally {
      close();
    }
  });

  test("T1-P0-2.2: /pricing does not say Optional under SWEEPR Free for add-ons, and POST /api/portal/purchase-addon returns 402 without Pro", async () => {
    const { app, repo, close } = setup();
    try {
      const pricingHtml = await (await app.request("/pricing")).text();
      const tableRows = [...pricingHtml.matchAll(/<tr\b[^>]*>(?:(?!<\/tr>)[\s\S])*?<\/tr>/gi)];
      const batteryCells = tableRows
        .map((rm) => [...rm[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1])))
        .find((cells) => cells.length >= 3 && /Battery\s+Health\s+Saver/i.test(cells[0]));
      assert.ok(batteryCells, "Expected Battery Health Saver comparison row on /pricing");
      assert.equal(
        /Optional/i.test(batteryCells[1]),
        false,
        `SWEEPR Free column must not claim add-ons are Optional (got "${batteryCells[1]}")`
      );
      assert.match(
        batteryCells[1],
        /Pro\s*Only|Pro\b/i,
        `SWEEPR Free column for Battery Health Saver must indicate Pro Only (got "${batteryCells[1]}")`
      );

      // Verify runtime enforcement: non-Pro account gets 402
      const { createHash } = await import("node:crypto");
      const email = "freeuser@example.com";
      repo.createAccount("acc_free_1", createHash("sha256").update("rt_free_1").digest("hex"), email);
      const code = "123456";
      repo.setOtp(email, createHash("sha256").update(code).digest("hex"), Math.floor(Date.now() / 1000) + 600);
      const otpRes = await app.request("/api/verify-otp", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://sweeprcleaner.com" },
        body: JSON.stringify({ email, code }),
      });
      assert.equal(otpRes.status, 200);
      const setCookie = otpRes.headers.get("set-cookie") || "";
      const sessionCookie = setCookie.split(";")[0];
      assert.ok(sessionCookie.startsWith("sweepr_session="));

      const addonRes = await app.request("/api/portal/purchase-addon", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://sweeprcleaner.com",
          cookie: sessionCookie,
        },
        body: JSON.stringify({ addon: "battery_care" }),
      });
      assert.equal(addonRes.status, 402);
    } finally {
      close();
    }
  });

  test("T1-P0-2.3: GET /v1/conversion/offer avoids $1 First Month, returns actual $1.99/£1.99 intro price and recognized intro_monthly_url", async () => {
    const { app, close } = setup();
    try {
      const res = await app.request("/v1/conversion/offer");
      assert.equal(res.status, 200);
      const data = (await res.json()) as any;
      assert.equal(data.ok, true);
      assert.equal(/\$1\s+First\s+Month/i.test(String(data.cta_label || "")), false, "Must not advertise '$1 First Month'");
      assert.match(String(data.cta_label || ""), /1\.99/, "cta_label must reflect actual 1.99 intro price");
      assert.ok(typeof data.intro_monthly_url === "string" && data.intro_monthly_url.startsWith("/order"));
      const u = new URL(data.intro_monthly_url, "https://sweeprcleaner.com");
      assert.ok(
        u.searchParams.get("offer") === "intro" || u.searchParams.get("intro") === "1",
        `Expected offer=intro or intro=1 in intro_monthly_url, got ${data.intro_monthly_url}`
      );
    } finally {
      close();
    }
  });

  test("T1-P0-2.4: POST /v1/checkout with cloud_vault-only sets cloud_vault: '1' and does NOT set battery_care: '1'", async () => {
    const { post, capturedSessions, close } = setup();
    try {
      const accRes = await post("/v1/accounts", { device_id: "b".repeat(64), device_type: "pc" });
      assert.equal(accRes.status, 200);
      const { refresh_token } = (await accRes.json()) as { refresh_token: string };

      const chkRes = await post(
        "/v1/checkout",
        { plan: "annual", addons: ["cloud_vault"], email: "vaultonly@example.com" },
        { authorization: `Bearer ${refresh_token}` }
      );
      assert.equal(chkRes.status, 200);
      assert.equal(capturedSessions.length, 1);
      const meta = capturedSessions[0].subscription_data?.metadata ?? {};
      assert.equal(meta.cloud_vault, "1");
      assert.equal(meta.battery_care, undefined, "cloud_vault-only checkout must NOT inject battery_care: '1'");
    } finally {
      close();
    }
  });

  test("T1-P0-2.5: / and /pricing expose all 30 server currencies in select & DOM and localize add-on/per-device copy", async () => {
    const { app, close } = setup();
    const expectedCurrencies = Object.keys(PRICING_BY_CURRENCY);
    assert.equal(expectedCurrencies.length, 30);

    try {
      const home = await mountHtmlInVm(app, "/", { userAgent: WINDOWS_CHROME_UA, timeZone: "Europe/London" });
      const pricing = await mountHtmlInVm(app, "/pricing", { userAgent: WINDOWS_CHROME_UA, timeZone: "Europe/London" });
      try {
        const homeOpts = home.getEl("#globalCurrencySelect").options.map((o) => o.value.toLowerCase());
        const pricingOpts = pricing.getEl("#pricingCurrencySelect").options.map((o) => o.value.toLowerCase());
        for (const code of expectedCurrencies) {
          assert.ok(homeOpts.includes(code), `index.html #globalCurrencySelect missing currency "${code}"`);
          assert.ok(pricingOpts.includes(code), `pricing.html #pricingCurrencySelect missing currency "${code}"`);
        }

        // Verify all 30 render via setValue() without falling back to GBP or leaking £/$ on non-GBP/USD currencies
        for (const code of expectedCurrencies) {
          const tier = PRICING_BY_CURRENCY[code];
          const expectedAnnual = formatCurrencyAmount(tier, tier.annualAmount);
          const expectedAddon = formatCurrencyAmount(tier, tier.batteryCareAnnualAmount);

          home.setValue("#globalCurrencySelect", code);
          await home.flushAsync(4);
          assert.equal(home.getEl("#globalCurrencySelect").value, code);
          assert.equal(home.getEl("#giantPriceFigure").textContent.trim(), expectedAnnual, `Home figure mismatch for ${code}`);
          assert.ok(
            home.getEl("#addonBatteryPriceTag").textContent.includes(expectedAddon),
            `Home battery add-on mismatch for ${code}: ${home.getEl("#addonBatteryPriceTag").textContent}`
          );

          pricing.setValue("#pricingCurrencySelect", code);
          await pricing.flushAsync(4);
          assert.equal(pricing.getEl("#pricingCurrencySelect").value, code);
          assert.equal(pricing.getEl("#pGiantFigure").textContent.trim(), expectedAnnual, `Pricing figure mismatch for ${code}`);
          assert.ok(
            pricing.getEl("#pAddonBatteryPrice").textContent.includes(expectedAddon),
            `Pricing battery add-on mismatch for ${code}`
          );

          if (code !== "gbp" && code !== "usd") {
            const perDev = pricing.getEl("#pPerDeviceCallout").textContent;
            assert.equal(/£0\.83|\$1\.08/.test(perDev), false, `Hardcoded £0.83 / $1.08 leak in #pPerDeviceCallout for ${code}: ${perDev}`);
            assert.ok(perDev.includes(tier.symbol), `Expected localized symbol "${tier.symbol}" in #pPerDeviceCallout for ${code}: ${perDev}`);
          }
        }
      } finally {
        home.dispose();
        pricing.dispose();
      }
    } finally {
      close();
    }
  });
});

describe("Tier 1 — p0-3: Order Consent, Mobile Bonus Bar & Experiment Hygiene", () => {
  test("T1-P0-3.1: /order #termsConsent and #legalConsent are unchecked in SSR HTML and after initCheckout()", async () => {
    const { app, close } = setup();
    try {
      const vmPage = await mountHtmlInVm(app, "/order", { userAgent: WINDOWS_CHROME_UA });
      try {
        const terms = vmPage.getEl("#termsConsent");
        const legal = vmPage.getEl("#legalConsent");
        assert.equal(terms.hasAttribute("checked"), false, "#termsConsent must not have SSR checked attribute");
        assert.equal(legal.hasAttribute("checked"), false, "#legalConsent must not have SSR checked attribute");
        assert.equal(terms.checked, false, "#termsConsent.checked must be false on load");
        assert.equal(legal.checked, false, "#legalConsent.checked must be false on load");
      } finally {
        vmPage.dispose();
      }
    } finally {
      close();
    }
  });

  test("T1-P0-3.2: Express wallets and #orderForm block checkout and do NOT force consent checkboxes true when unchecked", async () => {
    const { app, close } = setup();
    try {
      const vmPage = await mountHtmlInVm(app, "/order", {
        userAgent: WINDOWS_CHROME_UA,
        mockFetch: async (url) => {
          if (url.includes("/api/create-subscription")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ redirectUrl: "/checkout/success?web=1" }),
              text: async () => JSON.stringify({ redirectUrl: "/checkout/success?web=1" }),
            };
          }
          return null;
        },
      });
      try {
        vmPage.setValue("#email", "buyer@example.com");
        for (const trigger of [
          () => vmPage.click("#expressGPayBtn"),
          () => vmPage.click("#expressApplePayBtn"),
          () => vmPage.click("#paypalBtn"),
          () => vmPage.click("#expressRevolutBtn"),
          () => vmPage.submit("#orderForm"),
        ]) {
          trigger();
          await vmPage.flushAsync(4);
          assert.equal(vmPage.getEl("#termsConsent").checked, false, "Handler must not force #termsConsent.checked = true");
          assert.equal(vmPage.getEl("#legalConsent").checked, false, "Handler must not force #legalConsent.checked = true");
          const errBox = vmPage.getEl("#checkoutError");
          assert.equal(errBox.classList.contains("hidden"), false, "#checkoutError must be visible when consent is unchecked");
          assert.ok(errBox.textContent.trim().length > 0, "#checkoutError must explain consent requirement");
          const subCalls = vmPage.fetchCalls.filter((c) => c.url.includes("/api/create-subscription"));
          assert.equal(subCalls.length, 0, "Zero /api/create-subscription calls allowed without consent");
        }
      } finally {
        vmPage.dispose();
      }
    } finally {
      close();
    }
  });

  test("T1-P0-3.3: /order mobile accordion hint does not say '2 free bonuses'", async () => {
    const { app, close } = setup();
    try {
      const vmPage = await mountHtmlInVm(app, "/order", { userAgent: WINDOWS_CHROME_UA });
      try {
        const hint = vmPage.getEl("#mobileAccordionHint");
        assert.equal(/2\s+free\s+bonuses/i.test(hint.textContent), false, "Initial #mobileAccordionHint must not claim '2 free bonuses'");
        // Toggle open and closed to check JS collapse text as well
        vmPage.click("#mobileSummaryToggleBtn");
        await vmPage.flushAsync(2);
        vmPage.click("#mobileSummaryToggleBtn");
        await vmPage.flushAsync(2);
        assert.equal(/2\s+free\s+bonuses/i.test(hint.textContent), false, "Collapsed #mobileAccordionHint must not claim '2 free bonuses'");
      } finally {
        vmPage.dispose();
      }
    } finally {
      close();
    }
  });

  test("T1-P0-3.4: /order does not fire order_intro_rescue_v1 exposure requests on load", async () => {
    const { app, close } = setup();
    try {
      const vmPage = await mountHtmlInVm(app, "/order", { userAgent: WINDOWS_CHROME_UA });
      try {
        const expCalls = vmPage.fetchCalls.filter((c) => c.url.includes("order_intro_rescue_v1"));
        assert.equal(expCalls.length, 0, "/order must not call /api/experiments/assign?experiment=order_intro_rescue_v1");
      } finally {
        vmPage.dispose();
      }
    } finally {
      close();
    }
  });

  test("T1-P0-3.5: GET /api/experiments/assign?experiment=order_intro_rescue_v1 does not pollute analytics_events exposures", async () => {
    const { app, repo, close } = setup();
    try {
      const res = await app.request("/api/experiments/assign?experiment=order_intro_rescue_v1&visitor_id=v_unknown");
      assert.equal(res.status, 200);
      const data = (await res.json()) as any;
      assert.equal(data.ok, true);
      assert.deepEqual(data.assignments, {});

      const rows = repo.db
        .prepare("SELECT event_name, metadata FROM analytics_events WHERE event_name = 'experiment_exposure'")
        .all() as Array<{ event_name: string; metadata: string }>;
      assert.equal(rows.length, 0, "Unknown experiment ID must record 0 experiment_exposure rows");
    } finally {
      close();
    }
  });
});

describe("Tier 1 — p0-4: Feature Accuracy, Lockbox, Battery HW Limits & Telemetry Truth", () => {
  test("T1-P0-4.1: 7-Day Undo qualified (2–10 GB budget, 5 GB default, Recycle Bin fallback / exclusions) on / and /pricing", async () => {
    const { app, close } = setup();
    try {
      for (const route of ["/", "/pricing"]) {
        const text = stripTags(extractMainBody(await (await app.request(route)).text()));
        assert.match(text, /2\s*[–-]\s*10\s*GB/i, `Expected 2–10 GB Undo budget qualification on ${route}`);
        assert.match(text, /5\s*GB\s+default/i, `Expected 5 GB default Undo qualification on ${route}`);
        assert.match(text, /Recycle\s*Bin|Trash/i, `Expected OS Recycle Bin / Trash fallback qualification on ${route}`);
        assert.match(
          text,
          /exclud[^.\n]{0,80}(?:shredded|browser\s+DB|registry)|(?:shredded\s+files|browser\s+(?:DBs|databases)|registry\s+changes)[^.\n]{0,120}(?:exclud|cannot\s+be\s+restored)/i,
          `Expected explicit Undo exclusions (shredded files / browser DBs / registry) on ${route}`
        );
      }
    } finally {
      close();
    }
  });

  test("T1-P0-4.2: Private File Lockbox & Cloud Backup described honestly as local Argon2id + AES-256-GCM + local-to-local sync folder", async () => {
    const { app, close } = setup();
    try {
      for (const route of ["/", "/pricing", "/order"]) {
        const text = stripTags(extractMainBody(await (await app.request(route)).text()));
        assert.match(text, /Argon2id|AES-256-GCM/i, `Expected local encryption details on ${route}`);
        assert.match(text, /local.*sync|OneDrive|Google Drive|Dropbox|iCloud|mirror/i, `Expected local-to-local sync-folder wording on ${route}`);
      }
    } finally {
      close();
    }
  });

  test("T1-P0-4.3: Battery 80% hardware charge cap qualified by ASUS WMI / Dell CCTK / Linux sysfs vs software alert", async () => {
    const { app, close } = setup();
    try {
      for (const route of ["/", "/pricing", "/order"]) {
        const text = stripTags(extractMainBody(await (await app.request(route)).text()));
        assert.match(
          text,
          /80%[^.\n]{0,60}charge\s+(?:cap|limit)[^.\n]{0,120}ASUS\s+WMI[\s\S]{0,60}Dell\s+CCTK[\s\S]{0,60}Linux\s+sysfs/i,
          `Expected 80% charge cap qualified with ASUS WMI, Dell CCTK & Linux sysfs on ${route}`
        );
        assert.match(
          text,
          /(?:ASUS\s+WMI|Dell\s+CCTK|Linux\s+sysfs)[^.\n]{0,140}(?:software\s+(?:unplug\s+)?alert|unplug\s+alert)/i,
          `Expected software unplug alert fallback near Battery 80% HW cap copy on ${route}`
        );
      }
    } finally {
      close();
    }
  });

  test("T1-P0-4.4: Honest telemetry disclosures across /, /pricing, /privacy, and switchers (disclosing /v1/telemetry/event & crash)", async () => {
    const { app, close } = setup();
    try {
      const privacyText = stripTags(extractMainBody(await (await app.request("/privacy")).text()));
      assert.match(privacyText, /\/v1\/telemetry\/event/);
      assert.match(privacyText, /\/v1\/telemetry\/crash/);

      for (const route of ["/", "/pricing", "/order", "/privacy"]) {
        const text = stripTags(extractMainBody(await (await app.request(route)).text()));
        assert.equal(
          /\bzero\s+(?:personal\s+filename\s+)?telemetry\b/i.test(text),
          false,
          `Misleading unqualified 'zero telemetry' claim on ${route}`
        );
      }

      const competitorOnlyRe = /\b(?:BleachBit|PrivaZer|OnyX|Pearcleaner)\b/i;
      for (const route of ACTIVE_SWITCHER_ROUTES) {
        const mainBody = extractMainBody(await (await app.request(route)).text());
        for (const { label, sweeprCell } of extractSweeprTableColumnRows(mainBody)) {
          assert.equal(
            /\bzero\s+(?:personal\s+filename\s+)?telemetry\b/i.test(sweeprCell),
            false,
            `SWEEPR table cell claims 'zero telemetry' on ${route} (${label}: "${sweeprCell}")`
          );
        }
        const prose = stripTags(mainBody.replace(/<table\b[\s\S]*?<\/table>/gi, " "));
        for (const sentence of prose.split(/(?<=[.!?])\s+|\n+/)) {
          if (/\bzero\s+(?:personal\s+filename\s+)?telemetry\b/i.test(sentence)) {
            assert.ok(
              competitorOnlyRe.test(sentence) && !/\bSWEEPR\b/i.test(sentence),
              `Misleading 'zero telemetry' claim for SWEEPR on ${route}: "${sentence}"`
            );
          }
        }
      }
    } finally {
      close();
    }
  });

  test("T1-P0-4.5: Honest background execution wording (optional tray / scheduled cleaning, no blanket 'zero background daemons')", async () => {
    const { app, close } = setup();
    try {
      const padXml = await (await app.request("/pad.xml")).text();
      assert.equal(
        /never\s+slowing\s+down\s+your\s+PC\s+in\s+the\s+background/i.test(padXml),
        false,
        "pad.xml must not claim 'never slowing down your PC in the background'"
      );

      for (const route of ["/", "/pricing", "/order"]) {
        const text = stripTags(extractMainBody(await (await app.request(route)).text()));
        assert.equal(
          /\bzero\s+(?:background\s+)?daemons\b/i.test(text),
          false,
          `Blanket 'zero daemons' claim on ${route}`
        );
      }

      const competitorOnlyRe = /\b(?:BleachBit|PrivaZer|OnyX|Pearcleaner)\b/i;
      for (const route of ["/vs/cleanmypc", "/vs/bleachbit", "/alternatives/bleachbit"]) {
        const mainBody = extractMainBody(await (await app.request(route)).text());
        for (const { label, sweeprCell } of extractSweeprTableColumnRows(mainBody)) {
          assert.equal(
            /\bzero\s+(?:background\s+)?daemons\b/i.test(sweeprCell),
            false,
            `SWEEPR table cell claims 'zero daemons' on ${route} (${label}: "${sweeprCell}")`
          );
        }
        const prose = stripTags(mainBody.replace(/<table\b[\s\S]*?<\/table>/gi, " "));
        for (const sentence of prose.split(/(?<=[.!?])\s+|\n+/)) {
          if (/\bzero\s+(?:background\s+)?daemons\b/i.test(sentence)) {
            assert.ok(
              competitorOnlyRe.test(sentence) && !/\bSWEEPR\b/i.test(sentence),
              `Blanket 'zero daemons' claim for SWEEPR on ${route}: "${sentence}"`
            );
          }
        }
      }
      const homeText = stripTags(extractMainBody(await (await app.request("/")).text()));
      assert.match(homeText, /optional.*(?:tray|schedul)|(?:tray|schedul).*optional/i);
    } finally {
      close();
    }
  });
});

describe("Tier 1 — p0-5: Mock GB Breakdowns & Ungrounded Time Claims", () => {
  test("T1-P0-5.1: 5.1 GB vs 3.1 GB App Leftovers self-contradiction resolved on /", async () => {
    const { app, close } = setup();
    try {
      const mainBody = extractMainBody(await (await app.request("/")).text());
      const has51 = /\b5\.1\s*GB\b/i.test(mainBody);
      const has31 = /\b3\.1\s*GB\b/i.test(mainBody);
      assert.equal(has51 && has31, false, "index.html must not contain contradictory 5.1 GB and 3.1 GB App Leftovers figures");
    } finally {
      close();
    }
  });

  test("T1-P0-5.2: Illustrative breakdowns on / are labeled Example footprint / Illustrative / Typical estimate near GB metrics", async () => {
    const { app, close } = setup();
    try {
      const mainText = stripTags(extractMainBody(await (await app.request("/")).text()));
      const labelRe = /Example\s+(?:footprint|breakdown|preview|scan)|Illustrative|Typical\s+estimate/i;
      assert.match(mainText, labelRe, "Expected explicit illustrative label on /");

      for (const gbRe of [/\b14\.8\s*GB\b/i, /\b6\.4\s*GB\b/i, /\b4\.2\s*GB\b/i]) {
        const matches = [...mainText.matchAll(new RegExp(gbRe.source, "gi"))].filter((m) => {
          const idx = m.index ?? 0;
          const ctx = mainText.slice(Math.max(0, idx - 120), Math.min(mainText.length, idx + m[0].length + 60));
          return !/Live\s+Tauri\s+Desktop\s+Overview[\s\S]{0,120}14\.3\s*GB/i.test(ctx);
        });
        assert.ok(matches.length > 0, `Expected illustrative metric ${gbRe} on /`);
        for (const m of matches) {
          const idx = m.index ?? 0;
          const windowText = mainText.slice(Math.max(0, idx - 220), Math.min(mainText.length, idx + m[0].length + 220));
          assert.match(
            windowText,
            /Example\s+(?:footprint|breakdown|preview|scan)|Example:|Illustrative|Typical\s+estimate/i,
            `Illustrative GB metric "${m[0]}" on / lacks nearby Example/Illustrative label: "${windowText}"`
          );
        }
      }
    } finally {
      close();
    }
  });

  test("T1-P0-5.3: /order exit-intent modal replaces synthetic 14.2 GB CSS laptop mockup with real desktop UI capture in #discountModal", async () => {
    const { app, close } = setup();
    try {
      const vmOrder = await mountHtmlInVm(app, "/order", { userAgent: WINDOWS_CHROME_UA });
      try {
        const modal = vmOrder.getEl("#discountModal");
        const modalText = modal.textContent.replace(/\s+/g, " ").trim();
        assert.equal(/14\.2\s*GB/i.test(modalText), false, "#discountModal must not contain legacy synthetic 14.2 GB mockup");
        assert.match(modalText, /6\.76\s*MB\s+Native\s+Rust/i, "Expected 6.76 MB Native Rust caption inside #discountModal");
        assert.ok(
          modal.querySelector('img[src="/img/desktop-smart-scan.webp"]'),
          "Expected real /img/desktop-smart-scan.webp UI capture inside #discountModal"
        );
      } finally {
        vmOrder.dispose();
      }
    } finally {
      close();
    }
  });

  test("T1-P0-5.4: /safe-to-delete presets and /tools/pc-cache-calculator (69.8 GB) are labeled Example footprint / Typical estimate", async () => {
    const { app, close } = setup();
    try {
      const checkerText = stripTags(extractMainBody(await (await app.request("/safe-to-delete")).text()));
      assert.match(
        checkerText,
        /Example\s+(?:footprint|estimate)|\(Example\)|Illustrative\s+(?:example|footprint)|Typical\s+estimate/i,
        "Expected explicit illustrative/example label on /safe-to-delete presets"
      );

      const calcText = stripTags(extractMainBody(await (await app.request("/tools/pc-cache-calculator")).text()));
      assert.match(calcText, /69\.8\s*GB/i, "Expected 69.8 GB default estimate on /tools/pc-cache-calculator");
      const m69 = calcText.match(/69\.8\s*GB/i)!;
      const idx = m69.index ?? 0;
      const windowCalc = calcText.slice(Math.max(0, idx - 180), Math.min(calcText.length, idx + m69[0].length + 180));
      assert.match(
        windowCalc,
        /Example\s+(?:footprint|estimate)|Typical\s+estimate|Illustrative/i,
        `69.8 GB calculator figure lacks nearby Example footprint / Typical estimate label: "${windowCalc}"`
      );
    } finally {
      close();
    }
  });

  test("T1-P0-5.5: Ungrounded arbitrary time claims (45s / 10s / 60s / under a second) removed across pages and pad.xml", async () => {
    const { app, close } = setup();
    try {
      const checks: Array<{ route: string; pattern: RegExp }> = [
        { route: "/", pattern: /45\s*seconds|Installs\s+in\s+10\s+seconds/i },
        { route: "/order", pattern: /<10s\s+Scan|&lt;10s\s+Scan/i },
        { route: "/pricing", pattern: /60-Second\s+Storage\s+Scan/i },
        { route: "/pad.xml", pattern: /60-second|under\s+60\s+seconds/i },
        { route: "/state-of-windows-storage", pattern: /in\s+60\s+seconds|under\s+60\s+seconds/i },
        { route: "/vs/avast-cleanup", pattern: /under\s+a\s+second|60\s*seconds/i },
      ];
      for (const { route, pattern } of checks) {
        const body = await (await app.request(route)).text();
        assert.equal(pattern.test(body), false, `Ungrounded time claim ${pattern} still present on ${route}`);
      }
    } finally {
      close();
    }
  });
});

describe("Tier 1 — p0-6: Crawler/Bot Guard & Geo-Currency Sync", () => {
  test("T1-P0-6.1: Googlebot Smartphone on / + /nav.js keeps Windows SSR CTA and never rewrites to android&direct=1", async () => {
    const { app, close } = setup();
    try {
      const vmPage = await mountHtmlInVm(app, "/", {
        userAgent: GOOGLEBOT_SMARTPHONE_UA,
        timeZone: "America/New_York",
      });
      try {
        assert.equal(vmPage.getEl("#primaryDownloadCta").getAttribute("href"), "/download?platform=windows");
        assert.equal(vmPage.getEl("#headerDownloadBtn").getAttribute("href"), "/download");
        assert.match(vmPage.getEl("#primaryDownloadLabel").textContent, /Windows/i);
        const androidLinks = vmPage
          .querySelectorAll('a[href^="/download"]')
          .filter((a) => (a.getAttribute("href") || "").includes("platform=android"));
        assert.equal(androidLinks.length, 0, "Googlebot Smartphone must never receive Android download rewrite");
      } finally {
        vmPage.dispose();
      }
    } finally {
      close();
    }
  });

  test("T1-P0-6.2: Googlebot Smartphone on /pricing + /nav.js keeps clean /download link", async () => {
    const { app, close } = setup();
    try {
      const vmPage = await mountHtmlInVm(app, "/pricing", {
        userAgent: GOOGLEBOT_SMARTPHONE_UA,
        timeZone: "America/New_York",
      });
      try {
        const dlLinks = vmPage.querySelectorAll('a[href^="/download"]');
        assert.ok(dlLinks.length > 0);
        for (const a of dlLinks) {
          assert.equal(
            (a.getAttribute("href") || "").includes("android"),
            false,
            `Googlebot Smartphone on /pricing must not rewrite download href (${a.getAttribute("href")})`
          );
        }
      } finally {
        vmPage.dispose();
      }
    } finally {
      close();
    }
  });

  test("T1-P0-6.3: US-timezone Googlebot Smartphone DOM currency on / matches SSR GBP JSON-LD (£49.99)", async () => {
    const { app, close } = setup();
    try {
      const vmPage = await mountHtmlInVm(app, "/", {
        userAgent: GOOGLEBOT_SMARTPHONE_UA,
        timeZone: "America/New_York",
      });
      try {
        const jsonLds = extractJsonLdObjects(vmPage.html);
        const appSchema = jsonLds.find((o) => o["@type"] === "SoftwareApplication");
        assert.ok(appSchema, "Expected SoftwareApplication JSON-LD");
        const firstOffer = Array.isArray(appSchema.offers) ? appSchema.offers[0] : appSchema.offers;
        assert.equal(firstOffer.priceCurrency, "GBP");
        assert.equal(String(firstOffer.price), "49.99");
        assert.equal(
          vmPage.getEl("#giantPriceFigure").textContent.trim(),
          "£49.99",
          "Crawler DOM currency must remain GBP matching JSON-LD even in America/New_York timezone"
        );
      } finally {
        vmPage.dispose();
      }
    } finally {
      close();
    }
  });

  test("T1-P0-6.4: US-timezone Googlebot Smartphone DOM currency on /pricing matches SSR GBP JSON-LD (£49.99)", async () => {
    const { app, close } = setup();
    try {
      const vmPage = await mountHtmlInVm(app, "/pricing", {
        userAgent: GOOGLEBOT_SMARTPHONE_UA,
        timeZone: "America/New_York",
      });
      try {
        const jsonLds = extractJsonLdObjects(vmPage.html);
        const prodSchema = jsonLds.find((o) => o["@type"] === "Product");
        assert.ok(prodSchema, "Expected Product JSON-LD");
        const firstOffer = Array.isArray(prodSchema.offers) ? prodSchema.offers[0] : prodSchema.offers;
        assert.equal(firstOffer.priceCurrency, "GBP");
        assert.equal(vmPage.getEl("#pGiantFigure").textContent.trim(), "£49.99");
      } finally {
        vmPage.dispose();
      }
    } finally {
      close();
    }
  });

  test("T1-P0-6.5: Real Linux UA on / does not get routed to dead-end /download?platform=linux", async () => {
    const { app, close } = setup();
    try {
      const vmPage = await mountHtmlInVm(app, "/", {
        userAgent: LINUX_DESKTOP_UA,
        platform: "Linux x86_64",
      });
      try {
        const href = vmPage.getEl("#primaryDownloadCta").getAttribute("href") || "";
        assert.equal(href.includes("platform=linux"), false, `Linux dead-end CTA must be removed (got ${href})`);
      } finally {
        vmPage.dispose();
      }
    } finally {
      close();
    }
  });
});

describe("Tier 1 — p0-7 & Entity Constraints: Next-Search Anticipation & Sole-Trader Truth", () => {
  test("T1-P0-7.1: All 9 active SEO templates include <main> links to /pricing, /refund, /safe-to-delete, and /vs/ccleaner", async () => {
    const { app, close } = setup();
    try {
      for (const route of ALL_9_TEMPLATE_ROUTES) {
        const res = await app.request(route);
        assert.equal(res.status, 200);
        const html = await res.text();
        const mainBody = extractMainBody(html);
        const hrefs = extractAnchors(mainBody).map((a) => a.href.split("?")[0].split("#")[0]);
        for (const target of ["/pricing", "/refund", "/safe-to-delete", "/vs/ccleaner"]) {
          if (target === route) continue;
          assert.ok(
            hrefs.includes(target),
            `Template route "${route}" <main> missing contextual link to "${target}"`
          );
        }
      }
    } finally {
      close();
    }
  });

  test("T1-P0-7.2: / includes <main> link to /state-of-windows-storage plus contextual links inside storage tiles, comparison tiles, and FAQ", async () => {
    const { app, close } = setup();
    try {
      const html = await (await app.request("/")).text();
      const mainBody = extractMainBody(html);
      const mainHrefs = extractAnchors(mainBody).map((a) => a.href.split("?")[0]);
      assert.ok(mainHrefs.includes("/state-of-windows-storage"), "/ <main> must link /state-of-windows-storage");

      const storageTileSection = mainBody.match(/aria-labelledby="unified-architecture-heading"[\s\S]*?<\/section>/i)?.[0] ?? "";
      assert.ok(extractAnchors(storageTileSection).length >= 1, "Storage tiles section must contain contextual links");

      const compTileSection = mainBody.match(/aria-labelledby="why-sweepr-comparison-heading"[\s\S]*?<\/section>/i)?.[0] ?? "";
      assert.ok(extractAnchors(compTileSection).length >= 1, "Comparison tiles section must contain contextual links");

      const faqSection = mainBody.match(/id="faq-heading"[\s\S]*?<\/section>/i)?.[0] ?? "";
      assert.ok(extractAnchors(faqSection).length >= 1, "FAQ section must contain contextual links");
    } finally {
      close();
    }
  });

  test("T1-P0-7.3: Clean href='/download' links drop rel='nofollow' on marketing/legal/header pages while robots.txt preserves /download? rule", async () => {
    const { app, close } = setup();
    try {
      const robots = await (await app.request("/robots.txt")).text();
      assert.match(robots, /Allow:\s*\/download\$/);
      assert.match(robots, /Disallow:\s*\/download\?/);

      for (const route of ["/", "/pricing", "/clean", "/tools", "/safe-to-delete", "/state-of-windows-storage", "/vs/ccleaner", "/alternatives/ccleaner", "/refund", "/support", "/privacy"]) {
        const html = await (await app.request(route)).text();
        const anchors = extractAnchors(html);
        const cleanDownloads = anchors.filter((a) => a.href === "/download");
        for (const a of cleanDownloads) {
          assert.equal(
            /\bnofollow\b/i.test(a.rel),
            false,
            `Clean href="/download" on ${route} must not carry rel="nofollow" (found rel="${a.rel}")`
          );
        }
      }
    } finally {
      close();
    }
  });

  test("T1-P0-7.4: /refund, /support, /privacy have <main> return/next-step links and /privacy links /delete-account", async () => {
    const { app, close } = setup();
    try {
      for (const route of ["/refund", "/support", "/privacy"]) {
        const html = await (await app.request(route)).text();
        const mainHrefs = extractAnchors(extractMainBody(html)).map((a) => a.href.split("?")[0]);
        assert.ok(
          mainHrefs.some((h) => h === "/pricing" || h === "/safe-to-delete" || h === "/clean" || h === "/vs/ccleaner"),
          `${route} <main> should include return/next-step links to product/pricing/tools`
        );
      }
      const privacyMain = extractMainBody(await (await app.request("/privacy")).text());
      const privacyHrefs = extractAnchors(privacyMain).map((a) => a.href.split("?")[0]);
      assert.ok(privacyHrefs.includes("/delete-account"), "/privacy <main> must link to /delete-account");
      const delRes = await app.request("/delete-account");
      assert.equal(delRes.status, 200);
    } finally {
      close();
    }
  });

  test("T1-P0-7.5: Zero forbidden entity fluff across all active routes, switchers, legal pages, pad.xml, llms.txt & .mobileconfig", async () => {
    const { app, close } = setup();
    try {
      const routes = [
        ...ALL_9_TEMPLATE_ROUTES,
        ...ACTIVE_SWITCHER_ROUTES,
        "/pricing",
        "/order",
        "/refund",
        "/support",
        "/privacy",
        "/terms",
        "/pad.xml",
        "/llms.txt",
      ];
      for (const route of routes) {
        const res = await app.request(route);
        assert.equal(res.status, 200, `Expected 200 for ${route}`);
        assertNoEntityFluff(await res.text(), route);
      }
      const mobileconfig = readFileSync(resolve(SERVER_PUBLIC, "SWEEPRCleaner.mobileconfig"), "utf-8");
      assertNoEntityFluff(mobileconfig, "SWEEPRCleaner.mobileconfig");
    } finally {
      close();
    }
  });
});

// ============================================================================
// TIER 2: Boundary & Corner Cases
// ============================================================================

describe("Tier 2 — Boundary & Corner Cases Across All P0 Areas", () => {
  test("T2-BVA-1: jpy/krw zero-decimal and suffix currencies (sek, czk, bgn) format accurately in API + DOM", async () => {
    const { app, close } = setup();
    try {
      const zeroDecCodes = ["jpy", "krw"] as const;
      const suffixCodes = ["sek", "czk", "bgn"] as const;

      for (const code of [...zeroDecCodes, ...suffixCodes]) {
        const apiRes = await app.request(`/api/pricing?currency=${code}`);
        assert.equal(apiRes.status, 200);
        const apiJson = (await apiRes.json()) as any;
        const p = apiJson.pricing;
        const tier = PRICING_BY_CURRENCY[code];
        assert.equal(p.currency, code);
        assert.equal(p.annualFormatted, formatCurrencyAmount(tier, tier.annualAmount));
        if (tier.zeroDecimal) {
          assert.equal(/\.\d{2}/.test(p.annualFormatted), false, `Zero-decimal ${code} must not contain decimals`);
        } else {
          assert.ok(p.annualFormatted.endsWith(tier.symbol), `Suffix currency ${code} must end with "${tier.symbol}"`);
        }
      }

      const vmPricing = await mountHtmlInVm(app, "/pricing?currency=krw", { userAgent: WINDOWS_CHROME_UA });
      try {
        assert.equal(vmPricing.getEl("#pGiantFigure").textContent.trim(), "₩89,900");
        assert.equal(/\.\d/.test(vmPricing.getEl("#pGiantFigure").textContent), false);
        vmPricing.setValue("#pricingCurrencySelect", "czk");
        await vmPricing.flushAsync(4);
        assert.equal(vmPricing.getEl("#pGiantFigure").textContent.trim(), "1,499.99 Kč");
      } finally {
        vmPricing.dispose();
      }
    } finally {
      close();
    }
  });

  test("T2-BVA-2: /order intro query params (?intro=1, ?offer=intro, ?plan=intro, ?variant=B) all activate intro discount", async () => {
    const { app, close } = setup();
    try {
      for (const qs of [
        "/order?plan=monthly&intro=1",
        "/order?plan=monthly&offer=intro",
        "/order?plan=intro",
        "/order?plan=monthly&variant=B",
      ]) {
        const vmPage = await mountHtmlInVm(app, qs, { userAgent: WINDOWS_CHROME_UA });
        try {
          assert.equal(vmPage.getEl("#radioPlanMonthly").checked, true, `${qs} should select monthly`);
          assert.equal(vmPage.getEl("#totalTodayText").textContent.trim(), "£1.99", `${qs} should display £1.99 total today`);
          assert.equal(vmPage.getEl("#discountSummaryRow").classList.contains("hidden"), false, `${qs} should show discount row`);
          assert.equal(vmPage.getEl("#monthlyIntroPill").classList.contains("hidden"), false, `${qs} should show intro pill`);
        } finally {
          vmPage.dispose();
        }
      }
    } finally {
      close();
    }
  });

  test("T2-BVA-3: POST /v1/checkout add-on matrix (cloud_vault only vs battery_care only vs both vs none)", async () => {
    const { post, capturedSessions, close } = setup();
    try {
      const accRes = await post("/v1/accounts", { device_id: "c".repeat(64), device_type: "pc" });
      const { refresh_token } = (await accRes.json()) as { refresh_token: string };

      const cases: Array<{ addons: string[]; wantBat: string | undefined; wantCloud: string | undefined }> = [
        { addons: ["cloud_vault"], wantBat: undefined, wantCloud: "1" },
        { addons: ["battery_care"], wantBat: "1", wantCloud: undefined },
        { addons: ["battery_care", "cloud_vault"], wantBat: "1", wantCloud: "1" },
        { addons: [], wantBat: undefined, wantCloud: undefined },
      ];

      for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        const res = await post(
          "/v1/checkout",
          { plan: "annual", addons: c.addons, email: `matrix${i}@example.com` },
          { authorization: `Bearer ${refresh_token}` }
        );
        assert.equal(res.status, 200);
        const meta = capturedSessions[i].subscription_data?.metadata ?? {};
        assert.equal(meta.battery_care, c.wantBat, `Case ${i} battery_care mismatch`);
        assert.equal(meta.cloud_vault, c.wantCloud, `Case ${i} cloud_vault mismatch`);
      }
    } finally {
      close();
    }
  });

  test("T2-BVA-4: /api/experiments/assign filtering across unknown, single known, unfiltered, POST & record_exposure=0", async () => {
    const { app, repo, close } = setup();
    try {
      // 1. record_exposure=0 writes 0 rows
      const dryRes = await app.request("/api/experiments/assign?visitor_id=v_dry&record_exposure=0");
      assert.equal(dryRes.status, 200);
      assert.equal(
        (repo.db.prepare("SELECT COUNT(*) as c FROM analytics_events WHERE event_name='experiment_exposure'").get() as any).c,
        0
      );

      // 2. Single known experiment only records that experiment
      const singleRes = await app.request("/api/experiments/assign?experiment=checker_cta_copy_v1&visitor_id=v_single");
      assert.equal(singleRes.status, 200);
      const singleJson = (await singleRes.json()) as any;
      assert.deepEqual(Object.keys(singleJson.assignments), ["checker_cta_copy_v1"]);
      const rows = repo.db
        .prepare("SELECT metadata FROM analytics_events WHERE event_name='experiment_exposure'")
        .all() as Array<{ metadata: string }>;
      assert.equal(rows.length, 1);
      assert.equal(JSON.parse(rows[0].metadata).experiment, "checker_cta_copy_v1");

      // 3. POST with unknown experiment writes 0 additional rows
      const postUnknown = await app.request("/api/experiments/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ experiment: "order_intro_rescue_v1", visitor_id: "v_post_unknown" }),
      });
      assert.equal(postUnknown.status, 200);
      assert.deepEqual(((await postUnknown.json()) as any).assignments, {});
      assert.equal(
        (repo.db.prepare("SELECT COUNT(*) as c FROM analytics_events WHERE event_name='experiment_exposure'").get() as any).c,
        1
      );

      // 4. Unfiltered returns all ACTIVE_EXPERIMENTS
      const allRes = await app.request("/api/experiments/assign?visitor_id=v_all");
      const allJson = (await allRes.json()) as any;
      assert.deepEqual(Object.keys(allJson.assignments).sort(), Object.keys(ACTIVE_EXPERIMENTS).sort());
    } finally {
      close();
    }
  });

  test("T2-BVA-5: Bot vs Real UA boundary matrix on / + /nav.js", async () => {
    const { app, close } = setup();
    try {
      const cases = [
        { ua: GOOGLEBOT_DESKTOP_UA, expectHref: "/download?platform=windows" },
        { ua: "Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)", expectHref: "/download?platform=windows" },
        { ua: "OAI-SearchBot/1.0 (+https://openai.com/searchbot)", expectHref: "/download?platform=windows" },
        { ua: WINDOWS_CHROME_UA, expectHref: "/download?platform=windows" },
        { ua: ANDROID_PIXEL_UA, expectHref: "/download?platform=android&direct=1" },
        { ua: IPHONE_SAFARI_UA, expectHref: "/download?platform=ios" },
      ];
      for (const c of cases) {
        const vmPage = await mountHtmlInVm(app, "/", { userAgent: c.ua, timeZone: "Europe/London" });
        try {
          const href = vmPage.getEl("#primaryDownloadCta").getAttribute("href") || "";
          assert.ok(
            href.startsWith(c.expectHref),
            `UA "${c.ua.slice(0, 40)}" expected CTA starting with "${c.expectHref}", got "${href}"`
          );
        } finally {
          vmPage.dispose();
        }
      }
    } finally {
      close();
    }
  });

  test("T2-BVA-6: /download?platform=linux&stream=1 never streams .AppImage", async () => {
    const { app, close } = setup();
    try {
      const res = await app.request("/download?platform=linux&stream=1", {
        headers: { "user-agent": LINUX_DESKTOP_UA },
      });
      assert.notEqual(res.headers.get("content-type"), "application/x-executable");
      assert.equal(/\.AppImage/i.test(res.headers.get("content-disposition") || ""), false);
    } finally {
      close();
    }
  });

  test("T2-BVA-7: p0-1 boundaries — iOS /ios-app vs /download?platform=ios&stream=1, .mobileconfig 5-device vs 302, & negated Linux on /vs/bleachbit", async () => {
    const { app, close } = setup();
    try {
      const iosAppRes = await app.request("/ios-app", { headers: { "user-agent": IPHONE_SAFARI_UA } });
      assert.equal(iosAppRes.status, 200);
      assertHonestIosFraming(await iosAppRes.text(), "/ios-app");

      const iosStream = await app.request("/download?platform=ios&stream=1", {
        headers: { "user-agent": IPHONE_SAFARI_UA },
      });
      assert.notEqual(iosStream.headers.get("content-type"), "application/x-apple-diskimage");
      assert.equal(/\.dmg/i.test(iosStream.headers.get("content-disposition") || ""), false);

      const mcRes = await app.request("/SWEEPRCleaner.mobileconfig", { redirect: "manual" });
      assert.equal(mcRes.status, 302);
      assert.equal(mcRes.headers.get("location"), "/download?platform=ios");
      const mcDisk = readFileSync(resolve(SERVER_PUBLIC, "SWEEPRCleaner.mobileconfig"), "utf-8");
      assert.match(mcDisk, /5-device/i);
      assert.equal(/3-device/i.test(mcDisk), false);

      const bleachHtml = await (await app.request("/vs/bleachbit")).text();
      assertNoSweeprLinuxClaim(bleachHtml, "/vs/bleachbit");
    } finally {
      close();
    }
  });

  test("T2-BVA-8: p0-2 boundaries — Free account 402 on cloud_vault & battery_care, localized /v1/conversion/offer, & /v1/checkout monthly intro", async () => {
    const { app, repo, post, capturedSessions, close } = setup();
    try {
      const { createHash } = await import("node:crypto");
      const email = "bva_free@example.com";
      repo.createAccount("acc_bva_free", createHash("sha256").update("rt_bva_free").digest("hex"), email);
      repo.setOtp(email, createHash("sha256").update("654321").digest("hex"), Math.floor(Date.now() / 1000) + 600);
      const otpRes = await app.request("/api/verify-otp", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://sweeprcleaner.com" },
        body: JSON.stringify({ email, code: "654321" }),
      });
      const sessionCookie = (otpRes.headers.get("set-cookie") || "").split(";")[0];

      for (const addon of ["cloud_vault", "battery_care"]) {
        const res = await app.request("/api/portal/purchase-addon", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://sweeprcleaner.com", cookie: sessionCookie },
          body: JSON.stringify({ addon }),
        });
        assert.equal(res.status, 402, `Free account purchasing ${addon} must return 402`);
      }

      for (const [country, expectSym] of [["US", "$"], ["GB", "£"]] as const) {
        const offerRes = await app.request(`/v1/conversion/offer?country=${country}`);
        assert.equal(offerRes.status, 200);
        const data = (await offerRes.json()) as any;
        assert.equal(/\$1\s+First\s+Month/i.test(String(data.cta_label)), false);
        assert.ok(String(data.cta_label).includes(`${expectSym}1.99`), `Expected ${expectSym}1.99 for ${country}, got ${data.cta_label}`);
      }

      const acc = (await (await post("/v1/accounts", { device_id: "f".repeat(64), device_type: "pc" })).json()) as any;
      const chkIntro = await post(
        "/v1/checkout",
        { plan: "monthly", intro: true, currency: "usd", email: "bva_intro@example.com" },
        { authorization: `Bearer ${acc.refresh_token}` }
      );
      assert.equal(chkIntro.status, 200);
      assert.equal(capturedSessions[0].line_items[0].price_data.currency, "usd");
      assert.equal(capturedSessions[0].subscription_data.metadata.battery_care, undefined);
      assert.equal(capturedSessions[0].subscription_data.metadata.cloud_vault, undefined);
    } finally {
      close();
    }
  });

  test("T2-BVA-9: p0-4 boundaries — 2–10 GB budget Undo boundaries on /terms & /pad.xml, plus /v1/telemetry/event & crash validation", async () => {
    const { app, post, close } = setup();
    try {
      const termsMain = stripTags(extractMainBody(await (await app.request("/terms")).text()));
      assert.match(termsMain, /2\s*[–-]\s*10\s*GB/i);
      assert.match(termsMain, /5\s*GB\s+default/i);
      assert.match(termsMain, /Recycle\s*Bin|Trash/i);

      const padXml = await (await app.request("/pad.xml")).text();
      const padHasLegacyLimits =
        /500\s*MB/i.test(padXml) && /50\s*MB/i.test(padXml) && /300/.test(padXml);
      const padHasBudgetLimits =
        /Unlimited\s+Temp\s+&(?:amp;)?\s*Browser\s+Cache\s+Clean/i.test(padXml) &&
        /2[–-]10\s*GB/i.test(padXml) &&
        /5\s*GB\s+default/i.test(padXml) &&
        /excludes\s+shredded\s+files/i.test(padXml);
      assert.equal(padHasLegacyLimits, false, "pad.xml must not contain legacy 500 MB / 50 MB / 300 item limits");
      assert.ok(
        padHasBudgetLimits,
        "pad.xml must truthfully qualify Free tier and 7-Day Undo Quarantine limits & exclusions"
      );
      assert.match(padXml, /Recycle\s*Bin/i);

      // Telemetry boundary validation matching /privacy disclosures
      const badEv = await post("/v1/telemetry/event", { event_name: "not_a_valid_event_name" });
      assert.equal(badEv.status, 400);
      const okEv = await post("/v1/telemetry/event", { event_name: "paywall_viewed", platform: "windows" });
      assert.equal(okEv.status, 200);

      const badCrash = await post("/v1/telemetry/crash", {});
      assert.equal(badCrash.status, 400);
      const okCrash = await post("/v1/telemetry/crash", { platform: "windows", error_type: "panic", message: "test" });
      assert.equal(okCrash.status, 200);
    } finally {
      close();
    }
  });

  test("T2-BVA-10: p0-5 boundaries — 69.8 GB calculator preset sum & interactive toggle + /safe-to-delete preset labeling", async () => {
    const { app, close } = setup();
    try {
      const vmCalc = await mountHtmlInVm(app, "/tools/pc-cache-calculator", { userAgent: WINDOWS_CHROME_UA });
      try {
        const cbs = vmCalc.querySelectorAll(".bloat-calc-cb");
        const checkedGbSum = cbs
          .filter((cb) => cb.checked)
          .reduce((acc, cb) => acc + Number(cb.getAttribute("data-gb") || 0), 0);
        assert.equal(checkedGbSum.toFixed(1), "69.8", "Default checked calculator workloads must sum to 69.8 GB");
        assert.equal(vmCalc.getEl("#bloatCalcTotalGb").textContent.trim(), "~69.8 GB");

        // Uncheck one workload (Steam 12.5 GB) -> 57.3 GB, or uncheck all -> 0.0 GB
        cbs[0].checked = false;
        cbs[0].dispatchEvent("change");
        await vmCalc.flushAsync(2);
        assert.equal(vmCalc.getEl("#bloatCalcTotalGb").textContent.trim(), "~57.3 GB");

        for (const cb of cbs) {
          cb.checked = false;
        }
        cbs[0].dispatchEvent("change");
        await vmCalc.flushAsync(2);
        assert.equal(vmCalc.getEl("#bloatCalcTotalGb").textContent.trim(), "~0.0 GB");
      } finally {
        vmCalc.dispose();
      }

      const vmChecker = await mountHtmlInVm(app, "/safe-to-delete", { userAgent: WINDOWS_CHROME_UA });
      try {
        vmChecker.sandbox.loadPreset("gaming");
        await vmChecker.flushAsync(6);
        assert.match(vmChecker.getEl("#kpiGbLabel").textContent, /EXAMPLE\s+FOOTPRINT/i);
        assert.match(vmChecker.getEl("#kpiGbSub").textContent, /Illustrative/i);
      } finally {
        vmChecker.dispose();
      }
    } finally {
      close();
    }
  });

  test("T2-BVA-11: p0-7 boundaries — rel='nofollow' kept on /order? & /download? while dropped on clean /download, & sitemap.xml parity", async () => {
    const { app, close } = setup();
    try {
      for (const route of ["/", "/pricing", "/vs/ccleaner"]) {
        const html = await (await app.request(route)).text();
        const anchors = extractAnchors(html);
        const cleanDl = anchors.filter((a) => a.href === "/download");
        assert.ok(cleanDl.length > 0, `Expected clean /download link on ${route}`);
        for (const a of cleanDl) {
          assert.equal(/\bnofollow\b/i.test(a.rel), false, `Clean /download on ${route} must drop rel=nofollow`);
        }
        const orderLinks = anchors.filter((a) => a.href.startsWith("/order?"));
        for (const a of orderLinks) {
          assert.match(a.rel, /\bnofollow\b/i, `Parameterized order link ${a.href} on ${route} should retain rel=nofollow`);
        }
      }

      const sitemapRes = await app.request("/sitemap.xml");
      assert.equal(sitemapRes.status, 200);
      const sitemapXml = await sitemapRes.text();
      const locs = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      assert.equal(locs.length, 101, `Expected 101 URLs in /sitemap.xml, got ${locs.length}`);
      assert.ok(locs.includes("https://sweeprcleaner.com/"));
      assert.ok(locs.includes("https://sweeprcleaner.com/pricing"));
      assert.ok(locs.includes("https://sweeprcleaner.com/state-of-windows-storage"));
      assert.equal(locs.some((u) => u.includes("/order") || u.includes("/download?")), false);
    } finally {
      close();
    }
  });
});

// ============================================================================
// TIER 3: Cross-Feature Combinations
// ============================================================================

describe("Tier 3 — Cross-Feature Pairwise Combinations", () => {
  test("T3-X1: GET /v1/conversion/offer -> mount returned intro_monthly_url in /order VM -> zero experiment pollution", async () => {
    const { app, repo, close } = setup();
    try {
      const offerRes = await app.request("/v1/conversion/offer?email=intro@example.com");
      assert.equal(offerRes.status, 200);
      const offer = (await offerRes.json()) as any;
      assert.equal(/\$1\s+First\s+Month/i.test(offer.cta_label), false);
      assert.match(offer.cta_label, /1\.99/);

      const vmOrder = await mountHtmlInVm(app, offer.intro_monthly_url, { userAgent: WINDOWS_CHROME_UA });
      try {
        assert.equal(vmOrder.getEl("#email").value, "intro@example.com");
        assert.equal(vmOrder.getEl("#radioPlanMonthly").checked, true);
        assert.equal(vmOrder.getEl("#totalTodayText").textContent.trim(), "£1.99");
        assert.equal(vmOrder.getEl("#discountSummaryRow").classList.contains("hidden"), false);
      } finally {
        vmOrder.dispose();
      }

      const expCount = (repo.db.prepare("SELECT COUNT(*) as c FROM analytics_events WHERE event_name='experiment_exposure'").get() as any).c;
      assert.equal(expCount, 0, "Offer -> Order journey must not pollute experiment_exposure rows");
    } finally {
      close();
    }
  });

  test("T3-X2: /pricing 30-currency selection (JPY) -> #pCheckoutBtn href -> /order VM -> POST /v1/checkout", async () => {
    const { app, post, capturedSessions, close } = setup();
    try {
      const vmPricing = await mountHtmlInVm(app, "/pricing", { userAgent: WINDOWS_CHROME_UA, timeZone: "Europe/London" });
      let checkoutHref = "";
      try {
        vmPricing.setValue("#pricingCurrencySelect", "jpy");
        vmPricing.setChecked("#pAddonCloud", true);
        await vmPricing.flushAsync(4);
        assert.equal(vmPricing.getEl("#pGiantFigure").textContent.trim(), "¥11,560");
        checkoutHref = vmPricing.getEl("#pCheckoutBtn").getAttribute("href") || "";
        assert.match(checkoutHref, /currency=jpy/);
        assert.match(checkoutHref, /addons=cloud_vault/);
      } finally {
        vmPricing.dispose();
      }

      const vmOrder = await mountHtmlInVm(app, checkoutHref, { userAgent: WINDOWS_CHROME_UA });
      try {
        assert.equal(vmOrder.getEl("#cloudVaultCheckbox").checked, true);
        assert.equal(vmOrder.getEl("#batteryCareCheckbox").checked, false);
        assert.equal(vmOrder.getEl("#totalTodayText").textContent.trim(), "¥11,560");
        assert.equal(/£|\$/.test(vmOrder.getEl("#totalTodayText").textContent), false);
      } finally {
        vmOrder.dispose();
      }

      const accRes = await post("/v1/accounts", { device_id: "d".repeat(64), device_type: "pc" });
      const { refresh_token } = (await accRes.json()) as { refresh_token: string };
      const chkRes = await post(
        "/v1/checkout",
        { plan: "annual", currency: "jpy", addons: ["cloud_vault"], email: "jpbuyer@example.com" },
        { authorization: `Bearer ${refresh_token}` }
      );
      assert.equal(chkRes.status, 200);
      assert.equal(capturedSessions[0].subscription_data.metadata.cloud_vault, "1");
      assert.equal(capturedSessions[0].subscription_data.metadata.battery_care, undefined);
      assert.equal(capturedSessions[0].line_items[0].price_data.currency, "jpy");
    } finally {
      close();
    }
  });

  test("T3-X3: /clean/app/steam-depotcache -> /pricing -> /refund -> /download funnel & rel='nofollow' discipline", async () => {
    const { app, close } = setup();
    try {
      const guideMain = extractMainBody(await (await app.request("/clean/app/steam-depotcache")).text());
      const guideHrefs = extractAnchors(guideMain).map((a) => a.href.split("?")[0]);
      assert.ok(guideHrefs.includes("/pricing"));
      assert.ok(guideHrefs.includes("/refund"));
      assert.ok(guideHrefs.includes("/safe-to-delete"));
      assert.ok(guideHrefs.includes("/vs/ccleaner"));

      const pricingHtml = await (await app.request("/pricing")).text();
      const cleanDl = extractAnchors(pricingHtml).filter((a) => a.href === "/download");
      assert.ok(cleanDl.length > 0);
      for (const a of cleanDl) assert.equal(/\bnofollow\b/i.test(a.rel), false);

      const refundMain = extractMainBody(await (await app.request("/refund")).text());
      assertNoEntityFluff(refundMain, "/refund");

      const dlHtml = await (await app.request("/download?platform=windows", { headers: { "user-agent": WINDOWS_CHROME_UA } })).text();
      assert.match(dlHtml, /winget install Sweepr\.SweeprCleaner\b/);
    } finally {
      close();
    }
  });
});

// ============================================================================
// TIER 4: Real-World End-User & Crawler Journeys
// ============================================================================

describe("Tier 4 — Real-World End-User & Crawler Journeys", () => {
  test("T4-J1: Full Googlebot Smartphone crawl journey across /, /pricing, /clean/app/steam-depotcache, /vs/ccleaner, /state-of-windows-storage", async () => {
    const { app, close } = setup();
    try {
      const vmHome = await mountHtmlInVm(app, "/", { userAgent: GOOGLEBOT_SMARTPHONE_UA, timeZone: "America/New_York" });
      const vmPricing = await mountHtmlInVm(app, "/pricing", { userAgent: GOOGLEBOT_SMARTPHONE_UA, timeZone: "America/New_York" });
      try {
        assert.equal(vmHome.getEl("#primaryDownloadCta").getAttribute("href"), "/download?platform=windows");
        assert.equal(vmHome.getEl("#giantPriceFigure").textContent.trim(), "£49.99");
        assert.equal(vmPricing.getEl("#pGiantFigure").textContent.trim(), "£49.99");
      } finally {
        vmHome.dispose();
        vmPricing.dispose();
      }

      for (const route of ["/", "/pricing", "/clean/app/steam-depotcache", "/vs/ccleaner", "/state-of-windows-storage"]) {
        const res = await app.request(route, { headers: { "user-agent": GOOGLEBOT_SMARTPHONE_UA } });
        assert.equal(res.status, 200);
        const html = await res.text();
        assertNoEntityFluff(html, route);
        assertNoSweeprLinuxClaim(html, route);
      }
    } finally {
      close();
    }
  });

  test("T4-J2: Full Windows buyer journey (/, /safe-to-delete, /pricing, /order consent gate + submit, /refund, /privacy -> /delete-account)", async () => {
    const { app, close } = setup();
    try {
      const vmHome = await mountHtmlInVm(app, "/", { userAgent: WINDOWS_CHROME_UA, timeZone: "Europe/London" });
      try {
        const homeMain = stripTags(extractMainBody(vmHome.html));
        assert.match(homeMain, /Unlimited\s+Temp\s+&(?:amp;)?\s*Browser\s+Cache\s+Clean/i);
        assert.match(homeMain, /2\s*[–-]\s*10\s*GB/i);
        assert.equal(/\b5\.1\s*GB\b/i.test(homeMain) && /\b3\.1\s*GB\b/i.test(homeMain), false);
      } finally {
        vmHome.dispose();
      }

      const checkerRes = await app.request("/safe-to-delete");
      assert.equal(checkerRes.status, 200);
      assert.match(stripTags(extractMainBody(await checkerRes.text())), /Example|Sample|Typical/i);

      const vmPricing = await mountHtmlInVm(app, "/pricing", { userAgent: WINDOWS_CHROME_UA, timeZone: "Europe/London" });
      let orderUrl = "";
      try {
        orderUrl = vmPricing.getEl("#pCheckoutBtn").getAttribute("href") || "/order?plan=annual";
      } finally {
        vmPricing.dispose();
      }

      const vmOrder = await mountHtmlInVm(app, orderUrl, {
        userAgent: WINDOWS_CHROME_UA,
        mockFetch: async (url) => {
          if (url.includes("/api/create-subscription")) {
            const resBody = JSON.stringify({ redirectUrl: "/checkout/success?web=1" });
            return {
              ok: true,
              status: 200,
              json: async () => JSON.parse(resBody),
              text: async () => resBody,
            };
          }
          return null;
        },
      });
      try {
        // Unchecked consent blocks express & form checkout
        vmOrder.click("#expressGPayBtn");
        await vmOrder.flushAsync(4);
        assert.equal(vmOrder.getEl("#checkoutError").classList.contains("hidden"), false);
        assert.equal(vmOrder.fetchCalls.filter((c) => c.url.includes("/api/create-subscription")).length, 0);

        // Explicit consent + form fields succeeds
        vmOrder.setChecked("#termsConsent", true);
        vmOrder.setChecked("#legalConsent", true);
        vmOrder.setValue("#email", "winbuyer@example.com");
        vmOrder.setValue("#cardName", "Alice Buyer");
        vmOrder.setValue("#fallbackCardNumber", "4000123456789010");
        vmOrder.setValue("#fallbackCardExpiry", "12/28");
        vmOrder.setValue("#fallbackCardCvc", "123");
        vmOrder.submit("#orderForm");
        await vmOrder.flushAsync(6);

        const subCalls = vmOrder.fetchCalls.filter((c) => c.url.includes("/api/create-subscription"));
        assert.equal(subCalls.length, 1, "Explicitly consented checkout must submit /api/create-subscription");
        const sent = JSON.parse(subCalls[0].body || "{}");
        assert.equal(sent.email, "winbuyer@example.com");
        assert.equal(sent.plan, "annual");
      } finally {
        vmOrder.dispose();
      }

      const privacyHtml = await (await app.request("/privacy")).text();
      assert.ok(extractAnchors(extractMainBody(privacyHtml)).some((a) => a.href === "/delete-account"));
      assert.equal((await app.request("/delete-account")).status, 200);
    } finally {
      close();
    }
  });

  test("T4-J3: International JPY/KRW multi-currency upgrade journey", async () => {
    const { app, post, capturedSessions, close } = setup();
    try {
      const offer = (await (await app.request("/v1/conversion/offer?email=intl@example.com")).json()) as any;
      assert.match(offer.cta_label, /1\.99/);

      const vmPricing = await mountHtmlInVm(app, "/pricing?currency=jpy", { userAgent: WINDOWS_CHROME_UA });
      try {
        assert.equal(vmPricing.getEl("#pGiantFigure").textContent.trim(), "¥9,980");
        vmPricing.setValue("#pricingCurrencySelect", "krw");
        await vmPricing.flushAsync(4);
        assert.equal(vmPricing.getEl("#pGiantFigure").textContent.trim(), "₩89,900");
      } finally {
        vmPricing.dispose();
      }

      const vmOrder = await mountHtmlInVm(app, "/order?plan=monthly&intro=1&currency=krw", { userAgent: WINDOWS_CHROME_UA });
      try {
        assert.equal(vmOrder.getEl("#totalTodayText").textContent.trim(), "₩2,900");
        assert.match(vmOrder.getEl("#summaryPlanPrice").textContent, /₩16,900/);
      } finally {
        vmOrder.dispose();
      }

      const acc = (await (await post("/v1/accounts", { device_id: "e".repeat(64), device_type: "pc" })).json()) as any;
      const chk = await post(
        "/v1/checkout",
        { plan: "monthly", intro: true, currency: "krw", addons: ["cloud_vault"], email: "intl@example.com" },
        { authorization: `Bearer ${acc.refresh_token}` }
      );
      assert.equal(chk.status, 200);
      assert.equal(capturedSessions[0].subscription_data.metadata.cloud_vault, "1");
      assert.equal(capturedSessions[0].subscription_data.metadata.battery_care, undefined);
    } finally {
      close();
    }
  });

  test("T4-J4: Mobile iOS & Linux visitor honest routing journey", async () => {
    const { app, close } = setup();
    try {
      const iosLanding = await app.request("/download?platform=ios", { headers: { "user-agent": IPHONE_SAFARI_UA } });
      assert.equal(iosLanding.status, 200);
      assertHonestIosFraming(await iosLanding.text(), "/download?platform=ios");

      const iosStream = await app.request("/download?platform=ios&stream=1", { headers: { "user-agent": IPHONE_SAFARI_UA } });
      assert.notEqual(iosStream.headers.get("content-type"), "application/x-apple-diskimage");

      const mcRedirect = await app.request("/SWEEPRCleaner.mobileconfig", { redirect: "manual" });
      assert.equal(mcRedirect.status, 302);
      const mcDisk = readFileSync(resolve(SERVER_PUBLIC, "SWEEPRCleaner.mobileconfig"), "utf-8");
      assert.match(mcDisk, /5-device/i);
      assertNoEntityFluff(mcDisk, "SWEEPRCleaner.mobileconfig");

      const linuxStream = await app.request("/download?platform=linux&stream=1", { headers: { "user-agent": LINUX_DESKTOP_UA } });
      assert.notEqual(linuxStream.headers.get("content-type"), "application/x-executable");

      const vmLinuxHome = await mountHtmlInVm(app, "/", { userAgent: LINUX_DESKTOP_UA, platform: "Linux x86_64" });
      try {
        assert.equal((vmLinuxHome.getEl("#primaryDownloadCta").getAttribute("href") || "").includes("platform=linux"), false);
      } finally {
        vmLinuxHome.dispose();
      }
    } finally {
      close();
    }
  });

  test("T4-J5: Telemetry & experiment hygiene journey", async () => {
    const { app, repo, close } = setup();
    try {
      const vmOrder = await mountHtmlInVm(app, "/order", { userAgent: WINDOWS_CHROME_UA });
      try {
        assert.equal(vmOrder.fetchCalls.filter((c) => c.url.includes("order_intro_rescue_v1")).length, 0);
      } finally {
        vmOrder.dispose();
      }

      const unknownRes = await app.request("/api/experiments/assign?experiment=order_intro_rescue_v1&visitor_id=hygiene_1");
      assert.equal(unknownRes.status, 200);
      assert.equal((repo.db.prepare("SELECT COUNT(*) as c FROM analytics_events WHERE event_name='experiment_exposure'").get() as any).c, 0);

      const validRes = await app.request("/api/experiments/assign?experiment=checker_cta_copy_v1&visitor_id=hygiene_1");
      assert.equal(validRes.status, 200);
      const rows = repo.db.prepare("SELECT metadata FROM analytics_events WHERE event_name='experiment_exposure'").all() as Array<{ metadata: string }>;
      assert.equal(rows.length, 1);
      assert.equal(JSON.parse(rows[0].metadata).experiment, "checker_cta_copy_v1");

      const privacyText = stripTags(extractMainBody(await (await app.request("/privacy")).text()));
      assert.match(privacyText, /\/v1\/telemetry\/event/);
      assert.match(privacyText, /\/v1\/telemetry\/crash/);
      assertNoEntityFluff(privacyText, "/privacy");
    } finally {
      close();
    }
  });
});

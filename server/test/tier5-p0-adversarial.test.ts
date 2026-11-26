import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { PRICING_BY_CURRENCY, getPricingForCountryOrCurrency } from "../src/pricing.js";
import {
  sendSubscriptionEmail,
  sendRenewalReminderEmail,
} from "../src/email.js";
import {
  sendDownloadRecoveryEmail,
  recordInstallerDownloaded,
  getVisitorRecoveryStatus,
} from "../src/download-recovery.js";
import {
  redeemGiveawayLicense,
  runGiveawayUpgradeSweep,
  triggerGiveawayDeviceLimitUpgradeEmail,
  updateGiveawayConfig,
} from "../src/giveaway.js";
import { processAnnualRenewalRecap } from "../src/renewal-recap.js";

const { privateKey } = generateKeyPairSync("ed25519");

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER_DIR = resolve(ROOT_DIR, "server");
const SERVER_PUBLIC = resolve(SERVER_DIR, "public");
const SERVER_SRC = resolve(SERVER_DIR, "src");

const WINDOWS_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const FORBIDDEN_ENTITY_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "SWEEPR Cleaner Inc.", re: /SWEEPR\s+Cleaner\s+Inc(?:\.(?=\s|$|[,;.)\]"'<])|(?=\s|$|[,;.)\]"'<]))/i },
  { label: "24/7 Support Desk", re: /24\/7\s+Support\s+Desk/i },
  { label: "24/7 support team", re: /24\/7\s+support\s+team/i },
  { label: "24/7 support", re: /24\/7\s+(?:priority\s+)?support/i },
  { label: "around the clock", re: /around\s+the\s+clock/i },
  { label: "under 2 hours", re: /under\s+2\s+hours/i },
  { label: "Data Protection Officer", re: /Data\s+Protection\s+Officer/i },
  { label: "SWEEPR Technologies", re: /SWEEPR\s+Technologies/i },
  { label: "SWEEPR Cleaner Team", re: /SWEEPR\s+Cleaner\s+Team/i },
  { label: "The SWEEPR Team", re: /\bThe\s+SWEEPR\s+Team\b/i },
  { label: "SWEEPR Team", re: /\bSWEEPR\s+Team\b/i },
];

function setup(overrides: Record<string, unknown> = {}) {
  const capturedSessions: any[] = [];
  const mockStripe: any = {
    customers: { list: async () => ({ data: [] }) },
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
        items: { data: [{ id: "si_test_1", price: { currency: "gbp", recurring: { interval: "year", interval_count: 1 } } }] },
      }),
      update: async (id: string) => ({ id, status: "active" }),
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

  return { repo, app, post, capturedSessions, close };
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
    .replace(/&pound;/gi, "£")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function assertNoForbiddenEntity(content: string, label: string) {
  for (const { label: pLabel, re } of FORBIDDEN_ENTITY_PATTERNS) {
    const m = content.match(re);
    assert.equal(m, null, `Forbidden entity fluff "${pLabel}" in ${label}: ${m?.[0] ?? ""}`);
  }
}

// ============================================================================
// Lightweight DOM + VM Harness for Browser Script Adversarial Tests
// ============================================================================
const VOID_TAGS = new Set([
  "AREA", "BASE", "BR", "COL", "EMBED", "HR", "IMG", "INPUT",
  "LINK", "META", "PARAM", "SOURCE", "TRACK", "WBR",
]);

class FakeTextNode {
  nodeType = 3;
  nodeValue: string;
  parentNode: FakeElement | null = null;
  constructor(val: string) {
    this.nodeValue = val;
  }
  get firstChild(): null {
    return null;
  }
  get nextSibling(): FakeElement | FakeTextNode | null {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx >= 0 && idx + 1 < this.parentNode.childNodes.length
      ? this.parentNode.childNodes[idx + 1]
      : null;
  }
  get textContent(): string {
    return this.nodeValue;
  }
  set textContent(v: string) {
    this.nodeValue = String(v ?? "");
  }
}

class FakeClassList {
  private el: FakeElement;
  constructor(el: FakeElement) {
    this.el = el;
  }
  private classes(): string[] {
    return (this.el.attributes.get("class") ?? "").split(/\s+/).filter(Boolean);
  }
  private write(list: string[]) {
    this.el.attributes.set("class", list.join(" "));
  }
  contains(c: string): boolean {
    return this.classes().includes(c);
  }
  add(...tokens: string[]) {
    const list = this.classes();
    for (const t of tokens) if (t && !list.includes(t)) list.push(t);
    this.write(list);
  }
  remove(...tokens: string[]) {
    this.write(this.classes().filter((c) => !tokens.includes(c)));
  }
  toggle(token: string, force?: boolean): boolean {
    const has = this.contains(token);
    const shouldAdd = force !== undefined ? force : !has;
    if (shouldAdd) this.add(token);
    else this.remove(token);
    return shouldAdd;
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
  onload: ((ev?: any) => void) | null = null;
  onerror: ((ev?: any) => void) | null = null;

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

  get firstChild(): FakeElement | FakeTextNode | null {
    return this.childNodes[0] ?? null;
  }

  get nextSibling(): FakeElement | FakeTextNode | null {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx >= 0 && idx + 1 < this.parentNode.childNodes.length
      ? this.parentNode.childNodes[idx + 1]
      : null;
  }

  get lang(): string {
    return this.attributes.get("lang") ?? "";
  }
  set lang(v: string) {
    this.attributes.set("lang", String(v ?? ""));
  }

  get src(): string {
    return this.attributes.get("src") ?? "";
  }
  set src(v: string) {
    this.attributes.set("src", String(v ?? ""));
  }

  get async(): boolean {
    return this.attributes.has("async");
  }
  set async(v: boolean) {
    if (v) this.attributes.set("async", "");
    else this.attributes.delete("async");
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

  get href(): string {
    return this.attributes.get("href") ?? "";
  }
  set href(v: string) {
    this.attributes.set("href", String(v ?? ""));
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
    const walk = (n: FakeElement) => {
      for (const ch of n.children) {
        if (ch.tagName === "OPTION") opts.push(ch);
        else walk(ch);
      }
    };
    walk(this);
    return opts;
  }

  get value(): string {
    if (this.tagName === "SELECT") {
      if (this._value !== null) return this._value;
      const opts = this.options;
      const selOpt = opts.find((o) => o.attributes.has("selected")) ?? opts[0];
      return selOpt ? (selOpt.attributes.get("value") ?? selOpt.textContent) : "";
    }
    if (this.tagName === "OPTION") return this.attributes.get("value") ?? this.textContent;
    if (this._value !== null) return this._value;
    return this.attributes.get("value") ?? "";
  }

  set value(v: string) {
    const str = String(v ?? "");
    if (this.tagName === "SELECT") {
      const match = this.options.find((o) => (o.attributes.get("value") ?? o.textContent) === str);
      if (match) this._value = str;
      return;
    }
    this._value = str;
  }

  forceTamperedSelectValue(v: string) {
    this._value = v;
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
      this.childNodes.push(new FakeTextNode(String(v)));
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
    for (const node of parseHtmlFragment(String(html ?? ""), this._vmRunAttr)) {
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  appendChild<T extends FakeElement | FakeTextNode>(node: T): T {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    if (node instanceof FakeElement && this._vmRunAttr) node.setVmRunner(this._vmRunAttr);
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
    if (this.parentNode) this.parentNode.removeChild(this);
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
    if (position === "beforeend") return this.appendChild(el);
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
    this.listeners.set(type, list.filter((f) => f !== fn));
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
            preventDefault: ev.preventDefault ?? function (this: any) { this.defaultPrevented = true; },
          };
    const inlineAttr = this.attributes.get(`on${eventObj.type}`);
    if (inlineAttr && this._vmRunAttr) {
      this._vmRunAttr(this, inlineAttr, eventObj);
    }
    for (const fn of [...(this.listeners.get(eventObj.type) ?? [])]) {
      fn.call(this, eventObj);
    }
    return !eventObj.defaultPrevented;
  }

  click() {
    const isCheckbox = this.tagName === "INPUT" && this.type === "checkbox";
    const isRadio = this.tagName === "INPUT" && this.type === "radio";
    if (isCheckbox) this.checked = !this.checked;
    else if (isRadio) this.checked = true;
    const ev = {
      type: "click",
      target: this,
      currentTarget: this,
      defaultPrevented: false,
      stopPropagation() {},
      preventDefault() { this.defaultPrevented = true; },
    };
    this.dispatchEvent(ev);
    if ((isCheckbox || isRadio) && !ev.defaultPrevented) {
      this.dispatchEvent("change");
    }
  }

  querySelectorAll(selector: string): FakeElement[] {
    const parts = selector.split(",").map((s) => s.trim()).filter(Boolean);
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
      const actual = el.getAttribute(m[1].toLowerCase());
      if (actual === null) return false;
      const expected = m[3] ?? "";
      if (m[2] === "=" && actual !== expected) return false;
      if (m[2] === "^=" && !actual.startsWith(expected)) return false;
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
    if (!curr || (curr === root && !matchesSimpleSelector(curr, segments[i]))) return false;
    curr = curr.parentNode;
  }
  return true;
}

function parseAttributes(attrStr: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    map.set(m[1].toLowerCase(), decodeBasicEntities(m[2] ?? m[3] ?? m[4] ?? ""));
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
      stack[stack.length - 1].appendChild(new FakeTextNode(decodeBasicEntities(html.slice(i, lt))));
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
    if (!selfClosing && !VOID_TAGS.has(tagName)) stack.push(el);
    i = pos + 1;
  }
  return root.childNodes;
}

interface MountVmOpts {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  timeZone?: string;
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  extraGlobals?: Record<string, unknown>;
  mockFetch?: (url: string, init?: any) => Promise<any>;
}

async function mountHtmlInVm(
  app: ReturnType<typeof createApp>,
  pathWithQuery: string,
  opts: MountVmOpts = {}
) {
  const userAgent = opts.userAgent ?? WINDOWS_CHROME_UA;
  const res = await app.request(pathWithQuery, { headers: { "user-agent": userAgent } });
  assert.equal(res.status, 200, `Expected 200 for ${pathWithQuery}, got ${res.status}`);
  const html = await res.text();

  const root = new FakeElement("DOCUMENT");
  for (const n of parseHtmlFragment(html)) {
    n.parentNode = root;
    root.childNodes.push(n);
  }
  const headEl = root.querySelector("head") ?? root;
  const bodyEl = root.querySelector("body") ?? root;
  const urlObj = new URL(`https://sweeprcleaner.com${pathWithQuery}`);
  const lsStore = new Map<string, string>(Object.entries(opts.localStorage ?? {}));
  const ssStore = new Map<string, string>(Object.entries(opts.sessionStorage ?? {}));
  const docListeners = new Map<string, Array<(ev: any) => void>>();
  const winListeners = new Map<string, Array<(ev: any) => void>>();
  const fetchCalls: Array<{ url: string; method: string; body?: string }> = [];
  const runtimeErrors: Error[] = [];
  const activeTimers = new Set<ReturnType<typeof setTimeout>>();
  const pendingTasks = new Set<Promise<unknown>>();
  const trackTask = <T>(p: Promise<T>): Promise<T> => {
    pendingTasks.add(p);
    p.finally(() => pendingTasks.delete(p));
    return p;
  };

  const makeStorage = (store: Map<string, string>) => ({
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v ?? "")),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  });

  const vmDoc: any = {
    documentElement: root.querySelector("html") ?? root,
    head: headEl,
    body: bodyEl,
    cookie: "",
    title: root.querySelector("title")?.textContent ?? "",
    getElementById: (id: string) => {
      const walk = (n: FakeElement): FakeElement | null => {
        for (const ch of n.children) {
          if (ch.id === id) return ch;
          const f = walk(ch);
          if (f) return f;
        }
        return null;
      };
      return walk(root);
    },
    querySelector: (s: string) => root.querySelector(s),
    querySelectorAll: (s: string) => root.querySelectorAll(s),
    createElement: (tag: string) => new FakeElement(tag, vmRunAttr),
    createTextNode: (t: string) => new FakeTextNode(t),
    addEventListener: (t: string, fn: (ev: any) => void) => {
      const l = docListeners.get(t) ?? [];
      l.push(fn);
      docListeners.set(t, l);
    },
    removeEventListener: (t: string, fn: (ev: any) => void) => {
      docListeners.set(t, (docListeners.get(t) ?? []).filter((f) => f !== fn));
    },
    dispatchEvent: (ev: any) => {
      const type = typeof ev === "string" ? ev : ev.type;
      const obj = typeof ev === "string" ? { type, target: vmDoc } : ev;
      for (const fn of [...(docListeners.get(type) ?? [])]) {
        const res: unknown = fn.call(vmDoc, obj);
        if (res && typeof (res as { then?: unknown }).then === "function") {
          trackTask(
            Promise.resolve(res).catch((err) => {
              runtimeErrors.push(err instanceof Error ? err : new Error(String(err)));
            })
          );
        }
      }
      return true;
    },
  };

  const vmWin: any = {
    location: {
      href: urlObj.toString(),
      pathname: urlObj.pathname,
      search: urlObj.search,
      hostname: urlObj.hostname,
      origin: urlObj.origin,
    },
    navigator: {
      userAgent,
      platform: opts.platform ?? "Win32",
      maxTouchPoints: opts.maxTouchPoints ?? 0,
      language: "en-GB",
    },
    localStorage: makeStorage(lsStore),
    sessionStorage: makeStorage(ssStore),
    document: vmDoc,
    URLSearchParams,
    URL,
    Intl: {
      DateTimeFormat: function (...args: any[]) {
        const real = new Intl.DateTimeFormat(...args);
        return {
          resolvedOptions: () => ({
            ...real.resolvedOptions(),
            timeZone: opts.timeZone ?? "Europe/London",
          }),
          format: real.format.bind(real),
        };
      },
    },
    fetch: (url: string, init?: any) =>
      trackTask(
        (async () => {
          const u = String(url);
          fetchCalls.push({ url: u, method: init?.method ?? "GET", body: init?.body });
          if (opts.mockFetch) {
            const custom = await opts.mockFetch(u, init);
            if (custom) return custom;
          }
          if (u.startsWith("/")) {
            const appRes = await app.request(u, {
              method: init?.method ?? "GET",
              headers: init?.headers,
              body: init?.body,
            });
            const text = await appRes.text();
            return {
              ok: appRes.ok,
              status: appRes.status,
              text: async () => text,
              json: async () => JSON.parse(text),
            };
          }
          return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
        })()
      ),
    addEventListener: (t: string, fn: (ev: any) => void) => {
      const l = winListeners.get(t) ?? [];
      l.push(fn);
      winListeners.set(t, l);
    },
    removeEventListener: (t: string, fn: (ev: any) => void) => {
      winListeners.set(t, (winListeners.get(t) ?? []).filter((f) => f !== fn));
    },
    dispatchEvent: (ev: any) => {
      const type = typeof ev === "string" ? ev : ev.type;
      const obj = typeof ev === "string" ? { type, target: vmWin } : ev;
      for (const fn of [...(winListeners.get(type) ?? [])]) {
        const res: unknown = (fn as (e: any) => unknown).call(vmWin, obj);
        if (res && typeof (res as { then?: unknown }).then === "function") {
          trackTask(
            Promise.resolve(res).catch((err) => {
              runtimeErrors.push(err instanceof Error ? err : new Error(String(err)));
            })
          );
        }
      }
      return true;
    },
    setTimeout: (fn: (...a: any[]) => void, ms?: number, ...args: any[]) => {
      const h = setTimeout(() => {
        activeTimers.delete(h);
        fn(...args);
      }, Math.min(Number(ms ?? 0), 50));
      activeTimers.add(h);
      return h;
    },
    clearTimeout: (h: any) => {
      activeTimers.delete(h);
      clearTimeout(h);
    },
    setInterval: () => 0,
    clearInterval: () => {},
    console,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Date,
    RegExp,
    Error,
    Promise,
    Set,
    Map,
    encodeURIComponent,
    decodeURIComponent,
    parseFloat,
    parseInt,
    isNaN,
    isFinite,
    ...(opts.extraGlobals ?? {}),
  };
  vmWin.window = vmWin;
  vmWin.self = vmWin;

  const vmCtx = vm.createContext(vmWin);
  function vmRunAttr(el: FakeElement, code: string, ev: any) {
    (vmWin as any).__inlineTarget = el;
    (vmWin as any).__inlineEvent = ev;
    try {
      vm.runInContext(`(function(event){ ${code} }).call(__inlineTarget, __inlineEvent)`, vmCtx);
    } catch (err: any) {
      runtimeErrors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }
  root.setVmRunner(vmRunAttr);

  const origHeadAppend = headEl.appendChild.bind(headEl);
  headEl.appendChild = ((node: any) => {
    const appended = origHeadAppend(node);
    if (node instanceof FakeElement && node.tagName === "SCRIPT" && node.src) {
      const cleanSrc = node.src.split("?")[0];
      if (cleanSrc === "/nav.js" || cleanSrc === "/i18n.js" || cleanSrc === "/i18n-dict.js") {
        vmWin.setTimeout(() => {
          try {
            const dynCode = readFileSync(resolve(SERVER_PUBLIC, cleanSrc.slice(1)), "utf8");
            vm.runInContext(dynCode, vmCtx);
            if (typeof node.onload === "function") node.onload({ type: "load", target: node });
            node.dispatchEvent({ type: "load", target: node });
          } catch (err: any) {
            runtimeErrors.push(err instanceof Error ? err : new Error(String(err)));
            if (typeof node.onerror === "function") node.onerror({ type: "error", target: node });
            node.dispatchEvent({ type: "error", target: node });
          }
        }, 0);
      }
    }
    return appended;
  }) as typeof headEl.appendChild;

  for (const scriptEl of root.querySelectorAll("script")) {
    const type = (scriptEl.getAttribute("type") ?? "").toLowerCase();
    if (type && type !== "text/javascript" && type !== "application/javascript") continue;
    const src = scriptEl.getAttribute("src");
    let code = "";
    if (src) {
      const cleanSrc = src.split("?")[0];
      if (cleanSrc === "/nav.js" || cleanSrc === "/i18n.js" || cleanSrc === "/i18n-dict.js") {
        code = readFileSync(resolve(SERVER_PUBLIC, cleanSrc.slice(1)), "utf8");
      } else {
        continue;
      }
    } else {
      code = scriptEl.textContent;
    }
    if (!code.trim()) continue;
    try {
      vm.runInContext(code, vmCtx);
    } catch (err: any) {
      runtimeErrors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }

  vmDoc.dispatchEvent("DOMContentLoaded");
  vmWin.dispatchEvent("DOMContentLoaded");
  const settleDeadline = Date.now() + 2500;
  while ((pendingTasks.size > 0 || activeTimers.size > 0) && Date.now() < settleDeadline) {
    if (pendingTasks.size > 0) {
      await Promise.allSettled([...pendingTasks]);
    }
    await new Promise((r) => setTimeout(r, 15));
  }
  await new Promise((r) => setTimeout(r, 20));

  const dispose = () => {
    for (const h of activeTimers) clearTimeout(h);
    activeTimers.clear();
  };

  return { root, document: vmDoc, window: vmWin, fetchCalls, runtimeErrors, dispose };
}

// ============================================================================
// Tier-5 White-Box Adversarial Regression Suite (T5-ADV-1 .. T5-ADV-12)
// ============================================================================
describe("Tier-5 White-Box Adversarial Regression Suite (M4)", () => {
  test("T5-ADV-1: Winget manifest parity, entity truth, SHA-256 & P0-4/P0-5 compliance", () => {
    const wingetDir = resolve(ROOT_DIR, "winget-manifests/manifests/s/Sweepr/SweeprCleaner/0.1.0");
    const verYaml = readFileSync(resolve(wingetDir, "Sweepr.SweeprCleaner.yaml"), "utf8");
    const instYaml = readFileSync(resolve(wingetDir, "Sweepr.SweeprCleaner.installer.yaml"), "utf8");
    const localeYaml = readFileSync(resolve(wingetDir, "Sweepr.SweeprCleaner.locale.en-US.yaml"), "utf8");
    const releaseManifest = JSON.parse(readFileSync(resolve(SERVER_PUBLIC, "release-manifest.json"), "utf8"));
    const readme = readFileSync(resolve(ROOT_DIR, "README.md"), "utf8");

    assert.match(verYaml, /PackageIdentifier:\s*Sweepr\.SweeprCleaner/);
    assert.match(instYaml, /PackageIdentifier:\s*Sweepr\.SweeprCleaner/);
    assert.match(localeYaml, /PackageIdentifier:\s*Sweepr\.SweeprCleaner/);
    assert.ok(readme.includes("winget install Sweepr.SweeprCleaner"), "README.md must cite Sweepr.SweeprCleaner");

    assert.match(localeYaml, /Publisher:\s*Benjamin Cook/);
    assert.match(localeYaml, /Author:\s*Benjamin Cook/);
    assert.match(localeYaml, /Copyright:\s*Copyright \(c\) 2026 Benjamin Cook/);
    assertNoForbiddenEntity(localeYaml, "Winget locale YAML");

    // P0-4 & P0-5 compliance on Winget locale description
    assert.equal(/under\s+60\s+seconds/i.test(localeYaml), false, "Winget locale must not claim under 60 seconds");
    assert.equal(/zero\s+background\s+daemons/i.test(localeYaml), false, "Winget locale must not claim zero background daemons");
    assert.equal(/zero\s+telemetry(?![-\s]*Offline)/i.test(localeYaml), false, "Winget locale must not claim unqualified zero telemetry");
    const hasLegacyUndoQual = /<50\s*MB/i.test(localeYaml) && /300\s+rolling\s+items/i.test(localeYaml);
    const hasBudgetUndoQual = /2[–-]10\s*GB/i.test(localeYaml) && /5\s*GB\s+default/i.test(localeYaml) && /Recycle\s+Bin\s+fallback/i.test(localeYaml) && /excludes\s+shredded\s+files/i.test(localeYaml);
    assert.ok(hasLegacyUndoQual || hasBudgetUndoQual, "Winget locale must qualify 7-day Undo Quarantine limits and exclusions");

    // SHA-256 parity with release-manifest.json and binaries on disk
    const exeShaActual = createHash("sha256").update(readFileSync(resolve(SERVER_PUBLIC, "SWEEPRCleaner.exe"))).digest("hex").toUpperCase();
    const msiShaActual = createHash("sha256").update(readFileSync(resolve(SERVER_PUBLIC, "Sweepr_Setup.msi"))).digest("hex").toUpperCase();
    assert.equal(exeShaActual, String(releaseManifest.exe.sha256).toUpperCase());
    assert.equal(msiShaActual, String(releaseManifest.msi.sha256).toUpperCase());
    assert.ok(instYaml.includes(exeShaActual), "Winget installer YAML must match SWEEPRCleaner.exe SHA-256");
    assert.ok(instYaml.includes(msiShaActual), "Winget installer YAML must match Sweepr_Setup.msi SHA-256");
  });

  test("T5-ADV-2: /giveaway, /redeem/gotd, /giveaway/readme.txt & outbound giveaway emails P0-1/4/5/7 & sole-trader entity gate", async () => {
    const { app, repo, close } = setup();
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      updateGiveawayConfig(repo, {
        window_start_ts: nowSec - 3600,
        window_end_ts: nowSec + 3600,
        promo_code: "GOTD-2026-SWEEPR",
        upgrade_coupon: "GOTD50",
        upgrade_discount_pct: 50,
        partner_name: "Giveaway of the Day",
        allow_preview_redemption: true,
      });

      for (const route of ["/giveaway", "/redeem/gotd", "/giveaway/readme.txt"]) {
        const res = await app.request(route);
        assert.equal(res.status, 200, `${route} must return 200`);
        const body = await res.text();
        assertNoForbiddenEntity(body, route);
        assert.equal(/\bin\s+30\s+seconds\b/i.test(body), false, `${route} must not claim 30 seconds`);
        assert.equal(/\b5\s*MB\b/i.test(body), false, `${route} must not use stale 5 MB installer size`);
        assert.equal(/~?6\.8\s*MB/i.test(body), false, `${route} must not use stale ~6.8 MB installer size`);
        assert.match(body, /Safari\s+web\s+companion|TestFlight\s+beta/i, `${route} must qualify iOS`);
        if (route !== "/giveaway/readme.txt") {
          assert.match(body, /\b6\.76\s*MB\b/i, `${route} must advertise exact 6.76 MB installer size`);
          const cleanDlMatch = body.match(/<a\b[^>]*\bhref="\/download"[^>]*>/gi) ?? [];
          assert.ok(cleanDlMatch.length >= 1, `${route} must contain clean /download anchor`);
          for (const tag of cleanDlMatch) {
            assert.doesNotMatch(tag, /\brel="nofollow"/i, `${route} clean /download anchor must omit rel="nofollow": ${tag}`);
          }
        }
      }

      // Exercise all 4 outbound giveaway emails (T+3d nurture, T-14d expiry, T-3d expiry, 2nd-PC limit)
      const rT3d = redeemGiveawayLicense(repo, {
        email: "giveaway-t3d@subscriber.test",
        code: "GOTD-2026-SWEEPR",
        nowSec: nowSec - 4 * 86400,
      });
      const rT14d = redeemGiveawayLicense(repo, {
        email: "giveaway-t14d@subscriber.test",
        code: "GOTD-2026-SWEEPR",
        nowSec: nowSec - 170 * 86400,
      });
      const rT3dExp = redeemGiveawayLicense(repo, {
        email: "giveaway-expiry3d@subscriber.test",
        code: "GOTD-2026-SWEEPR",
        nowSec: nowSec - 178 * 86400,
      });
      assert.equal(rT3d.ok, true);
      assert.equal(rT14d.ok, true);
      assert.equal(rT3dExp.ok, true);

      const capturedEmails: Array<{ to: string; subject: string; textBody: string; htmlBody: string }> = [];
      const captureEmail = async (opts: {
        to: string;
        subject: string;
        textBody: string;
        htmlBody: string;
        tag?: string;
      }) => {
        capturedEmails.push({
          to: opts.to,
          subject: opts.subject,
          textBody: opts.textBody,
          htmlBody: opts.htmlBody,
        });
        return {
          ok: true,
          provider: "test-capture",
          id: `cap_${capturedEmails.length}`,
          to: opts.to,
          timestamp: new Date().toISOString(),
        };
      };

      const sweepRes = await runGiveawayUpgradeSweep(repo, { nowSec, dispatchEmail: captureEmail });
      assert.equal(sweepRes.nurture_3d_sent, 1, "Expected 1 T+3d nurture email");
      assert.equal(sweepRes.expiry_14d_sent, 1, "Expected 1 T-14d expiry email");
      assert.equal(sweepRes.expiry_3d_sent, 1, "Expected 1 T-3d expiry email");

      const devLimitRes = await triggerGiveawayDeviceLimitUpgradeEmail(
        repo,
        rT3d.account_id!,
        "giveaway-devlimit@subscriber.test",
        nowSec,
        captureEmail
      );
      assert.equal(devLimitRes.triggered, true, "Expected 2nd-PC device-limit upgrade email");
      assert.equal(capturedEmails.length, 4, "Expected 4 captured giveaway outbound emails");

      for (const mail of capturedEmails) {
        const fullPayload = `${mail.subject}\n${mail.textBody}\n${mail.htmlBody}`;
        assertNoForbiddenEntity(fullPayload, `giveaway outbound email to ${mail.to}`);
        assert.ok(
          mail.textBody.includes("— Benjamin Cook (SWEEPR Cleaner)"),
          `Giveaway email to ${mail.to} must sign off as Benjamin Cook (SWEEPR Cleaner)`
        );
        assert.equal(
          /\bautomatic\s+background\b/i.test(fullPayload),
          false,
          `Giveaway email to ${mail.to} must not claim unqualified automatic background`
        );
        const withoutQualifiedIos = decodeBasicEntities(fullPayload).replace(
          /\biOS\s*\(Safari web companion \/ TestFlight beta\)/gi,
          ""
        );
        assert.equal(
          /\biOS\b/i.test(withoutQualifiedIos),
          false,
          `Giveaway email to ${mail.to} must not contain unqualified iOS`
        );
      }
    } finally {
      close();
    }
  });

  test("T5-ADV-3: Transactional email & recovery templates obey P0-4/5 & sole-trader entity constraints", async () => {
    const { repo, close } = setup();
    const origLog = console.log;
    const capturedLogs: string[] = [];
    console.log = (...args: any[]) => {
      capturedLogs.push(args.map((a) => String(a)).join(" "));
    };

    try {
      const rOtp = await sendSubscriptionEmail("user@example.com", "otp", "123456");
      const rAct = await sendSubscriptionEmail("user@example.com", "activated", "annual", "Alice", "SWEEPR-PRO-TEST-KEY", {
        amountFormatted: "£49.99",
      });
      const rCan = await sendSubscriptionEmail("user@example.com", "canceled", "annual", "Alice");
      const rRem = await sendRenewalReminderEmail({
        to: "user@example.com",
        name: "Alice",
        plan: "annual",
        amountCents: 4999,
        currency: "GBP",
      });
      const rRec = await sendDownloadRecoveryEmail({
        to: "user@example.com",
        attributionId: "attr_t5_adv_3",
      });

      assert.equal(rOtp.ok, true);
      assert.equal(rAct.ok, true);
      assert.equal(rCan.ok, true);
      assert.equal(rRem.ok, true);
      assert.equal(rRec.ok, true);

      // Exercise A3 banner state API output (smartscreen_steps)
      const nowSec = Math.floor(Date.now() / 1000);
      recordInstallerDownloaded(repo, {
        attributionId: "attr_t5_adv_3",
        platform: "windows",
        installerFile: "SWEEPRCleaner.exe",
        nowSec: nowSec - 3600,
      });
      const banner = await getVisitorRecoveryStatus(repo, "attr_t5_adv_3", nowSec);
      assert.ok(banner.tracked);
      assert.equal(/\b5\s*MB\b/i.test(JSON.stringify(banner)), false, "A3 banner state must not state 5 MB");
      assert.match(JSON.stringify(banner), /6\.76\s*MB/i);

      // Exercise A6 annual renewal recap
      const accId = "acc_t5_adv_3";
      repo.createAccount(accId, "hash_t5_adv_3", "recap-t5@example.com");
      repo.upsertEntitlement({
        account_id: accId,
        stripe_subscription_id: null,
        plan: "annual",
        status: "active",
        current_period_end: nowSec + 7 * 86400,
        cancel_at_period_end: 0,
      });
      const recapRes = await processAnnualRenewalRecap(repo, { accountId: accId, nowSec, renewalTs: nowSec + 7 * 86400 });
      assert.equal(recapRes.ok, true);

      // Check captured runtime logs from sendSubscriptionEmail
      const joinedLogs = capturedLogs.join("\n");
      assert.ok(joinedLogs.includes("Benjamin Cook (SWEEPR Cleaner)"), "Captured OTP/cancel email must sign off as Benjamin Cook");
      assertNoForbiddenEntity(joinedLogs, "Captured transactional email logs");

      // White-box template audit of email.ts, download-recovery.ts, renewal-recap.ts
      for (const file of ["email.ts", "download-recovery.ts", "renewal-recap.ts"]) {
        const src = readFileSync(resolve(SERVER_SRC, file), "utf8");
        assertNoForbiddenEntity(src, file);
        assert.equal(/60s\s+Scan|60-Second\s+Storage\s+Scan/i.test(src), false, `${file} must not claim 60s/60-Second Scan`);
        assert.equal(/10-second\s+walkthrough/i.test(src), false, `${file} must not claim 10-second walkthrough`);
        assert.equal(/0\s*MB\s+background\s+RAM/i.test(src), false, `${file} must not claim 0 MB background RAM`);
        assert.equal(/\b5\s*MB\s+native\s+Rust/i.test(src), false, `${file} must not claim stale 5 MB installer size`);
      }
    } finally {
      console.log = origLog;
      close();
    }
  });

  test("T5-ADV-4: /v1/checkout preserves intro=1 on Stripe fallback & resists prototype-pollution currency/addon injection", async () => {
    const throwingStripe = {
      customers: { list: async () => ({ data: [] }) },
      coupons: {
        retrieve: async () => {
          throw new Error("stripe_down");
        },
        create: async () => {
          throw new Error("stripe_down");
        },
      },
      checkout: {
        sessions: {
          create: async () => {
            throw new Error("simulated_stripe_outage");
          },
        },
      },
    };
    const { post, close } = setup({ stripe: throwingStripe });
    try {
      const accRes = await post("/v1/accounts", { device_id: "t".repeat(64), device_type: "pc" });
      assert.equal(accRes.status, 200);
      const { refresh_token } = (await accRes.json()) as { refresh_token: string };

      const res = await post(
        "/v1/checkout",
        {
          plan: "monthly",
          intro: true,
          addons: ["cloud_vault"],
          currency: "constructor",
          email: "t5adv4@example.com",
        },
        { authorization: `Bearer ${refresh_token}` }
      );
      assert.equal(res.status, 200);
      const data = (await res.json()) as { url: string };
      assert.ok(data.url, "Fallback checkout URL must be returned");
      const parsed = new URL(data.url);
      assert.equal(parsed.pathname, "/order");
      assert.equal(parsed.searchParams.get("plan"), "monthly");
      assert.equal(parsed.searchParams.get("intro"), "1", "Stripe fallback must preserve intro=1 for monthly intro");
      assert.equal(parsed.searchParams.get("addons"), "cloud_vault");
      assert.equal(parsed.searchParams.get("addon"), "cloud_vault");
      assert.equal(parsed.searchParams.toString().includes("battery_care"), false, "Must NOT inject battery_care when only cloud_vault was requested");

      // Also verify /api/pricing with prototype-pollution currency names falls back cleanly to GBP
      for (const badCur of ["__proto__", "constructor", "toString", "valueOf"]) {
        const { app, close: close2 } = setup();
        try {
          const pRes = await app.request(`/api/pricing?currency=${encodeURIComponent(badCur)}`);
          assert.equal(pRes.status, 200);
          const pJson = (await pRes.json()) as any;
          assert.equal(pJson.pricing.currency, "gbp", `Invalid currency ${badCur} must fall back to gbp`);
        } finally {
          close2();
        }
      }
    } finally {
      close();
    }
  });

  test("T5-ADV-5: pricing.ts 30-currency numeric, key, and zeroDecimal cross-file parity (index.html, pricing.html & order.html VM)", async () => {
    const serverKeys = Object.keys(PRICING_BY_CURRENCY).sort();
    assert.equal(serverKeys.length, 30, "pricing.ts must define exactly 30 currencies");

    const indexHtml = readFileSync(resolve(SERVER_PUBLIC, "index.html"), "utf8");
    const pricingHtml = readFileSync(resolve(SERVER_PUBLIC, "pricing.html"), "utf8");

    // Extract option values from #globalCurrencySelect (index.html) and #pricingCurrencySelect (pricing.html)
    const extractSelectValues = (html: string, selectId: string): string[] => {
      const m = html.match(new RegExp(`<select\\b[^>]*id="${selectId}"[^>]*>([\\s\\S]*?)<\\/select>`, "i"));
      assert.ok(m, `Expected <select id="${selectId}">`);
      return [...m[1].matchAll(/<option\b[^>]*value="([^"]+)"/gi)].map((o) => o[1].toLowerCase()).sort();
    };

    assert.deepEqual(extractSelectValues(indexHtml, "globalCurrencySelect"), serverKeys, "index.html select must match 30 server currencies");
    assert.deepEqual(extractSelectValues(pricingHtml, "pricingCurrencySelect"), serverKeys, "pricing.html select must match 30 server currencies");

    // Evaluate FALLBACK_PRICING (index.html) and CATALOG (pricing.html) in isolated VM
    const extractObjectLiteral = (html: string, varName: string): Record<string, any> => {
      const m = html.match(new RegExp(`var\\s+${varName}\\s*=\\s*(\\{[\\s\\S]*?\\n\\s*\\});`));
      assert.ok(m, `Expected var ${varName} = {...};`);
      const sandbox: Record<string, any> = {};
      vm.runInNewContext(`result = ${m[1]};`, sandbox);
      return sandbox.result;
    };

    const indexCatalog = extractObjectLiteral(indexHtml, "FALLBACK_PRICING");
    const pricingCatalog = extractObjectLiteral(pricingHtml, "CATALOG");

    assert.deepEqual(Object.keys(indexCatalog).sort(), serverKeys, "index.html FALLBACK_PRICING keys must match pricing.ts");
    assert.deepEqual(Object.keys(pricingCatalog).sort(), serverKeys, "pricing.html CATALOG keys must match pricing.ts");

    for (const cur of serverKeys) {
      const srv = PRICING_BY_CURRENCY[cur as keyof typeof PRICING_BY_CURRENCY];
      const idx = indexCatalog[cur];
      const prc = pricingCatalog[cur];
      const isZeroDec = Boolean(srv.zeroDecimal);
      const toMajor = (minor: number) => (isZeroDec ? minor : +(minor / 100).toFixed(2));

      assert.equal(Boolean(idx.zeroDec), isZeroDec, `index.html zeroDec mismatch for ${cur}`);
      assert.equal(Boolean(prc.zeroDec), isZeroDec, `pricing.html zeroDec mismatch for ${cur}`);
      assert.equal(idx.annual, toMajor(srv.annualAmount), `index.html annual mismatch for ${cur}`);
      assert.equal(prc.annual, toMajor(srv.annualAmount), `pricing.html annual mismatch for ${cur}`);
      assert.equal(idx.sixMo, toMajor(srv.sixMonthAmount), `index.html sixMo mismatch for ${cur}`);
      assert.equal(prc.sixMo, toMajor(srv.sixMonthAmount), `pricing.html sixMo mismatch for ${cur}`);
      assert.equal(idx.monthly, toMajor(srv.monthlyAmount), `index.html monthly mismatch for ${cur}`);
      assert.equal(prc.monthly, toMajor(srv.monthlyAmount), `pricing.html monthly mismatch for ${cur}`);
      assert.equal(idx.intro, toMajor(srv.introMonthlyAmount), `index.html intro mismatch for ${cur}`);
      assert.equal(prc.intro, toMajor(srv.introMonthlyAmount), `pricing.html intro mismatch for ${cur}`);
      assert.equal(idx.addonAnnual, toMajor(srv.batteryCareAnnualAmount), `index.html addonAnnual mismatch for ${cur}`);
      assert.equal(prc.addon, toMajor(srv.batteryCareAnnualAmount), `pricing.html addon mismatch for ${cur}`);
      const loc = getPricingForCountryOrCurrency(null, cur);
      assert.equal(idx.addonAnnual, toMajor(loc.cloudVaultAnnualAmount), `index.html cloudVaultAnnual mismatch for ${cur}`);
    }

    // Verify /order?currency=XXX renders all 30 server currencies accurately in VM
    const { app, close } = setup();
    try {
      for (const cur of serverKeys) {
        const loc = getPricingForCountryOrCurrency(null, cur);
        const orderVm = await mountHtmlInVm(app, `/order?currency=${encodeURIComponent(cur)}`);
        try {
          assert.equal(orderVm.runtimeErrors.length, 0, `/order?currency=${cur} VM errors: ${orderVm.runtimeErrors}`);
          assert.equal(
            orderVm.window.SWEEPR_CHECKOUT_CURRENCY,
            cur.toUpperCase(),
            `/order?currency=${cur} must set SWEEPR_CHECKOUT_CURRENCY`
          );
          const totalTodayText = orderVm.document.getElementById("totalTodayText")?.textContent ?? "";
          assert.equal(
            totalTodayText,
            loc.annualFormatted,
            `/order?currency=${cur} totalTodayText mismatch: got "${totalTodayText}", expected "${loc.annualFormatted}"`
          );
          const perDevText = orderVm.document.getElementById("o2MobileAnnualPerDevice")?.textContent ?? "";
          assert.ok(
            perDevText.includes(loc.symbol),
            `/order?currency=${cur} per-device callout must contain localized symbol "${loc.symbol}": got "${perDevText}"`
          );
          if (cur !== "gbp") {
            assert.equal(
              perDevText.includes("£0.83"),
              false,
              `/order?currency=${cur} must not leak hardcoded GBP £0.83 in per-device callout`
            );
          }
        } finally {
          orderVm.dispose();
        }
      }
    } finally {
      close();
    }
  });

  test("T5-ADV-6: DevTools tampered <select> & ?currency=__proto__ fuzzing across /, /pricing, /order", async () => {
    const { app, close } = setup();
    try {
      // 1. Tampered <select> on /
      const homeVm = await mountHtmlInVm(app, "/?currency=__proto__");
      try {
        assert.equal(homeVm.runtimeErrors.length, 0, `Runtime errors on /?currency=__proto__: ${homeVm.runtimeErrors}`);
        const sel = homeVm.document.getElementById("globalCurrencySelect") as FakeElement;
        sel.forceTamperedSelectValue("__proto__");
        sel.dispatchEvent("change");
        await new Promise((r) => setTimeout(r, 40));
        assert.equal(homeVm.runtimeErrors.length, 0, `Runtime errors after tampered select change on /: ${homeVm.runtimeErrors}`);
        assert.ok(homeVm.document.getElementById("giantPriceFigure")?.textContent.includes("£49.99"), "Tampered / select must fall back to GBP £49.99");
        const jsonLd = JSON.parse(homeVm.document.getElementById("softwareAppJsonLd")?.textContent || "{}");
        assert.equal(jsonLd.offers[0].priceCurrency, "GBP");
      } finally {
        homeVm.dispose();
      }

      // 2. Tampered <select> on /pricing
      const pricingVm = await mountHtmlInVm(app, "/pricing?currency=constructor");
      try {
        assert.equal(pricingVm.runtimeErrors.length, 0, `Runtime errors on /pricing?currency=constructor: ${pricingVm.runtimeErrors}`);
        const sel = pricingVm.document.getElementById("pricingCurrencySelect") as FakeElement;
        sel.forceTamperedSelectValue("__proto__");
        sel.dispatchEvent("change");
        await new Promise((r) => setTimeout(r, 40));
        assert.equal(pricingVm.runtimeErrors.length, 0, `Runtime errors after tampered select change on /pricing: ${pricingVm.runtimeErrors}`);
        assert.ok(pricingVm.document.getElementById("pGiantFigure")?.textContent.includes("£49.99"), "Tampered /pricing select must fall back to GBP £49.99");
        const jsonLd = JSON.parse(pricingVm.document.getElementById("pricingProductJsonLd")?.textContent || "{}");
        assert.equal(jsonLd.offers[0].priceCurrency, "GBP");
      } finally {
        pricingVm.dispose();
      }

      // 3. Fuzzing /order?currency=__proto__
      const orderVm = await mountHtmlInVm(app, "/order?currency=__proto__");
      try {
        assert.equal(orderVm.runtimeErrors.length, 0, `Runtime errors on /order?currency=__proto__: ${orderVm.runtimeErrors}`);
        assert.equal(orderVm.window.SWEEPR_CHECKOUT_CURRENCY, "GBP", "/order?currency=__proto__ must fall back to GBP");
      } finally {
        orderVm.dispose();
      }
    } finally {
      close();
    }
  });

  test("T5-ADV-7: 10-UA crawler spoofing matrix with non-UK timezones & Linux platform keeps Windows CTA + GBP JSON-LD parity", async () => {
    const { app, close } = setup();
    const botUAs = [
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Googlebot-Mobile/2.1 (Android; Linux)",
      "AdsBot-Google-Mobile (+http://www.google.com/mobile/adsbot.html) Mozilla/5.0 (iPhone; CPU iPhone OS 14_7 like Mac OS X)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Google-InspectionTool/1.0",
      "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 GoogleOther",
      "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Applebot/0.1",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36",
      "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
      "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
    ];

    try {
      for (const ua of botUAs) {
        const homeVm = await mountHtmlInVm(app, "/", {
          userAgent: ua,
          platform: "Linux x86_64",
          timeZone: "America/Los_Angeles",
        });
        try {
          assert.equal(homeVm.runtimeErrors.length, 0, `Bot VM errors for UA=${ua}: ${homeVm.runtimeErrors}`);
          const primaryCta = homeVm.document.getElementById("primaryDownloadCta");
          assert.ok(primaryCta, "primaryDownloadCta must exist");
          assert.equal(
            primaryCta.getAttribute("href"),
            "/download?platform=windows",
            `Crawler UA=${ua} must retain Windows SSR CTA`
          );
          const allDownloadLinks = homeVm.root
            .querySelectorAll("a[href]")
            .map((a: FakeElement) => a.getAttribute("href") ?? "");
          assert.equal(
            allDownloadLinks.some((h: string) => h.includes("platform=android") || h.includes("platform=linux")),
            false,
            `Crawler UA=${ua} must not have Android or Linux download CTA hijack`
          );
          assert.ok(
            homeVm.document.getElementById("giantPriceFigure")?.textContent.includes("£49.99"),
            `Crawler UA=${ua} must keep GBP £49.99 matching SSR JSON-LD`
          );
          const jsonLd = JSON.parse(homeVm.document.getElementById("softwareAppJsonLd")?.textContent || "{}");
          assert.equal(jsonLd.offers[0].priceCurrency, "GBP");
        } finally {
          homeVm.dispose();
        }
      }
    } finally {
      close();
    }
  });

  test("T5-ADV-8: /order explicit consent cannot be bypassed across all payment methods, wallets, Stripe prButton, or exit modal", async () => {
    const { app, close } = setup();
    let prButtonClickHandlers: Array<(ev: any) => void> = [];
    const mockStripeFactory = () => ({
      elements: () => ({
        create: (type: string) => {
          if (type === "paymentRequestButton") {
            return {
              mount: () => {},
              on: (evName: string, fn: (ev: any) => void) => {
                if (evName === "click") prButtonClickHandlers.push(fn);
              },
            };
          }
          return { mount: () => {}, on: () => {} };
        },
      }),
      paymentRequest: () => ({
        canMakePayment: async () => ({ applePay: true }),
        update: () => {},
        on: () => {},
        show: () => {},
      }),
    });

    try {
      const orderVm = await mountHtmlInVm(app, "/order", {
        mockFetch: async (url) => {
          if (url.startsWith("/api/checkout-config")) {
            const payload = {
              publishableKey: "pk_test_mock_123",
              elementsEnabled: true,
              isLiveStripe: false,
              currency: "gbp",
              country: "GB",
              pricing: PRICING_BY_CURRENCY.gbp,
            };
            return { ok: true, status: 200, text: async () => JSON.stringify(payload), json: async () => payload };
          }
          return null;
        },
        extraGlobals: { Stripe: mockStripeFactory },
      });

      try {
        const terms = orderVm.document.getElementById("termsConsent") as FakeElement;
        const legal = orderVm.document.getElementById("legalConsent") as FakeElement;
        const email = orderVm.document.getElementById("email") as FakeElement;
        email.value = "consent-test@example.com";

        const subscriptionPosts = () =>
          orderVm.fetchCalls.filter((c) => c.url.includes("/api/create-subscription") || c.url.includes("/api/paypal"));

        // Case A: Both unchecked -> test every payment method + express wallets + modal claim + prButton
        assert.equal(terms.checked, false);
        assert.equal(legal.checked, false);

        for (const method of ["card", "paypal", "revolut_pay", "amazon_pay", "ideal", "bancontact", "kakao_pay", "naver_pay"]) {
          orderVm.window.selectPaymentLogoMethod(method, false);
          await orderVm.window.triggerCheckout(method, false);
          assert.equal(terms.checked, false, `Method ${method} must not force termsConsent.checked`);
          assert.equal(legal.checked, false, `Method ${method} must not force legalConsent.checked`);
        }

        orderVm.window.triggerExpressWallet();
        orderVm.window.triggerApplePay();
        orderVm.window.activateDiscountOffer(false);
        await orderVm.window.triggerCheckout("card", false);

        assert.ok(prButtonClickHandlers.length >= 1, "Stripe prButton click handler must be registered");
        for (const handler of prButtonClickHandlers) {
          let prevented = false;
          handler({ preventDefault: () => { prevented = true; } });
          assert.equal(prevented, true, "Stripe prButton click without consent must call ev.preventDefault()");
        }

        assert.equal(subscriptionPosts().length, 0, "Zero checkout API calls allowed when both consent boxes unchecked");

        // Case B: Only termsConsent checked, legalConsent unchecked
        terms.checked = true;
        legal.checked = false;
        await orderVm.window.triggerCheckout("card", false);
        assert.equal(legal.checked, false, "Must not auto-check legalConsent");
        assert.equal(subscriptionPosts().length, 0, "Zero checkout API calls allowed when legalConsent unchecked");

        // Case C: Only legalConsent checked, termsConsent unchecked
        terms.checked = false;
        legal.checked = true;
        await orderVm.window.triggerCheckout("paypal", true);
        assert.equal(terms.checked, false, "Must not auto-check termsConsent");
        assert.equal(subscriptionPosts().length, 0, "Zero checkout API calls allowed when termsConsent unchecked");
      } finally {
        orderVm.dispose();
      }
    } finally {
      close();
    }
  });

  test("T5-ADV-9: ?plan=annual overrides stale intro draft while ?plan=monthly&intro=1 and ?plan=intro activate intro", async () => {
    const { app, close } = setup();
    try {
      const staleDraft = JSON.stringify({
        updatedAt: Date.now(),
        plan: "monthly",
        isDiscountApplied: true,
        email: "draft@example.com",
      });

      // 1. Explicit ?plan=annual must NOT be overridden by stale intro draft
      const annualVm = await mountHtmlInVm(app, "/order?plan=annual", {
        sessionStorage: { sweepr_order_draft: staleDraft },
      });
      try {
        assert.equal(annualVm.runtimeErrors.length, 0);
        const totalText = annualVm.document.getElementById("totalTodayText")?.textContent ?? "";
        assert.ok(totalText.includes("49.99"), `?plan=annual must show £49.99, got "${totalText}"`);
      } finally {
        annualVm.dispose();
      }

      // 2. Explicit ?plan=monthly&intro=1 activates £1.99 intro
      const introQueryVm = await mountHtmlInVm(app, "/order?plan=monthly&intro=1");
      try {
        assert.equal(introQueryVm.runtimeErrors.length, 0);
        const totalText = introQueryVm.document.getElementById("totalTodayText")?.textContent ?? "";
        assert.ok(totalText.includes("1.99"), `?plan=monthly&intro=1 must show £1.99, got "${totalText}"`);
      } finally {
        introQueryVm.dispose();
      }

      // 3. Explicit ?plan=intro activates £1.99 intro
      const planIntroVm = await mountHtmlInVm(app, "/order?plan=intro");
      try {
        assert.equal(planIntroVm.runtimeErrors.length, 0);
        const totalText = planIntroVm.document.getElementById("totalTodayText")?.textContent ?? "";
        assert.ok(totalText.includes("1.99"), `?plan=intro must show £1.99, got "${totalText}"`);
      } finally {
        planIntroVm.dispose();
      }
    } finally {
      close();
    }
  });

  test("T5-ADV-10: i18n-dict.js hygiene across all 7 languages & /de/pricing VM render", async () => {
    const dictSrc = readFileSync(resolve(SERVER_PUBLIC, "i18n-dict.js"), "utf8");
    const dictCtx: any = { window: {} };
    vm.runInNewContext(dictSrc, dictCtx);
    const dict = dictCtx.window.SWEEPR_I18N_DICTIONARY as Record<string, Record<string, string>>;
    const expectedLangs = ["de", "fr", "es", "it", "pt", "nl", "ja"];
    assert.deepEqual(Object.keys(dict).sort(), [...expectedLangs].sort());

    const staleRe =
      /SWEEPR Cleaner Inc|SWEEPR Cleaner Team|24\/7|Our team|Unser Team|Notre équipe|Nuestro equipo|Il nostro team|Nossa equipe|Ons team|サポートチーム|support team|Support-Team|équipe de support|equipo de soporte|team di supporto|equipe de suporte|supportteam|3 Devices|3 Geräte|3 appareils|3 dispositivos|3 dispositivi|3 apparaten|3台|3 PCs|60-Second|60-Sekunden|60 secondes|60 segundos|60 secondi|60 seconden|60秒|\b60s\b|under 60|unter 60|moins de 60|menos de 60|meno di 60|minder dan 60|60秒未満|\bLinux\b|zero background|Null Hintergrund|Zero background|zero telemetry|Null Telemetrie|keine Hintergrund|Aucune télémétrie|Cero telemetría|Zero telemetria|Geen achtergrond|No Telemetry|Zero Telemetry|\b5 MB\b/i;

    for (const lang of expectedLangs) {
      const entries = Object.entries(dict[lang]);
      assert.ok(entries.length >= 400, `${lang} dictionary must retain core translations`);
      for (const [k, v] of entries) {
        assert.equal(staleRe.test(k), false, `Stale i18n key in ${lang}: ${k}`);
        assert.equal(staleRe.test(v), false, `Stale i18n value in ${lang}: ${k} => ${v}`);
      }
      assert.ok(dict[lang]["✓ Up to 5 Devices"], `${lang} must translate 5-device entitlement`);
      assert.ok(dict[lang]["Unlimited Temp & Browser Cache Clean"], `${lang} must translate Unlimited Temp & Browser Cache Clean`);
    }

    const { app, close } = setup();
    try {
      const localizedExpected: Array<[string, string, string]> = [
        ["/de/pricing", "de", "Preise"],
        ["/fr/pricing", "fr", "Tarifs"],
        ["/es/pricing", "es", "Precios"],
      ];
      for (const [route, expectedLang, expectedNavTranslation] of localizedExpected) {
        const localizedVm = await mountHtmlInVm(app, route);
        try {
          assert.equal(localizedVm.runtimeErrors.length, 0, `Localized VM errors on ${route}: ${localizedVm.runtimeErrors}`);
          assert.ok(
            localizedVm.window.SWEEPR_I18N_DICTIONARY?.[expectedLang],
            `${route} must dynamically load /i18n-dict.js via sc.onload`
          );
          assert.equal(
            localizedVm.document.documentElement.lang,
            expectedLang,
            `${route} must set html.lang=${expectedLang}`
          );
          const bodyText = localizedVm.document.body?.textContent ?? "";
          assert.ok(
            bodyText.includes(expectedNavTranslation),
            `${route} must translate DOM text with "${expectedNavTranslation}"`
          );
        } finally {
          localizedVm.dispose();
        }
      }
    } finally {
      close();
    }
  });

  test("T5-ADV-11: analytics.js, /dashboard, /login & /delete-account sole-trader entity & binary size parity", async () => {
    const { app, close } = setup();
    try {
      const analyticsRes = await app.request("/analytics.js");
      assert.equal(analyticsRes.status, 200);
      const analyticsJs = await analyticsRes.text();
      assertNoForbiddenEntity(analyticsJs, "/analytics.js");
      assert.equal(/\b5\s*MB\s+native\s+Rust/i.test(analyticsJs), false, "/analytics.js must not state stale 5 MB binary size");
      assert.match(analyticsJs, /6\.76\s*MB\s+native\s+Rust/i);

      for (const route of ["/dashboard", "/login", "/delete-account"]) {
        const res = await app.request(route);
        assert.equal(res.status, 200, `${route} must return 200`);
        const html = await res.text();
        assertNoForbiddenEntity(html, route);
        assert.equal(/\b3\s*devices\b/i.test(html), false, `${route} must not claim stale 3 devices`);
        assert.equal(/\b5\s*MB\b/i.test(html), false, `${route} must not state stale 5 MB installer size`);
      }
    } finally {
      close();
    }
  });

  test("T5-ADV-12: Active switcher integrity, pricing cell binding & rel=nofollow discipline", async () => {
    const { app, close } = setup();
    const activeSwitchers = [
      "/vs/ccleaner", "/vs/cleanmymac", "/vs/bleachbit", "/vs/avast-cleanup",
      "/vs/cleanmypc", "/vs/glary-utilities", "/vs/wise-disk-cleaner", "/vs/daisydisk", "/vs/pearcleaner", "/vs/onyx",
      "/alternatives/ccleaner", "/alternatives/cleanmymac", "/alternatives/bleachbit",
      "/alternatives/avast-cleanup", "/alternatives/cleanmypc", "/alternatives/glary-utilities", "/alternatives/wise-disk-cleaner",
      "/alternatives/daisydisk", "/alternatives/pearcleaner", "/alternatives/onyx",
    ];

    try {
      for (const route of activeSwitchers) {
        const res = await app.request(route);
        assert.equal(res.status, 200, `${route} must return 200`);
        const html = await res.text();
        assertNoForbiddenEntity(html, route);
        assert.match(
          html,
          /<a\b[^>]*href="\/pricing"[^>]*>[\s\S]*?<span\b[^>]*data-sweepr-pricing-cell/i,
          `${route} must bind data-sweepr-pricing-cell inside <a href="/pricing">`
        );

        for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
          const tag = m[0];
          const hrefMatch = tag.match(/\bhref="([^"]+)"/i);
          if (!hrefMatch) continue;
          const href = decodeBasicEntities(hrefMatch[1]);
          if (href === "/download") {
            assert.doesNotMatch(tag, /\brel="nofollow"/i, `${route} clean /download must omit rel="nofollow": ${tag}`);
          } else if (href.startsWith("/download?") || href === "/order" || href.startsWith("/order?")) {
            assert.match(tag, /\brel="nofollow"/i, `${route} parameterized/order CTA must include rel="nofollow": ${tag}`);
          }
        }
      }
    } finally {
      close();
    }
  });
});

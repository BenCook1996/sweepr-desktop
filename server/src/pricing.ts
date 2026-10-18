import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

export interface RawCurrencyTier {
  currency: string;
  currencyCode: string;
  symbol: string;
  symbolPosition: "prefix" | "suffix";
  zeroDecimal: boolean;
  annualAmount: number;
  sixMonthAmount: number;
  monthlyAmount: number;
  introMonthlyAmount: number;
}

export interface LocalizedPlanPricing {
  country: string;
  countryFlag: string;
  language: string;
  currency: string;
  currencyCode: string;
  symbol: string;
  symbolPosition: "prefix" | "suffix";
  zeroDecimal: boolean;
  annualAmount: number;
  annualFormatted: string;
  annualMonthlyEqFormatted: string;
  annualRegularTotalFormatted: string;
  annualSavingsAmountFormatted: string;
  annualSavingsPercent: number;
  sixMonthAmount: number;
  sixMonthFormatted: string;
  sixMonthMonthlyEqFormatted: string;
  sixMonthRegularTotalFormatted: string;
  sixMonthSavingsAmountFormatted: string;
  sixMonthSavingsPercent: number;
  monthlyAmount: number;
  monthlyFormatted: string;
  introMonthlyAmount: number;
  introMonthlyFormatted: string;
  introSavingsAmount: number;
  introSavingsFormatted: string;
}

export const PRICING_BY_CURRENCY: Record<string, RawCurrencyTier> = {
  usd: {
    currency: "usd",
    currencyCode: "USD",
    symbol: "$",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 6499,
    sixMonthAmount: 4799,
    monthlyAmount: 1199,
    introMonthlyAmount: 199,
  },
  gbp: {
    currency: "gbp",
    currencyCode: "GBP",
    symbol: "£",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 4999,
    sixMonthAmount: 3699,
    monthlyAmount: 899,
    introMonthlyAmount: 199,
  },
  eur: {
    currency: "eur",
    currencyCode: "EUR",
    symbol: "€",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 5999,
    sixMonthAmount: 4499,
    monthlyAmount: 1099,
    introMonthlyAmount: 199,
  },
  cad: {
    currency: "cad",
    currencyCode: "CAD",
    symbol: "CA$",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 8999,
    sixMonthAmount: 6499,
    monthlyAmount: 1599,
    introMonthlyAmount: 299,
  },
  aud: {
    currency: "aud",
    currencyCode: "AUD",
    symbol: "A$",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 9999,
    sixMonthAmount: 7499,
    monthlyAmount: 1799,
    introMonthlyAmount: 299,
  },
  nzd: {
    currency: "nzd",
    currencyCode: "NZD",
    symbol: "NZ$",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 10999,
    sixMonthAmount: 7999,
    monthlyAmount: 1999,
    introMonthlyAmount: 299,
  },
  chf: {
    currency: "chf",
    currencyCode: "CHF",
    symbol: "CHF ",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 5999,
    sixMonthAmount: 4499,
    monthlyAmount: 1099,
    introMonthlyAmount: 199,
  },
  sek: {
    currency: "sek",
    currencyCode: "SEK",
    symbol: " kr",
    symbolPosition: "suffix",
    zeroDecimal: false,
    annualAmount: 69999,
    sixMonthAmount: 51999,
    monthlyAmount: 12999,
    introMonthlyAmount: 1999,
  },
  nok: {
    currency: "nok",
    currencyCode: "NOK",
    symbol: " kr",
    symbolPosition: "suffix",
    zeroDecimal: false,
    annualAmount: 69999,
    sixMonthAmount: 51999,
    monthlyAmount: 12999,
    introMonthlyAmount: 1999,
  },
  dkk: {
    currency: "dkk",
    currencyCode: "DKK",
    symbol: " kr.",
    symbolPosition: "suffix",
    zeroDecimal: false,
    annualAmount: 44999,
    sixMonthAmount: 32999,
    monthlyAmount: 8499,
    introMonthlyAmount: 1499,
  },
  pln: {
    currency: "pln",
    currencyCode: "PLN",
    symbol: " zł",
    symbolPosition: "suffix",
    zeroDecimal: false,
    annualAmount: 25999,
    sixMonthAmount: 18999,
    monthlyAmount: 4799,
    introMonthlyAmount: 799,
  },
  czk: {
    currency: "czk",
    currencyCode: "CZK",
    symbol: " Kč",
    symbolPosition: "suffix",
    zeroDecimal: false,
    annualAmount: 149999,
    sixMonthAmount: 109999,
    monthlyAmount: 27999,
    introMonthlyAmount: 4999,
  },
  ron: {
    currency: "ron",
    currencyCode: "RON",
    symbol: " lei",
    symbolPosition: "suffix",
    zeroDecimal: false,
    annualAmount: 29999,
    sixMonthAmount: 21999,
    monthlyAmount: 5499,
    introMonthlyAmount: 999,
  },
  bgn: {
    currency: "bgn",
    currencyCode: "BGN",
    symbol: " лв.",
    symbolPosition: "suffix",
    zeroDecimal: false,
    annualAmount: 11999,
    sixMonthAmount: 8999,
    monthlyAmount: 2199,
    introMonthlyAmount: 399,
  },
  try: {
    currency: "try",
    currencyCode: "TRY",
    symbol: "₺",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 219999,
    sixMonthAmount: 164999,
    monthlyAmount: 39999,
    introMonthlyAmount: 6999,
  },
  jpy: {
    currency: "jpy",
    currencyCode: "JPY",
    symbol: "¥",
    symbolPosition: "prefix",
    zeroDecimal: true,
    annualAmount: 9980,
    sixMonthAmount: 7480,
    monthlyAmount: 1880,
    introMonthlyAmount: 290,
  },
  krw: {
    currency: "krw",
    currencyCode: "KRW",
    symbol: "₩",
    symbolPosition: "prefix",
    zeroDecimal: true,
    annualAmount: 89900,
    sixMonthAmount: 65900,
    monthlyAmount: 16900,
    introMonthlyAmount: 2900,
  },
  sgd: {
    currency: "sgd",
    currencyCode: "SGD",
    symbol: "S$",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 8499,
    sixMonthAmount: 6299,
    monthlyAmount: 1599,
    introMonthlyAmount: 299,
  },
  hkd: {
    currency: "hkd",
    currencyCode: "HKD",
    symbol: "HK$",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 49999,
    sixMonthAmount: 36999,
    monthlyAmount: 9499,
    introMonthlyAmount: 1599,
  },
  twd: {
    currency: "twd",
    currencyCode: "TWD",
    symbol: "NT$",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 209999,
    sixMonthAmount: 154999,
    monthlyAmount: 38999,
    introMonthlyAmount: 6499,
  },
  inr: {
    currency: "inr",
    currencyCode: "INR",
    symbol: "₹",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 549999,
    sixMonthAmount: 399999,
    monthlyAmount: 99999,
    introMonthlyAmount: 16999,
  },
  brl: {
    currency: "brl",
    currencyCode: "BRL",
    symbol: "R$ ",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 34999,
    sixMonthAmount: 25999,
    monthlyAmount: 6499,
    introMonthlyAmount: 999,
  },
  mxn: {
    currency: "mxn",
    currencyCode: "MXN",
    symbol: "MX$",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 129999,
    sixMonthAmount: 94999,
    monthlyAmount: 23999,
    introMonthlyAmount: 3999,
  },
  zar: {
    currency: "zar",
    currencyCode: "ZAR",
    symbol: "R ",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 114999,
    sixMonthAmount: 84999,
    monthlyAmount: 20999,
    introMonthlyAmount: 3499,
  },
  aed: {
    currency: "aed",
    currencyCode: "AED",
    symbol: "AED ",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 23999,
    sixMonthAmount: 17999,
    monthlyAmount: 4499,
    introMonthlyAmount: 799,
  },
  sar: {
    currency: "sar",
    currencyCode: "SAR",
    symbol: "SAR ",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 24499,
    sixMonthAmount: 17999,
    monthlyAmount: 4499,
    introMonthlyAmount: 799,
  },
  ils: {
    currency: "ils",
    currencyCode: "ILS",
    symbol: "₪",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 24499,
    sixMonthAmount: 17999,
    monthlyAmount: 4499,
    introMonthlyAmount: 799,
  },
  myr: {
    currency: "myr",
    currencyCode: "MYR",
    symbol: "RM",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 27999,
    sixMonthAmount: 20999,
    monthlyAmount: 5199,
    introMonthlyAmount: 899,
  },
  thb: {
    currency: "thb",
    currencyCode: "THB",
    symbol: "฿",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 219999,
    sixMonthAmount: 159999,
    monthlyAmount: 39999,
    introMonthlyAmount: 6999,
  },
  php: {
    currency: "php",
    currencyCode: "PHP",
    symbol: "₱",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 369999,
    sixMonthAmount: 274999,
    monthlyAmount: 68999,
    introMonthlyAmount: 11999,
  },
};

export const COUNTRY_TO_CURRENCY: Record<string, string> = {
  // United States & USD-using territories/countries
  US: "usd", PR: "usd", VI: "usd", GU: "usd", AS: "usd", MP: "usd",
  EC: "usd", SV: "usd", PA: "usd", ZW: "usd", TL: "usd", BS: "usd",
  BB: "usd", BM: "usd", VG: "usd", KY: "usd", TC: "usd", KH: "usd",
  LR: "usd", MH: "usd", FM: "usd", PW: "usd",
  // United Kingdom & Crown Dependencies
  GB: "gbp", UK: "gbp", IM: "gbp", JE: "gbp", GG: "gbp", GI: "gbp", FK: "gbp",
  // Eurozone & European countries
  DE: "eur", FR: "eur", ES: "eur", IT: "eur", NL: "eur", BE: "eur",
  AT: "eur", IE: "eur", PT: "eur", FI: "eur", GR: "eur", LU: "eur",
  MT: "eur", CY: "eur", SK: "eur", SI: "eur", EE: "eur", LV: "eur",
  LT: "eur", HR: "eur", AD: "eur", MC: "eur", SM: "eur", VA: "eur",
  ME: "eur", XK: "eur", AL: "eur", BA: "eur", MK: "eur", RS: "eur",
  IS: "eur", UA: "eur", MD: "eur", HU: "eur",
  // Other specific currencies
  CA: "cad",
  AU: "aud", CX: "aud", CC: "aud", NF: "aud", NR: "aud", TV: "aud", KI: "aud",
  NZ: "nzd", CK: "nzd", NU: "nzd", PN: "nzd", TK: "nzd",
  CH: "chf", LI: "chf",
  SE: "sek",
  NO: "nok",
  DK: "dkk", FO: "dkk", GL: "dkk",
  PL: "pln",
  CZ: "czk",
  RO: "ron",
  BG: "bgn",
  TR: "try",
  JP: "jpy",
  KR: "krw",
  SG: "sgd",
  HK: "hkd", MO: "hkd",
  TW: "twd",
  IN: "inr",
  BR: "brl",
  MX: "mxn",
  ZA: "zar", NA: "zar", LS: "zar", SZ: "zar",
  AE: "aed",
  SA: "sar",
  IL: "ils",
  MY: "myr",
  TH: "thb",
  PH: "php",
};

export const COUNTRY_TO_LANG: Record<string, string> = {
  // German
  DE: "de", AT: "de", CH: "de", LI: "de",
  // French
  FR: "fr", MC: "fr", BE: "fr", LU: "fr",
  // Spanish
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es",
  EC: "es", VE: "es", UY: "es", PY: "es", BO: "es", CR: "es",
  PA: "es", DO: "es", GT: "es", HN: "es", SV: "es", NI: "es", PR: "es",
  // Italian
  IT: "it", SM: "it", VA: "it",
  // Portuguese
  PT: "pt", BR: "pt", AO: "pt", MZ: "pt",
  // Dutch
  NL: "nl", SR: "nl",
  // Japanese
  JP: "ja",
};

export function countryCodeToFlag(country: string): string {
  const c = (country || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "🇺🇸";
  const codePoints = [c.charCodeAt(0) + 127397, c.charCodeAt(1) + 127397];
  return String.fromCodePoint(...codePoints);
}

export function formatCurrencyAmount(tier: RawCurrencyTier, amount: number): string {
  const numStr = tier.zeroDecimal
    ? Math.round(amount).toLocaleString("en-US")
    : (amount / 100).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
  return tier.symbolPosition === "suffix" ? `${numStr}${tier.symbol}` : `${tier.symbol}${numStr}`;
}

export function getPricingForCountryOrCurrency(
  countryInput?: string | null,
  currencyInput?: string | null
): LocalizedPlanPricing {
  const rawCountry = (countryInput || "").trim().toUpperCase();
  const country = /^[A-Z]{2}$/.test(rawCountry) && rawCountry !== "XX" ? rawCountry : "US";
  const normCountry = country === "UK" ? "GB" : country;

  const rawCurrency = (currencyInput || "").trim().toLowerCase();
  const resolvedCurrencyKey =
    (rawCurrency && PRICING_BY_CURRENCY[rawCurrency] ? rawCurrency : null) ||
    COUNTRY_TO_CURRENCY[normCountry] ||
    "usd";

  const tier = PRICING_BY_CURRENCY[resolvedCurrencyKey] || PRICING_BY_CURRENCY.usd;
  const language = COUNTRY_TO_LANG[normCountry] || "en";
  const countryFlag = countryCodeToFlag(normCountry);

  const annualMonthlyEq = tier.zeroDecimal
    ? Math.floor(tier.annualAmount / 12)
    : Math.floor(tier.annualAmount / 12);
  const annualRegularTotal = tier.monthlyAmount * 12;
  const annualSavingsAmount = annualRegularTotal - tier.annualAmount;
  const annualSavingsPercent = Math.round((1 - tier.annualAmount / annualRegularTotal) * 100);

  const sixMonthMonthlyEq = tier.zeroDecimal
    ? Math.floor(tier.sixMonthAmount / 6)
    : Math.floor(tier.sixMonthAmount / 6);
  const sixMonthRegularTotal = tier.monthlyAmount * 6;
  const sixMonthSavingsAmount = sixMonthRegularTotal - tier.sixMonthAmount;
  const sixMonthSavingsPercent = Math.round((1 - tier.sixMonthAmount / sixMonthRegularTotal) * 100);

  const introSavingsAmount = tier.monthlyAmount - tier.introMonthlyAmount;

  return {
    country: normCountry,
    countryFlag,
    language,
    currency: tier.currency,
    currencyCode: tier.currencyCode,
    symbol: tier.symbol,
    symbolPosition: tier.symbolPosition,
    zeroDecimal: tier.zeroDecimal,
    annualAmount: tier.annualAmount,
    annualFormatted: formatCurrencyAmount(tier, tier.annualAmount),
    annualMonthlyEqFormatted: formatCurrencyAmount(tier, annualMonthlyEq),
    annualRegularTotalFormatted: formatCurrencyAmount(tier, annualRegularTotal),
    annualSavingsAmountFormatted: formatCurrencyAmount(tier, annualSavingsAmount),
    annualSavingsPercent,
    sixMonthAmount: tier.sixMonthAmount,
    sixMonthFormatted: formatCurrencyAmount(tier, tier.sixMonthAmount),
    sixMonthMonthlyEqFormatted: formatCurrencyAmount(tier, sixMonthMonthlyEq),
    sixMonthRegularTotalFormatted: formatCurrencyAmount(tier, sixMonthRegularTotal),
    sixMonthSavingsAmountFormatted: formatCurrencyAmount(tier, sixMonthSavingsAmount),
    sixMonthSavingsPercent,
    monthlyAmount: tier.monthlyAmount,
    monthlyFormatted: formatCurrencyAmount(tier, tier.monthlyAmount),
    introMonthlyAmount: tier.introMonthlyAmount,
    introMonthlyFormatted: formatCurrencyAmount(tier, tier.introMonthlyAmount),
    introSavingsAmount,
    introSavingsFormatted: formatCurrencyAmount(tier, introSavingsAmount),
  };
}

const ipCountryCache = new Map<string, { country: string; expiresAt: number }>();

function isPrivateOrLoopbackIp(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/i, "").trim();
  if (!clean || clean === "local" || clean === "127.0.0.1" || clean === "::1" || clean === "0.0.0.0") {
    return true;
  }
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(clean)) {
    return true;
  }
  return false;
}

export async function lookupCountryByIp(rawIp: string): Promise<string | null> {
  const ip = rawIp.replace(/^::ffff:/i, "").trim();
  const isLocal = isPrivateOrLoopbackIp(ip);
  const cacheKey = isLocal ? "__local_outbound__" : ip;
  const nowMs = Date.now();
  const cached = ipCountryCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) {
    return cached.country;
  }

  // In unit tests (http://test), skip external network calls
  if (ip === "local") return null;

  const ttlMs = isLocal ? 15_000 : 10 * 60_000;
  try {
    const url = isLocal ? "https://api.country.is/" : `https://api.country.is/${encodeURIComponent(ip)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const data: any = await res.json();
      const c = String(data?.country || "").trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(c)) {
        ipCountryCache.set(cacheKey, { country: c, expiresAt: nowMs + ttlMs });
        return c;
      }
    }
  } catch {
    // Fallback to geojs.io
  }

  try {
    const url = isLocal
      ? "https://get.geojs.io/v1/ip/country.json"
      : `https://get.geojs.io/v1/ip/country/${encodeURIComponent(ip)}.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const data: any = await res.json();
      const c = String(data?.country || "").trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(c)) {
        ipCountryCache.set(cacheKey, { country: c, expiresAt: nowMs + ttlMs });
        return c;
      }
    }
  } catch {
    // Ignore geo lookup failure
  }

  return null;
}

export async function resolvePricingForRequest(
  c: Context,
  bodyOverride?: { country?: string; currency?: string }
): Promise<LocalizedPlanPricing> {
  const queryCountry = c.req.query("country") || bodyOverride?.country;
  const queryCurrency = c.req.query("currency") || bodyOverride?.currency;

  if (queryCountry || queryCurrency) {
    return getPricingForCountryOrCurrency(queryCountry, queryCurrency);
  }

  const headerCountry =
    c.req.header("cf-ipcountry") ||
    c.req.header("x-vercel-ip-country") ||
    c.req.header("x-country-code") ||
    c.req.header("cloudfront-viewer-country") ||
    c.req.header("x-appengine-country");

  if (headerCountry && /^[A-Za-z]{2}$/.test(headerCountry.trim()) && headerCountry.trim().toUpperCase() !== "XX") {
    return getPricingForCountryOrCurrency(headerCountry.trim().toUpperCase(), null);
  }

  // Extract visitor IP from proxy headers or connection info
  const forwardedIp =
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip")?.trim();

  let ip = forwardedIp || "";
  if (!ip) {
    try {
      ip = getConnInfo(c).remote.address ?? "local";
    } catch {
      ip = "local";
    }
  }

  const lookedUp = await lookupCountryByIp(ip);
  if (lookedUp) {
    return getPricingForCountryOrCurrency(lookedUp, null);
  }

  return getPricingForCountryOrCurrency("US", "usd");
}

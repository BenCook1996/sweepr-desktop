import { isIP } from "node:net";
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
  batteryCareAnnualAmount: number;
  batteryCareSixMonthAmount: number;
  batteryCareMonthlyAmount: number;
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
  batteryCareAnnualAmount: number;
  batteryCareAnnualFormatted: string;
  batteryCareAnnualMonthlyEqFormatted: string;
  batteryCareSixMonthAmount: number;
  batteryCareSixMonthFormatted: string;
  batteryCareSixMonthMonthlyEqFormatted: string;
  batteryCareMonthlyAmount: number;
  batteryCareMonthlyFormatted: string;
  cloudVaultAnnualAmount: number;
  cloudVaultAnnualFormatted: string;
  cloudVaultAnnualMonthlyEqFormatted: string;
  cloudVaultSixMonthAmount: number;
  cloudVaultSixMonthFormatted: string;
  cloudVaultSixMonthMonthlyEqFormatted: string;
  cloudVaultMonthlyAmount: number;
  cloudVaultMonthlyFormatted: string;
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
    batteryCareAnnualAmount: 999,
    batteryCareSixMonthAmount: 699,
    batteryCareMonthlyAmount: 199,
  },
  gbp: {
    currency: "gbp",
    currencyCode: "GBP",
    symbol: "£",
    symbolPosition: "prefix",
    zeroDecimal: false,
    annualAmount: 4999,
    sixMonthAmount: 3899,
    monthlyAmount: 999,
    introMonthlyAmount: 199,
    batteryCareAnnualAmount: 999,
    batteryCareSixMonthAmount: 699,
    batteryCareMonthlyAmount: 199,
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
    batteryCareAnnualAmount: 999,
    batteryCareSixMonthAmount: 699,
    batteryCareMonthlyAmount: 199,
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
    batteryCareAnnualAmount: 1499,
    batteryCareSixMonthAmount: 999,
    batteryCareMonthlyAmount: 299,
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
    batteryCareAnnualAmount: 1599,
    batteryCareSixMonthAmount: 1099,
    batteryCareMonthlyAmount: 299,
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
    batteryCareAnnualAmount: 1799,
    batteryCareSixMonthAmount: 1199,
    batteryCareMonthlyAmount: 349,
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
    batteryCareAnnualAmount: 999,
    batteryCareSixMonthAmount: 699,
    batteryCareMonthlyAmount: 199,
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
    batteryCareAnnualAmount: 11999,
    batteryCareSixMonthAmount: 7999,
    batteryCareMonthlyAmount: 1999,
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
    batteryCareAnnualAmount: 11999,
    batteryCareSixMonthAmount: 7999,
    batteryCareMonthlyAmount: 1999,
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
    batteryCareAnnualAmount: 7999,
    batteryCareSixMonthAmount: 4999,
    batteryCareMonthlyAmount: 1499,
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
    batteryCareAnnualAmount: 4499,
    batteryCareSixMonthAmount: 2999,
    batteryCareMonthlyAmount: 799,
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
    batteryCareAnnualAmount: 24999,
    batteryCareSixMonthAmount: 16999,
    batteryCareMonthlyAmount: 4499,
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
    batteryCareAnnualAmount: 4999,
    batteryCareSixMonthAmount: 3499,
    batteryCareMonthlyAmount: 999,
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
    batteryCareAnnualAmount: 1999,
    batteryCareSixMonthAmount: 1299,
    batteryCareMonthlyAmount: 399,
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
    batteryCareAnnualAmount: 39999,
    batteryCareSixMonthAmount: 24999,
    batteryCareMonthlyAmount: 6999,
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
    batteryCareAnnualAmount: 1580,
    batteryCareSixMonthAmount: 980,
    batteryCareMonthlyAmount: 290,
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
    batteryCareAnnualAmount: 14900,
    batteryCareSixMonthAmount: 9900,
    batteryCareMonthlyAmount: 2900,
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
    batteryCareAnnualAmount: 1399,
    batteryCareSixMonthAmount: 899,
    batteryCareMonthlyAmount: 249,
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
    batteryCareAnnualAmount: 7999,
    batteryCareSixMonthAmount: 5499,
    batteryCareMonthlyAmount: 1499,
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
    batteryCareAnnualAmount: 34999,
    batteryCareSixMonthAmount: 22999,
    batteryCareMonthlyAmount: 6499,
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
    batteryCareAnnualAmount: 89999,
    batteryCareSixMonthAmount: 59999,
    batteryCareMonthlyAmount: 16999,
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
    batteryCareAnnualAmount: 5999,
    batteryCareSixMonthAmount: 3999,
    batteryCareMonthlyAmount: 999,
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
    batteryCareAnnualAmount: 21999,
    batteryCareSixMonthAmount: 14999,
    batteryCareMonthlyAmount: 3999,
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
    batteryCareAnnualAmount: 19999,
    batteryCareSixMonthAmount: 12999,
    batteryCareMonthlyAmount: 3499,
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
    batteryCareAnnualAmount: 3999,
    batteryCareSixMonthAmount: 2699,
    batteryCareMonthlyAmount: 799,
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
    batteryCareAnnualAmount: 3999,
    batteryCareSixMonthAmount: 2699,
    batteryCareMonthlyAmount: 799,
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
    batteryCareAnnualAmount: 3999,
    batteryCareSixMonthAmount: 2699,
    batteryCareMonthlyAmount: 799,
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
    batteryCareAnnualAmount: 4499,
    batteryCareSixMonthAmount: 2999,
    batteryCareMonthlyAmount: 899,
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
    batteryCareAnnualAmount: 34999,
    batteryCareSixMonthAmount: 22999,
    batteryCareMonthlyAmount: 6999,
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
    batteryCareAnnualAmount: 59999,
    batteryCareSixMonthAmount: 39999,
    batteryCareMonthlyAmount: 10999,
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

  const batteryCareAnnualMonthlyEq = Math.floor(tier.batteryCareAnnualAmount / 12);
  const batteryCareSixMonthMonthlyEq = Math.floor(tier.batteryCareSixMonthAmount / 6);

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
    batteryCareAnnualAmount: tier.batteryCareAnnualAmount,
    batteryCareAnnualFormatted: formatCurrencyAmount(tier, tier.batteryCareAnnualAmount),
    batteryCareAnnualMonthlyEqFormatted: formatCurrencyAmount(tier, batteryCareAnnualMonthlyEq),
    batteryCareSixMonthAmount: tier.batteryCareSixMonthAmount,
    batteryCareSixMonthFormatted: formatCurrencyAmount(tier, tier.batteryCareSixMonthAmount),
    batteryCareSixMonthMonthlyEqFormatted: formatCurrencyAmount(tier, batteryCareSixMonthMonthlyEq),
    batteryCareMonthlyAmount: tier.batteryCareMonthlyAmount,
    batteryCareMonthlyFormatted: formatCurrencyAmount(tier, tier.batteryCareMonthlyAmount),
    cloudVaultAnnualAmount: tier.batteryCareAnnualAmount,
    cloudVaultAnnualFormatted: formatCurrencyAmount(tier, tier.batteryCareAnnualAmount),
    cloudVaultAnnualMonthlyEqFormatted: formatCurrencyAmount(tier, batteryCareAnnualMonthlyEq),
    cloudVaultSixMonthAmount: tier.batteryCareSixMonthAmount,
    cloudVaultSixMonthFormatted: formatCurrencyAmount(tier, tier.batteryCareSixMonthAmount),
    cloudVaultSixMonthMonthlyEqFormatted: formatCurrencyAmount(tier, batteryCareSixMonthMonthlyEq),
    cloudVaultMonthlyAmount: tier.batteryCareMonthlyAmount,
    cloudVaultMonthlyFormatted: formatCurrencyAmount(tier, tier.batteryCareMonthlyAmount),
  };
}

const MAX_GEO_CACHE_KEYS = 5_000;
const ipCountryCache = new Map<string, { country: string; expiresAt: number }>();

function setGeoCache(key: string, country: string, expiresAt: number, nowMs: number) {
  if (ipCountryCache.size >= MAX_GEO_CACHE_KEYS) {
    for (const [k, v] of ipCountryCache) {
      if (v.expiresAt <= nowMs) ipCountryCache.delete(k);
    }
    if (ipCountryCache.size >= MAX_GEO_CACHE_KEYS) {
      let excess = ipCountryCache.size - MAX_GEO_CACHE_KEYS + 1;
      for (const k of ipCountryCache.keys()) {
        if (excess-- <= 0) break;
        ipCountryCache.delete(k);
      }
    }
  }
  ipCountryCache.set(key, { country, expiresAt });
}

function isPrivateIpv4Parts(a: number, b: number, c = 0): boolean {
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224 ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 88 && c === 99)
  );
}

function parseIpv6Words(h: string): number[] | null {
  let ipStr = h;
  const lastColon = ipStr.lastIndexOf(":");
  if (lastColon >= 0) {
    const tail = ipStr.slice(lastColon + 1);
    if (tail.includes(".")) {
      const parts = tail.split(".").map(Number);
      if (parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)) {
        const hi = (parts[0] << 8) | parts[1];
        const lo = (parts[2] << 8) | parts[3];
        ipStr = `${ipStr.slice(0, lastColon)}:${hi.toString(16)}:${lo.toString(16)}`;
      }
    }
  }

  const doubleColon = ipStr.indexOf("::");
  let leftParts: string[] = [];
  let rightParts: string[] = [];

  if (doubleColon >= 0) {
    const left = ipStr.slice(0, doubleColon);
    const right = ipStr.slice(doubleColon + 2);
    leftParts = left ? left.split(":") : [];
    rightParts = right ? right.split(":") : [];
  } else {
    leftParts = ipStr.split(":");
  }

  const totalKnown = leftParts.length + rightParts.length;
  if (totalKnown > 8) return null;
  const missing = 8 - totalKnown;
  const words: number[] = [];

  for (const part of leftParts) {
    const val = Number.parseInt(part, 16);
    if (Number.isNaN(val) || val < 0 || val > 0xffff) return null;
    words.push(val);
  }
  for (let i = 0; i < missing; i++) {
    words.push(0);
  }
  for (const part of rightParts) {
    const val = Number.parseInt(part, 16);
    if (Number.isNaN(val) || val < 0 || val > 0xffff) return null;
    words.push(val);
  }

  return words.length === 8 ? words : null;
}

export function isPrivateOrLoopbackIp(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/i, "").replace(/^\[|\]$/g, "").trim().toLowerCase();
  if (!clean || clean === "local") return true;

  const ipv = isIP(clean);
  if (ipv === 4) {
    const parts = clean.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    return isPrivateIpv4Parts(parts[0], parts[1], parts[2]);
  } else if (ipv === 6) {
    const words = parseIpv6Words(clean);
    if (!words) return true;
    // Unspecified (::)
    if (words.every((w) => w === 0)) return true;
    // Loopback (::1, 0:0:0:0:0:0:0:1, etc.)
    if (words.slice(0, 7).every((w) => w === 0) && words[7] === 1) return true;
    // Unique-local (fc00::/7)
    if ((words[0] & 0xfe00) === 0xfc00) return true;
    // Link-local (fe80::/10) and Site-local (fec0::/10)
    if ((words[0] & 0xfe00) === 0xfe00) return true;
    // Multicast (ff00::/8)
    if ((words[0] & 0xff00) === 0xff00) return true;
    // Discard prefix (100::/64)
    if (words[0] === 0x0100 && words[1] === 0 && words[2] === 0 && words[3] === 0) return true;
    // Documentation (2001:db8::/32) and Benchmarking (2001:2::/48)
    if (words[0] === 0x2001 && (words[1] === 0x0db8 || (words[1] === 0x0002 && words[2] === 0))) return true;
    // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96)
    const isMapped = words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff;
    const isCompatible = words.slice(0, 6).every((w) => w === 0);
    if (isMapped || isCompatible) {
      const a = (words[6] >> 8) & 0xff;
      const b = words[6] & 0xff;
      const c = (words[7] >> 8) & 0xff;
      return isPrivateIpv4Parts(a, b, c);
    }
    return false;
  }
  // Not a valid IP literal: treat as local/invalid to prevent outbound requests with invalid targets
  return true;
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
        setGeoCache(cacheKey, c, nowMs + ttlMs, nowMs);
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
        setGeoCache(cacheKey, c, nowMs + ttlMs, nowMs);
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
  bodyOverride?: { country?: string; currency?: string; trustProxy?: boolean; allowQueryOverride?: boolean }
): Promise<LocalizedPlanPricing> {
  const allowQuery =
    bodyOverride?.allowQueryOverride ??
    (c.req.method === "GET" && c.req.path === "/api/checkout-config");
  const queryCountry = (allowQuery ? c.req.query("country") : undefined) || bodyOverride?.country;
  const queryCurrency = (allowQuery ? c.req.query("currency") : undefined) || bodyOverride?.currency;

  if (queryCountry || queryCurrency) {
    return getPricingForCountryOrCurrency(queryCountry, queryCurrency);
  }

  const trustProxy = Boolean(bodyOverride?.trustProxy);
  if (trustProxy) {
    const headerCountry =
      c.req.header("cf-ipcountry") ||
      c.req.header("x-vercel-ip-country") ||
      c.req.header("cloudfront-viewer-country") ||
      c.req.header("x-appengine-country");

    if (headerCountry && /^[A-Za-z]{2}$/.test(headerCountry.trim()) && headerCountry.trim().toUpperCase() !== "XX") {
      return getPricingForCountryOrCurrency(headerCountry.trim().toUpperCase(), null);
    }
  }

  // Extract visitor IP from proxy headers only when behind a trusted proxy
  let ip = "";
  if (trustProxy) {
    const trustCloudflare = process.env.TRUST_CLOUDFLARE === "1";
    const cfIp = trustCloudflare ? c.req.header("cf-connecting-ip")?.trim() : "";
    const xff = c.req.header("x-forwarded-for");
    const rightmostXff = xff
      ? xff
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .at(-1)
      : "";
    ip = cfIp || rightmostXff || c.req.header("x-real-ip")?.trim() || "";
  }
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

  const acceptLang = c.req.header("accept-language") || "";
  const regionMatch = acceptLang.match(/\b[a-z]{2,3}-([A-Z]{2})\b/i);
  if (regionMatch && regionMatch[1]) {
    const region = regionMatch[1].toUpperCase();
    if (region !== "XX") {
      return getPricingForCountryOrCurrency(region, null);
    }
  }

  return getPricingForCountryOrCurrency("US", "usd");
}

export function detectLeadDevice(c: Context, hintDevice?: string | null): string {
  const hint = String(hintDevice ?? "").trim();
  const hintLower = hint.toLowerCase();
  const ua = (c.req.header("user-agent") || "").toLowerCase();

  if (hint && !["pc", "mobile", "web"].includes(hintLower)) {
    return hint.slice(0, 64);
  }

  const isApp = hintLower === "pc" || hintLower === "mobile" || /tauri|sweepr|okhttp|cfnetwork/i.test(ua);

  if (hintLower === "mobile") {
    if (/iphone|ipad|ipod|cfnetwork|darwin/i.test(ua)) return "iPhone / iOS (App)";
    if (/android|okhttp|dalvik/i.test(ua)) return "Android (App)";
    return "Mobile App";
  }

  if (hintLower === "pc") {
    if (/macintosh|mac os x/i.test(ua)) return "macOS (App)";
    if (/linux/i.test(ua) && !/android/i.test(ua)) return "Linux (App)";
    return "Windows PC (App)";
  }

  if (/ipad/i.test(ua)) return isApp ? "iPad / iOS (App)" : "iPad / iOS";
  if (/iphone|ipod/i.test(ua)) return isApp ? "iPhone / iOS (App)" : "iPhone / iOS";
  if (/android/i.test(ua)) return isApp ? "Android (App)" : "Android";
  if (/cros/i.test(ua)) return "Chromebook";
  if (/windows/i.test(ua)) return isApp ? "Windows PC (App)" : "Windows PC";
  if (/macintosh|mac os x/i.test(ua)) return isApp ? "macOS (App)" : "macOS";
  if (/linux|x11/i.test(ua)) return isApp ? "Linux (App)" : "Linux";

  return hintLower === "web" ? "Web Browser" : "Windows PC";
}


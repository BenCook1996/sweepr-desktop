import type { Repo } from "./db.js";
import { classifyTransactionalTier } from "./seo/keywords.js";
import type { SeoStore } from "./seo/store.js";

export type KeywordRoasStatus = "SCALE_WINNER" | "HOLD_LEARNING" | "PAUSE_LOSER";

export interface KeywordRoasRow {
  query: string;
  channel: "bing" | "google" | "reddit" | "meta" | "organic";
  clicks_or_downloads: number;
  installs: number;
  scans: number;
  checkouts_started: number;
  conversions: number;
  max_cpc_gbp: number;
  spend_gbp: number;
  attributable_revenue_gbp: number;
  roas: number;
  cpa_gbp: number;
  status: KeywordRoasStatus;
  recommended_action: string;
  recommended_new_cpc_gbp: number;
}

export interface ChannelRoasSummary {
  channel: "bing" | "google" | "reddit" | "meta" | "organic";
  clicks_or_downloads: number;
  installs: number;
  scans: number;
  checkouts_started: number;
  conversions: number;
  spend_gbp: number;
  attributable_revenue_gbp: number;
  roas: number;
  cpa_gbp: number;
}

export interface RoasBudgetReport {
  ok: true;
  generated_at: string;
  microsoft_ads_customer_id: string;
  base_daily_budget_gbp: number;
  active_daily_budget_gbp?: number;
  last_reallocated_at?: string | null;
  target_roas_floor: number;
  target_cpa_ceiling_gbp: number;
  reinvestment_rate: number;
  current_daily_budget_gbp: number;
  total_spend_gbp: number;
  total_revenue_gbp: number;
  blended_roas: number;
  totals: {
    paid_spend_gbp: number;
    paid_revenue_gbp: number;
    paid_conversions: number;
    paid_roas: number;
    paid_cpa_gbp: number;
    qualifies_for_65pct_reinvestment: boolean;
    reinvestment_unlock_gbp: number;
    recommended_daily_budget_gbp: number;
    recommended_weekly_budget_gbp: number;
  };
  channels: ChannelRoasSummary[];
  campaigns: Array<{
    campaign: string;
    query: string;
    channel: ChannelRoasSummary["channel"];
    spend_gbp: number;
    revenue_gbp: number;
    conversions: number;
    roas: number;
    status: KeywordRoasStatus;
    recommended_action: string;
  }>;
  keywords: KeywordRoasRow[];
  scale_winners: KeywordRoasRow[];
  pause_losers: KeywordRoasRow[];
}

function normalizeChannel(rawSource?: string | null, msclkid?: string | null, gclid?: string | null): ChannelRoasSummary["channel"] {
  const s = String(rawSource || "").trim().toLowerCase();
  if (msclkid || s.includes("bing") || s.includes("microsoft") || s === "msn") return "bing";
  if (gclid || s.includes("google") || s === "adwords" || s === "gads") return "google";
  if (s.includes("reddit")) return "reddit";
  if (s.includes("meta") || s.includes("facebook") || s.includes("instagram") || s === "fb") return "meta";
  return "organic";
}

function normalizeKeyword(rawTerm?: string | null): string {
  return String(rawTerm || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$|^"|"$/g, "")
    .replace(/\s+/g, " ");
}

function estimatePlanRevenueGbp(plan?: string | null, amountCents?: number | null, currency?: string | null): number {
  if (amountCents && Number.isFinite(Number(amountCents)) && Number(amountCents) > 0) {
    const raw = Number(amountCents) / 100;
    const cur = String(currency || "gbp").toLowerCase();
    if (cur === "gbp") return Math.round(raw * 100) / 100;
    if (cur === "usd") return Math.round(raw * 0.79 * 100) / 100;
    if (cur === "eur") return Math.round(raw * 0.86 * 100) / 100;
    return Math.round(raw * 100) / 100;
  }
  const p = String(plan || "annual").toLowerCase();
  if (p.includes("lifetime")) return 47.99;
  if (p.includes("month")) return 11.99;
  return 23.99;
}

export function computeRoasAndBudgetReport(repo: Repo, seoStore?: SeoStore): RoasBudgetReport {
  const approvedAds =
    (seoStore?.getSetting<Array<any>>("intent_gap_approved_ads", []) ?? []).filter(
      (a) => a && a.query
    );
  const spendOverrides =
    seoStore?.getSetting<
      Record<
        string,
        {
          channel?: ChannelRoasSummary["channel"];
          clicks?: number;
          installs?: number;
          scans?: number;
          checkouts?: number;
          conversions?: number;
          spend_gbp?: number;
          revenue_gbp?: number;
          max_cpc_gbp?: number;
          status?: string;
          paused?: boolean;
          paused_at?: number;
        }
      >
    >("paid_ads_spend_overrides", {}) ?? {};

  const kwMap = new Map<
    string,
    {
      query: string;
      channel: ChannelRoasSummary["channel"];
      clicks: number;
      installs: number;
      scans: number;
      checkouts: number;
      conversions: number;
      maxCpcGbp: number;
      explicitSpendGbp: number | null;
      revenueGbp: number;
      pausedByRoas?: boolean;
    }
  >();

  const ensureKw = (query: string, channel: ChannelRoasSummary["channel"], defaultCpc = 0.55) => {
    const norm = normalizeKeyword(query) || `(unattributed_${channel})`;
    const key = `${channel}:${norm}`;
    let entry = kwMap.get(key);
    if (!entry) {
      entry = {
        query: norm,
        channel,
        clicks: 0,
        installs: 0,
        scans: 0,
        checkouts: 0,
        conversions: 0,
        maxCpcGbp: defaultCpc,
        explicitSpendGbp: null,
        revenueGbp: 0,
        pausedByRoas: false,
      };
      kwMap.set(key, entry);
    }
    return entry;
  };

  // Seed approved Microsoft Ads keywords from A2 Intent-Gap queue
  for (const ad of approvedAds) {
    const q = normalizeKeyword(ad.query);
    if (!q) continue;
    const entry = ensureKw(q, "bing", Number(ad.max_cpc_gbp) || 0.45);
    entry.maxCpcGbp = Number(ad.max_cpc_gbp) || entry.maxCpcGbp;
    if (ad.status === "paused_low_roas") entry.pausedByRoas = true;
  }

  // Scan recent analytics_events for funnel events carrying UTM / click-ID attribution
  const seenConversionKeys = new Set<string>();
  const events = repo.db
    .prepare("SELECT account_id, event_name as event, metadata as meta FROM analytics_events ORDER BY created_at DESC LIMIT 5000")
    .all() as Array<{ account_id: string | null; event: string; meta: string | null }>;
  for (const ev of events) {
    let meta: Record<string, any> = {};
    try {
      meta = ev.meta ? JSON.parse(ev.meta) : {};
    } catch {
      meta = {};
    }
    const nested = meta.metadata && typeof meta.metadata === "object" ? meta.metadata : {};
    const utmSource =
      meta.utm_source || nested.utm_source || meta.last_utm_source || meta.first_utm_source || "";
    const utmTerm =
      meta.utm_term || nested.utm_term || meta.last_utm_term || meta.first_utm_term || meta.query || nested.query || "";
    const msclkid = meta.msclkid || nested.msclkid || "";
    const gclid = meta.gclid || nested.gclid || "";

    if (!utmSource && !utmTerm && !msclkid && !gclid) continue;

    const channel = normalizeChannel(utmSource, msclkid, gclid);
    const entry = ensureKw(utmTerm || `(campaign_${channel})`, channel);

    if (ev.event === "installer_downloaded" || ev.event === "download_click") {
      entry.clicks += 1;
    } else if (ev.event === "app_installed") {
      entry.installs += 1;
    } else if (ev.event === "scan_completed") {
      entry.scans += 1;
    } else if (ev.event === "checkout_started" || ev.event === "paywall_viewed") {
      entry.checkouts += 1;
    } else if (ev.event === "purchase_completed" || ev.event === "subscription_created") {
      const dedupeKey = String(
        meta.subscription_id || nested.subscription_id || ev.account_id || meta.account_id || `${entry.query}:${ev.event}:${entry.conversions}`
      );
      if (!seenConversionKeys.has(dedupeKey)) {
        seenConversionKeys.add(dedupeKey);
        entry.conversions += 1;
        entry.revenueGbp += estimatePlanRevenueGbp(
          meta.plan || nested.plan,
          meta.amount_cents || nested.amount_cents,
          meta.currency || nested.currency
        );
      }
    }
  }

  // Scan Stripe `subscription_synced` activities with attribution metadata (deduplicated against analytics_events)
  try {
    const syncActs = repo.db
      .prepare(
        "SELECT account_id, metadata FROM activities WHERE type = 'subscription_synced' AND metadata IS NOT NULL ORDER BY created_at DESC LIMIT 1000"
      )
      .all() as Array<{ account_id: string | null; metadata: string }>;
    for (const row of syncActs) {
      let meta: Record<string, any> = {};
      try {
        meta = JSON.parse(row.metadata);
      } catch {
        continue;
      }
      if (meta.status !== "active" && meta.status !== "trialing") continue;
      if (!meta.utm_source && !meta.utm_term && !meta.msclkid && !meta.gclid) continue;
      const dedupeKey = String(meta.subscription_id || row.account_id || meta.account_id || "");
      if (dedupeKey && seenConversionKeys.has(dedupeKey)) continue;
      if (dedupeKey) seenConversionKeys.add(dedupeKey);
      const channel = normalizeChannel(meta.utm_source, meta.msclkid, meta.gclid);
      const entry = ensureKw(meta.utm_term || `(campaign_${channel})`, channel);
      entry.conversions += 1;
      entry.revenueGbp += estimatePlanRevenueGbp(meta.plan, meta.amount_cents, meta.currency);
    }
  } catch {}

  // Apply explicit spend/conversion overrides (from Microsoft Ads import or CRM reallocation API)
  for (const [rawQuery, ov] of Object.entries(spendOverrides)) {
    const channel = ov.channel || "bing";
    const entry = ensureKw(rawQuery, channel, ov.max_cpc_gbp ?? 0.55);
    if (ov.clicks !== undefined) entry.clicks = Number(ov.clicks);
    if (ov.installs !== undefined) entry.installs = Number(ov.installs);
    if (ov.scans !== undefined) entry.scans = Number(ov.scans);
    if (ov.checkouts !== undefined) entry.checkouts = Number(ov.checkouts);
    if (ov.conversions !== undefined) entry.conversions = Number(ov.conversions);
    if (ov.spend_gbp !== undefined) entry.explicitSpendGbp = Number(ov.spend_gbp);
    if (ov.revenue_gbp !== undefined) entry.revenueGbp = Number(ov.revenue_gbp);
    if (ov.max_cpc_gbp !== undefined) entry.maxCpcGbp = Number(ov.max_cpc_gbp);
    if (ov.status === "paused_low_roas" || ov.paused === true) entry.pausedByRoas = true;
  }

  const keywordRows: KeywordRoasRow[] = [];
  const channelRollup = new Map<ChannelRoasSummary["channel"], ChannelRoasSummary>();
  for (const ch of ["bing", "google", "reddit", "meta", "organic"] as const) {
    channelRollup.set(ch, {
      channel: ch,
      clicks_or_downloads: 0,
      installs: 0,
      scans: 0,
      checkouts_started: 0,
      conversions: 0,
      spend_gbp: 0,
      attributable_revenue_gbp: 0,
      roas: 0,
      cpa_gbp: 0,
    });
  }

  for (const item of kwMap.values()) {
    const isPaid = item.channel !== "organic";
    const spendGbp =
      item.explicitSpendGbp !== null
        ? Math.round(item.explicitSpendGbp * 100) / 100
        : isPaid
          ? Math.round(item.clicks * item.maxCpcGbp * 100) / 100
          : 0;
    const revGbp = Math.round(item.revenueGbp * 100) / 100;
    const roas = spendGbp > 0 ? Math.round((revGbp / spendGbp) * 100) / 100 : revGbp > 0 ? 99.0 : 0;
    const cpaGbp =
      item.conversions > 0 ? Math.round((spendGbp / item.conversions) * 100) / 100 : spendGbp;

    let status: KeywordRoasStatus = "HOLD_LEARNING";
    let recommendedAction = "Hold current bid while gathering initial click & scan telemetry (< £15 spend).";
    let newCpc = item.maxCpcGbp;

    if (item.conversions >= 1 && roas >= 1.5 && cpaGbp <= 20) {
      status = "SCALE_WINNER";
      newCpc = Math.min(1.8, Math.round(item.maxCpcGbp * 1.15 * 100) / 100);
      recommendedAction = `Scale winner (ROAS ${roas}x >= 1.5x, CPA £${cpaGbp} <= £20): increase max CPC to £${newCpc.toFixed(2)} and clone to Google Search Exact Match.`;
    } else if (item.pausedByRoas || (spendGbp >= 15 && item.conversions === 0) || (spendGbp >= 25 && roas < 1.0)) {
      status = "PAUSE_LOSER";
      newCpc = 0;
      recommendedAction = `Pause underperforming keyword (£${spendGbp.toFixed(2)} spend, ${item.conversions} conversions, ROAS ${roas}x < 1.0x) and reallocate budget to winning exact-match terms.`;
    }

    keywordRows.push({
      query: item.query,
      channel: item.channel,
      clicks_or_downloads: item.clicks,
      installs: item.installs,
      scans: item.scans,
      checkouts_started: item.checkouts,
      conversions: item.conversions,
      max_cpc_gbp: item.maxCpcGbp,
      spend_gbp: spendGbp,
      attributable_revenue_gbp: revGbp,
      roas,
      cpa_gbp: cpaGbp,
      status,
      recommended_action: recommendedAction,
      recommended_new_cpc_gbp: newCpc,
    });

    const chSum = channelRollup.get(item.channel)!;
    chSum.clicks_or_downloads += item.clicks;
    chSum.installs += item.installs;
    chSum.scans += item.scans;
    chSum.checkouts_started += item.checkouts;
    chSum.conversions += item.conversions;
    chSum.spend_gbp = Math.round((chSum.spend_gbp + spendGbp) * 100) / 100;
    chSum.attributable_revenue_gbp = Math.round((chSum.attributable_revenue_gbp + revGbp) * 100) / 100;
  }

  for (const chSum of channelRollup.values()) {
    chSum.roas =
      chSum.spend_gbp > 0
        ? Math.round((chSum.attributable_revenue_gbp / chSum.spend_gbp) * 100) / 100
        : chSum.attributable_revenue_gbp > 0
          ? 99.0
          : 0;
    chSum.cpa_gbp =
      chSum.conversions > 0
        ? Math.round((chSum.spend_gbp / chSum.conversions) * 100) / 100
        : chSum.spend_gbp;
  }

  keywordRows.sort((a, b) => b.attributable_revenue_gbp - a.attributable_revenue_gbp || b.spend_gbp - a.spend_gbp);

  const paidChannels = [...channelRollup.values()].filter((c) => c.channel !== "organic");
  const paidSpendGbp = Math.round(paidChannels.reduce((s, c) => s + c.spend_gbp, 0) * 100) / 100;
  const paidRevenueGbp = Math.round(paidChannels.reduce((s, c) => s + c.attributable_revenue_gbp, 0) * 100) / 100;
  const paidConversions = paidChannels.reduce((s, c) => s + c.conversions, 0);
  const paidRoas =
    paidSpendGbp > 0 ? Math.round((paidRevenueGbp / paidSpendGbp) * 100) / 100 : 0;
  const paidCpaGbp =
    paidConversions > 0 ? Math.round((paidSpendGbp / paidConversions) * 100) / 100 : paidSpendGbp;

  // v3 65% Reinvestment Rule: Unlocks 65% of attributable Day-1 gross revenue when ROAS >= 1.5 and CPA <= £20
  const qualifiesForReinvestment = paidConversions >= 1 && paidRoas >= 1.5 && paidCpaGbp <= 20.0;
  const reinvestmentUnlockGbp = qualifiesForReinvestment
    ? Math.round(0.65 * paidRevenueGbp * 100) / 100
    : 0;
  const budgetState = seoStore?.getSetting<{
    current_daily_budget_gbp?: number;
    last_reallocated_at?: string;
    history?: Array<any>;
  }>("roas_budget_state", {});
  const baseDailyBudgetGbp = 10.0;
  const recommendedDailyBudgetGbp =
    Math.round((baseDailyBudgetGbp + reinvestmentUnlockGbp / 7) * 100) / 100;
  const recommendedWeeklyBudgetGbp = Math.round(recommendedDailyBudgetGbp * 7 * 100) / 100;
  const activeDailyBudgetGbp =
    Number(budgetState?.current_daily_budget_gbp) > 0
      ? Number(budgetState?.current_daily_budget_gbp)
      : baseDailyBudgetGbp;

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    microsoft_ads_customer_id: "255115583",
    base_daily_budget_gbp: baseDailyBudgetGbp,
    active_daily_budget_gbp: activeDailyBudgetGbp,
    last_reallocated_at: budgetState?.last_reallocated_at ?? null,
    target_roas_floor: 1.5,
    target_cpa_ceiling_gbp: 20.0,
    reinvestment_rate: 0.65,
    totals: {
      paid_spend_gbp: paidSpendGbp,
      paid_revenue_gbp: paidRevenueGbp,
      paid_conversions: paidConversions,
      paid_roas: paidRoas,
      paid_cpa_gbp: paidCpaGbp,
      qualifies_for_65pct_reinvestment: qualifiesForReinvestment,
      reinvestment_unlock_gbp: reinvestmentUnlockGbp,
      recommended_daily_budget_gbp: recommendedDailyBudgetGbp,
      recommended_weekly_budget_gbp: recommendedWeeklyBudgetGbp,
    },
    current_daily_budget_gbp: activeDailyBudgetGbp,
    total_spend_gbp: paidSpendGbp,
    total_revenue_gbp: paidRevenueGbp,
    blended_roas: paidRoas,
    campaigns: keywordRows.map((k) => ({
      campaign: `[${k.channel.toUpperCase()}] ${k.query}`,
      query: k.query,
      channel: k.channel,
      spend_gbp: k.spend_gbp,
      revenue_gbp: k.attributable_revenue_gbp,
      conversions: k.conversions,
      roas: k.roas,
      status: k.status,
      recommended_action: k.recommended_action,
    })),
    channels: [...channelRollup.values()],
    keywords: keywordRows,
    scale_winners: keywordRows.filter((k) => k.status === "SCALE_WINNER"),
    pause_losers: keywordRows.filter((k) => k.status === "PAUSE_LOSER"),
  };
}

export function applyRoasReallocation(
  repo: Repo,
  seoStore: SeoStore,
  input: {
    keyword_overrides?: Array<{
      query: string;
      channel?: ChannelRoasSummary["channel"];
      clicks?: number;
      installs?: number;
      scans?: number;
      checkouts?: number;
      conversions?: number;
      spend_gbp?: number;
      revenue_gbp?: number;
      max_cpc_gbp?: number;
    }>;
    auto_adjust_bids?: boolean;
  }
) {
  const existingOverrides =
    seoStore.getSetting<Record<string, any>>("paid_ads_spend_overrides", {}) ?? {};

  if (Array.isArray(input.keyword_overrides)) {
    for (const item of input.keyword_overrides) {
      const q = normalizeKeyword(item.query);
      if (!q) continue;
      existingOverrides[q] = {
        ...(existingOverrides[q] || {}),
        ...item,
        query: q,
        updated_at: new Date().toISOString(),
      };
    }
    seoStore.setSetting("paid_ads_spend_overrides", existingOverrides);
  }

  const report = computeRoasAndBudgetReport(repo, seoStore);

  let bidsAdjusted = 0;
  let losersPaused = 0;
  if (input.auto_adjust_bids !== false) {
    const approvedAds = seoStore.getSetting<Array<any>>("intent_gap_approved_ads", []) ?? [];
    for (const kw of report.keywords) {
      const adEntry = approvedAds.find((a) => normalizeKeyword(a.query) === kw.query);
      if (kw.status === "SCALE_WINNER") {
        if (adEntry) {
          adEntry.max_cpc_gbp = kw.recommended_new_cpc_gbp;
          adEntry.roas_status = "SCALE_WINNER";
          adEntry.status = "approved";
        }
        existingOverrides[kw.query] = {
          ...(existingOverrides[kw.query] || { query: kw.query, channel: kw.channel }),
          max_cpc_gbp: kw.recommended_new_cpc_gbp,
          status: "SCALE_WINNER",
          paused: false,
          updated_at: new Date().toISOString(),
        };
        bidsAdjusted += 1;
      } else if (kw.status === "PAUSE_LOSER") {
        if (adEntry) {
          adEntry.status = "paused_low_roas";
          adEntry.roas_status = "PAUSE_LOSER";
        }
        existingOverrides[kw.query] = {
          ...(existingOverrides[kw.query] || { query: kw.query, channel: kw.channel }),
          max_cpc_gbp: 0,
          status: "paused_low_roas",
          paused: true,
          updated_at: new Date().toISOString(),
        };
        losersPaused += 1;
      }
    }
    seoStore.setSetting("intent_gap_approved_ads", approvedAds);
    seoStore.setSetting("paid_ads_spend_overrides", existingOverrides);
  }

  const finalReport = computeRoasAndBudgetReport(repo, seoStore);
  const prevState =
    seoStore.getSetting<{
      current_daily_budget_gbp?: number;
      last_reallocated_at?: string;
      history?: Array<any>;
    }>("roas_budget_state", {}) ?? {};
  const nowIso = new Date().toISOString();
  const history = Array.isArray(prevState.history) ? prevState.history.slice(-24) : [];
  history.push({
    reallocated_at: nowIso,
    bids_adjusted: bidsAdjusted,
    losers_paused: losersPaused,
    recommended_daily_budget_gbp: finalReport.totals.recommended_daily_budget_gbp,
    reinvestment_unlock_gbp: finalReport.totals.reinvestment_unlock_gbp,
  });
  seoStore.setSetting("roas_budget_state", {
    current_daily_budget_gbp: finalReport.totals.recommended_daily_budget_gbp,
    last_reallocated_at: nowIso,
    history,
  });

  // Share empirical Paid Ads keyword CVRs by transactional tier with A17 Strategy Forecast Ledger
  const paidKeywordCvrByTier: Record<string, { clicks: number; downloads: number; conversions: number }> = {};
  for (const kw of finalReport.keywords) {
    if (kw.clicks_or_downloads <= 0) continue;
    const tx = classifyTransactionalTier(kw.query);
    const bucket = paidKeywordCvrByTier[tx.tier] ?? { clicks: 0, downloads: 0, conversions: 0 };
    bucket.clicks += kw.clicks_or_downloads;
    bucket.downloads += Math.max(kw.installs, Math.round(kw.clicks_or_downloads * 0.2));
    bucket.conversions += kw.conversions;
    paidKeywordCvrByTier[tx.tier] = bucket;
  }
  if (Object.keys(paidKeywordCvrByTier).length > 0) {
    seoStore.reconcileStrategyLedgerActualsAndCalibrate({
      paidKeywordCvrByTier,
      recalibrate: true,
    });
  }

  return {
    ok: true,
    bids_adjusted: bidsAdjusted,
    losers_paused: losersPaused,
    report: computeRoasAndBudgetReport(repo, seoStore),
  };
}

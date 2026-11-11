import { createHash } from "node:crypto";
import type { Repo } from "./db.js";

export type ExperimentId = "checker_cta_copy_v1" | "paywall_anchor_v1";
export type ExperimentVariant = "A" | "B";

export const MIN_SAMPLE_PER_VARIANT = 100;
export const Z_THRESHOLD_95 = 1.96;

export interface ExperimentDefinition {
  id: ExperimentId;
  name: string;
  description: string;
  variants: {
    A: { label: string; copy: string };
    B: { label: string; copy: string };
  };
}

export const ACTIVE_EXPERIMENTS: Record<ExperimentId, ExperimentDefinition> = {
  checker_cta_copy_v1: {
    id: "checker_cta_copy_v1",
    name: "Safe-to-Delete & Tool Checker Result CTA Copy",
    description:
      "A/B test comparing action-oriented 'Clean All in 1 Click' CTA (Variant A) vs. value/risk-reversal 'Get the 5-Device Pro Licence (14-Day Guarantee)' CTA (Variant B).",
    variants: {
      A: {
        label: "Action CTA (Clean in 1 Click)",
        copy: "Clean All in 1 Click — Get SWEEPR Pro →",
      },
      B: {
        label: "Value + Guarantee CTA (5-Device Licence)",
        copy: "Get the 5-Device Pro Licence (14-Day Guarantee) →",
      },
    },
  },
  paywall_anchor_v1: {
    id: "paywall_anchor_v1",
    name: "Checkout & In-App Paywall Price Anchoring",
    description:
      "A/B test comparing standard Annual-Default anchoring (Variant A) vs. Per-Month Equivalent (£4.16/mo) + Monthly Comparison Toggle anchoring (Variant B).",
    variants: {
      A: {
        label: "Annual Default Anchor (£49.99/yr)",
        copy: "Annual Pro — £49.99/yr (Covers 5 Devices)",
      },
      B: {
        label: "Per-Month Breakdown Anchor (£4.16/mo billed annually vs £9.99/mo)",
        copy: "Annual Pro — Just £4.16/mo (Save 58% vs Monthly • 5 Devices)",
      },
    },
  },
};

const promotedWinners = new Map<string, ExperimentVariant>();
let onPromotePersistHook: ((winners: Record<string, ExperimentVariant>) => void) | null = null;

export function setPromotedWinnersPersistHook(
  fn: ((winners: Record<string, ExperimentVariant>) => void) | null
) {
  onPromotePersistHook = fn;
}

export function hydratePromotedExperimentWinners(
  saved: Record<string, string> | null | undefined
) {
  if (!saved || typeof saved !== "object") return;
  for (const [id, v] of Object.entries(saved)) {
    if (v === "A" || v === "B") {
      promotedWinners.set(id, v);
    }
  }
}

export function exportPromotedExperimentWinners(): Record<string, ExperimentVariant> {
  const out: Record<string, ExperimentVariant> = {};
  for (const [id, v] of promotedWinners.entries()) {
    out[id] = v;
  }
  return out;
}

export function promoteExperimentWinner(
  experimentId: string,
  variant: ExperimentVariant | null
) {
  const id = String(experimentId || "").trim();
  if (!id) return;
  if (variant === "A" || variant === "B") {
    promotedWinners.set(id, variant);
  } else {
    promotedWinners.delete(id);
  }
  if (onPromotePersistHook) {
    try {
      onPromotePersistHook(exportPromotedExperimentWinners());
    } catch {}
  }
}

export function getPromotedExperimentWinner(experimentId: string): ExperimentVariant | null {
  return promotedWinners.get(String(experimentId || "").trim()) ?? null;
}

export function assignExperimentVariant(
  experimentId: string,
  visitorKey: string
): ExperimentVariant {
  const promoted = promotedWinners.get(experimentId);
  if (promoted === "A" || promoted === "B") {
    return promoted;
  }
  const cleanKey = String(visitorKey || "anon").trim() || "anon";
  const digest = createHash("sha256")
    .update(`${experimentId}:${cleanKey}`)
    .digest();
  return digest[0] % 2 === 0 ? "A" : "B";
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun 26.2.17) for computing two-tailed confidence %.
 */
function normalCdf(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const prob =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + 1.330274429 * t))));
  return x >= 0 ? 1 - prob : prob;
}

export function computeTwoProportionZTest(
  exposuresA: number,
  conversionsA: number,
  exposuresB: number,
  conversionsB: number
) {
  const nA = Math.max(exposuresA, conversionsA, 0);
  const nB = Math.max(exposuresB, conversionsB, 0);
  const cA = Math.min(conversionsA, nA);
  const cB = Math.min(conversionsB, nB);

  const pA = nA > 0 ? cA / nA : 0;
  const pB = nB > 0 ? cB / nB : 0;
  const sampleSizeReached = nA >= MIN_SAMPLE_PER_VARIANT && nB >= MIN_SAMPLE_PER_VARIANT;

  let zScore = 0;
  let confidencePct = 0;
  if (nA > 0 && nB > 0 && cA + cB > 0 && cA + cB < nA + nB) {
    const pPool = (cA + cB) / (nA + nB);
    const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));
    if (se > 0) {
      zScore = Math.round(((pB - pA) / se) * 1000) / 1000;
      const twoTailedConfidence = (2 * normalCdf(Math.abs(zScore)) - 1) * 100;
      confidencePct = Math.min(99.99, Math.max(0, Math.round(twoTailedConfidence * 100) / 100));
    }
  }

  const relativeLiftPct =
    pA > 0 ? Math.round(((pB - pA) / pA) * 10000) / 100 : pB > 0 ? 100 : 0;
  const isStatisticallySignificant = sampleSizeReached && Math.abs(zScore) >= Z_THRESHOLD_95;
  const significantWinner: ExperimentVariant | null = isStatisticallySignificant
    ? zScore > 0
      ? "B"
      : "A"
    : null;

  const anomalies: string[] = [];
  if (nA + nB >= 50) {
    const expected = (nA + nB) / 2;
    const chiSq =
      ((nA - expected) * (nA - expected)) / expected +
      ((nB - expected) * (nB - expected)) / expected;
    if (chiSq > 3.841) {
      anomalies.push(
        `SRM_DETECTED: Traffic split (${nA} vs ${nB}, chi2=${chiSq.toFixed(2)}) deviates significantly from 50/50.`
      );
    }
  }
  if ((nA >= 50 && cA === 0) || (nB >= 50 && cB === 0)) {
    anomalies.push(
      `ZERO_CONVERSION_ANOMALY: Variant has >=50 exposures with 0 conversions — verify conversion tracking.`
    );
  }

  return {
    z_score: zScore,
    confidence_pct: confidencePct,
    relative_lift_pct: relativeLiftPct,
    sample_size_reached: sampleSizeReached,
    is_statistically_significant: isStatisticallySignificant,
    statistically_significant_winner: significantWinner,
    anomalies,
  };
}

export function getExperimentSummary(repo: Repo) {
  const rows = repo.db
    .prepare(
      `SELECT event_name, metadata FROM analytics_events WHERE event_name IN ('experiment_exposure', 'experiment_conversion') ORDER BY id DESC LIMIT 10000`
    )
    .all() as Array<{ event_name: string; metadata: string | null }>;

  const stats: Record<
    string,
    {
      id: string;
      name: string;
      description: string;
      variants: {
        A: { label: string; copy: string; exposures: number; conversions: number; conversion_rate_pct: number };
        B: { label: string; copy: string; exposures: number; conversions: number; conversion_rate_pct: number };
      };
      winning_variant: "A" | "B" | "tie";
      z_score: number;
      confidence_pct: number;
      relative_lift_pct: number;
      sample_size_reached: boolean;
      is_statistically_significant: boolean;
      statistically_significant_winner: ExperimentVariant | null;
      auto_promoted_variant: ExperimentVariant | null;
      anomalies: string[];
    }
  > = {};

  const seenExposures = new Map<string, Set<string>>();
  const seenConversions = new Map<string, Set<string>>();

  for (const def of Object.values(ACTIVE_EXPERIMENTS)) {
    stats[def.id] = {
      id: def.id,
      name: def.name,
      description: def.description,
      variants: {
        A: { ...def.variants.A, exposures: 0, conversions: 0, conversion_rate_pct: 0 },
        B: { ...def.variants.B, exposures: 0, conversions: 0, conversion_rate_pct: 0 },
      },
      winning_variant: "tie",
      z_score: 0,
      confidence_pct: 0,
      relative_lift_pct: 0,
      sample_size_reached: false,
      is_statistically_significant: false,
      statistically_significant_winner: null,
      auto_promoted_variant: promotedWinners.get(def.id) ?? null,
      anomalies: [],
    };
    seenExposures.set(`${def.id}:A`, new Set());
    seenExposures.set(`${def.id}:B`, new Set());
    seenConversions.set(`${def.id}:A`, new Set());
    seenConversions.set(`${def.id}:B`, new Set());
  }

  for (const r of rows) {
    let meta: any = {};
    try {
      meta = r.metadata ? JSON.parse(r.metadata) : {};
    } catch {
      meta = {};
    }
    const expId = String(meta.experiment || meta.experiment_id || "").trim();
    const variant = String(meta.variant || "").trim().toUpperCase();
    if (!stats[expId] || (variant !== "A" && variant !== "B")) continue;
    const visitorKey = String(meta.visitor_id || meta.visitor_key || "").trim();
    const bucket = stats[expId].variants[variant as "A" | "B"];

    if (r.event_name === "experiment_exposure") {
      if (visitorKey) {
        const set = seenExposures.get(`${expId}:${variant}`)!;
        if (set.has(visitorKey)) continue;
        set.add(visitorKey);
      }
      bucket.exposures += 1;
    } else if (r.event_name === "experiment_conversion") {
      if (visitorKey) {
        const set = seenConversions.get(`${expId}:${variant}`)!;
        if (set.has(visitorKey)) continue;
        set.add(visitorKey);
      }
      bucket.conversions += 1;
    }
  }

  for (const exp of Object.values(stats)) {
    for (const v of ["A", "B"] as const) {
      const b = exp.variants[v];
      const denom = Math.max(b.exposures, b.conversions, 1);
      b.conversion_rate_pct =
        b.exposures > 0 || b.conversions > 0
          ? Math.round((b.conversions / denom) * 10000) / 100
          : 0;
    }
    if (exp.variants.A.conversion_rate_pct > exp.variants.B.conversion_rate_pct) {
      exp.winning_variant = "A";
    } else if (exp.variants.B.conversion_rate_pct > exp.variants.A.conversion_rate_pct) {
      exp.winning_variant = "B";
    } else {
      exp.winning_variant = "tie";
    }

    const zStats = computeTwoProportionZTest(
      exp.variants.A.exposures,
      exp.variants.A.conversions,
      exp.variants.B.exposures,
      exp.variants.B.conversions
    );
    exp.z_score = zStats.z_score;
    exp.confidence_pct = zStats.confidence_pct;
    exp.relative_lift_pct = zStats.relative_lift_pct;
    exp.sample_size_reached = zStats.sample_size_reached;
    exp.is_statistically_significant = zStats.is_statistically_significant;
    exp.statistically_significant_winner = zStats.statistically_significant_winner;
    exp.anomalies = zStats.anomalies;

    if (zStats.statistically_significant_winner && !promotedWinners.has(exp.id)) {
      promoteExperimentWinner(exp.id, zStats.statistically_significant_winner);
    }
    exp.auto_promoted_variant = promotedWinners.get(exp.id) ?? null;
  }

  return {
    ok: true,
    experiments: Object.values(stats),
  };
}

/**
 * Extracts empirical lift multipliers from A9 A/B experiments for A17 Forecaster calibration.
 */
export function getExperimentLiftMultipliers(repo: Repo): {
  checker_cta_copy_v1: number;
  paywall_anchor_v1: number;
} {
  const summary = getExperimentSummary(repo);
  const out = { checker_cta_copy_v1: 1.0, paywall_anchor_v1: 1.0 };
  for (const exp of summary.experiments) {
    if (exp.relative_lift_pct > 0 && (exp.sample_size_reached || exp.auto_promoted_variant)) {
      const mult = Number(Math.max(1.0, Math.min(1.45, 1 + exp.relative_lift_pct / 100)).toFixed(2));
      if (exp.id === "checker_cta_copy_v1") out.checker_cta_copy_v1 = mult;
      if (exp.id === "paywall_anchor_v1") out.paywall_anchor_v1 = mult;
    }
  }
  return out;
}

/**
 * Automatically records `experiment_conversion` for active experiments when a visitor starts/completes checkout.
 * Checks prior `experiment_exposure` events so unexposed visitors do not pollute unrelated experiments.
 */
export function attributeCheckoutToExperiments(
  repo: Repo,
  opts: { visitorKey?: string | null; accountId?: string | null; action?: string; plan?: string }
) {
  const cleanKey = String(opts.visitorKey || opts.accountId || "").trim();
  if (!cleanKey) return;

  const exposedExperiments = new Set<string>();
  try {
    const expRows = repo.db
      .prepare(
        "SELECT metadata FROM analytics_events WHERE event_name = 'experiment_exposure' AND metadata LIKE ? ORDER BY created_at DESC LIMIT 50"
      )
      .all(`%${cleanKey}%`) as Array<{ metadata: string | null }>;
    for (const r of expRows) {
      if (!r.metadata) continue;
      try {
        const parsed = JSON.parse(r.metadata);
        const expName = parsed.experiment || parsed.metadata?.experiment;
        if (expName) exposedExperiments.add(String(expName));
      } catch {}
    }
  } catch {}

  for (const expId of Object.keys(ACTIVE_EXPERIMENTS) as ExperimentId[]) {
    // Only attribute if the visitor was exposed to this experiment, OR if no exposures were recorded at all (fallback for direct /pricing checkout on paywall_anchor_v1)
    if (exposedExperiments.size > 0 && !exposedExperiments.has(expId)) continue;
    const variant = assignExperimentVariant(expId, cleanKey);
    repo.addAnalyticsEvent({
      event_name: "experiment_conversion",
      account_id: opts.accountId || undefined,
      platform: "web",
      metadata: {
        experiment: expId,
        variant,
        visitor_id: cleanKey,
        action: opts.action || "checkout_initiated",
        ...(opts.plan ? { plan: opts.plan } : {}),
      },
    });
  }
}

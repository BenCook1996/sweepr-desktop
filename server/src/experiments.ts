import { createHash } from "node:crypto";
import type { Repo } from "./db.js";

export type ExperimentId = "checker_cta_copy_v1" | "paywall_anchor_v1";
export type ExperimentVariant = "A" | "B";

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
      "A/B test comparing standard Annual-Default anchoring (Variant A) vs. Per-Month Equivalent (£2.49/mo) + Monthly Comparison Toggle anchoring (Variant B).",
    variants: {
      A: {
        label: "Annual Default Anchor (£29.99/yr)",
        copy: "Annual Pro — £29.99/yr (Covers 5 Devices)",
      },
      B: {
        label: "Per-Month Breakdown Anchor (£2.49/mo billed annually vs £4.99/mo)",
        copy: "Annual Pro — Just £2.49/mo (Save 50% vs Monthly • 5 Devices)",
      },
    },
  },
};

export function assignExperimentVariant(
  experimentId: string,
  visitorKey: string
): ExperimentVariant {
  const cleanKey = String(visitorKey || "anon").trim() || "anon";
  const digest = createHash("sha256")
    .update(`${experimentId}:${cleanKey}`)
    .digest();
  return digest[0] % 2 === 0 ? "A" : "B";
}

export function getExperimentSummary(repo: Repo) {
  const rows = repo.db
    .prepare(
      `SELECT event_name, metadata FROM analytics_events WHERE event_name IN ('experiment_exposure', 'experiment_conversion') ORDER BY id DESC LIMIT 5000`
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
    }
  > = {};

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
    };
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
    const bucket = stats[expId].variants[variant as "A" | "B"];
    if (r.event_name === "experiment_exposure") {
      bucket.exposures += 1;
    } else if (r.event_name === "experiment_conversion") {
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
  }

  return {
    ok: true,
    experiments: Object.values(stats),
  };
}

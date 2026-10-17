<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { formatBytes, PRICING } from "../lib/format";

  let {
    open, bytes, freeBytes, onClose, onActivated, onCleanFree,
  }: {
    open: boolean; bytes: number; freeBytes: number;
    onClose: () => void; onActivated: () => void; onCleanFree: () => void;
  } = $props();

  let stage = $state<"offer" | "waiting">("offer");
  let selectedPlan = $state<"monthly" | "annual">("monthly");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function check(): Promise<boolean> {
    try {
      const s = await api.licenseStatus(true);
      if (s.active) {
        stopPolling();
        stage = "offer";
        onActivated();
        return true;
      }
    } catch { /* keep polling */ }
    return false;
  }

  async function activate() {
    error = null;
    busy = true;
    try {
      await api.startCheckout(undefined, selectedPlan); // opens Stripe Checkout in the system browser
      stage = "waiting";
      let ticks = 0;
      stopPolling();
      pollTimer = setInterval(async () => {
        if (++ticks > 150) stopPolling(); // ~10 minutes
        await check();
      }, 4000);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function manualCheck() {
    busy = true;
    const ok = await check();
    busy = false;
    if (!ok) error = "We haven't received confirmation yet. It can take a few seconds after payment.";
  }

  function close() {
    stopPolling();
    stage = "offer";
    error = null;
    onClose();
  }

  $effect(() => () => stopPolling());
</script>

{#if open}
  <div class="backdrop" role="presentation" onclick={close}>
    <div class="sheet card" role="dialog" aria-modal="true" aria-labelledby="pw-title" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === "Escape" && close()}>
      {#if stage === "offer"}
        <h2 id="pw-title">Clean {formatBytes(bytes)} now</h2>
        <p class="muted">You've seen exactly what's there. Activate Sweepr to clean every category, and keep your machine tidy with ongoing rule updates.</p>

        <div class="plan-selector" role="radiogroup" aria-label="Select billing plan">
          <button
            type="button"
            class="plan-option"
            class:selected={selectedPlan === "monthly"}
            onclick={() => (selectedPlan = "monthly")}
            aria-pressed={selectedPlan === "monthly"}
          >
            <div class="row" style="justify-content: space-between; width: 100%;">
              <strong>Monthly</strong>
              <span class="badge free">30d Trial</span>
            </div>
            <div class="opt-price">{PRICING.activation} today</div>
            <div class="muted small">then {PRICING.monthly}/mo</div>
          </button>

          <button
            type="button"
            class="plan-option"
            class:selected={selectedPlan === "annual"}
            onclick={() => (selectedPlan = "annual")}
            aria-pressed={selectedPlan === "annual"}
          >
            <div class="row" style="justify-content: space-between; width: 100%;">
              <strong>Annual</strong>
              <span class="badge pro">{PRICING.annualSave}</span>
            </div>
            <div class="opt-price">{PRICING.annual}/yr</div>
            <div class="muted small">{PRICING.annualSave} · no free trial</div>
          </button>
        </div>

        <div class="price card">
          {#if selectedPlan === "monthly"}
            <div class="row"><strong class="amount">{PRICING.activation}</strong><span class="muted">today (first {PRICING.trialDays} days)</span></div>
            <div class="muted">then <strong style="color:var(--text)">{PRICING.monthly}/month</strong>. Cancel anytime in two clicks.</div>
          {:else}
            <div class="row"><strong class="amount">{PRICING.annual}</strong><span class="muted">/yr — {PRICING.annualSave}</span></div>
            <div class="muted">Billed annually (<strong style="color:var(--text)">no free trial</strong>). Cancel anytime in two clicks.</div>
          {/if}
          <ul>
            <li>Covers up to 3 PCs + 3 mobile devices</li>
            <li>Cancel from the app or your account page</li>
            <li>Secure checkout by Stripe, opens in your browser</li>
          </ul>
        </div>

        {#if error}<div class="error-banner">{error}</div>{/if}

        <button class="primary big" disabled={busy} onclick={activate}>
          {busy ? "Opening checkout…" : selectedPlan === "annual" ? `Activate Annual (${PRICING.annual}/yr)` : `Activate for ${PRICING.activation}`}
        </button>
        <div class="row" style="justify-content:center">
          {#if freeBytes > 0}
            <button class="ghost" onclick={onCleanFree}>Clean free items only ({formatBytes(freeBytes)})</button>
          {/if}
          <button class="ghost" onclick={close}>Not now</button>
        </div>
      {:else}
        <h2 id="pw-title">Finish checkout in your browser</h2>
        <p class="muted">This window updates automatically when your payment is confirmed.</p>
        <div class="spinner" aria-hidden="true"></div>
        {#if error}<div class="error-banner">{error}</div>{/if}
        <button class="primary" disabled={busy} onclick={manualCheck}>I've completed payment</button>
        <button class="ghost" onclick={close}>Cancel</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: #0009; display: grid; place-items: center; z-index: 50; backdrop-filter: blur(3px); }
  .sheet { width: 480px; padding: 26px; display: flex; flex-direction: column; gap: 14px; text-align: center; }
  h2 { margin: 0; }
  .plan-selector { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .plan-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    gap: 3px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1.5px solid var(--border);
    background: var(--panel-2);
    cursor: pointer;
    box-shadow: none;
    white-space: normal;
  }
  .plan-option.selected {
    border-color: var(--accent);
    background: var(--accent-light);
  }
  .opt-price { font-size: 18px; font-weight: 800; color: var(--accent); }
  .price { padding: 16px; text-align: left; background: var(--panel-2); display: flex; flex-direction: column; gap: 6px; }
  .amount { font-size: 26px; color: var(--accent); }
  ul { margin: 8px 0 0; padding-left: 18px; color: var(--muted); font-size: 12.5px; line-height: 1.7; }
  .spinner { align-self: center; width: 36px; height: 36px; border: 4px solid var(--panel-2); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>

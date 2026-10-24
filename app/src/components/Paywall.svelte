<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { formatBytes } from "../lib/format";

  let {
    open, bytes, onClose, onActivated,
  }: {
    open: boolean; bytes: number;
    onClose: () => void; onActivated: () => void;
  } = $props();

  let stage = $state<"offer" | "waiting">("offer");
  let selectedPlan = $state<"annual" | "monthly">("annual");
  let batteryCare = $state(false);
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
      if (batteryCare) {
        await api.startAddonCheckout("battery_care", undefined, selectedPlan);
      } else {
        await api.startCheckout(undefined, selectedPlan); // opens Stripe Checkout in the system browser
      }
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
        <p class="muted">You've seen exactly what's there. Activate SWEEPR Cleaner Pro to unlock every cleaning, optimization, and privacy tool.</p>

        <div class="plan-picker">
          <button
            type="button"
            class="plan-option {selectedPlan === 'monthly' ? 'selected' : ''}"
            onclick={() => (selectedPlan = "monthly")}
          >
            <div class="plan-top">
              <strong>1st-Month Intro</strong>
              <span class="save-badge">Save 80%</span>
            </div>
            <div class="plan-price">£1.99<span class="per"> 1st mo</span></div>
            <div class="plan-sub">Then £9.99/mo · Cancel in 1 click</div>
          </button>

          <button
            type="button"
            class="plan-option {selectedPlan === 'annual' ? 'selected' : ''}"
            onclick={() => (selectedPlan = "annual")}
          >
            <div class="plan-top">
              <strong>Annual Pro</strong>
              <span class="save-badge">Save 58%</span>
            </div>
            <div class="plan-price">£49.99<span class="per">/yr</span></div>
            <div class="plan-sub">£4.16/mo eq. · Best Value</div>
          </button>
        </div>

        <div class="price card">
          <div class="row"><strong>Included with SWEEPR Cleaner Pro</strong></div>
          <ul>
            <li>Clean all system junk, browser clutter &amp; app caches (with 7-day Undo)</li>
            <li>1-Click Speed Boost, Duplicate File Finder, Cloud Cleaner &amp; App Updater</li>
            <li>Covers up to 3 PCs (14-day money-back guarantee)</li>
          </ul>
        </div>

        {#if error}<div class="error-banner">{error}</div>{/if}

        <label class="order-bump" class:checked={batteryCare}>
          <input type="checkbox" bind:checked={batteryCare} />
          <div class="bump-body">
            <div class="bump-title">
              <strong>Add Laptop Battery Care</strong>
              <span class="bump-price">+{selectedPlan === "annual" ? "£17.99/yr" : "£2.99/mo"}</span>
            </div>
            <div class="bump-sub">
              Extend your laptop battery's lifespan: stops charging at 80% when plugged in, keeps your laptop cool, and puts idle browser tabs to sleep.
            </div>
          </div>
        </label>

        <button class="primary big" disabled={busy} onclick={activate}>
          {busy ? "Opening checkout…" : selectedPlan === "annual"
            ? `Continue with Annual Pro (${batteryCare ? "£67.98" : "£49.99"}/yr)`
            : `Unlock 1st Month for ${batteryCare ? "£4.98" : "£1.99"}`}
        </button>
        <div class="row" style="justify-content:center">
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
  .sheet { width: 500px; max-width: 94vw; padding: 26px; display: flex; flex-direction: column; gap: 14px; text-align: center; }
  h2 { margin: 0; }
  .plan-picker { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; text-align: left; }
  .plan-option { padding: 12px 14px; border-radius: 12px; border: 1.5px solid var(--border, #e2e8f0); background: var(--panel, #fff); cursor: pointer; display: flex; flex-direction: column; align-items: stretch; white-space: normal; width: 100%; min-width: 0; gap: 4px; transition: all 0.15s ease; color: inherit; }
  .plan-option.selected { border-color: var(--accent, #10b981); background: rgba(16, 185, 129, 0.08); box-shadow: 0 0 0 1px var(--accent, #10b981); }
  .plan-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 13px; }
  .save-badge { font-size: 10px; font-weight: 800; text-transform: uppercase; padding: 2px 6px; border-radius: 999px; background: #10b981; color: #fff; }
  .flex-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 999px; background: var(--panel-2, #f1f5f9); color: var(--muted, #64748b); }
  .plan-price { font-size: 20px; font-weight: 800; }
  .plan-price .per { font-size: 12px; font-weight: 500; color: var(--muted); }
  .plan-sub { font-size: 11px; color: var(--muted); }
  .price { padding: 14px 16px; text-align: left; background: var(--panel-2); display: flex; flex-direction: column; gap: 4px; }
  ul { margin: 6px 0 0; padding-left: 18px; color: var(--muted); font-size: 12.5px; line-height: 1.65; }
  .order-bump { display: flex; gap: 10px; align-items: flex-start; text-align: left; padding: 12px 14px; border-radius: 12px; border: 1.5px dashed #f59e0b; background: rgba(245, 158, 11, 0.07); cursor: pointer; }
  .order-bump.checked { border-style: solid; background: rgba(245, 158, 11, 0.14); }
  .order-bump input { margin-top: 3px; accent-color: #f59e0b; }
  .bump-body { display: flex; flex-direction: column; gap: 3px; }
  .bump-title { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
  .bump-price { font-weight: 800; color: #b45309; white-space: nowrap; }
  .bump-sub { font-size: 11.5px; color: var(--muted); line-height: 1.5; }
  .spinner { align-self: center; width: 36px; height: 36px; border: 4px solid var(--panel-2); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>

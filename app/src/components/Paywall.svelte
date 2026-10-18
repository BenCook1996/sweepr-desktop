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
      await api.startCheckout(); // opens Stripe Checkout in the system browser
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
        <p class="muted">You've seen exactly what's there. Activate SWEEPR Cleaner to clean every category, and keep your machine tidy with ongoing rule updates.</p>

        <div class="price card">
          <div class="row"><strong>SWEEPR Cleaner Pro</strong></div>
          <div class="muted small">Choose the plan that works best for you at checkout.</div>
          <ul>
            <li>Unlocks all deep-cleaning categories, browser &amp; app caches, and Pro optimization tools</li>
            <li>Covers up to 3 Desktop PCs</li>
            <li>Secure checkout by Stripe, opens in your browser</li>
          </ul>
        </div>

        {#if error}<div class="error-banner">{error}</div>{/if}

        <button class="primary big" disabled={busy} onclick={activate}>
          {busy ? "Opening checkout…" : "Activate SWEEPR Cleaner Pro"}
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
  .sheet { width: 480px; padding: 26px; display: flex; flex-direction: column; gap: 14px; text-align: center; }
  h2 { margin: 0; }
  .price { padding: 16px; text-align: left; background: var(--panel-2); display: flex; flex-direction: column; gap: 6px; }
  ul { margin: 8px 0 0; padding-left: 18px; color: var(--muted); font-size: 12.5px; line-height: 1.7; }
  .spinner { align-self: center; width: 36px; height: 36px; border: 4px solid var(--panel-2); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>

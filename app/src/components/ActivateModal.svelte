<script lang="ts">
  import { api, errorMessage } from "../lib/api";

  let { open = $bindable(false), onActivated }: { open: boolean; onActivated?: () => void } = $props();

  let email = $state("");
  let selectedPlan = $state<"annual" | "monthly">("annual");
  let includeBatteryAddon = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let waitingPayment = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function checkLicense(): Promise<boolean> {
    try {
      const s = await api.licenseStatus(true);
      if (s.active) {
        stopPolling();
        open = false;
        if (onActivated) onActivated();
        return true;
      }
    } catch { /* polling */ }
    return false;
  }

  async function handleActivate() {
    error = null;
    if (!email.trim() || !email.includes("@")) {
      error = "Please enter a valid email address.";
      return;
    }

    busy = true;
    try {
      const activatedImmediately = includeBatteryAddon
        ? await api.startAddonCheckout("battery_care", email.trim(), selectedPlan)
        : await api.startCheckout(email.trim(), selectedPlan);
      if (activatedImmediately || (await checkLicense())) {
        stopPolling();
        open = false;
        if (onActivated) onActivated();
        return;
      }
      waitingPayment = true;
      stopPolling();
      let ticks = 0;
      pollTimer = setInterval(async () => {
        if (++ticks > 150) stopPolling();
        await checkLicense();
      }, 4000);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  function close() {
    stopPolling();
    open = false;
    error = null;
    waitingPayment = false;
  }
</script>

{#if open}
  <div class="modal-backdrop" onclick={close} role="presentation">
    <div class="modal-sheet card" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === "Escape" && close()} role="dialog" aria-modal="true" tabindex="-1">
      <!-- Modal Header -->
      <div class="modal-header">
        <h2 class="modal-title">Activate now</h2>
        <button class="close-btn" onclick={close} aria-label="Close">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <!-- Modal Body -->
      {#if !waitingPayment}
        <div class="modal-body">
          <p class="prompt-text">
            Please enter your <strong>Email address</strong> (existing subscribers unlock immediately; new users continue to checkout)
          </p>

          <div class="inputs-group">
            <input
              type="email"
              bind:value={email}
              placeholder="Enter your email address"
              class="soft-input"
              aria-label="Email address"
              onkeydown={(e) => e.key === "Enter" && handleActivate()}
            />
          </div>

          <div class="plan-grid">
            <button
              type="button"
              class="plan-card-btn"
              class:selected={selectedPlan === "annual"}
              onclick={() => (selectedPlan = "annual")}
            >
              <span class="plan-card-title">Annual · £49.99/yr</span>
              <span class="plan-card-sub highlight">Save 58% (£4.16/mo)</span>
            </button>
            <button
              type="button"
              class="plan-card-btn"
              class:selected={selectedPlan === "monthly"}
              onclick={() => (selectedPlan = "monthly")}
            >
              <span class="plan-card-title">Monthly · £9.99/mo</span>
              <span class="plan-card-sub">Flexible · Cancel anytime</span>
            </button>
          </div>

          <label class="addon-row">
            <input type="checkbox" bind:checked={includeBatteryAddon} />
            <div style="flex:1; min-width:0;">
              <strong>+ Add Total Battery Care (+£17.99/yr)</strong>
              <div class="muted" style="font-size:11px;">80% Charge Guard, Thermal Guard &amp; Auto-Sleep Browser Tabs</div>
            </div>
          </label>

          {#if error}
            <div class="error-banner">{error}</div>
          {/if}

          <div class="action-row">
            <button class="primary begin-btn" disabled={busy} onclick={handleActivate}>
              {busy ? "Opening checkout…" : "Begin activation"}
            </button>
          </div>
        </div>

      {:else}
        <!-- Waiting on Checkout Completion -->
        <div class="modal-body waiting-body">
          <div class="spinner"></div>
          <h3>Checkout opened in browser</h3>
          <p class="muted small">Please complete payment in the secure Stripe window. SWEEPR Cleaner will activate automatically once confirmed.</p>
          {#if error}
            <div class="error-banner">{error}</div>
          {/if}
          <button class="primary begin-btn" style="margin-top: 16px;" onclick={checkLicense}>
            Check activation status
          </button>
          <button class="ghost" style="margin-top: 6px;" onclick={close}>Cancel</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.45);
    backdrop-filter: blur(6px);
    display: grid;
    place-items: center;
    z-index: 200;
    padding: 20px;
  }

  .modal-sheet {
    width: 100%;
    max-width: 540px;
    background: var(--panel-solid, #ffffff);
    border-radius: 16px;
    border: 1px solid var(--border);
    box-shadow: 0 20px 50px rgba(15, 23, 42, 0.15);
    padding: 28px 36px 20px 36px;
    display: flex;
    flex-direction: column;
    animation: popIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 18px;
  }
  .modal-title {
    font-size: 24px;
    font-weight: 700;
    margin: 0;
    color: var(--text);
    letter-spacing: -0.4px;
  }
  .close-btn {
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 6px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    box-shadow: none;
  }
  .close-btn:hover {
    background: var(--panel-2);
    color: var(--text);
  }

  .modal-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .prompt-text {
    font-size: 14.5px;
    color: var(--text-secondary);
    margin: 0 0 14px 0;
  }
  .prompt-text strong {
    color: var(--text);
    font-weight: 700;
  }

  .inputs-group {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 14px;
  }
  .soft-input {
    width: 100%;
    padding: 12px 18px;
    border-radius: 9999px;
    background: var(--panel-2);
    border: 1.5px solid var(--border);
    font-size: 14px;
    color: var(--text);
    outline: none;
    transition: all 0.2s ease;
  }
  .soft-input:focus {
    background: var(--panel-solid);
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
  }

  .plan-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 10px;
    width: 100%;
    margin-bottom: 12px;
  }
  .plan-card-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 3px;
    width: 100%;
    min-width: 0;
    padding: 11px 14px;
    border-radius: 12px;
    border: 1.5px solid var(--border);
    background: var(--panel-2);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    white-space: normal;
    box-shadow: none;
    transition: all 0.15s ease;
  }
  .plan-card-btn:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--panel-solid);
  }
  .plan-card-btn.selected {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.12);
    box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.25);
  }
  .plan-card-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
    line-height: 1.25;
  }
  .plan-card-sub {
    font-size: 11.5px;
    color: var(--muted);
    font-weight: 500;
    line-height: 1.25;
  }
  .plan-card-sub.highlight {
    color: var(--accent);
    font-weight: 600;
  }

  .addon-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 14px;
    margin-bottom: 16px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .action-row {
    width: 100%;
    display: flex;
    justify-content: center;
  }
  .begin-btn {
    padding: 12px 42px;
    border-radius: 10px;
    font-weight: 700;
    font-size: 14px;
    background: linear-gradient(135deg, #059669 0%, #10b981 100%);
    color: #ffffff;
    border: none;
    box-shadow: 0 4px 14px rgba(16, 185, 129, 0.28);
    transition: all 0.2s ease;
  }
  .begin-btn:hover:not(:disabled) {
    box-shadow: 0 6px 18px rgba(16, 185, 129, 0.4);
    transform: translateY(-1px);
  }

  .waiting-body {
    padding: 20px 0;
  }
  .spinner {
    width: 38px;
    height: 38px;
    border: 3.5px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
    margin-bottom: 16px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes popIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }

  .error-banner {
    padding: 8px 14px;
    margin-bottom: 14px;
    background: rgba(239, 68, 68, 0.14);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: var(--danger);
    border-radius: 8px;
    font-size: 12.5px;
    width: 100%;
  }
</style>

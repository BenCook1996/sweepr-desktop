<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { PRICING } from "../lib/format";

  let { open = $bindable(false), onActivated }: { open: boolean; onActivated?: () => void } = $props();

  let email = $state("");
  let emailConfirm = $state("");
  let selectedPlan = $state<"monthly" | "annual">("monthly");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let waitingPayment = $state(false);
  let activeInfo = $state<"privacy" | "sales" | "info" | null>(null);
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
    if (email.trim().toLowerCase() !== emailConfirm.trim().toLowerCase()) {
      error = "Email addresses do not match.";
      return;
    }

    busy = true;
    try {
      await api.startCheckout(email.trim(), selectedPlan);
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
    activeInfo = null;
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
            Please enter your <strong>Email address</strong> (required for activation)
          </p>

          <div class="plan-cards" role="radiogroup" aria-label="Select billing plan">
            <button
              type="button"
              class="plan-card"
              class:selected={selectedPlan === "monthly"}
              onclick={() => (selectedPlan = "monthly")}
              aria-pressed={selectedPlan === "monthly"}
            >
              <div class="row" style="justify-content: space-between; width: 100%;">
                <strong>Monthly Plan</strong>
                <span class="badge free">30-Day Trial</span>
              </div>
              <div class="plan-price">{PRICING.activation} today</div>
              <div class="muted small">then {PRICING.monthly}/mo · Cancel anytime</div>
            </button>

            <button
              type="button"
              class="plan-card"
              class:selected={selectedPlan === "annual"}
              onclick={() => (selectedPlan = "annual")}
              aria-pressed={selectedPlan === "annual"}
            >
              <div class="row" style="justify-content: space-between; width: 100%;">
                <strong>Annual Plan</strong>
                <span class="badge pro">{PRICING.annualSave}</span>
              </div>
              <div class="plan-price">{PRICING.annual}/yr</div>
              <div class="muted small">{PRICING.annualSave} · Billed yearly, no free trial</div>
            </button>
          </div>

          <div class="inputs-group">
            <input
              type="email"
              bind:value={email}
              placeholder="Enter email address"
              class="soft-input"
              aria-label="Email address"
            />
            <input
              type="email"
              bind:value={emailConfirm}
              placeholder="Re-enter email address"
              class="soft-input"
              aria-label="Confirm email address"
            />
          </div>

          <div class="pricing-hint muted small">
            {#if selectedPlan === "monthly"}
              {PRICING.activation} today, then {PRICING.monthly}/month. Cancel anytime.
            {:else}
              {PRICING.annual}/yr — {PRICING.annualSave}, no free trial. Cancel anytime.
            {/if}
          </div>

          {#if error}
            <div class="error-banner">{error}</div>
          {/if}

          <div class="action-row">
            <button class="primary begin-btn" disabled={busy} onclick={handleActivate}>
              {busy ? "Opening checkout…" : selectedPlan === "annual" ? `Activate Annual (${PRICING.annual}/yr)` : "Begin activation"}
            </button>
          </div>
        </div>

        {#if activeInfo === "privacy"}
          <div class="info-drawer muted small">
            <strong>Privacy Policy:</strong> SWEEPR Cleaner scans your files locally on your PC—never uploading file names or contents. Your email is used solely for licence activation and billing receipts via Stripe.
          </div>
        {:else if activeInfo === "sales"}
          <div class="info-drawer muted small">
            <strong>Sales Policy:</strong> {PRICING.activation} for your first {PRICING.trialDays} days on the Monthly plan (then {PRICING.monthly}/month), or {PRICING.annual}/year on the Annual plan ({PRICING.annualSave}, no trial). Cancel anytime in 1 click from the Account tab.
          </div>
        {:else if activeInfo === "info"}
          <div class="info-drawer muted small">
            <strong>More info:</strong> Your SWEEPR Cleaner Pro subscription unlocks deep browser/app cache cleanup, duplicate finder, registry repair, file shredder, and covers up to 3 PCs + 3 mobile devices.
          </div>
        {/if}

        <!-- Modal Footer Links -->
        <div class="modal-footer">
          <button type="button" class="footer-link" onclick={() => (activeInfo = activeInfo === "privacy" ? null : "privacy")}>Privacy Policy</button>
          <button type="button" class="footer-link" onclick={() => (activeInfo = activeInfo === "sales" ? null : "sales")}>Sales Policy</button>
          <button type="button" class="footer-link" onclick={() => (activeInfo = activeInfo === "info" ? null : "info")}>More info</button>
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

  .plan-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    width: 100%;
    margin-bottom: 16px;
  }
  .plan-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    gap: 4px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1.5px solid var(--border);
    background: var(--panel-2);
    cursor: pointer;
    box-shadow: none;
    white-space: normal;
  }
  .plan-card.selected {
    border-color: var(--accent);
    background: var(--accent-light);
  }
  .plan-price {
    font-size: 18px;
    font-weight: 800;
    color: var(--accent);
    margin-top: 2px;
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
    background: #edf3f8;
    border: 1.5px solid transparent;
    font-size: 14px;
    color: #0f172a;
    outline: none;
    transition: all 0.2s ease;
  }
  .soft-input:focus {
    background: #ffffff;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
  }

  .pricing-hint {
    margin-bottom: 18px;
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

  .info-drawer {
    margin-top: 16px;
    padding: 10px 14px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    text-align: left;
    line-height: 1.45;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 20px;
    margin-top: 20px;
    padding-top: 12px;
  }
  .footer-link {
    background: transparent;
    border: none;
    padding: 0;
    box-shadow: none;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    color: var(--muted);
    text-decoration: underline;
    transition: color 0.15s;
  }
  .footer-link:hover {
    color: var(--text);
    background: transparent;
  }

  .waiting-body {
    padding: 20px 0;
  }
  .spinner {
    width: 38px;
    height: 38px;
    border: 3.5px solid #e2e8f0;
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
    background: #fef2f2;
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: #b91c1c;
    border-radius: 8px;
    font-size: 12.5px;
    width: 100%;
  }
</style>

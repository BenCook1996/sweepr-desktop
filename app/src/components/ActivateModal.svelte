<script lang="ts">
  import { onDestroy } from "svelte";
  import { api, errorMessage } from "../lib/api";

  let { open = $bindable(false), onActivated }: { open: boolean; onActivated?: () => void } = $props();

  type PlanId = "monthly" | "six_month" | "annual";

  let email = $state("");
  let selectedPlan = $state<PlanId>("monthly");
  let showSignIn = $state(false);
  let showQrScan = $state(false);
  let qrSvg = $state<string | null>(null);
  let qrCountdown = $state(120);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let waitingPayment = $state(false);
  let unlockedSuccess = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let qrTimer: ReturnType<typeof setInterval> | null = null;

  const ctaPriceLabel = $derived(
    selectedPlan === "monthly"
      ? "£1.99"
      : selectedPlan === "six_month"
      ? "£38.99"
      : "£49.99"
  );

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (qrTimer) clearInterval(qrTimer);
    qrTimer = null;
  }

  async function startQrSignIn() {
    error = null;
    showQrScan = true;
    qrSvg = null;
    stopPolling();
    try {
      const ch = await api.startQrChallenge();
      qrSvg = ch.qr_svg;
      qrCountdown = ch.ttl_seconds || 120;
      qrTimer = setInterval(async () => {
        qrCountdown = Math.max(0, qrCountdown - 1);
        if (qrCountdown <= 0) {
          stopPolling();
          return;
        }
        if (qrCountdown % 2 === 0) {
          try {
            const res = await api.pollQrChallenge(ch.challenge_id, ch.poll_secret);
            if (res.status === "approved") {
              notifyActivated();
            } else if (res.status === "expired") {
              qrCountdown = 0;
              stopPolling();
            }
          } catch {}
        }
      }, 1000);
    } catch (e) {
      error = errorMessage(e);
    }
  }

  function notifyActivated() {
    stopPolling();
    waitingPayment = false;
    unlockedSuccess = true;
    setTimeout(() => {
      open = false;
      unlockedSuccess = false;
      showSignIn = false;
      if (onActivated) onActivated();
      window.dispatchEvent(new CustomEvent("sweepr-license-activated"));
    }, 420);
  }

  async function checkLicense(): Promise<boolean> {
    try {
      const s = await api.licenseStatus(true);
      if (s.active) {
        notifyActivated();
        return true;
      }
    } catch { /* polling */ }
    return false;
  }

  async function handleActivate() {
    error = null;
    const trimmedEmail = email.trim();
    if (showSignIn && (!trimmedEmail || !trimmedEmail.includes("@"))) {
      error = "Enter the email address used for your Pro subscription.";
      return;
    }
    if (trimmedEmail && !trimmedEmail.includes("@")) {
      error = "Enter a valid email address.";
      return;
    }

    busy = true;
    try {
      const emailArg = trimmedEmail ? trimmedEmail : undefined;
      const activatedImmediately = await api.startCheckout(emailArg, selectedPlan);
      if (activatedImmediately || (await checkLicense())) {
        notifyActivated();
        return;
      }
      waitingPayment = true;
      stopPolling();
      let ticks = 0;
      pollTimer = setInterval(async () => {
        if (++ticks > 240) stopPolling();
        await checkLicense();
      }, 2500);
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
    showSignIn = false;
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  onDestroy(stopPolling);
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if open}
  <div class="modal-backdrop" onclick={close} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal-sheet card" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <button class="close-btn" onclick={close} aria-label="Close">✕</button>

      {#if unlockedSuccess}
        <div class="modal-body waiting-body">
          <div class="unlock-morph-badge" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path class="unlock-shackle" d="M8 11V7a4 4 0 017.4-2" />
              <path class="unlock-check" d="M9.5 16l1.8 1.8 3.6-3.6" />
            </svg>
          </div>
          <h3 class="waiting-title">Pro Activated ✓</h3>
          <p class="prompt-text">Resuming cleanup automatically…</p>
        </div>
      {:else if !waitingPayment}
        <div class="modal-body">
          <div class="brand-pill">
            <span class="brand-dot"></span>
            <span>SWEEPR Pro</span>
          </div>

          <h2 class="modal-title">Clean &amp; speed up in 1 click</h2>
          <p class="prompt-text">Try your first month for £1.99. Cancel anytime.</p>

          <div class="plan-grid">
            <button
              type="button"
              class="plan-card-btn"
              class:selected={selectedPlan === "monthly"}
              onclick={() => (selectedPlan = "monthly")}
            >
              <div class="plan-card-top">
                <span class="plan-label">Monthly</span>
                <span class="radio-dot" aria-hidden="true"></span>
              </div>
              <span class="plan-price">£1.99</span>
              <span class="plan-sub">1st mo, then £9.99</span>
            </button>

            <button
              type="button"
              class="plan-card-btn"
              class:selected={selectedPlan === "six_month"}
              onclick={() => (selectedPlan = "six_month")}
            >
              <div class="plan-card-top">
                <span class="plan-label">6 Months</span>
                <span class="radio-dot" aria-hidden="true"></span>
              </div>
              <span class="plan-price">£38.99</span>
              <span class="plan-sub highlight">Save 35% (£6.50/mo)</span>
            </button>

            <button
              type="button"
              class="plan-card-btn"
              class:selected={selectedPlan === "annual"}
              onclick={() => (selectedPlan = "annual")}
            >
              <div class="plan-card-top">
                <span class="plan-label">Yearly</span>
                <span class="radio-dot" aria-hidden="true"></span>
              </div>
              <span class="plan-price">£49.99</span>
              <span class="plan-sub highlight">Save 58% (£4.16/mo)</span>
            </button>
          </div>

          {#if showSignIn}
            <div class="signin-drawer">
              <input
                type="email"
                bind:value={email}
                placeholder="Enter your Pro email address"
                class="neutral-input"
                aria-label="Email address"
                onkeydown={(e) => e.key === "Enter" && handleActivate()}
              />
              <div style="display: flex; justify-content: flex-end; margin-top: 6px;">
                <button type="button" class="link-btn" onclick={startQrSignIn}>
                  Sign In with QR Code
                </button>
              </div>
            </div>
          {/if}

          {#if showQrScan}
            <div style="width: 100%; margin-bottom: 12px; padding: 12px; border-radius: 14px; background: var(--panel-2); border: 1px solid var(--border); display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center;">
              {#if qrSvg}
                <div style="width: 150px; height: 150px; background: #fff; padding: 8px; border-radius: 10px;">
                  {@html qrSvg}
                </div>
              {:else}
                <span style="font-size: 12px; color: var(--muted);">Generating QR code…</span>
              {/if}
              <div style="display: flex; align-items: center; gap: 10px; font-size: 11.5px; color: var(--muted);">
                <span>Expires in {qrCountdown}s</span>
                <button type="button" class="link-btn" onclick={startQrSignIn}>Refresh QR</button>
                <button type="button" class="link-btn" onclick={() => { stopPolling(); showQrScan = false; }}>Hide QR</button>
              </div>
            </div>
          {/if}

          {#if error}
            <div class="error-banner">{error}</div>
          {/if}

          <button class="begin-btn" disabled={busy} onclick={handleActivate}>
            {#if busy}
              <span>Opening…</span>
            {:else if showSignIn && email.trim()}
              <span>Activate Existing Pro</span>
              <span class="btn-arrow">→</span>
            {:else}
              <span>Continue for {ctaPriceLabel}</span>
              <span class="btn-arrow">→</span>
            {/if}
          </button>

          <div class="footer-links">
            <span class="secure-label">🔒 Stripe Secure Checkout</span>
            <button
              type="button"
              class="link-btn"
              onclick={() => {
                showSignIn = !showSignIn;
                error = null;
              }}
            >
              {showSignIn ? "Hide sign in" : "Already have Pro? Sign in"}
            </button>
          </div>
        </div>
      {:else}
        <div class="modal-body waiting-body">
          <div class="spinner"></div>
          <h3 class="waiting-title">Waiting for payment…</h3>
          <p class="prompt-text">Cleanup resumes automatically once confirmed.</p>
          {#if error}
            <div class="error-banner">{error}</div>
          {/if}
          <button class="begin-btn" onclick={checkLicense}>Check Status</button>
          <button class="ghost cancel-btn" onclick={close}>Cancel</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(7, 10, 13, 0.72);
    backdrop-filter: blur(8px);
    display: grid;
    place-items: center;
    z-index: 200;
    padding: 20px;
  }

  .modal-sheet {
    position: relative;
    width: 100%;
    max-width: 440px;
    background: var(--panel-solid, #ffffff);
    border-radius: 22px;
    border: 1px solid var(--border);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
    padding: 24px 24px 20px 24px;
    display: flex;
    flex-direction: column;
    animation: popIn 160ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .close-btn {
    position: absolute;
    top: 16px;
    right: 16px;
    width: 28px;
    height: 28px;
    border-radius: 9999px;
    background: var(--panel-2);
    border: none;
    color: var(--muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    padding: 0;
    box-shadow: none;
    transition: background-color 140ms ease, color 140ms ease;
  }
  .close-btn:hover {
    background: var(--border);
    color: var(--text);
  }

  .modal-body {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
  }

  .brand-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 9999px;
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.28);
    color: #059669;
    font-size: 11px;
    font-weight: 700;
    margin-bottom: 10px;
  }
  :global(.dark) .brand-pill {
    color: #34d399;
  }
  .brand-dot {
    width: 6px;
    height: 6px;
    border-radius: 9999px;
    background: #10b981;
  }

  .modal-title {
    font-size: 21px;
    font-weight: 800;
    margin: 0;
    color: var(--text);
    letter-spacing: -0.4px;
    line-height: 1.25;
  }
  .prompt-text {
    font-size: 13px;
    color: var(--muted);
    margin: 4px 0 18px 0;
  }

  .plan-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    width: 100%;
    margin-bottom: 18px;
  }
  .plan-card-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 12px 11px;
    border-radius: 16px;
    border: 2px solid var(--border);
    background: var(--panel);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    box-shadow: none;
    transition: transform 75ms cubic-bezier(0.16, 1, 0.3, 1), border-color 140ms ease, background-color 140ms ease;
  }
  .plan-card-btn:active {
    transform: scale(0.985);
  }
  .plan-card-btn:hover {
    border-color: rgba(16, 185, 129, 0.55);
  }
  .plan-card-btn.selected {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.08);
  }

  .plan-card-top {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .plan-label {
    font-size: 11.5px;
    font-weight: 700;
    color: var(--text);
    opacity: 0.85;
  }
  .radio-dot {
    width: 15px;
    height: 15px;
    border-radius: 9999px;
    border: 2px solid var(--border);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: border-color 140ms ease, background-color 140ms ease;
  }
  .plan-card-btn.selected .radio-dot {
    border-color: #10b981;
    background: #10b981;
    box-shadow: inset 0 0 0 2.5px var(--panel-solid, #ffffff);
  }

  .plan-price {
    font-size: 21px;
    font-weight: 900;
    color: var(--text);
    letter-spacing: -0.5px;
    line-height: 1.05;
  }
  .plan-sub {
    font-size: 10.5px;
    font-weight: 500;
    color: var(--muted);
    margin-top: 6px;
    line-height: 1.25;
  }
  .plan-sub.highlight {
    color: #059669;
    font-weight: 700;
  }
  :global(.dark) .plan-sub.highlight {
    color: #34d399;
  }

  .signin-drawer {
    width: 100%;
    margin-bottom: 12px;
  }
  .neutral-input {
    width: 100%;
    padding: 10px 13px;
    border-radius: 12px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    font-size: 13px;
    color: var(--text);
    outline: none;
    transition: border-color 140ms ease, box-shadow 140ms ease;
  }
  .neutral-input:focus {
    border-color: #64748b;
    box-shadow: 0 0 0 3px rgba(100, 116, 139, 0.15);
  }

  .begin-btn {
    width: 100%;
    padding: 13px 20px;
    border-radius: 13px;
    font-weight: 700;
    font-size: 14.5px;
    background: linear-gradient(90deg, #059669 0%, #10b981 100%);
    color: #ffffff;
    border: none;
    box-shadow: 0 6px 20px rgba(16, 185, 129, 0.28);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: transform 75ms cubic-bezier(0.16, 1, 0.3, 1), filter 140ms ease;
  }
  .begin-btn:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .begin-btn:active:not(:disabled) {
    transform: scale(0.985);
  }
  .btn-arrow {
    color: #d1fae5;
    font-weight: 700;
  }

  .footer-links {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    font-size: 11.5px;
    color: var(--muted);
  }
  .secure-label {
    opacity: 0.85;
  }
  .link-btn {
    background: none;
    border: none;
    padding: 0;
    color: var(--muted);
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: none;
    transition: color 140ms ease;
  }
  .link-btn:hover {
    color: #059669;
    text-decoration: underline;
  }
  :global(.dark) .link-btn:hover {
    color: #34d399;
  }

  .waiting-body {
    align-items: center;
    text-align: center;
    padding: 12px 0 4px 0;
    gap: 12px;
  }
  .waiting-title {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
    color: var(--text);
  }
  .cancel-btn {
    width: 100%;
    font-size: 12px;
  }
  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border);
    border-top-color: #10b981;
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .unlock-morph-badge {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    background: rgba(16, 185, 129, 0.16);
    border: 1px solid rgba(16, 185, 129, 0.45);
    display: grid;
    place-items: center;
    animation: popIn 160ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .unlock-shackle {
    transform-origin: 16px 11px;
    animation: shackleLift 160ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .unlock-check {
    stroke-dasharray: 14;
    stroke-dashoffset: 14;
    animation: checkDraw 140ms cubic-bezier(0.16, 1, 0.3, 1) 50ms forwards;
  }
  @keyframes shackleLift {
    from { transform: translateY(0) rotate(0deg); }
    to   { transform: translateY(-2px) rotate(12deg); }
  }
  @keyframes checkDraw {
    to { stroke-dashoffset: 0; }
  }

  .error-banner {
    width: 100%;
    padding: 9px 12px;
    border-radius: 10px;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: var(--danger, #ef4444);
    font-size: 12px;
    margin-bottom: 12px;
  }
</style>

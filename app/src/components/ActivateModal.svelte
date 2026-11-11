<script lang="ts">
  import { onDestroy } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { api, errorMessage, trackAppEvent, type PaywallContext } from "../lib/api";

  let {
    open = $bindable(false),
    context = null,
    onActivated,
  }: {
    open: boolean;
    context?: PaywallContext | null;
    onActivated?: () => void;
  } = $props();

  type PlanId = "monthly" | "six_month" | "annual";

  let email = $state("");
  let selectedPlan = $state<PlanId>("annual");
  let experimentVariant = $state<"A" | "B">("A");
  let conversionOffer = $state<{
    offer_type?: string;
    coupon_code?: string;
    discount_pct?: number;
    headline?: string;
    subheadline?: string;
  } | null>(null);
  let lastTrackedOpen = false;

  $effect(() => {
    if (open && !lastTrackedOpen) {
      lastTrackedOpen = true;
      api
        .appInfo()
        .then((info) => {
          const base = (info.api_url || "https://sweeprcleaner.com").replace(/\/+$/, "");
          const uid = encodeURIComponent(info.device_id || info.machine_id || "desktop");
          let lastScanBytes = 0;
          try {
            lastScanBytes = Number(localStorage.getItem("sweepr_last_scan_bytes") || "0") || 0;
          } catch {
            lastScanBytes = 0;
          }
          void fetch(`${base}/v1/conversion/offer?hardware_id=${uid}&bytes_found=${lastScanBytes}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((offer) => {
              if (offer && Number(offer.discount_pct || 0) > 0) {
                conversionOffer = {
                  offer_type: String(offer.offer_type || "scan_tier"),
                  coupon_code: String(offer.coupon_code || offer.coupon || "SCAN5GB20"),
                  discount_pct: Number(offer.discount_pct || 20),
                  headline: String(offer.headline || `Save ${offer.discount_pct}% on Annual Pro`),
                  subheadline: String(offer.subheadline || `Code ${offer.coupon_code || offer.coupon || "SCAN5GB20"} unlocked from your scan`),
                };
              }
            })
            .catch(() => {});
          return fetch(`${base}/api/experiments/assign?experiment=paywall_anchor_v1&uid=${uid}`);
        })
        .then((r) => (r.ok ? r.json() : null))
        .then((exp) => {
          const assignedVariant = exp?.assignments?.paywall_anchor_v1?.variant || exp?.variant;
          if (assignedVariant === "B") {
            experimentVariant = "B";
            introOfferActive = true;
            selectedPlan = "monthly";
          } else {
            experimentVariant = "A";
            selectedPlan = "annual";
          }
          trackAppEvent("paywall_viewed", {
            plan: selectedPlan,
            experiment_id: "paywall_anchor_v1",
            variant: experimentVariant,
            trigger_feature: context?.feature ?? null,
            freed_bytes: context?.freedBytes ?? null,
            remaining_bytes: context?.remainingBytes ?? null,
          });
        })
        .catch(() => {
          trackAppEvent("paywall_viewed", { plan: selectedPlan, experiment_id: "paywall_anchor_v1", variant: "A" });
        });
    } else if (!open && lastTrackedOpen) {
      lastTrackedOpen = false;
    }
  });
  let showSignIn = $state(false);
  let otpSent = $state(false);
  let otpCode = $state("");
  let statusNotice = $state<string | null>(null);
  let showQrScan = $state(false);
  let qrSvg = $state<string | null>(null);
  let qrCountdown = $state(120);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let waitingPayment = $state(false);
  let unlockedSuccess = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let qrTimer: ReturnType<typeof setInterval> | null = null;

  function selectPlan(plan: PlanId) {
    selectedPlan = plan;
    trackAppEvent("paywall_plan_selected", {
      plan,
      experiment_id: "paywall_anchor_v1",
      variant: experimentVariant,
    });
  }

  let monthlyIntroLabel = $state("£1.99");
  let introOfferActive = $state(false);
  let monthlyRenewLabel = $state("£9.99");

  function activateIntroRescueOffer() {
    introOfferActive = true;
    selectPlan("monthly");
  }
  let sixMonthLabel = $state("£38.99");
  let sixMonthPerMoLabel = $state("£6.50");
  let sixMonthRegularTotalLabel = $state("£59.94");
  let sixMonthSavingsPercent = $state(Math.round((1 - (38.99 / (9.99 * 6))) * 100));
  let annualLabel = $state("£49.99");
  let annualPerMoLabel = $state("£4.16");
  let annualRegularTotalLabel = $state("£119.88");
  let annualSavingsPercent = $state(Math.round((1 - (49.99 / (9.99 * 12))) * 100));
  let currencySymbol = $state("£");
  let currencySymbolPosition = $state<"prefix" | "suffix">("prefix");
  let currencyZeroDecimal = $state(false);
  let introMonthlyAmount = $state(199);
  let monthlyAmount = $state(999);
  let sixMonthAmount = $state(3899);
  let annualAmount = $state(4999);
  let addonMonthlyAmount = $state(199);
  let addonSixMonthAmount = $state(699);
  let addonAnnualAmount = $state(999);
  let batteryAddonMonthlyLabel = $state("£1.99");
  let batteryAddonSixMonthLabel = $state("£6.99");
  let batteryAddonLabel = $state("£9.99");
  let cloudAddonMonthlyLabel = $state("£1.99");
  let cloudAddonSixMonthLabel = $state("£6.99");
  let cloudAddonLabel = $state("£9.99");
  let addBatteryCare = $state(false);
  let addCloudVault = $state(false);

  function formatMinorAmount(minor: number): string {
    const numStr = currencyZeroDecimal
      ? Math.round(minor).toLocaleString("en-US")
      : (minor / 100).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
    return currencySymbolPosition === "suffix" ? `${numStr}${currencySymbol}` : `${currencySymbol}${numStr}`;
  }

  $effect(() => {
    let tz = "";
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      if (tz.startsWith("America/")) {
        currencySymbol = "$";
        currencySymbolPosition = "prefix";
        currencyZeroDecimal = false;
        introMonthlyAmount = 199;
        monthlyAmount = 1199;
        sixMonthAmount = 4799;
        annualAmount = 6499;
        addonMonthlyAmount = 199;
        addonSixMonthAmount = 699;
        addonAnnualAmount = 999;
        monthlyIntroLabel = "$1.99";
        monthlyRenewLabel = "$11.99";
        sixMonthLabel = "$47.99";
        sixMonthPerMoLabel = "$7.99";
        sixMonthRegularTotalLabel = "$71.94";
        sixMonthSavingsPercent = Math.round((1 - (47.99 / (11.99 * 6))) * 100);
        annualLabel = "$64.99";
        annualPerMoLabel = "$5.41";
        annualRegularTotalLabel = "$143.88";
        annualSavingsPercent = Math.round((1 - (64.99 / (11.99 * 12))) * 100);
        batteryAddonMonthlyLabel = "$1.99";
        batteryAddonSixMonthLabel = "$6.99";
        batteryAddonLabel = "$9.99";
        cloudAddonMonthlyLabel = "$1.99";
        cloudAddonSixMonthLabel = "$6.99";
        cloudAddonLabel = "$9.99";
      } else if (tz.startsWith("Europe/") && !tz.includes("London") && !tz.includes("Belfast")) {
        currencySymbol = "€";
        currencySymbolPosition = "prefix";
        currencyZeroDecimal = false;
        introMonthlyAmount = 199;
        monthlyAmount = 1099;
        sixMonthAmount = 4499;
        annualAmount = 5999;
        addonMonthlyAmount = 199;
        addonSixMonthAmount = 699;
        addonAnnualAmount = 999;
        monthlyIntroLabel = "€1.99";
        monthlyRenewLabel = "€10.99";
        sixMonthLabel = "€44.99";
        sixMonthPerMoLabel = "€7.49";
        sixMonthRegularTotalLabel = "€65.94";
        sixMonthSavingsPercent = Math.round((1 - (44.99 / (10.99 * 6))) * 100);
        annualLabel = "€59.99";
        annualPerMoLabel = "€4.99";
        annualRegularTotalLabel = "€131.88";
        annualSavingsPercent = Math.round((1 - (59.99 / (10.99 * 12))) * 100);
        batteryAddonMonthlyLabel = "€1.99";
        batteryAddonSixMonthLabel = "€6.99";
        batteryAddonLabel = "€9.99";
        cloudAddonMonthlyLabel = "€1.99";
        cloudAddonSixMonthLabel = "€6.99";
        cloudAddonLabel = "€9.99";
      }
    } catch {}
    api
      .appInfo()
      .then((info) => {
        const base = (info.api_url || "https://sweeprcleaner.com").replace(/\/+$/, "");
        const qs = tz ? `?tz=${encodeURIComponent(tz)}` : "";
        return fetch(`${base}/api/pricing${qs}`);
      })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        const p = cfg?.pricing;
        if (!p) return;
        if (typeof p.symbol === "string" && p.symbol) currencySymbol = p.symbol;
        if (p.symbolPosition === "suffix" || p.symbolPosition === "prefix") {
          currencySymbolPosition = p.symbolPosition;
        }
        if (typeof p.zeroDecimal === "boolean") currencyZeroDecimal = p.zeroDecimal;
        if (Number(p.introMonthlyAmount) > 0) introMonthlyAmount = Number(p.introMonthlyAmount);
        if (Number(p.monthlyAmount) > 0) monthlyAmount = Number(p.monthlyAmount);
        if (Number(p.sixMonthAmount) > 0) sixMonthAmount = Number(p.sixMonthAmount);
        if (Number(p.annualAmount) > 0) annualAmount = Number(p.annualAmount);
        if (Number(p.batteryCareMonthlyAmount) > 0) addonMonthlyAmount = Number(p.batteryCareMonthlyAmount);
        if (Number(p.batteryCareSixMonthAmount) > 0) addonSixMonthAmount = Number(p.batteryCareSixMonthAmount);
        if (Number(p.batteryCareAnnualAmount) > 0) addonAnnualAmount = Number(p.batteryCareAnnualAmount);
        if (p.introMonthlyFormatted || p.monthlyIntroFormatted) {
          monthlyIntroLabel = p.introMonthlyFormatted || p.monthlyIntroFormatted;
        }
        if (p.monthlyFormatted) monthlyRenewLabel = p.monthlyFormatted;
        if (p.sixMonthFormatted) sixMonthLabel = p.sixMonthFormatted;
        if (p.sixMonthMonthlyEqFormatted || p.sixMonthPerMonthFormatted) {
          sixMonthPerMoLabel = p.sixMonthMonthlyEqFormatted || p.sixMonthPerMonthFormatted;
        }
        if (p.sixMonthRegularTotalFormatted) {
          sixMonthRegularTotalLabel = p.sixMonthRegularTotalFormatted;
        }
        if (p.annualFormatted) annualLabel = p.annualFormatted;
        if (p.annualMonthlyEqFormatted || p.annualPerMonthFormatted) {
          annualPerMoLabel = p.annualMonthlyEqFormatted || p.annualPerMonthFormatted;
        }
        if (p.annualRegularTotalFormatted) {
          annualRegularTotalLabel = p.annualRegularTotalFormatted;
        }
        if (typeof p.sixMonthSavingsPercent === "number" && p.sixMonthSavingsPercent > 0) {
          sixMonthSavingsPercent = p.sixMonthSavingsPercent;
        } else if (Number(p.sixMonthAmount) > 0 && Number(p.monthlyAmount) > 0) {
          sixMonthSavingsPercent = Math.round((1 - (Number(p.sixMonthAmount) / (Number(p.monthlyAmount) * 6))) * 100);
        }
        if (typeof p.annualSavingsPercent === "number" && p.annualSavingsPercent > 0) {
          annualSavingsPercent = p.annualSavingsPercent;
        } else if (Number(p.annualAmount) > 0 && Number(p.monthlyAmount) > 0) {
          annualSavingsPercent = Math.round((1 - (Number(p.annualAmount) / (Number(p.monthlyAmount) * 12))) * 100);
        }
        if (p.batteryCareMonthlyFormatted) batteryAddonMonthlyLabel = p.batteryCareMonthlyFormatted;
        if (p.batteryCareSixMonthFormatted) batteryAddonSixMonthLabel = p.batteryCareSixMonthFormatted;
        if (p.batteryCareAnnualFormatted) batteryAddonLabel = p.batteryCareAnnualFormatted;
        if (p.cloudVaultMonthlyFormatted) cloudAddonMonthlyLabel = p.cloudVaultMonthlyFormatted;
        if (p.cloudVaultSixMonthFormatted) cloudAddonSixMonthLabel = p.cloudVaultSixMonthFormatted;
        if (p.cloudVaultAnnualFormatted) cloudAddonLabel = p.cloudVaultAnnualFormatted;
      })
      .catch(() => {});
  });

  const selectedAddons = $derived([
    ...(addBatteryCare ? ["battery_care"] : []),
    ...(addCloudVault ? ["cloud_vault"] : []),
  ]);

  const activeBatteryAddonBadge = $derived(
    selectedPlan === "monthly"
      ? `+${batteryAddonMonthlyLabel}/mo`
      : selectedPlan === "six_month"
      ? `+${batteryAddonSixMonthLabel}/6mo`
      : `+${batteryAddonLabel}/yr`
  );

  const activeCloudAddonBadge = $derived(
    selectedPlan === "monthly"
      ? `+${cloudAddonMonthlyLabel}/mo`
      : selectedPlan === "six_month"
      ? `+${cloudAddonSixMonthLabel}/6mo`
      : `+${cloudAddonLabel}/yr`
  );

  const basePlanLabel = $derived(
    selectedPlan === "monthly"
      ? introOfferActive
        ? `${monthlyIntroLabel} 1st mo`
        : `${monthlyRenewLabel}/mo`
      : selectedPlan === "six_month"
      ? `${sixMonthLabel}/6mo`
      : `${annualLabel}/yr`
  );

  const ctaPriceLabel = $derived(
    (() => {
      if (selectedAddons.length === 0) {
        const pct = Number(conversionOffer?.discount_pct || 0);
        return pct > 0 && conversionOffer?.coupon_code
          ? `${basePlanLabel} (-${pct}% w/ ${conversionOffer.coupon_code})`
          : basePlanLabel;
      }
      const baseMinor =
        selectedPlan === "monthly"
          ? introOfferActive
            ? introMonthlyAmount
            : monthlyAmount
          : selectedPlan === "six_month"
          ? sixMonthAmount
          : annualAmount;
      const addonMinor =
        selectedPlan === "monthly"
          ? addonMonthlyAmount
          : selectedPlan === "six_month"
          ? addonSixMonthAmount
          : addonAnnualAmount;
      const combinedMinor = baseMinor + selectedAddons.length * addonMinor;
      const periodSuffix =
        selectedPlan === "monthly"
          ? introOfferActive
            ? " 1st mo"
            : "/mo"
          : selectedPlan === "six_month"
          ? "/6mo"
          : "/yr";
      const totalFormatted = `${formatMinorAmount(combinedMinor)}${periodSuffix}`;
      const pct = Number(conversionOffer?.discount_pct || 0);
      return pct > 0 && conversionOffer?.coupon_code
        ? `${totalFormatted} (-${pct}% w/ ${conversionOffer.coupon_code})`
        : totalFormatted;
    })()
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

  async function requestSignInOtp() {
    error = null;
    statusNotice = null;
    const trimmedEmail = email.trim();
    if (trimmedEmail.includes("ptk_")) {
      busy = true;
      try {
        const s = await api.redeemPairingToken(trimmedEmail);
        if (s.active) {
          notifyActivated();
          return;
        }
      } catch (e) {
        error = errorMessage(e);
      } finally {
        busy = false;
      }
      return;
    }
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      error = "Enter the email address used for your Pro subscription.";
      return;
    }
    busy = true;
    try {
      await api.sendAccountOtp(trimmedEmail);
      otpSent = true;
      statusNotice = `Sent a 6-digit login code to ${trimmedEmail}. Enter it below (or paste your ptk_... pairing key).`;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function handleActivate() {
    error = null;
    statusNotice = null;
    const trimmedEmail = email.trim();
    const trimmedCode = otpCode.trim();

    if (trimmedCode.includes("ptk_") || trimmedEmail.includes("ptk_")) {
      busy = true;
      try {
        const rawTok = trimmedCode.includes("ptk_") ? trimmedCode : trimmedEmail;
        const s = await api.redeemPairingToken(rawTok);
        if (s.active) {
          notifyActivated();
          return;
        }
      } catch (e) {
        error = errorMessage(e);
      } finally {
        busy = false;
      }
      return;
    }

    if (showSignIn) {
      if (!trimmedEmail || !trimmedEmail.includes("@")) {
        error = "Enter the email address used for your Pro subscription.";
        return;
      }
      if (!otpSent && !trimmedCode) {
        await requestSignInOtp();
        return;
      }
      if (!trimmedCode) {
        error = "Enter the 6-digit verification code sent to your email (or paste your ptk_... pairing key).";
        return;
      }
      busy = true;
      try {
        const s = await api.verifyAccountOtp(trimmedEmail, trimmedCode);
        if (s.active) {
          notifyActivated();
          return;
        }
        error = "No active Pro subscription found for this account yet.";
      } catch (e) {
        error = errorMessage(e);
      } finally {
        busy = false;
      }
      return;
    }

    if (trimmedEmail && !trimmedEmail.includes("@")) {
      error = "Enter a valid email address.";
      return;
    }

    busy = true;
    try {
      const emailArg = trimmedEmail ? trimmedEmail : undefined;
      const couponArg = conversionOffer?.coupon_code?.trim() || undefined;
      const activatedImmediately =
        selectedAddons.length > 0
          ? await api.startAddonCheckout(selectedAddons.join(","), emailArg, selectedPlan, couponArg)
          : await api.startCheckout(emailArg, selectedPlan, couponArg);
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
      const msg = errorMessage(e);
      if (msg.includes("OTP_REQUIRED") || msg.includes("requires_otp")) {
        showSignIn = true;
        otpSent = true;
        statusNotice = msg.replace(/^OTP_REQUIRED:\s*/i, "");
      } else {
        error = msg;
      }
    } finally {
      busy = false;
    }
  }

  function close() {
    stopPolling();
    open = false;
    error = null;
    statusNotice = null;
    waitingPayment = false;
    showSignIn = false;
    otpSent = false;
    otpCode = "";
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
  <div
    class="modal-backdrop"
    onclick={close}
    role="presentation"
    transition:fade={{ duration: 160 }}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="modal-sheet modal card"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      transition:scale={{ duration: 220, start: 0.96, opacity: 0, easing: cubicOut }}
    >
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
          {#if context?.message}
            <div class="starter-aha-banner" role="status">
              {#if context.feature}
                <span class="starter-aha-kicker">{context.feature}</span>
              {/if}
              <p class="starter-aha-text">{context.message}</p>
            </div>
          {:else}
            <p class="prompt-text">Choose a plan below. Cancel anytime in 1 click.</p>
          {/if}

          {#if conversionOffer && (conversionOffer.discount_pct ?? 0) > 0}
            <div class="conversion-offer-banner" role="status">
              <span class="offer-badge">{conversionOffer.discount_pct}% OFF</span>
              <span class="offer-text">
                <strong>{conversionOffer.headline}</strong>
                {#if conversionOffer.coupon_code}
                  · Code <code>{conversionOffer.coupon_code}</code>
                {/if}
              </span>
            </div>
          {/if}

          <div class="plan-grid">
            <button
              type="button"
              class="plan-card-btn annual-hero-card"
              class:selected={selectedPlan === "annual"}
              onclick={() => selectPlan("annual")}
            >
              <span class="most-popular-pill">MOST POPULAR</span>
              <div class="plan-card-top">
                <span class="plan-label">Annual Pro</span>
                <span class="radio-dot" aria-hidden="true"></span>
              </div>
              <span class="plan-price">{annualPerMoLabel}<span class="plan-period">/mo</span></span>
              <span class="plan-anchor"><span class="plan-strike">{annualRegularTotalLabel}</span> {annualLabel}/yr</span>
              <span class="plan-sub highlight">Save {annualSavingsPercent}%</span>
            </button>

            <button
              type="button"
              class="plan-card-btn"
              class:selected={selectedPlan === "six_month"}
              onclick={() => selectPlan("six_month")}
            >
              <div class="plan-card-top">
                <span class="plan-label">6-Month</span>
                <span class="radio-dot" aria-hidden="true"></span>
              </div>
              <span class="plan-price">{sixMonthPerMoLabel}<span class="plan-period">/mo</span></span>
              <span class="plan-anchor"><span class="plan-strike">{sixMonthRegularTotalLabel}</span> {sixMonthLabel}/6mo</span>
              <span class="plan-sub highlight">Save {sixMonthSavingsPercent}%</span>
            </button>

            <button
              type="button"
              class="plan-card-btn"
              class:selected={selectedPlan === "monthly"}
              onclick={() => selectPlan("monthly")}
            >
              <div class="plan-card-top">
                <span class="plan-label">Monthly</span>
                <span class="radio-dot" aria-hidden="true"></span>
              </div>
              {#if introOfferActive}
                <span class="plan-price">{monthlyIntroLabel}<span class="plan-period"> 1st mo</span></span>
                <span class="plan-anchor">Renews {monthlyRenewLabel}/mo</span>
                <span class="plan-sub highlight">1st-Month Trial</span>
              {:else}
                <span class="plan-price">{monthlyRenewLabel}<span class="plan-period">/mo</span></span>
                <span class="plan-anchor">Billed monthly</span>
                <span class="plan-sub">Cancel anytime</span>
              {/if}
            </button>
          </div>

          <div class="per-device-callout">
            Covers 5 PCs, Macs &amp; Phones — just £0.83 / $1.08 per device/month (vs $39.95/yr for 1 Mac on CleanMyMac)
          </div>

          <div class="intro-rescue-row">
            {#if introOfferActive && selectedPlan === "monthly"}
              <span class="intro-rescue-active">✓ Introductory {monthlyIntroLabel} 1st-month rate active (renews {monthlyRenewLabel}/mo · cancel anytime)</span>
            {:else}
              <button type="button" class="intro-rescue-btn" onclick={activateIntroRescueOffer}>
                Hesitant to commit for a year? Try your 1st month for {monthlyIntroLabel} →
              </button>
            {/if}
          </div>

          <div class="why-sub-card">
            <div class="why-sub-title">Why a Subscription? Continuous Protection Across 5 Devices</div>
            <p class="why-sub-lead">
              Static one-time utilities go obsolete on the next Windows 24H2, macOS Sequoia, Chrome, or ComfyUI update:
            </p>
            <ul class="why-sub-list">
              <li><span>✓</span> Weekly updated cache definitions for new game patches, AI tools, and OS updates</li>
              <li><span>✓</span> Set-and-forget Scheduled Background Auto-Clean with 7-Day Undo Quarantine</li>
              <li><span>✓</span> 5-Device license covering Windows, Mac, iPhone &amp; Android with 1-click cancellation anytime</li>
            </ul>
          </div>

          <div class="addon-rows">
            <label class="addon-row-pill">
              <span class="addon-row-left">
                <input type="checkbox" bind:checked={addBatteryCare} />
                <span>Battery Health Saver (80% Charge Alert &amp; Cooling)</span>
              </span>
              <span class="addon-row-price">{activeBatteryAddonBadge}</span>
            </label>
            <label class="addon-row-pill">
              <span class="addon-row-left">
                <input type="checkbox" bind:checked={addCloudVault} />
                <span>Private File Lockbox &amp; Automatic Cloud Backup</span>
              </span>
              <span class="addon-row-price">{activeCloudAddonBadge}</span>
            </label>
          </div>

          {#if showSignIn}
            <div class="signin-drawer">
              <label for="activate-email-input" style="display: block; font-size: 11px; font-weight: 700; color: var(--muted); margin-bottom: 5px;">
                Registered Pro Email Address (or paste ptk_... pairing key)
              </label>
              <div style="display: flex; gap: 6px;">
                <input
                  id="activate-email-input"
                  type="email"
                  bind:value={email}
                  placeholder="you@company.com or ptk_..."
                  class="neutral-input"
                  aria-label="Email address or pairing key"
                  onkeydown={(e) => e.key === "Enter" && handleActivate()}
                />
                <button
                  type="button"
                  class="link-btn"
                  style="white-space: nowrap; padding: 0 8px;"
                  disabled={busy}
                  onclick={requestSignInOtp}
                >
                  {otpSent ? "Resend Code" : "Email 6-Digit Code"}
                </button>
              </div>
              <div style="margin-top: 8px;">
                <label for="activate-otp-input" style="display: block; font-size: 11px; font-weight: 700; color: var(--muted); margin-bottom: 5px;">
                  6-Digit Verification Code / Pairing Key
                </label>
                <input
                  id="activate-otp-input"
                  type="text"
                  bind:value={otpCode}
                  placeholder="123456 or ptk_..."
                  class="neutral-input"
                  aria-label="6-digit verification code or pairing key"
                  onkeydown={(e) => e.key === "Enter" && handleActivate()}
                />
              </div>
              {#if statusNotice}
                <div style="margin-top: 6px; font-size: 11.5px; color: var(--accent, #10b981); font-weight: 600;">
                  {statusNotice}
                </div>
              {/if}
              <div style="display: flex; justify-content: flex-end; margin-top: 6px;">
                <button type="button" class="link-btn" onclick={startQrSignIn}>
                  Sign In with QR Code
                </button>
              </div>
            </div>
          {/if}

          {#if showQrScan}
            <div style="width: 100%; margin-bottom: 12px; padding: 12px; border-radius: 22px; background: var(--panel-2); border: 1px solid var(--border); display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center;">
              {#if qrSvg}
                <div style="width: 150px; height: 150px; background: #fff; padding: 8px; border-radius: 10px;">
                  <img
                    src={`data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`}
                    alt="Activation QR Code"
                    style="width:100%;height:100%;display:block;"
                  />
                </div>
              {:else}
                <span style="font-size: 12px; color: var(--muted);">Generating QR code…</span>
              {/if}
              <div style="display: flex; align-items: center; gap: 10px; font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums;">
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
              <span>Verifying…</span>
            {:else if showSignIn}
              <span>{otpCode.trim() ? "Verify & Unlock Pro" : otpSent ? "Verify 6-Digit Code" : "Send 6-Digit Login Code"}</span>
              <span class="btn-arrow">→</span>
            {:else}
              <span>Continue for {ctaPriceLabel}</span>
              <span class="btn-arrow">→</span>
            {/if}
          </button>

          <div class="footer-links">
            <span class="secure-label">Stripe Secure Checkout</span>
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

  .modal-sheet,
  .modal {
    position: relative;
    width: 100%;
    max-width: 440px;
    max-height: calc(100vh - 36px);
    overflow-y: auto;
    background: var(--panel-solid, #ffffff);
    border-radius: 22px;
    border: 1px solid var(--border);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
    padding: 24px 24px 20px 24px;
    display: flex;
    flex-direction: column;
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
    transition:
      transform 120ms var(--ease-out),
      background-color 140ms var(--ease-out),
      color 140ms var(--ease-out);
  }
  .close-btn:hover {
    background: var(--border);
    color: var(--text);
  }
  .close-btn:active:not(:disabled) {
    transform: scale(0.96);
    transition-duration: 80ms;
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

  .starter-aha-banner {
    width: 100%;
    margin: 10px 0 14px 0;
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(16, 185, 129, 0.11);
    border: 1px solid rgba(16, 185, 129, 0.36);
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;
  }
  .starter-aha-kicker {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #059669;
  }
  :global(.dark) .starter-aha-kicker {
    color: #34d399;
  }
  .starter-aha-text {
    margin: 0;
    font-size: 12.5px;
    font-weight: 700;
    line-height: 1.4;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .conversion-offer-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 11px;
    margin-bottom: 12px;
    border-radius: 12px;
    border: 1px solid rgba(16, 185, 129, 0.35);
    background: rgba(16, 185, 129, 0.08);
    font-size: 11.5px;
    color: var(--text);
    text-align: left;
  }
  .offer-badge {
    background: #10b981;
    color: #ffffff;
    font-weight: 800;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 999px;
    letter-spacing: 0.03em;
    flex-shrink: 0;
  }
  .offer-text code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-weight: 700;
    color: #059669;
  }

  .plan-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    width: 100%;
    margin-bottom: 10px;
  }
  .per-device-callout {
    width: 100%;
    padding: 7px 10px;
    margin-bottom: 8px;
    border-radius: 10px;
    background: rgba(16, 185, 129, 0.08);
    border: 1px solid rgba(16, 185, 129, 0.25);
    color: var(--text);
    font-size: 11px;
    font-weight: 700;
    line-height: 1.35;
    text-align: center;
  }
  .intro-rescue-row {
    width: 100%;
    margin-bottom: 12px;
    text-align: center;
  }
  .intro-rescue-btn {
    background: transparent;
    border: none;
    padding: 2px 6px;
    font-size: 11.5px;
    font-weight: 700;
    color: #059669;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  :global(.dark) .intro-rescue-btn {
    color: #34d399;
  }
  .intro-rescue-active {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    color: #059669;
  }
  :global(.dark) .intro-rescue-active {
    color: #34d399;
  }
  .why-sub-card {
    width: 100%;
    padding: 9px 11px;
    margin-bottom: 12px;
    border-radius: 12px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    text-align: left;
  }
  .why-sub-title {
    font-size: 11.5px;
    font-weight: 800;
    color: var(--text);
    margin-bottom: 2px;
  }
  .why-sub-lead {
    font-size: 10.5px;
    color: var(--muted);
    margin: 0 0 5px 0;
    line-height: 1.35;
  }
  .why-sub-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2.5px;
    font-size: 10.5px;
    font-weight: 600;
    color: var(--text);
    line-height: 1.35;
  }
  .why-sub-list li {
    display: flex;
    align-items: baseline;
    gap: 5px;
  }
  .why-sub-list li span {
    color: #10b981;
    font-weight: 800;
    flex-shrink: 0;
  }
  .plan-card-btn {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 14px 11px 12px 11px;
    border-radius: 16px;
    border: 2px solid var(--border);
    background: var(--panel);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    box-shadow: none;
    transition:
      transform 140ms var(--ease-out),
      opacity 140ms var(--ease-out),
      border-color 140ms var(--ease-out),
      background-color 140ms var(--ease-out),
      color 140ms var(--ease-out),
      box-shadow 140ms var(--ease-out);
  }
  .most-popular-pill {
    position: absolute;
    top: -9px;
    left: 10px;
    background: #10b981;
    color: #ffffff;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.05em;
    padding: 2px 7px;
    border-radius: 999px;
    line-height: 1.2;
    box-shadow: 0 2px 6px rgba(16, 185, 129, 0.35);
  }
  .plan-period {
    font-size: 12px;
    font-weight: 700;
    color: var(--muted);
    margin-left: 1px;
  }
  .plan-anchor {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--muted);
    margin-top: 4px;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }
  .plan-strike {
    text-decoration: line-through;
    opacity: 0.65;
    margin-right: 2px;
  }
  .plan-card-btn:active:not(:disabled) {
    transform: scale(0.98);
    transition-duration: 80ms;
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
    transition:
      border-color 140ms var(--ease-out),
      background-color 140ms var(--ease-out),
      box-shadow 140ms var(--ease-out);
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
    font-variant-numeric: tabular-nums;
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

  .addon-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    margin-bottom: 14px;
  }
  .addon-row-pill {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--panel);
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    cursor: pointer;
    transition:
      transform 140ms var(--ease-out),
      opacity 140ms var(--ease-out),
      border-color 140ms var(--ease-out),
      background-color 140ms var(--ease-out),
      color 140ms var(--ease-out),
      box-shadow 140ms var(--ease-out);
  }
  .addon-row-pill:hover {
    border-color: rgba(16, 185, 129, 0.45);
  }
  .addon-row-pill:active:not(:disabled) {
    transform: scale(0.98);
    transition-duration: 80ms;
  }
  .addon-row-left {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .addon-row-price {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11.5px;
    font-weight: 700;
    color: #059669;
  }
  :global(.dark) .addon-row-price {
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
    transition:
      border-color 140ms var(--ease-out),
      box-shadow 140ms var(--ease-out);
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
    transition:
      transform 140ms var(--ease-out),
      opacity 140ms var(--ease-out),
      background-color 140ms var(--ease-out),
      box-shadow 140ms var(--ease-out),
      filter 140ms var(--ease-out);
  }
  .begin-btn:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .begin-btn:active:not(:disabled) {
    transform: scale(0.98);
    transition-duration: 80ms;
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

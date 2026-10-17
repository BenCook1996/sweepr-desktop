<script lang="ts">
  type Step = "welcome" | "installing" | "complete";
  let { onComplete, onClose }: { onComplete?: () => void; onClose?: () => void } = $props();

  let step = $state<Step>("welcome");
  let progress = $state(0);
  let statusText = $state("Preparing to install SWEEPR Cleaner…");

  function startInstall() {
    step = "installing";
    progress = 0;
    statusText = "Preparing to install SWEEPR Cleaner…";

    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 8) + 4;
      if (progress >= 25 && progress < 50) {
        statusText = "Unpacking high-performance Rust cleaning engine…";
      } else if (progress >= 50 && progress < 75) {
        statusText = "Setting up registry and cache diagnostic modules…";
      } else if (progress >= 75 && progress < 100) {
        statusText = "Finalizing secure file shredder and privacy guard…";
      } else if (progress >= 100) {
        progress = 100;
        statusText = "Installation complete! Launching SWEEPR Cleaner…";
        clearInterval(interval);
        setTimeout(() => {
          if (onComplete) onComplete();
          else step = "complete";
        }, 800);
      }
    }, 120);
  }
</script>

<div class="installer-window">
  <!-- Frameless Header -->
  <header class="installer-header">
    <div class="header-left">
      SWEEPR Cleaner 0.1.0 Installer
    </div>

    <div class="header-center">
      <div class="installer-logo" aria-hidden="true">
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" width="24" height="24">
          <defs>
            <linearGradient id="instEmeraldBg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#10b981" />
              <stop offset="100%" stop-color="#047857" />
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="96" height="96" rx="24" fill="url(#instEmeraldBg)" />
          <line x1="76" y1="24" x2="53" y2="47" stroke="#a7f3d0" stroke-width="8" stroke-linecap="round" />
          <path d="M 42 40 L 60 58 L 55 64 L 36 45 Z" fill="#ffffff" />
          <path d="M 34 48 L 52 66 L 38 82 C 30 78, 22 70, 18 62 Z" fill="#ffffff" />
          <line x1="34" y1="76" x2="43" y2="63" stroke="#047857" stroke-width="3" stroke-linecap="round" />
          <line x1="27" y1="69" x2="36" y2="56" stroke="#047857" stroke-width="3" stroke-linecap="round" />
          <path d="M 74 56 Q 74 65 83 65 Q 74 65 74 74 Q 74 65 65 65 Q 74 65 74 56 Z" fill="#ffffff" />
          <circle cx="62" cy="79" r="3.5" fill="#a7f3d0" />
        </svg>
      </div>
      <span class="installer-brand">SWEEPR <span style="color: #059669; font-weight: 800;">Cleaner</span></span>
    </div>

    <div class="header-right">
      <button class="close-btn" onclick={onClose} aria-label="Close">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </header>

  <!-- Content Container -->
  {#if step === "welcome"}
    <main class="installer-body welcome-layout">
      <div class="left-col">
        <h1 class="welcome-heading">Welcome to SWEEPR Cleaner</h1>
        <p class="welcome-sub">Smart Performance, Deep Cleaning and Privacy for your PC.</p>

        <button class="primary install-btn" onclick={startInstall}>
          INSTALL
        </button>
      </div>

      <div class="right-col">
        <!-- Friendly smiling computer mascot with SWEEPR Cleaner Emerald styling -->
        <div class="mascot-container">
          <svg viewBox="0 0 200 160" width="200" height="160" class="mascot-svg">
            <!-- Monitor Frame -->
            <rect x="20" y="15" width="160" height="110" rx="20" fill="#e2f4ea" stroke="#059669" stroke-width="6" />
            <!-- Monitor Stand -->
            <path d="M 80 125 L 75 145 L 125 145 L 120 125 Z" fill="#047857" />
            <rect x="60" y="145" width="80" height="8" rx="4" fill="#047857" />
            
            <!-- Smiling Eyes -->
            <path d="M 58 55 Q 70 42 82 55" fill="none" stroke="#1f2937" stroke-width="6" stroke-linecap="round" />
            <path d="M 118 55 Q 130 42 142 55" fill="none" stroke="#1f2937" stroke-width="6" stroke-linecap="round" />
            
            <!-- Big Happy Smile -->
            <path d="M 72 75 Q 100 105 128 75" fill="none" stroke="#1f2937" stroke-width="7" stroke-linecap="round" />
            
            <!-- Subtle Rosy Cheeks -->
            <circle cx="58" cy="74" r="7" fill="rgba(16, 185, 129, 0.3)" />
            <circle cx="142" cy="74" r="7" fill="rgba(16, 185, 129, 0.3)" />
          </svg>
        </div>
      </div>
    </main>

    <!-- Legal Footer -->
    <footer class="installer-footer">
      <p class="footer-legal">
        By clicking Install, you are agreeing to SWEEPR Cleaner <a href="#terms" class="legal-link">End User License Agreement</a>, <a href="#privacy" class="legal-link">Privacy Policy</a>, and <a href="#terms" class="legal-link">Terms of Service</a>.
        <br />
        Once you click "INSTALL", the installation process will begin and cannot be cancelled or aborted.
      </p>
    </footer>

  {:else if step === "installing"}
    <main class="installer-body progress-layout">
      <h1 class="progress-heading">Thank you for downloading SWEEPR Cleaner</h1>

      <!-- Segmented Circular Spinner with Percentage -->
      <div class="spinner-box">
        <div class="radial-spinner">
          <svg viewBox="0 0 100 100" width="90" height="90">
            <!-- 12 Segmented Radiating Ticks -->
            {#each Array(12) as _, i}
              {@const angle = i * 30}
              {@const isFilled = (progress / 100) * 12 > i}
              <line
                x1="50" y1="16"
                x2="50" y2="28"
                stroke={isFilled ? "#059669" : "#cbd5e1"}
                stroke-width="5"
                stroke-linecap="round"
                transform="rotate({angle} 50 50)"
              />
            {/each}
          </svg>
          <div class="percent-label">{progress}%</div>
        </div>
      </div>

      <p class="progress-sub">{statusText}</p>
    </main>

  {:else if step === "complete"}
    <main class="installer-body progress-layout">
      <div class="complete-icon-bubble">✓</div>
      <h1 class="progress-heading" style="margin-top: 16px;">SWEEPR Cleaner is Ready!</h1>
      <p class="progress-sub">Installation finished successfully.</p>
      <button class="primary install-btn" style="margin-top: 24px;" onclick={onComplete}>
        LAUNCH SWEEPR CLEANER
      </button>
    </main>
  {/if}
</div>

<style>
  .installer-window {
    width: 100%;
    max-width: 860px;
    height: 540px;
    margin: 20px auto;
    background: #f8fafc;
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(15, 23, 42, 0.12);
    border: 1px solid rgba(226, 232, 240, 0.9);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1e293b;
    position: relative;
  }

  /* Installer Top Bar */
  .installer-header {
    height: 52px;
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    flex-shrink: 0;
  }
  .header-left {
    font-size: 13px;
    color: #64748b;
    font-weight: 500;
  }
  .header-center {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .installer-logo {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
  }
  .installer-brand {
    font-size: 16px;
    font-weight: 800;
    letter-spacing: -0.3px;
    color: #0f172a;
  }
  .header-right {
    display: flex;
    align-items: center;
  }
  .close-btn {
    background: transparent;
    border: none;
    color: #64748b;
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    box-shadow: none;
  }
  .close-btn:hover {
    background: #f1f5f9;
    color: #0f172a;
    transform: none;
  }

  /* Body Layouts */
  .installer-body {
    flex: 1;
    padding: 40px 60px;
    display: flex;
  }
  .welcome-layout {
    align-items: center;
    justify-content: space-between;
    gap: 40px;
  }
  .left-col {
    flex: 1;
    max-width: 440px;
  }
  .welcome-heading {
    font-size: 32px;
    font-weight: 800;
    color: #0f172a;
    margin: 0 0 12px 0;
    letter-spacing: -0.5px;
  }
  .welcome-sub {
    font-size: 15px;
    color: #475569;
    line-height: 1.5;
    margin: 0 0 28px 0;
  }
  .install-btn {
    padding: 12px 38px;
    font-size: 14px;
    font-weight: 700;
    border-radius: 8px;
    background: linear-gradient(135deg, #059669 0%, #10b981 100%);
    color: #ffffff;
    border: none;
    box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
    cursor: pointer;
  }
  .install-btn:hover {
    background: linear-gradient(135deg, #047857 0%, #059669 100%);
    box-shadow: 0 6px 18px rgba(16, 185, 129, 0.45);
    transform: translateY(-1px);
  }

  .right-col {
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .mascot-container {
    filter: drop-shadow(0 8px 16px rgba(5, 150, 105, 0.15));
  }

  /* Footer Legal Notice */
  .installer-footer {
    padding: 18px 40px 24px 40px;
    text-align: center;
  }
  .footer-legal {
    font-size: 11.5px;
    color: #64748b;
    line-height: 1.6;
    margin: 0;
  }
  .legal-link {
    color: #334155;
    text-decoration: underline;
  }

  /* Progress Screen Layout */
  .progress-layout {
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .progress-heading {
    font-size: 26px;
    font-weight: 800;
    color: #0f172a;
    margin: 0 0 32px 0;
  }
  .spinner-box {
    margin: 10px 0 28px 0;
  }
  .radial-spinner {
    position: relative;
    width: 90px;
    height: 90px;
  }
  .percent-label {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 14px;
    font-weight: 800;
    color: #059669;
  }
  .progress-sub {
    font-size: 14px;
    color: #475569;
    margin: 0;
  }
  .complete-icon-bubble {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: #dcfce7;
    color: #059669;
    display: grid;
    place-items: center;
    font-size: 28px;
    font-weight: 800;
  }
</style>

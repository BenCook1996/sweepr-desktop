<script lang="ts">
  import Performance from "./Performance.svelte";
  import Apps from "./Apps.svelte";
  import Duplicates from "./Duplicates.svelte";
  import Privacy from "./Privacy.svelte";
  import Shredder from "./Shredder.svelte";
  import type { LicenseStatus } from "../lib/api";

  export type OptimizationSubTab = "memory" | "apps" | "storage" | "privacy" | "shredder";

  let {
    license,
    subTab = $bindable<OptimizationSubTab>("memory"),
  }: {
    license: LicenseStatus | null;
    subTab?: OptimizationSubTab;
  } = $props();
</script>

<div class="optimization-view">
  <div class="subnav-bar">
    <div class="subnav-pill" role="tablist" aria-label="Optimization tools">
      <button
        class="subnav-btn"
        class:active={subTab === "memory"}
        onclick={() => (subTab = "memory")}
        role="tab"
        aria-selected={subTab === "memory"}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        <span>Speed &amp; Startup</span>
      </button>
      <button
        class="subnav-btn"
        class:active={subTab === "apps"}
        onclick={() => (subTab = "apps")}
        role="tab"
        aria-selected={subTab === "apps"}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
        <span>Apps &amp; Orphans</span>
      </button>
      <button
        class="subnav-btn"
        class:active={subTab === "storage"}
        onclick={() => (subTab = "storage")}
        role="tab"
        aria-selected={subTab === "storage"}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span>Duplicates &amp; Disk</span>
      </button>
      <button
        class="subnav-btn"
        class:active={subTab === "privacy"}
        onclick={() => (subTab = "privacy")}
        role="tab"
        aria-selected={subTab === "privacy"}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span>Browser Privacy</span>
      </button>
      <button
        class="subnav-btn"
        class:active={subTab === "shredder"}
        onclick={() => (subTab = "shredder")}
        role="tab"
        aria-selected={subTab === "shredder"}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <span>File Shredder</span>
      </button>
    </div>
  </div>

  <div class="subnav-content">
    {#if subTab === "memory"}
      <Performance {license} />
    {:else if subTab === "apps"}
      <Apps {license} />
    {:else if subTab === "storage"}
      <Duplicates {license} />
    {:else if subTab === "privacy"}
      <Privacy {license} />
    {:else}
      <Shredder {license} />
    {/if}
  </div>
</div>

<style>
  .optimization-view {
    max-width: 1240px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
    color: var(--text);
  }
  .subnav-bar {
    display: flex;
    align-items: center;
    justify-content: flex-start;
  }
  .subnav-pill {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    background: var(--panel-2);
    padding: 4px;
    border-radius: 9999px;
    border: 1px solid var(--border);
  }
  .subnav-btn {
    background: transparent;
    border: none;
    padding: 7px 18px;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 13px;
    color: var(--muted);
    cursor: pointer;
    transition: all 0.15s ease;
    box-shadow: none;
  }
  .subnav-btn:hover {
    color: var(--text);
    background: transparent;
    transform: none;
  }
  .subnav-btn.active {
    background: var(--panel-solid);
    color: var(--accent);
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
  }
  .subnav-btn.active svg {
    stroke: var(--accent);
  }
  .subnav-content {
    flex: 1;
  }
</style>

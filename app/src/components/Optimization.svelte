<script lang="ts">
  import Performance from "./Performance.svelte";
  import Apps from "./Apps.svelte";
  import Duplicates from "./Duplicates.svelte";
  import Privacy from "./Privacy.svelte";
  import type { LicenseStatus } from "../lib/api";

  let { license }: { license: LicenseStatus | null } = $props();
  let subTab = $state<"memory" | "apps" | "storage" | "privacy">("memory");
</script>

<div class="optimization-view">
  <div class="subnav-bar">
    <div class="subnav-pill">
      <button class="subnav-btn" class:active={subTab === "memory"} onclick={() => (subTab = "memory")}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16v10H4zM8 7V4M12 7V4M16 7V4M8 20v-3M12 20v-3M16 20v-3"/></svg>
        <span>RAM, Processes & Boot</span>
      </button>
      <button class="subnav-btn" class:active={subTab === "apps"} onclick={() => (subTab = "apps")}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16v12H4z M9 10h6 M9 14h6"/></svg>
        <span>Software & Shortcuts</span>
      </button>
      <button class="subnav-btn" class:active={subTab === "storage"} onclick={() => (subTab = "storage")}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7v14H3V7h5zm13 0v14h-5V7h5zM15 3v18H9V3h6z"/></svg>
        <span>Storage & Duplicates</span>
      </button>
      <button class="subnav-btn" class:active={subTab === "privacy"} onclick={() => (subTab = "privacy")}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <span>Privacy, Browser & Shredder</span>
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
    {:else}
      <Privacy {license} />
    {/if}
  </div>
</div>

<style>
  .optimization-view { display: flex; flex-direction: column; gap: 20px; color: var(--text); }
  .subnav-bar { display: flex; align-items: center; justify-content: flex-start; }
  .subnav-pill { display: flex; flex-wrap: wrap; gap: 4px; background: var(--panel-2); padding: 4px; border-radius: 9999px; border: 1px solid var(--border); }
  .subnav-btn { background: transparent; border: none; padding: 7px 18px; border-radius: 9999px; display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; color: var(--muted); cursor: pointer; transition: all 0.2s; box-shadow: none; }
  .subnav-btn:hover { color: var(--text); background: transparent; }
  .subnav-btn.active { background: var(--panel-solid); color: var(--accent); box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08); }
  .subnav-btn.active svg { stroke: var(--accent); }
  .subnav-content { flex: 1; }
</style>

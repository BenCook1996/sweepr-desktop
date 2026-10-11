<script lang="ts">
  import Memory from "./Memory.svelte";
  import Apps from "./Apps.svelte";
  import type { LicenseStatus } from "../lib/api";

  let { license }: { license: LicenseStatus | null } = $props();
  let subTab = $state<"memory" | "apps">("memory");
</script>

<div class="optimization-view">
  <div class="subnav-bar">
    <div class="subnav-pill">
      <button class="subnav-btn" class:active={subTab === "memory"} onclick={() => (subTab = "memory")}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16v10H4zM8 7V4M12 7V4M16 7V4M8 20v-3M12 20v-3M16 20v-3"/></svg>
        <span>RAM & Startup Boot</span>
      </button>
      <button class="subnav-btn" class:active={subTab === "apps"} onclick={() => (subTab = "apps")}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16v12H4z M9 10h6 M9 14h6"/></svg>
        <span>Software & Registry</span>
      </button>
    </div>
  </div>

  <div class="subnav-content">
    {#if subTab === "memory"}
      <Memory {license} />
    {:else}
      <Apps {license} />
    {/if}
  </div>
</div>

<style>
  .optimization-view { display: flex; flex-direction: column; gap: 20px; }
  .subnav-bar { display: flex; align-items: center; justify-content: flex-start; }
  .subnav-pill { display: flex; gap: 4px; background: rgba(241, 245, 249, 0.85); padding: 4px; border-radius: 9999px; border: 1px solid var(--border); }
  .subnav-btn { background: transparent; border: none; padding: 7px 18px; border-radius: 9999px; display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; color: var(--muted); cursor: pointer; transition: all 0.2s; box-shadow: none; }
  .subnav-btn:hover { color: var(--text); }
  .subnav-btn.active { background: #ffffff; color: var(--accent); box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05); }
  .subnav-btn.active svg { stroke: var(--accent); }
  .subnav-content { flex: 1; }
</style>

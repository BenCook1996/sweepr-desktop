<script lang="ts">
  import Shredder from "./Shredder.svelte";
  import Privacy from "./Privacy.svelte";
  import type { LicenseStatus } from "../lib/api";

  let { license }: { license: LicenseStatus | null } = $props();
  let subTab = $state<"shredder" | "privacy">("shredder");
</script>

<div class="utilities-view">
  <div class="subnav-bar">
    <div class="subnav-pill">
      <button class="subnav-btn" class:active={subTab === "shredder"} onclick={() => (subTab = "shredder")}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <span>File Shredder</span>
      </button>
      <button class="subnav-btn" class:active={subTab === "privacy"} onclick={() => (subTab = "privacy")}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span>Dark Web & Privacy</span>
      </button>
    </div>
  </div>

  <div class="subnav-content">
    {#if subTab === "shredder"}
      <Shredder {license} />
    {:else}
      <Privacy {license} />
    {/if}
  </div>
</div>

<style>
  .utilities-view { display: flex; flex-direction: column; gap: 20px; }
  .subnav-bar { display: flex; align-items: center; justify-content: flex-start; }
  .subnav-pill { display: flex; gap: 4px; background: rgba(241, 245, 249, 0.85); padding: 4px; border-radius: 9999px; border: 1px solid var(--border); }
  .subnav-btn { background: transparent; border: none; padding: 7px 18px; border-radius: 9999px; display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; color: var(--muted); cursor: pointer; transition: all 0.2s; box-shadow: none; }
  .subnav-btn:hover { color: var(--text); }
  .subnav-btn.active { background: #ffffff; color: var(--accent); box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05); }
  .subnav-btn.active svg { stroke: var(--accent); }
  .subnav-content { flex: 1; }
</style>

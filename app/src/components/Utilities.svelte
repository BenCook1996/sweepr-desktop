<script lang="ts">
  import Shredder from "./Shredder.svelte";
  import type { LicenseStatus } from "../lib/api";

  let { license }: { license: LicenseStatus | null } = $props();
</script>

<div class="utilities-view">
  <Shredder {license} />
</div>

<style>
  .utilities-view { display: flex; flex-direction: column; gap: 20px; }
</style>


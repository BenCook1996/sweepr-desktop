const fs = require('fs');
const p = 'C:\\Users\\Benjamin\\Downloads\\desktop_cleaner\\app\\src\\components\\Account.svelte';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(/import \{ api[\s\S]*?\} from "\.\.\/lib\/api";/, `$&
  import { getLifetimeStats, type LifetimeStats } from "../lib/store";
  import { formatBytes, formatCount } from "../lib/format";`);

c = c.replace(/let busy = \$state\(false\);/, `let busy = $state(false);
  let stats = $state<LifetimeStats>({bytesFreed: 0, filesRemoved: 0});
  $effect(() => {
    stats = getLifetimeStats();
    const cb = () => stats = getLifetimeStats();
    window.addEventListener('sweepr-stats-update', cb);
    return () => window.removeEventListener('sweepr-stats-update', cb);
  });`);

c = c.replace(/<\/div>\s*\{\#if info\}/, `</div>

<div class="card box">
  <div class="row"><strong>Lifetime Stats</strong></div>
  <p class="muted" style="margin: 0">Sweepr has saved you <strong>{formatBytes(stats.bytesFreed)}</strong> by removing <strong>{formatCount(stats.filesRemoved)}</strong> junk files so far.</p>
</div>

{#if info}`);

fs.writeFileSync(p, c);

<script lang="ts" module>
  export type RollbackDestination = "quarantine" | "recycle_bin" | "backup" | "permanent";

  export interface ConfirmCleanCategoryItem {
    id: string;
    name: string;
    bytes: number;
    files: number;
    fileUnit?: string;
    note?: string;
  }
</script>

<script lang="ts">
  import { tick } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { formatBytes, formatCount } from "../lib/format";

  let {
    open,
    title,
    rollback,
    secondaryRollbackBadge,
    rollbackDetail,
    categories,
    totalBytes,
    totalFiles,
    totalFilesUnit = "files",
    confirmLabel,
    busy = false,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    title: string;
    rollback: RollbackDestination;
    secondaryRollbackBadge?: string;
    rollbackDetail?: string;
    categories: ConfirmCleanCategoryItem[];
    totalBytes: number;
    totalFiles: number;
    totalFilesUnit?: string;
    confirmLabel: string;
    busy?: boolean;
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
  } = $props();

  let drawerEl = $state<HTMLDivElement | null>(null);
  let cancelBtnEl = $state<HTMLButtonElement | null>(null);
  let previouslyFocusedEl: HTMLElement | null = null;
  let wasOpen = false;

  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");
  const shortcutLabel = isMac ? "⌘↵" : "Ctrl+Enter";

  const reducedMotion = $derived(
    typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  );

  const rollbackBadgeLabel = $derived(
    rollback === "quarantine"
      ? "Moved to 7-Day Undo Quarantine"
      : rollback === "recycle_bin"
        ? "OS Recycle Bin"
        : rollback === "backup"
          ? "Backed Up (1-Click Restore)"
          : "Permanent Delete — Cannot Be Undone"
  );

  const defaultRollbackDetail = $derived(
    rollback === "quarantine"
      ? "7-Day Undo Quarantine (configurable 2–10 GB disk budget, 5 GB default, same-volume O(1) move; OS Recycle Bin fallback if file exceeds budget; excludes shredded files, browser DBs, and registry edits)."
      : rollback === "recycle_bin"
        ? "Moved to your system Recycle Bin / Trash so you can restore anytime."
        : rollback === "backup"
          ? "Saved to local Registry Backups so you can restore the entry in 1 click anytime."
          : "Selected items are permanently removed and cannot be undone."
  );

  $effect(() => {
    if (open && !wasOpen) {
      wasOpen = true;
      previouslyFocusedEl =
        typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
      void tick().then(() => {
        cancelBtnEl?.focus();
      });
    } else if (!open && wasOpen) {
      wasOpen = false;
      const toRestore = previouslyFocusedEl;
      previouslyFocusedEl = null;
      if (toRestore && typeof toRestore.focus === "function") {
        void tick().then(() => {
          try {
            toRestore.focus();
          } catch {}
        });
      }
    }
  });

  function handleWindowKeydown(e: KeyboardEvent) {
    if (!open) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!busy) onCancel();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (!busy) void onConfirm();
      return;
    }

    if (e.key === "Tab" && drawerEl) {
      const focusables = Array.from(
        drawerEl.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (!active || active === first || !drawerEl.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (!active || active === last || !drawerEl.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }

  function formatItemCount(count: number, customUnit?: string): string {
    if (customUnit) {
      return `${formatCount(count)} ${customUnit}`;
    }
    return `${formatCount(count)} ${count === 1 ? "file" : "files"}`;
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
  <div
    class="confirm-drawer-backdrop"
    onclick={() => {
      if (!busy) onCancel();
    }}
    role="presentation"
    transition:fade={{ duration: reducedMotion ? 90 : 150 }}
  >
    <div
      bind:this={drawerEl}
      class="confirm-drawer card"
      class:is-permanent={rollback === "permanent"}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="preclean-drawer-title"
      aria-describedby="preclean-reassurance-pill"
      tabindex="-1"
      transition:fly={{ y: reducedMotion ? 0 : 22, duration: reducedMotion ? 90 : 190, easing: cubicOut }}
    >
      <div class="drawer-header">
        <div class="drawer-title-group">
          <div class="badge-row">
            <span
              class="rollback-badge"
              class:is-quarantine={rollback === "quarantine"}
              class:is-recycle={rollback === "recycle_bin" || rollback === "backup"}
              class:is-permanent={rollback === "permanent"}
            >
              {#if rollback === "quarantine"}
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.3" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <polyline points="9 12 11 14 15 10" />
                </svg>
              {:else if rollback === "recycle_bin" || rollback === "backup"}
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                </svg>
              {:else}
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.3" aria-hidden="true">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              {/if}
              <span>{rollbackBadgeLabel}</span>
            </span>

            {#if secondaryRollbackBadge}
              <span class="rollback-badge is-recycle">
                <span>{secondaryRollbackBadge}</span>
              </span>
            {/if}
          </div>

          <h2 id="preclean-drawer-title" class="drawer-title">{title}</h2>
          <p class="drawer-subtitle">{rollbackDetail ?? defaultRollbackDetail}</p>
        </div>

        <button
          type="button"
          class="drawer-close-btn"
          disabled={busy}
          onclick={onCancel}
          aria-label="Close confirmation drawer"
        >
          ✕
        </button>
      </div>

      <!-- Explicit Safety Reassurance Pill -->
      <div id="preclean-reassurance-pill" class="reassurance-pill">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polyline points="8.5 12.5 11 15 15.5 9.5" />
        </svg>
        <span>0 personal documents, photos, bookmarks, or saved games selected</span>
      </div>

      <!-- Totals Strip -->
      <div class="totals-strip" aria-label="Cleanup summary totals">
        <div class="total-stat">
          <span class="stat-label">TOTAL SIZE</span>
          <strong class="stat-value">{totalBytes > 0 ? formatBytes(totalBytes) : "Metadata Only"}</strong>
        </div>
        <div class="stat-divider" aria-hidden="true"></div>
        <div class="total-stat">
          <span class="stat-label">ITEMS SELECTED</span>
          <strong class="stat-value">{formatCount(totalFiles)} {totalFiles === 1 && totalFilesUnit === "files" ? "file" : totalFilesUnit}</strong>
        </div>
        <div class="stat-divider" aria-hidden="true"></div>
        <div class="total-stat">
          <span class="stat-label">CATEGORIES</span>
          <strong class="stat-value">{categories.length}</strong>
        </div>
      </div>

      <!-- Category Breakdown -->
      <div class="category-list" role="list" aria-label="Categories to be cleaned">
        {#each categories as cat (cat.id)}
          <div class="category-row" role="listitem">
            <div class="category-info">
              <strong class="category-name">{cat.name}</strong>
              {#if cat.note}
                <span class="category-note">{cat.note}</span>
              {/if}
            </div>
            <div class="category-metrics">
              <span class="category-files">{formatItemCount(cat.files, cat.fileUnit)}</span>
              {#if cat.bytes > 0}
                <strong class="category-bytes">{formatBytes(cat.bytes)}</strong>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <!-- Actions Footer -->
      <div class="drawer-footer">
        <span class="keyboard-hint">Press <kbd>Esc</kbd> to cancel · <kbd>{shortcutLabel}</kbd> to confirm</span>
        <div class="footer-buttons">
          <button
            bind:this={cancelBtnEl}
            type="button"
            class="ghost cancel-btn"
            disabled={busy}
            onclick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            class="primary confirm-btn"
            class:is-destructive={rollback === "permanent"}
            disabled={busy}
            onclick={() => void onConfirm()}
          >
            <span>{busy ? "Cleaning…" : confirmLabel}</span>
            {#if !busy}
              <kbd class="btn-kbd" aria-hidden="true">{shortcutLabel}</kbd>
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .confirm-drawer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 950;
    background: rgba(15, 18, 16, 0.46);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 16px 20px;
  }

  .confirm-drawer {
    width: 100%;
    max-width: 620px;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 18px;
    box-shadow: 0 22px 54px rgba(15, 23, 42, 0.24);
    padding: 20px 22px;
    display: flex;
    flex-direction: column;
    gap: 13px;
    max-height: calc(100vh - 36px);
  }

  .confirm-drawer.is-permanent {
    border-color: rgba(185, 28, 28, 0.35);
  }

  .drawer-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .drawer-title-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .badge-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .rollback-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 9999px;
    font-size: 11.5px;
    font-weight: 800;
    letter-spacing: 0.1px;
  }

  .rollback-badge.is-quarantine {
    background: var(--accent-light);
    color: var(--accent);
    border: 1px solid rgba(13, 104, 71, 0.28);
  }

  .rollback-badge.is-recycle {
    background: rgba(2, 132, 199, 0.12);
    color: #0369a1;
    border: 1px solid rgba(2, 132, 199, 0.28);
  }

  :global(:root[data-theme="dark"]) .rollback-badge.is-recycle,
  :global(:root.dark) .rollback-badge.is-recycle {
    background: rgba(56, 189, 248, 0.15);
    color: #7dd3fc;
    border-color: rgba(56, 189, 248, 0.32);
  }

  .rollback-badge.is-permanent {
    background: rgba(185, 28, 28, 0.12);
    color: var(--danger);
    border: 1px solid rgba(185, 28, 28, 0.32);
  }

  .drawer-title {
    margin: 2px 0 0 0;
    font-size: 17.5px;
    font-weight: 800;
    letter-spacing: -0.25px;
    color: var(--text);
  }

  .drawer-subtitle {
    margin: 0;
    font-size: 12.5px;
    color: var(--muted);
    line-height: 1.4;
  }

  .drawer-close-btn {
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--muted);
    font-size: 13px;
    flex-shrink: 0;
  }

  .reassurance-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--accent-light);
    border: 1px solid rgba(13, 104, 71, 0.24);
    color: var(--accent);
    font-size: 12.5px;
    font-weight: 700;
    line-height: 1.35;
  }

  .reassurance-pill svg {
    flex-shrink: 0;
  }

  .totals-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-radius: 12px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    font-variant-numeric: tabular-nums;
  }

  .total-stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .stat-label {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.55px;
    color: var(--muted);
  }

  .stat-value {
    font-size: 14.5px;
    font-weight: 800;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stat-divider {
    width: 1px;
    height: 26px;
    background: var(--border);
    flex-shrink: 0;
  }

  .category-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 196px;
    overflow-y: auto;
    padding-right: 2px;
    font-variant-numeric: tabular-nums;
  }

  .category-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--panel-2);
    border: 1px solid var(--border);
  }

  .category-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .category-name {
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .category-note {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .category-metrics {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .category-files {
    font-size: 12px;
    color: var(--muted);
    font-weight: 600;
  }

  .category-bytes {
    font-size: 13px;
    font-weight: 800;
    color: var(--accent);
    min-width: 62px;
    text-align: right;
  }

  .drawer-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding-top: 4px;
    border-top: 1px solid var(--border);
  }

  .keyboard-hint {
    font-size: 11.5px;
    color: var(--muted);
  }

  .keyboard-hint kbd,
  .btn-kbd {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10.5px;
    font-weight: 700;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text-secondary);
  }

  .footer-buttons {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .cancel-btn {
    padding: 9px 16px;
    border-radius: 9999px;
    font-weight: 700;
  }

  .confirm-btn {
    padding: 9px 18px;
    border-radius: 9999px;
    font-weight: 800;
    gap: 8px;
  }

  .confirm-btn .btn-kbd {
    background: rgba(255, 255, 255, 0.16);
    border-color: rgba(255, 255, 255, 0.28);
    color: #ffffff;
  }

  .confirm-btn.is-destructive {
    background: linear-gradient(135deg, #dc2626 0%, #b91c1c 60%, #991b1b 100%);
    border-color: #991b1b;
    color: #ffffff;
  }

  .confirm-btn.is-destructive:hover:not(:disabled) {
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 60%, #b91c1c 100%);
  }
</style>

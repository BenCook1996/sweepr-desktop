<script lang="ts">
  import { api, type DiskTreeNode, type LargeFilesReport } from "../lib/api";
  import {
    buildSunburstArcs,
    extensionsToVizItems,
    squarifyTreemap,
    treeChildrenToVizItems,
    type SunburstArc,
    type TreemapRect,
    type VizItem,
  } from "../lib/disk-viz";
  import { formatBytes, formatCount, shortenPath } from "../lib/format";

  let {
    report,
    onDrillScan,
  }: {
    report: LargeFilesReport;
    onDrillScan?: (path: string) => void;
  } = $props();

  let chartKind = $state<"treemap" | "sunburst">("treemap");
  let dimension = $state<"folders" | "extensions">("folders");
  let drillPath = $state<DiskTreeNode[]>([]);
  let hovered = $state<{ item: VizItem; percent: number } | null>(null);

  const fallbackRoot = $derived.by<DiskTreeNode>(() => {
    if (report.folder_tree) return report.folder_tree;
    const rootPath = report.scanned_dir || "";
    return {
      name: rootPath ? shortenPath(rootPath, 24) : "Scanned Folder",
      path: rootPath,
      bytes: report.total_scanned_bytes,
      files: report.total_scanned_files,
      kind: "dir",
      children: (report.by_folder || []).map((f) => ({
        name: f.label,
        path: rootPath ? `${rootPath}/${f.label}` : f.label,
        bytes: f.bytes,
        files: f.files,
        kind: f.label.startsWith("(") ? "other" : "dir",
        children: [],
      })),
    };
  });

  // Reset drill stack whenever a fresh report arrives
  $effect(() => {
    void report;
    drillPath = [];
    hovered = null;
  });

  const currentNode = $derived(
    drillPath.length > 0 ? drillPath[drillPath.length - 1] : fallbackRoot
  );

  const extensionRoot = $derived.by<DiskTreeNode>(() => ({
    name: "File Extensions",
    path: report.scanned_dir || "",
    bytes: report.by_extension.reduce((s, e) => s + e.bytes, 0) || report.total_scanned_bytes,
    files: report.by_extension.reduce((s, e) => s + e.files, 0) || report.total_scanned_files,
    kind: "dir",
    children: (report.by_extension || []).map((e) => ({
      name: e.label,
      path: report.scanned_dir || "",
      bytes: e.bytes,
      files: e.files,
      kind: "extension",
      children: [],
    })),
  }));

  const activeItems = $derived.by<VizItem[]>(() => {
    if (dimension === "extensions") {
      return extensionsToVizItems(report.by_extension || [], report.scanned_dir || "");
    }
    return treeChildrenToVizItems(currentNode);
  });

  const treemapRects = $derived<TreemapRect[]>(
    squarifyTreemap(activeItems, 0, 0, 800, 320)
  );

  const sunburstRoot = $derived(
    dimension === "extensions" ? extensionRoot : currentNode
  );
  const sunburstArcs = $derived<SunburstArc[]>(
    buildSunburstArcs(sunburstRoot, dimension === "extensions" ? 1 : 3, 52, 42, 180, 180)
  );

  const legendItems = $derived.by(() => {
    const total = Math.max(
      1,
      activeItems.reduce((s, it) => s + it.bytes, 0)
    );
    return [...activeItems]
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8)
      .map((item) => ({
        item,
        percent: (item.bytes / total) * 100,
      }));
  });

  function handleActivateItem(item: VizItem) {
    if (dimension === "extensions") return;
    if (item.node && item.kind === "dir" && item.node.children && item.node.children.length > 0) {
      drillPath = [...drillPath, item.node];
      hovered = null;
      return;
    }
    if (item.kind === "dir" && item.path && onDrillScan) {
      onDrillScan(item.path);
      return;
    }
    if (item.kind === "file" && item.path) {
      void api.revealInFolder(item.path);
    }
  }

  function handleKeyDown(e: KeyboardEvent, item: VizItem) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleActivateItem(item);
    }
  }

  function stepUp() {
    if (drillPath.length > 0) {
      drillPath = drillPath.slice(0, -1);
      hovered = null;
    }
  }
</script>

<div class="card viz-card">
  <div class="row viz-header">
    <div>
      <strong style="font-size: 16px;">Visual Disk-Space Map</strong>
      <div class="muted small" style="margin-top: 2px;">
        {formatBytes(report.total_scanned_bytes)} scanned across {formatCount(report.total_scanned_files)} files
      </div>
    </div>

    <div class="row" style="gap: 8px; flex-wrap: wrap;">
      <div class="pill-switch" role="tablist" aria-label="Disk breakdown dimension">
        <button
          type="button"
          class="pill-btn"
          class:active={dimension === "folders"}
          onclick={() => {
            dimension = "folders";
            hovered = null;
          }}
          role="tab"
          aria-selected={dimension === "folders"}
        >
          Folders (Drill-Down)
        </button>
        <button
          type="button"
          class="pill-btn"
          class:active={dimension === "extensions"}
          onclick={() => {
            dimension = "extensions";
            hovered = null;
          }}
          role="tab"
          aria-selected={dimension === "extensions"}
        >
          File Extensions
        </button>
      </div>

      <div class="pill-switch" role="tablist" aria-label="Chart visualization mode">
        <button
          type="button"
          class="pill-btn"
          class:active={chartKind === "treemap"}
          onclick={() => (chartKind = "treemap")}
          role="tab"
          aria-selected={chartKind === "treemap"}
        >
          Treemap
        </button>
        <button
          type="button"
          class="pill-btn"
          class:active={chartKind === "sunburst"}
          onclick={() => (chartKind = "sunburst")}
          role="tab"
          aria-selected={chartKind === "sunburst"}
        >
          Sunburst
        </button>
      </div>
    </div>
  </div>

  {#if dimension === "folders"}
    <div class="row breadcrumb-bar">
      <div class="crumbs" role="navigation" aria-label="Folder breadcrumbs">
        <button
          type="button"
          class="crumb-btn"
          class:current={drillPath.length === 0}
          onclick={() => {
            drillPath = [];
            hovered = null;
          }}
        >
          {fallbackRoot.name}
        </button>
        {#each drillPath as crumb, idx (crumb.path + idx)}
          <span class="muted small">/</span>
          <button
            type="button"
            class="crumb-btn"
            class:current={idx === drillPath.length - 1}
            onclick={() => {
              drillPath = drillPath.slice(0, idx + 1);
              hovered = null;
            }}
          >
            {crumb.name}
          </button>
        {/each}
      </div>

      <div class="row" style="gap: 6px;">
        {#if drillPath.length > 0}
          <button type="button" class="ghost small-btn" onclick={stepUp}>
            Up
          </button>
          {#if currentNode.kind === "dir" && currentNode.path && onDrillScan}
            <button
              type="button"
              class="ghost small-btn"
              onclick={() => onDrillScan?.(currentNode.path)}
              title={`Run a full scan inside ${currentNode.path}`}
            >
              Scan This Folder
            </button>
          {/if}
        {/if}
      </div>
    </div>
  {/if}

  {#if activeItems.length === 0}
    <div class="viz-empty muted small">
      No sized items found to visualize in this directory.
    </div>
  {:else if chartKind === "treemap"}
    <div class="treemap-wrap">
      <svg
        viewBox="0 0 800 320"
        class="treemap-svg"
        role="img"
        aria-label="Interactive folder treemap"
      >
        {#each treemapRects as r (r.item.id)}
          {@const canShowLabel = r.w >= 72 && r.h >= 34}
          {@const canShowSub = r.w >= 92 && r.h >= 48}
          {@const isClickable =
            dimension === "folders" &&
            ((r.item.kind === "dir" && Boolean(r.item.node?.children?.length || onDrillScan)) ||
              r.item.kind === "file")}
          <g
            class="viz-node"
            class:clickable={isClickable}
            role="button"
            tabindex="0"
            aria-label={`${r.item.name}: ${formatBytes(r.item.bytes)} (${r.percent.toFixed(1)}%), ${formatCount(r.item.files)} files`}
            onmouseenter={() => (hovered = { item: r.item, percent: r.percent })}
            onmouseleave={() => (hovered = null)}
            onfocus={() => (hovered = { item: r.item, percent: r.percent })}
            onblur={() => (hovered = null)}
            onclick={() => handleActivateItem(r.item)}
            onkeydown={(e) => handleKeyDown(e, r.item)}
          >
            <rect
              x={r.x + 1.5}
              y={r.y + 1.5}
              width={Math.max(1, r.w - 3)}
              height={Math.max(1, r.h - 3)}
              rx="6"
              fill={r.item.color}
              fill-opacity={hovered?.item.id === r.item.id ? "0.95" : "0.82"}
              stroke="var(--panel-solid)"
              stroke-width="1.5"
            />
            {#if canShowLabel}
              <text
                x={r.x + 10}
                y={r.y + 20}
                fill="#ffffff"
                font-size="12.5"
                font-weight="700"
                class="svg-label"
              >
                {r.item.name.length > Math.floor(r.w / 8)
                  ? `${r.item.name.slice(0, Math.max(4, Math.floor(r.w / 8) - 1))}…`
                  : r.item.name}
              </text>
              {#if canShowSub}
                <text
                  x={r.x + 10}
                  y={r.y + 37}
                  fill="rgba(255,255,255,0.9)"
                  font-size="11"
                  font-weight="600"
                  class="svg-label"
                >
                  {formatBytes(r.item.bytes)} · {r.percent.toFixed(1)}%
                </text>
              {/if}
            {/if}
          </g>
        {/each}
      </svg>
    </div>
  {:else}
    <div class="sunburst-grid">
      <svg
        viewBox="0 0 360 360"
        class="sunburst-svg"
        role="img"
        aria-label="Interactive folder sunburst"
      >
        {#each sunburstArcs as arc (arc.item.id)}
          <path
            d={arc.pathData}
            fill={arc.item.color}
            fill-opacity={hovered?.item.id === arc.item.id ? "0.98" : arc.depth === 1 ? "0.88" : arc.depth === 2 ? "0.74" : "0.6"}
            stroke="var(--panel-solid)"
            stroke-width="1.5"
            class="viz-node clickable"
            role="button"
            tabindex="0"
            aria-label={`${arc.item.name}: ${formatBytes(arc.item.bytes)} (${arc.percent.toFixed(1)}%)`}
            onmouseenter={() => (hovered = { item: arc.item, percent: arc.percent })}
            onmouseleave={() => (hovered = null)}
            onfocus={() => (hovered = { item: arc.item, percent: arc.percent })}
            onblur={() => (hovered = null)}
            onclick={() => handleActivateItem(arc.item)}
            onkeydown={(e) => handleKeyDown(e, arc.item)}
          />
        {/each}

        {#if drillPath.length > 0}
          <g
            class="viz-node clickable"
            role="button"
            tabindex="0"
            aria-label="Go up one folder level"
            onclick={stepUp}
            onkeydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                stepUp();
              }
            }}
          >
            <circle cx="180" cy="180" r="46" fill="var(--panel-solid)" stroke="var(--border)" stroke-width="1.5" />
            <text x="180" y="175" text-anchor="middle" fill="var(--text)" font-size="12" font-weight="800">
              {sunburstRoot.name.length > 13 ? `${sunburstRoot.name.slice(0, 12)}…` : sunburstRoot.name}
            </text>
            <text x="180" y="193" text-anchor="middle" fill="var(--accent)" font-size="11.5" font-weight="700">
              {formatBytes(sunburstRoot.bytes)}
            </text>
          </g>
        {:else}
          <g>
            <circle cx="180" cy="180" r="46" fill="var(--panel-solid)" stroke="var(--border)" stroke-width="1.5" />
            <text x="180" y="175" text-anchor="middle" fill="var(--text)" font-size="12" font-weight="800">
              {sunburstRoot.name.length > 13 ? `${sunburstRoot.name.slice(0, 12)}…` : sunburstRoot.name}
            </text>
            <text x="180" y="193" text-anchor="middle" fill="var(--accent)" font-size="11.5" font-weight="700">
              {formatBytes(sunburstRoot.bytes)}
            </text>
          </g>
        {/if}
      </svg>

      <div class="sunburst-legend">
        {#each legendItems as entry (entry.item.id)}
          <button
            type="button"
            class="legend-row"
            onmouseenter={() => (hovered = { item: entry.item, percent: entry.percent })}
            onmouseleave={() => (hovered = null)}
            onclick={() => handleActivateItem(entry.item)}
          >
            <span class="swatch" style={`background:${entry.item.color};`}></span>
            <span class="legend-name" title={entry.item.path || entry.item.name}>{entry.item.name}</span>
            <span class="muted small">{entry.percent.toFixed(1)}%</span>
            <strong class="small">{formatBytes(entry.item.bytes)}</strong>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="viz-footer row">
    {#if hovered}
      <span class="small" style="font-weight: 700;">
        {hovered.item.name}
      </span>
      <span class="muted small">
        {formatBytes(hovered.item.bytes)} ({hovered.percent.toFixed(1)}%) · {formatCount(hovered.item.files)} files
        {#if hovered.item.kind === "dir" && dimension === "folders"}
          · Click to drill down
        {:else if hovered.item.kind === "file"}
          · Click to reveal in folder
        {/if}
      </span>
    {:else}
      <span class="muted small">
        {dimension === "folders"
          ? "Hover any block for size & file count. Click folders to drill down or files to reveal."
          : "Breakdown by file extension across the scanned directory."}
      </span>
    {/if}
  </div>
</div>

<style>
  .viz-card {
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .viz-header {
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }
  .pill-switch {
    display: inline-flex;
    background: var(--panel-2);
    padding: 3px;
    border-radius: 9999px;
    border: 1px solid var(--border);
  }
  .pill-btn {
    background: transparent;
    border: none;
    padding: 5px 12px;
    border-radius: 9999px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    box-shadow: none;
  }
  .pill-btn.active {
    background: var(--panel-solid);
    color: var(--accent);
    box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
  }
  .breadcrumb-bar {
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 12px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .crumbs {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .crumb-btn {
    background: transparent;
    border: none;
    padding: 2px 6px;
    border-radius: 6px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    box-shadow: none;
  }
  .crumb-btn.current {
    color: var(--accent);
    font-weight: 800;
  }
  .treemap-wrap {
    width: 100%;
    overflow: hidden;
    border-radius: 12px;
    background: var(--panel-2);
    border: 1px solid var(--border);
  }
  .treemap-svg {
    display: block;
    width: 100%;
    height: auto;
    max-height: 340px;
  }
  .sunburst-grid {
    display: grid;
    grid-template-columns: minmax(220px, 320px) 1fr;
    gap: 16px;
    align-items: center;
  }
  @media (max-width: 720px) {
    .sunburst-grid {
      grid-template-columns: 1fr;
    }
  }
  .sunburst-svg {
    width: 100%;
    max-width: 320px;
    margin: 0 auto;
    display: block;
  }
  .sunburst-legend {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .legend-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    box-shadow: none;
  }
  .legend-row:hover {
    border-color: var(--accent);
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .legend-name {
    flex: 1;
    font-size: 12.5px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .viz-node:focus {
    outline: none;
  }
  .viz-node.clickable {
    cursor: pointer;
  }
  .svg-label {
    pointer-events: none;
    user-select: none;
  }
  .viz-empty {
    padding: 20px;
    text-align: center;
    background: var(--panel-2);
    border-radius: 10px;
  }
  .viz-footer {
    min-height: 22px;
    gap: 8px;
    flex-wrap: wrap;
    padding-top: 2px;
  }
  .small-btn {
    padding: 4px 12px;
    font-size: 12px;
    border-radius: 9999px;
  }
</style>

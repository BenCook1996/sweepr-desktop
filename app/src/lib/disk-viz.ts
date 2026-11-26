import type { DiskBreakdownItem, DiskTreeNode } from "./api";

export interface VizItem {
  id: string;
  name: string;
  path: string;
  bytes: number;
  files: number;
  kind: string;
  color: string;
  node?: DiskTreeNode;
}

export interface TreemapRect {
  item: VizItem;
  x: number;
  y: number;
  w: number;
  h: number;
  percent: number;
}

export interface SunburstArc {
  item: VizItem;
  depth: number;
  startAngle: number;
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
  pathData: string;
  percent: number;
}

export const VIZ_PALETTE = [
  "#10b981", // emerald-500
  "#0ea5e9", // sky-500
  "#f59e0b", // amber-500
  "#6366f1", // indigo-500
  "#14b8a6", // teal-500
  "#f43f5e", // rose-500
  "#8b5cf6", // violet-500
  "#06b6d4", // cyan-500
  "#84cc16", // lime-500
  "#ec4899", // pink-500
  "#eab308", // yellow-500
  "#3b82f6", // blue-500
  "#fb923c", // orange-400
  "#64748b", // slate-500
];

export function pickVizColor(index: number, kind?: string): string {
  if (kind === "other") return "#64748b";
  return VIZ_PALETTE[index % VIZ_PALETTE.length];
}

export function treeChildrenToVizItems(node: DiskTreeNode): VizItem[] {
  if (!node) return [];
  const src =
    node.children && node.children.length > 0
      ? node.children
      : [
          {
            name: node.name,
            path: node.path,
            bytes: node.bytes,
            files: node.files,
            kind: node.kind,
            children: [],
          },
        ];
  return src
    .filter((c) => Number.isFinite(c.bytes) && c.bytes > 0)
    .map((c, idx) => ({
      id: `${c.kind}:${c.path}:${c.name}:${idx}`,
      name: c.name,
      path: c.path,
      bytes: c.bytes,
      files: Number.isFinite(c.files) && c.files >= 0 ? c.files : 0,
      kind: c.kind,
      color: pickVizColor(idx, c.kind),
      node: c,
    }));
}

export function extensionsToVizItems(items: DiskBreakdownItem[], rootPath: string): VizItem[] {
  return items
    .filter((it) => Number.isFinite(it.bytes) && it.bytes > 0)
    .map((it, idx) => ({
      id: `ext:${it.label}:${idx}`,
      name: it.label,
      path: rootPath,
      bytes: it.bytes,
      files: Number.isFinite(it.files) && it.files >= 0 ? it.files : 0,
      kind: "extension",
      color: pickVizColor(idx),
    }));
}

function worstAspectRatio(row: { area: number }[], shortSide: number): number {
  if (row.length === 0 || shortSide <= 0) return Infinity;
  let sum = 0;
  let minA = Infinity;
  let maxA = 0;
  for (const r of row) {
    sum += r.area;
    if (r.area < minA) minA = r.area;
    if (r.area > maxA) maxA = r.area;
  }
  if (sum <= 0 || minA <= 0) return Infinity;
  const s2 = shortSide * shortSide;
  const sum2 = sum * sum;
  return Math.max((s2 * maxA) / sum2, sum2 / (s2 * minA));
}

/**
 * Bruls / van Wijk squarified treemap layout.
 */
export function squarifyTreemap(
  rawItems: VizItem[],
  x: number,
  y: number,
  w: number,
  h: number
): TreemapRect[] {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w <= 0 ||
    h <= 0
  ) {
    return [];
  }
  const valid = [...rawItems]
    .filter((it) => Number.isFinite(it.bytes) && it.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
  const totalBytes = valid.reduce((acc, it) => acc + it.bytes, 0);
  const totalArea = w * h;
  if (
    valid.length === 0 ||
    !Number.isFinite(totalBytes) ||
    totalBytes <= 0 ||
    !Number.isFinite(totalArea) ||
    totalArea <= 0
  ) {
    return [];
  }

  const nodes = valid.map((item) => ({
    item,
    area: (item.bytes / totalBytes) * totalArea,
    percent: (item.bytes / totalBytes) * 100,
  }));

  const rects: TreemapRect[] = [];
  let rx = x;
  let ry = y;
  let rw = w;
  let rh = h;
  let remaining = nodes;

  const layoutRow = (row: typeof nodes, horizontalSplit: boolean) => {
    const rowArea = row.reduce((s, r) => s + r.area, 0);
    if (rowArea <= 0) return;
    if (horizontalSplit) {
      // Lay out row along height (left strip of width rowW)
      const rowW = Math.min(rw, rowArea / Math.max(rh, 1e-6));
      let curY = ry;
      for (const entry of row) {
        const rectH = rowW > 0 ? entry.area / rowW : 0;
        rects.push({
          item: entry.item,
          x: rx,
          y: curY,
          w: Math.max(0, rowW),
          h: Math.max(0, rectH),
          percent: entry.percent,
        });
        curY += rectH;
      }
      rx += rowW;
      rw = Math.max(0, rw - rowW);
    } else {
      // Lay out row along width (top strip of height rowH)
      const rowH = Math.min(rh, rowArea / Math.max(rw, 1e-6));
      let curX = rx;
      for (const entry of row) {
        const rectW = rowH > 0 ? entry.area / rowH : 0;
        rects.push({
          item: entry.item,
          x: curX,
          y: ry,
          w: Math.max(0, rectW),
          h: Math.max(0, rowH),
          percent: entry.percent,
        });
        curX += rectW;
      }
      ry += rowH;
      rh = Math.max(0, rh - rowH);
    }
  };

  let row: typeof nodes = [];
  let i = 0;
  while (i < remaining.length) {
    const next = remaining[i];
    const shortSide = Math.min(rw, rh);
    if (row.length === 0) {
      row.push(next);
      i++;
      continue;
    }
    const curWorst = worstAspectRatio(row, shortSide);
    const nextWorst = worstAspectRatio([...row, next], shortSide);
    if (nextWorst <= curWorst) {
      row.push(next);
      i++;
    } else {
      layoutRow(row, rw >= rh);
      row = [];
    }
  }
  if (row.length > 0) {
    layoutRow(row, rw >= rh);
  }

  return rects;
}

function polarToCartesian(cx: number, cy: number, r: number, angleRad: number): { x: number; y: number } {
  // Start at 12 o'clock (-PI/2)
  const a = angleRad - Math.PI / 2;
  return {
    x: cx + r * Math.cos(a),
    y: cy + r * Math.sin(a),
  };
}

export function describeSunburstArc(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number
): string {
  if (
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    !Number.isFinite(innerR) ||
    !Number.isFinite(outerR) ||
    !Number.isFinite(startAngle) ||
    !Number.isFinite(endAngle)
  ) {
    return "";
  }
  const span = Math.min(endAngle - startAngle, Math.PI * 2 - 0.0006);
  const clampedEnd = startAngle + span;
  const p1 = polarToCartesian(cx, cy, outerR, startAngle);
  const p2 = polarToCartesian(cx, cy, outerR, clampedEnd);
  const p3 = polarToCartesian(cx, cy, innerR, clampedEnd);
  const p4 = polarToCartesian(cx, cy, innerR, startAngle);
  const largeArc = span > Math.PI ? 1 : 0;

  return [
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `A ${outerR.toFixed(2)} ${outerR.toFixed(2)} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    `A ${innerR.toFixed(2)} ${innerR.toFixed(2)} 0 ${largeArc} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

export function buildSunburstArcs(
  root: DiskTreeNode,
  maxRings = 3,
  innerR = 54,
  ringWidth = 40,
  cx = 180,
  cy = 180
): SunburstArc[] {
  if (
    !root ||
    !Number.isFinite(root.bytes) ||
    root.bytes <= 0 ||
    !Number.isFinite(maxRings) ||
    maxRings <= 0 ||
    !Number.isFinite(innerR) ||
    innerR < 0 ||
    !Number.isFinite(ringWidth) ||
    ringWidth <= 0 ||
    !Number.isFinite(cx) ||
    !Number.isFinite(cy)
  ) {
    return [];
  }
  const arcs: SunburstArc[] = [];
  const rootBytes = root.bytes;

  const visit = (
    node: DiskTreeNode,
    depth: number,
    startAngle: number,
    endAngle: number,
    baseColorIdx: number
  ) => {
    if (depth > maxRings) return;
    const children = (node.children || []).filter((c) => Number.isFinite(c.bytes) && c.bytes > 0);
    if (children.length === 0) return;

    const totalChildBytes = children.reduce((s, c) => s + c.bytes, 0);
    if (!Number.isFinite(totalChildBytes) || totalChildBytes <= 0) return;

    const parentSpan = endAngle - startAngle;
    if (!Number.isFinite(parentSpan) || parentSpan <= 0) return;
    const r0 = innerR + (depth - 1) * ringWidth;
    const r1 = r0 + ringWidth - 2;
    let cursor = startAngle;

    children.forEach((child, idx) => {
      const span = (child.bytes / totalChildBytes) * parentSpan;
      const a0 = cursor;
      const a1 = cursor + span;
      cursor = a1;
      if (span < 0.025) {
        return;
      }
      const colorIdx = depth === 1 ? idx : baseColorIdx + idx;
      const color = pickVizColor(colorIdx, child.kind);
      const vizItem: VizItem = {
        id: `sb:${depth}:${child.path}:${child.name}:${idx}`,
        name: child.name,
        path: child.path,
        bytes: child.bytes,
        files: child.files,
        kind: child.kind,
        color,
        node: child,
      };
      arcs.push({
        item: vizItem,
        depth,
        startAngle: a0,
        endAngle: a1,
        innerRadius: r0,
        outerRadius: r1,
        pathData: describeSunburstArc(cx, cy, r0, r1, a0, a1),
        percent: (child.bytes / rootBytes) * 100,
      });

      if (depth < maxRings && child.children && child.children.length > 0 && span >= 0.08) {
        visit(child, depth + 1, a0, a1, colorIdx);
      }
    });
  };

  visit(root, 1, 0, Math.PI * 2, 0);
  return arcs;
}

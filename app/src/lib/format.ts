export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-GB").format(n);
}

export function shortenPath(p: string, max = 80): string {
  if (p.length <= max) return p;
  return p.slice(0, 24) + "…" + p.slice(-(max - 25));
}

export const PRICING = {
  activation: "£1.99",
  monthly: "£9.99",
} as const;

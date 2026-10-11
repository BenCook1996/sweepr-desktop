export interface LifetimeStats {
  bytesFreed: number;
  filesRemoved: number;
}

export function getLifetimeStats(): LifetimeStats {
  const stored = localStorage.getItem("sweepr_lifetime");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {}
  }
  return { bytesFreed: 0, filesRemoved: 0 };
}

export function addLifetimeStats(bytes: number, files: number) {
  const current = getLifetimeStats();
  current.bytesFreed += bytes;
  current.filesRemoved += files;
  localStorage.setItem("sweepr_lifetime", JSON.stringify(current));
  window.dispatchEvent(new Event("sweepr-stats-update"));
}

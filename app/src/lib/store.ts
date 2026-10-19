import { api } from "./api";

export interface LifetimeStats {
  bytesFreed: number;
  filesRemoved: number;
}

export interface CleaningSession {
  id: string;
  timestamp: number;
  bytes_freed: number;
  files_removed: number;
  categories: string[];
  mode: string;
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

export async function syncLifetimeStatsFromBackend(): Promise<LifetimeStats> {
  try {
    const entries = await api.getCleaningHistory();
    if (entries && entries.length > 0) {
      localStorage.setItem("sweepr_cleaning_history", JSON.stringify(entries.slice(0, 50)));
      const backendBytes = entries.reduce((sum, e) => sum + e.bytes_freed, 0);
      const backendFiles = entries.reduce((sum, e) => sum + e.files_removed, 0);
      const current = getLifetimeStats();
      const merged: LifetimeStats = {
        bytesFreed: Math.max(current.bytesFreed, backendBytes),
        filesRemoved: Math.max(current.filesRemoved, backendFiles),
      };
      localStorage.setItem("sweepr_lifetime", JSON.stringify(merged));
      window.dispatchEvent(new Event("sweepr-stats-update"));
      return merged;
    }
  } catch {
    // Fallback to local cache if backend call fails
  }
  return getLifetimeStats();
}

export function addLifetimeStats(
  bytes: number,
  files: number,
  categories: string[] = [],
  mode = "Manual",
  persistToBackend = true
) {
  const current = getLifetimeStats();
  current.bytesFreed += bytes;
  current.filesRemoved += files;
  localStorage.setItem("sweepr_lifetime", JSON.stringify(current));

  if (bytes > 0 || files > 0) {
    const history = getLocalCleaningHistory();
    history.unshift({
      id: `sess_${Date.now()}`,
      timestamp: Math.floor(Date.now() / 1000),
      bytes_freed: bytes,
      files_removed: files,
      categories,
      mode,
    });
    localStorage.setItem("sweepr_cleaning_history", JSON.stringify(history.slice(0, 50)));

    if (persistToBackend) {
      api
        .recordCleaningHistory(bytes, files, categories, mode)
        .then((entries) => {
          localStorage.setItem("sweepr_cleaning_history", JSON.stringify(entries.slice(0, 50)));
        })
        .catch(() => {});
    }
  }

  window.dispatchEvent(new Event("sweepr-stats-update"));
}

export function getLocalCleaningHistory(): CleaningSession[] {
  const stored = localStorage.getItem("sweepr_cleaning_history");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {}
  }
  return [];
}

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Group = "system" | "browsers" | "apps" | "developer";

export interface FileEntry { path: string; size: number }
export interface CategoryResult {
  id: string; name: string; description: string; group: Group; free: boolean;
  bytes: number; files: number; roots: string[]; top_files: FileEntry[];
}
export interface ScanReport { categories: CategoryResult[]; total_bytes: number; total_files: number; duration_ms: number }
export interface ScanProgress { done: number; total: number; category_id: string; category_name: string; bytes_so_far: number }
export interface CleanReport { category_id: string; bytes_freed: number; files_removed: number; files_skipped: number; moved_to_trash: boolean }
export interface LicenseStatus { active: boolean; status: string; plan: string | null; expires_at: number | null; offline: boolean; dev_unlock: boolean }
export interface AppMemory { name: string; bytes: number; processes: number }
export interface MemoryOverview { total_bytes: number; used_bytes: number; available_bytes: number; top_apps: AppMemory[] }
export interface StartupItem { name: string; command: string; scope: string }
export interface AppInfo { version: string; platform: string; api_url: string }
export interface AppError { kind: "payment_required" | "network" | "license" | "not_found" | "other"; message: string }

export const isAppError = (e: unknown): e is AppError =>
  typeof e === "object" && e !== null && "kind" in e && "message" in e;

export const errorMessage = (e: unknown) => (isAppError(e) ? e.message : String(e));

export const api = {
  fetchApps: () => invoke<InstalledApp[]>('fetch_apps'),
  uninstallApp: (uninstall_string: string) => invoke<void>('uninstall_app', { uninstallString: uninstall_string }),
  findDuplicates: (dir: string) => invoke<DuplicateGroup[]>('find_duplicates', { dir }),
  scan: () => invoke<ScanReport>("scan_start"),
  onScanProgress: (cb: (p: ScanProgress) => void): Promise<UnlistenFn> =>
    listen<ScanProgress>("scan://progress", (e) => cb(e.payload)),
  clean: (ids: string[], useTrash: boolean) => invoke<CleanReport[]>("clean_categories", { ids, useTrash }),
  licenseStatus: (force = false) => invoke<LicenseStatus>("license_status", { force }),
  startCheckout: () => invoke<void>("start_checkout"),
  openBillingPortal: () => invoke<void>("open_billing_portal"),
  memory: () => invoke<MemoryOverview>("memory_overview"),
  shredFile: (path: string) => invoke<number>("shred_file", { path }),
  scanRegistry: () => invoke<RegistryIssue[]>("scan_registry"),
  fixRegistryIssue: (key_path: string) => invoke<void>("fix_registry_issue", { keyPath: key_path }),
  appInfo: () => invoke<AppInfo>("app_info"),
};

export interface InstalledApp { id: string; name: string; publisher: string; version: string; install_date: string; estimated_size: number; uninstall_string: string; }
export interface DuplicateGroup { hash: string; size: number; files: string[]; }
export interface RegistryIssue { key: string; name: string; issue_type: string; details: string; }


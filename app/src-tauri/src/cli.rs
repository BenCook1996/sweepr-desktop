//! Headless CLI dispatcher for SWEEPR Cleaner (#13, #15, #20).
//! Preserves GUI launches (`--portable` alone, `--installer`, `--attribution-id=...`)
//! and attaches to the parent console on Windows ONLY when headless CLI flags are used.

use crate::cleaner::{self, CleanReport};
use crate::commands::{self, CleanHistoryEntry};
use crate::error::AppError;
use crate::licensing::Licensing;
use crate::rules;
use crate::safety;
use crate::scanner;
use crate::scheduler;
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CliCommand {
    Help,
    Version,
    ExportRulesCatalog { path: Option<PathBuf> },
    ActivateToken { token: String },
    ScheduledClean,
    ScanClean(ScanCleanOptions),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScanCleanOptions {
    pub scan: bool,
    pub clean: bool,
    pub dry_run: bool,
    pub json: bool,
    pub categories: Vec<String>,
    pub use_trash: bool,
    pub portable: bool,
    pub data_dir: Option<PathBuf>,
}

#[derive(Serialize, Clone, Debug)]
struct CliErrorPayload {
    ok: bool,
    kind: String,
    error: String,
}

#[derive(Serialize, Clone, Debug)]
struct CliScanCleanOutput {
    ok: bool,
    command: String,
    dry_run: bool,
    portable: bool,
    data_dir: String,
    total_bytes: u64,
    total_files: u64,
    duration_ms: u64,
    categories: Vec<scanner::CategoryResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    clean_reports: Option<Vec<CleanReport>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes_freed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    files_removed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    files_skipped: Option<u64>,
}

#[cfg(windows)]
fn attach_parent_console_if_needed() {
    const ATTACH_PARENT_PROCESS: u32 = 0xFFFF_FFFF;
    const STD_OUTPUT_HANDLE: u32 = (-11i32) as u32;
    const STD_ERROR_HANDLE: u32 = (-12i32) as u32;
    const INVALID_HANDLE_VALUE: isize = -1;

    #[link(name = "kernel32")]
    extern "system" {
        fn AttachConsole(dw_process_id: u32) -> i32;
        fn GetStdHandle(n_std_handle: u32) -> isize;
    }

    unsafe {
        let out = GetStdHandle(STD_OUTPUT_HANDLE);
        let err = GetStdHandle(STD_ERROR_HANDLE);
        let out_missing = out == 0 || out == INVALID_HANDLE_VALUE;
        let err_missing = err == 0 || err == INVALID_HANDLE_VALUE;
        if out_missing || err_missing {
            let _ = AttachConsole(ATTACH_PARENT_PROCESS);
        }
    }
}

#[cfg(not(windows))]
fn attach_parent_console_if_needed() {}

/// Normalizes a `--scan-dir` argument value (trims quotes/whitespace, fixes drive roots like `D:` -> `D:\`).
fn normalize_scan_dir_value(raw: &str) -> Option<String> {
    let mut s = raw.trim().trim_matches('"').trim().to_string();
    if s.is_empty() {
        return None;
    }
    if s.len() == 2 && s.as_bytes()[0].is_ascii_alphabetic() && s.as_bytes()[1] == b':' {
        s.push('\\');
    }
    Some(s)
}

/// Extracts `--scan-dir <PATH>` or `--scan-dir=<PATH>` from process arguments for GUI startup.
pub fn extract_scan_dir_arg(args: &[String]) -> Option<String> {
    let mut i = 1usize;
    while i < args.len() {
        let arg = args[i].as_str();
        if arg == "--scan-dir" {
            if let Some(next) = args.get(i + 1) {
                if let Some(clean) = normalize_scan_dir_value(next) {
                    return Some(clean);
                }
            }
            i += 2;
            continue;
        }
        if let Some(val) = arg.strip_prefix("--scan-dir=") {
            if let Some(clean) = normalize_scan_dir_value(val) {
                return Some(clean);
            }
        }
        i += 1;
    }
    None
}

fn has_headless_action_flag(args: &[String]) -> bool {
    args.iter().skip(1).any(|a| {
        a == "--help"
            || a == "-h"
            || a == "--version"
            || a == "-V"
            || a == "--export-rules-catalog"
            || a.starts_with("--export-rules-catalog=")
            || a == "--activate-token"
            || a.starts_with("--activate-token=")
            || a == "--scheduled-clean"
            || a == "--scan"
            || a == "--clean"
    })
}

fn push_categories(raw: &str, out: &mut Vec<String>) -> Result<(), String> {
    let mut added_any = false;
    for part in raw.split(',') {
        let cat = part.trim();
        if cat.is_empty() {
            continue;
        }
        added_any = true;
        if !out.iter().any(|existing| existing.eq_ignore_ascii_case(cat)) {
            out.push(cat.to_string());
        }
    }
    if !added_any {
        return Err("--category requires a non-empty category ID".into());
    }
    Ok(())
}

/// Pure argument parser for headless CLI mode.
/// Returns `Ok(None)` when no headless action flag is present so GUI launches
/// (including `--portable`, `--installer`, `--attribution-id=...`) proceed normally.
pub fn parse_cli_args(args: &[String]) -> Result<Option<CliCommand>, String> {
    if !has_headless_action_flag(args) {
        return Ok(None);
    }

    let mut help = false;
    let mut version = false;
    let mut export_catalog: Option<Option<PathBuf>> = None;
    let mut activate_token: Option<String> = None;
    let mut scheduled_clean = false;
    let mut scan = false;
    let mut clean = false;
    let mut dry_run = false;
    let mut json = false;
    let mut use_trash = false;
    let mut portable = false;
    let mut data_dir: Option<PathBuf> = None;
    let mut categories: Vec<String> = Vec::new();

    let mut i = 1usize;
    while i < args.len() {
        let arg = args[i].as_str();
        match arg {
            "--help" | "-h" => help = true,
            "--version" | "-V" => version = true,
            "--scheduled-clean" => scheduled_clean = true,
            "--scan" => scan = true,
            "--clean" => clean = true,
            "--dry-run" => dry_run = true,
            "--json" => json = true,
            "--trash" => use_trash = true,
            "--portable" => portable = true,
            "--export-rules-catalog" => {
                let next = args
                    .get(i + 1)
                    .filter(|v| !v.starts_with('-') && !v.trim().is_empty())
                    .map(|v| {
                        i += 1;
                        PathBuf::from(v)
                    });
                export_catalog = Some(next);
            }
            "--activate-token" => {
                let val = args
                    .get(i + 1)
                    .filter(|v| !v.starts_with('-') && !v.trim().is_empty())
                    .cloned()
                    .ok_or_else(|| "--activate-token requires a token value".to_string())?;
                i += 1;
                activate_token = Some(val);
            }
            "--category" => {
                let val = args
                    .get(i + 1)
                    .filter(|v| !v.starts_with('-'))
                    .ok_or_else(|| "--category requires a category ID".to_string())?;
                i += 1;
                push_categories(val, &mut categories)?;
            }
            "--data-dir" => {
                let val = args
                    .get(i + 1)
                    .filter(|v| !v.starts_with('-') && !v.trim().is_empty())
                    .ok_or_else(|| "--data-dir requires a directory path".to_string())?;
                i += 1;
                data_dir = Some(PathBuf::from(val));
            }
            other => {
                if let Some(val) = other.strip_prefix("--export-rules-catalog=") {
                    let p = if val.trim().is_empty() {
                        None
                    } else {
                        Some(PathBuf::from(val))
                    };
                    export_catalog = Some(p);
                } else if let Some(val) = other.strip_prefix("--activate-token=") {
                    if val.trim().is_empty() {
                        return Err("--activate-token requires a non-empty token value".into());
                    }
                    activate_token = Some(val.to_string());
                } else if let Some(val) = other.strip_prefix("--category=") {
                    push_categories(val, &mut categories)?;
                } else if let Some(val) = other.strip_prefix("--data-dir=") {
                    if val.trim().is_empty() {
                        return Err("--data-dir requires a non-empty directory path".into());
                    }
                    data_dir = Some(PathBuf::from(val));
                } else if other == "--installer" || other.starts_with("--attribution-id=") || other.starts_with("--scan-dir=") {
                    // Known installer/attribution/GUI scan-dir flags can coexist safely
                } else if other == "--scan-dir" {
                    if args.get(i + 1).is_some() {
                        i += 1;
                    }
                } else {
                    return Err(format!("Unknown CLI argument: {other}"));
                }
            }
        }
        i += 1;
    }

    if help {
        return Ok(Some(CliCommand::Help));
    }
    if version {
        return Ok(Some(CliCommand::Version));
    }
    if let Some(path) = export_catalog {
        return Ok(Some(CliCommand::ExportRulesCatalog { path }));
    }
    if let Some(token) = activate_token {
        return Ok(Some(CliCommand::ActivateToken { token }));
    }
    if scheduled_clean {
        return Ok(Some(CliCommand::ScheduledClean));
    }

    Ok(Some(CliCommand::ScanClean(ScanCleanOptions {
        scan,
        clean,
        dry_run,
        json,
        categories,
        use_trash,
        portable,
        data_dir,
    })))
}

fn print_help() {
    println!(
        "\
SWEEPR Cleaner CLI v{}

USAGE:
  sweepr [OPTIONS]

ACTIONS:
  --scan                         Scan reclaimable junk categories (read-only)
  --clean                        Clean selected (or all eligible) categories
  --dry-run                      Preview cleanup without deleting files or writing state
  --scheduled-clean              Run configured scheduled cleanup task headlessly
  --activate-token <TOKEN>       Activate Pro license with pairing or enterprise JWS token
  --export-rules-catalog [PATH]  Export public built-in rules catalog JSON
  -h, --help                     Print this help message
  -V, --version                  Print application version

OPTIONS:
  --category <ID[,ID...]>        Filter to specific rule ID(s) (repeatable & comma-separated)
  --json                         Emit machine-readable JSON output
  --trash                        Send cleaned Pro items to OS Recycle Bin / Trash
  --portable                     Store data in portable_data beside executable
  --data-dir <PATH>              Override validated SWEEPR data directory
  --scan-dir <PATH>              Launch GUI directly into Disk Space Map for folder
",
        env!("CARGO_PKG_VERSION")
    );
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn format_cli_error(json: bool, kind: &str, msg: &str) -> String {
    if json {
        serde_json::to_string_pretty(&CliErrorPayload {
            ok: false,
            kind: kind.to_string(),
            error: msg.to_string(),
        })
        .unwrap_or_else(|_| format!("{{\"ok\":false,\"kind\":\"{kind}\",\"error\":\"{msg}\"}}"))
    } else {
        format!("sweepr: {msg}")
    }
}

pub async fn execute_scan_clean_in(
    opts: &ScanCleanOptions,
    data_dir: &Path,
    local_data_dir: &Path,
    licensing: &Licensing,
) -> Result<String, (i32, String)> {
    let disabled = safety::load_disabled_rules(data_dir);
    let available_rules: Vec<rules::Rule> = rules::all_with_custom(data_dir)
        .into_iter()
        .filter(|r| !disabled.contains(&r.id.to_ascii_lowercase()))
        .collect();

    let selected: Vec<rules::Rule> = if opts.categories.is_empty() {
        available_rules
    } else {
        let mut chosen = Vec::new();
        let mut unknown = Vec::new();
        for req_id in &opts.categories {
            if let Some(found) = available_rules
                .iter()
                .find(|r| r.id.eq_ignore_ascii_case(req_id))
            {
                chosen.push(found.clone());
            } else {
                unknown.push(req_id.clone());
            }
        }
        if !unknown.is_empty() {
            let valid_ids: Vec<String> = available_rules.iter().map(|r| r.id.clone()).collect();
            let msg = format!(
                "Unknown or disabled category ID(s): {}. Available: {}",
                unknown.join(", "),
                valid_ids.join(", ")
            );
            return Err((1, format_cli_error(opts.json, "not_found", &msg)));
        }
        chosen
    };

    let exclusions = safety::load_exclusions(data_dir);
    let is_real_clean = opts.clean && !opts.dry_run;
    let command_name = if opts.clean { "clean" } else { "scan" };

    if !is_real_clean {
        // Non-destructive scan or `--clean --dry-run`: never delete files or mutate state.
        let report = scanner::scan_all_with_exclusions(&selected, &exclusions, |_| {});
        if opts.json {
            let payload = CliScanCleanOutput {
                ok: true,
                command: command_name.to_string(),
                dry_run: true,
                portable: opts.portable,
                data_dir: data_dir.to_string_lossy().into_owned(),
                total_bytes: report.total_bytes,
                total_files: report.total_files,
                duration_ms: report.duration_ms,
                categories: report.categories,
                clean_reports: None,
                bytes_freed: None,
                files_removed: None,
                files_skipped: None,
            };
            let json_out = serde_json::to_string_pretty(&payload)
                .map_err(|e| (1, format_cli_error(true, "other", &e.to_string())))?;
            return Ok(json_out);
        }

        let mut lines = vec![format!(
            "SWEEPR {} (dry-run): {} bytes across {} files ({} ms)",
            command_name, report.total_bytes, report.total_files, report.duration_ms
        )];
        for cat in &report.categories {
            if cat.bytes > 0 || !opts.categories.is_empty() {
                lines.push(format!(
                    "  [{}] {} ({}) - {} bytes, {} files",
                    if cat.free { "FREE" } else { "PRO" },
                    cat.id,
                    cat.name,
                    cat.bytes,
                    cat.files
                ));
            }
        }
        return Ok(lines.join("\n"));
    }

    // Real clean (`--clean` without `--dry-run`)
    let _ = std::fs::create_dir_all(data_dir);
    let _ = std::fs::create_dir_all(local_data_dir);
    cleaner::purge_expired_quarantine_in(data_dir);

    let all_free = !selected.is_empty() && selected.iter().all(|r| r.free);
    let is_licensed = match commands::resolve_clean_is_licensed(licensing, data_dir, all_free).await {
        Ok(v) => v,
        Err(AppError::PaymentRequired) => {
            let msg = "SWEEPR Pro license required to clean non-free or custom categories. Free CLI categories: temp, chrome, edge, brave, firefox (or use --dry-run to preview).";
            return Err((2, format_cli_error(opts.json, "payment_required", msg)));
        }
        Err(e) => {
            return Err((1, format_cli_error(opts.json, "license", &e.to_string())));
        }
    };

    let scan_report = if opts.scan {
        Some(scanner::scan_all_with_exclusions(&selected, &exclusions, |_| {}))
    } else {
        None
    };

    let clean_ids: Vec<String> = selected.iter().map(|r| r.id.clone()).collect();
    let clean_reports = if !is_licensed {
        commands::execute_free_clean(&selected, clean_ids, data_dir, local_data_dir).map_err(|e| {
            let code = if matches!(e, AppError::PaymentRequired) { 2 } else { 1 };
            let kind = if code == 2 { "payment_required" } else { "other" };
            (code, format_cli_error(opts.json, kind, &e.to_string()))
        })?
    } else {
        let q_budget = commands::load_ui_preferences(data_dir).quarantine_budget_bytes;
        let reps: Vec<CleanReport> = selected
            .iter()
            .map(|r| {
                cleaner::clean_with_exclusions_quarantine_and_options(
                    r,
                    opts.use_trash,
                    &exclusions,
                    Some(data_dir),
                    None,
                    q_budget,
                )
            })
            .collect();
        let total_freed: u64 = reps.iter().map(|r| r.bytes_freed).sum();
        let total_removed: u64 = reps.iter().map(|r| r.files_removed).sum();
        if total_freed > 0 || total_removed > 0 {
            let entry = CleanHistoryEntry {
                id: format!("cli_{}", now_secs()),
                timestamp: now_secs(),
                bytes_freed: total_freed,
                files_removed: total_removed,
                categories: clean_ids,
                mode: if opts.use_trash {
                    "CLI (Recycle Bin)".into()
                } else {
                    "CLI (Sweepr Quarantine 7d undo)".into()
                },
            };
            let _ = commands::append_cleaning_history_pub(data_dir, entry);
        }
        reps
    };

    let bytes_freed: u64 = clean_reports.iter().map(|r| r.bytes_freed).sum();
    let files_removed: u64 = clean_reports.iter().map(|r| r.files_removed).sum();
    let files_skipped: u64 = clean_reports.iter().map(|r| r.files_skipped).sum();

    if opts.json {
        let (total_bytes, total_files, duration_ms, categories) = match scan_report {
            Some(sr) => (sr.total_bytes, sr.total_files, sr.duration_ms, sr.categories),
            None => (bytes_freed, files_removed, 0, Vec::new()),
        };
        let payload = CliScanCleanOutput {
            ok: true,
            command: command_name.to_string(),
            dry_run: false,
            portable: opts.portable,
            data_dir: data_dir.to_string_lossy().into_owned(),
            total_bytes,
            total_files,
            duration_ms,
            categories,
            clean_reports: Some(clean_reports),
            bytes_freed: Some(bytes_freed),
            files_removed: Some(files_removed),
            files_skipped: Some(files_skipped),
        };
        let json_out = serde_json::to_string_pretty(&payload)
            .map_err(|e| (1, format_cli_error(true, "other", &e.to_string())))?;
        return Ok(json_out);
    }

    let mut lines = vec![format!(
        "SWEEPR clean complete: freed {} bytes, removed {} files, skipped {} files",
        bytes_freed, files_removed, files_skipped
    )];
    for rep in &clean_reports {
        lines.push(format!(
            "  {} -> {} bytes freed, {} removed, {} skipped",
            rep.category_id, rep.bytes_freed, rep.files_removed, rep.files_skipped
        ));
    }
    Ok(lines.join("\n"))
}

pub fn run_if_requested() -> bool {
    let args: Vec<String> = std::env::args().collect();
    if !has_headless_action_flag(&args) {
        return false;
    }

    attach_parent_console_if_needed();
    let want_json = args.iter().any(|a| a == "--json");

    let cmd = match parse_cli_args(&args) {
        Ok(Some(c)) => c,
        Ok(None) => return false,
        Err(msg) => {
            eprintln!("{}", format_cli_error(want_json, "invalid_args", &msg));
            let _ = std::io::stderr().flush();
            std::process::exit(1);
        }
    };

    match cmd {
        CliCommand::Help => {
            print_help();
            let _ = std::io::stdout().flush();
            std::process::exit(0);
        }
        CliCommand::Version => {
            println!("sweepr {}", env!("CARGO_PKG_VERSION"));
            let _ = std::io::stdout().flush();
            std::process::exit(0);
        }
        CliCommand::ExportRulesCatalog { path } => {
            let out_path = path.unwrap_or_else(|| PathBuf::from("docs").join("public-rules-catalog.json"));
            match rules::export_public_rules_catalog_json() {
                Ok(json) => {
                    if let Some(parent) = out_path.parent().filter(|p| !p.as_os_str().is_empty()) {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    if let Err(e) = std::fs::write(&out_path, format!("{json}\n")) {
                        eprintln!("sweepr: failed to write {}: {e}", out_path.display());
                        let _ = std::io::stderr().flush();
                        std::process::exit(1);
                    }
                    println!("Exported public rules catalog to {}", out_path.display());
                    let _ = std::io::stdout().flush();
                    std::process::exit(0);
                }
                Err(e) => {
                    eprintln!("sweepr: failed to serialize rules catalog: {e}");
                    let _ = std::io::stderr().flush();
                    std::process::exit(1);
                }
            }
        }
        CliCommand::ActivateToken { token } => {
            let data_dir = crate::resolve_cli_data_dir(&args);
            let _ = std::fs::create_dir_all(&data_dir);
            let Ok(rt) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            else {
                eprintln!("sweepr: failed to initialize async runtime for activation");
                let _ = std::io::stderr().flush();
                std::process::exit(1);
            };
            let licensing = Licensing::new(data_dir);
            match rt.block_on(licensing.activate_token(&token)) {
                Ok(status) => {
                    println!(
                        "SWEEPR Cleaner activated (status: {}, plan: {})",
                        status.status,
                        status.plan.as_deref().unwrap_or("pro")
                    );
                    let _ = std::io::stdout().flush();
                    std::process::exit(0);
                }
                Err(e) => {
                    eprintln!("sweepr: activation failed: {e}");
                    let _ = std::io::stderr().flush();
                    std::process::exit(1);
                }
            }
        }
        CliCommand::ScheduledClean => {
            scheduler::run_headless_with_args(&args);
            std::process::exit(0);
        }
        CliCommand::ScanClean(mut opts) => {
            let mut resolved = crate::resolve_cli_data_dirs(&args);
            if opts.data_dir.is_some() {
                let validated = scheduler::resolve_validated_data_dir(&args);
                resolved.data_dir = validated.clone();
                if resolved.portable {
                    resolved.local_data_dir = validated;
                }
            }
            opts.portable = resolved.portable;

            let Ok(rt) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            else {
                eprintln!(
                    "{}",
                    format_cli_error(opts.json, "other", "failed to initialize async runtime")
                );
                let _ = std::io::stderr().flush();
                std::process::exit(1);
            };

            let licensing = Licensing::new(resolved.data_dir.clone());
            match rt.block_on(execute_scan_clean_in(
                &opts,
                &resolved.data_dir,
                &resolved.local_data_dir,
                &licensing,
            )) {
                Ok(out) => {
                    println!("{out}");
                    let _ = std::io::stdout().flush();
                    std::process::exit(0);
                }
                Err((code, err_out)) => {
                    eprintln!("{err_out}");
                    let _ = std::io::stderr().flush();
                    std::process::exit(code);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(items: &[&str]) -> Vec<String> {
        items.iter().map(|v| (*v).to_string()).collect()
    }

    #[test]
    fn parses_scan_clean_dry_run_json_and_repeatable_comma_categories() {
        // GUI-only flags must return Ok(None) so GUI launches normally
        assert_eq!(parse_cli_args(&s(&["sweepr.exe"])).unwrap(), None);
        assert_eq!(parse_cli_args(&s(&["sweepr.exe", "--portable"])).unwrap(), None);
        assert_eq!(parse_cli_args(&s(&["sweepr.exe", "--installer"])).unwrap(), None);
        assert_eq!(
            parse_cli_args(&s(&["sweepr.exe", "--attribution-id=attr_123"])).unwrap(),
            None
        );

        let parsed = parse_cli_args(&s(&[
            "sweepr.exe",
            "--portable",
            "--scan",
            "--clean",
            "--dry-run",
            "--json",
            "--trash",
            "--category",
            "temp",
            "--category",
            "chrome,edge",
            "--category=brave,temp",
        ]))
        .unwrap()
        .expect("should parse CLI command");

        assert_eq!(
            parsed,
            CliCommand::ScanClean(ScanCleanOptions {
                scan: true,
                clean: true,
                dry_run: true,
                json: true,
                categories: vec![
                    "temp".into(),
                    "chrome".into(),
                    "edge".into(),
                    "brave".into(),
                ],
                use_trash: true,
                portable: true,
                data_dir: None,
            })
        );

        assert!(matches!(
            parse_cli_args(&s(&["sweepr.exe", "--activate-token", "ptk_abc"])).unwrap(),
            Some(CliCommand::ActivateToken { token }) if token == "ptk_abc"
        ));
        assert!(matches!(
            parse_cli_args(&s(&["sweepr.exe", "--export-rules-catalog", "out.json"])).unwrap(),
            Some(CliCommand::ExportRulesCatalog { path: Some(p) }) if p == PathBuf::from("out.json")
        ));
        assert_eq!(
            parse_cli_args(&s(&["sweepr.exe", "--scheduled-clean"])).unwrap(),
            Some(CliCommand::ScheduledClean)
        );
        assert!(parse_cli_args(&s(&["sweepr.exe", "--scan", "--unknown-flag"])).is_err());
    }

    #[test]
    fn headless_scan_dry_run_json_executes_without_deleting_and_respects_pro_gate() {
        let base = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let root = base.join(format!("sweepr-cli-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let data_dir = root.join("data");
        let local_data_dir = root.join("local_data");
        let custom_cache = root.join("my_tool").join("cache");
        std::fs::create_dir_all(&data_dir).unwrap();
        std::fs::create_dir_all(&local_data_dir).unwrap();
        std::fs::create_dir_all(&custom_cache).unwrap();

        let sample_file = custom_cache.join("artifact.bin");
        std::fs::write(&sample_file, vec![b'x'; 2048]).unwrap();

        let custom_json = serde_json::json!({
            "id": "cli_custom_cache",
            "name": "CLI Custom Cache",
            "paths": [custom_cache.to_string_lossy()],
            "min_age_hours": 0
        })
        .to_string();
        rules::import_custom_rules_in(&data_dir, &custom_json, false).unwrap();

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let licensing = Licensing::new(data_dir.clone());

        // 1. `--scan --json` on custom rule outputs valid JSON and leaves files untouched
        let scan_opts = ScanCleanOptions {
            scan: true,
            clean: false,
            dry_run: false,
            json: true,
            categories: vec!["cli_custom_cache".into()],
            use_trash: false,
            portable: false,
            data_dir: None,
        };
        let scan_out = rt
            .block_on(execute_scan_clean_in(
                &scan_opts,
                &data_dir,
                &local_data_dir,
                &licensing,
            ))
            .unwrap();
        let parsed_scan: serde_json::Value = serde_json::from_str(&scan_out).unwrap();
        assert_eq!(parsed_scan.get("ok").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(parsed_scan.get("dry_run").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(parsed_scan.get("total_bytes").and_then(|v| v.as_u64()), Some(2048));
        assert!(sample_file.exists(), "--scan must never delete files");
        assert!(!data_dir.join("cleaning_history.json").exists());

        // 2. `--clean --dry-run --json` also leaves files untouched and does not fail Pro gate
        let dry_clean_opts = ScanCleanOptions {
            clean: true,
            dry_run: true,
            ..scan_opts.clone()
        };
        let dry_out = rt
            .block_on(execute_scan_clean_in(
                &dry_clean_opts,
                &data_dir,
                &local_data_dir,
                &licensing,
            ))
            .unwrap();
        let parsed_dry: serde_json::Value = serde_json::from_str(&dry_out).unwrap();
        assert_eq!(parsed_dry.get("command").and_then(|v| v.as_str()), Some("clean"));
        assert_eq!(parsed_dry.get("dry_run").and_then(|v| v.as_bool()), Some(true));
        assert!(sample_file.exists(), "--clean --dry-run must never delete files");

        // 3. Real `--clean` on Pro/custom rule fails with exit code 2 (PaymentRequired) when unlicensed
        let real_clean_pro = ScanCleanOptions {
            scan: false,
            clean: true,
            dry_run: false,
            ..scan_opts
        };
        let (code, err_json) = rt
            .block_on(execute_scan_clean_in(
                &real_clean_pro,
                &data_dir,
                &local_data_dir,
                &licensing,
            ))
            .unwrap_err();
        assert_eq!(code, 2);
        let parsed_err: serde_json::Value = serde_json::from_str(&err_json).unwrap();
        assert_eq!(
            parsed_err.get("kind").and_then(|v| v.as_str()),
            Some("payment_required")
        );
        assert!(sample_file.exists());

        // 4. Unknown category returns exit code 1
        let unknown_opts = ScanCleanOptions {
            categories: vec!["nonexistent_rule_xyz".into()],
            ..dry_clean_opts
        };
        let (bad_code, _) = rt
            .block_on(execute_scan_clean_in(
                &unknown_opts,
                &data_dir,
                &local_data_dir,
                &licensing,
            ))
            .unwrap_err();
        assert_eq!(bad_code, 1);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_dir_launches_gui_and_coexists_with_portable() {
        assert_eq!(
            parse_cli_args(&s(&["sweepr.exe", "--scan-dir", r"C:\Users\me\Downloads"])).unwrap(),
            None
        );
        assert_eq!(
            parse_cli_args(&s(&["sweepr.exe", "--portable", "--scan-dir=D:"])).unwrap(),
            None
        );
        assert_eq!(
            extract_scan_dir_arg(&s(&["sweepr.exe", "--scan-dir", r"C:\Users\me\Downloads"])),
            Some(r"C:\Users\me\Downloads".to_string())
        );
        assert_eq!(
            extract_scan_dir_arg(&s(&["sweepr.exe", "--scan-dir=\"D:\\\""])),
            Some(r"D:\".to_string())
        );
        assert_eq!(
            extract_scan_dir_arg(&s(&["sweepr.exe", "--scan-dir", "D:"])),
            Some(r"D:\".to_string())
        );
        assert_eq!(extract_scan_dir_arg(&s(&["sweepr.exe", "--scan-dir"])), None);

        // Coexists cleanly with headless flags too
        let parsed = parse_cli_args(&s(&["sweepr.exe", "--scan", "--scan-dir", r"C:\Temp"])).unwrap();
        assert!(matches!(parsed, Some(CliCommand::ScanClean(_))));
    }
}

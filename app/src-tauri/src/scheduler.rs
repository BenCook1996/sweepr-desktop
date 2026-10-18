//! Background Scheduled Scan & Clean manager.
//! Registers a native OS scheduled task (`schtasks` on Windows) that invokes
//! `sweepr.exe --scheduled-clean` headlessly at the user's chosen schedule
//! without requiring the SWEEPR Cleaner GUI to be open.

use crate::cleaner;
use crate::commands::{append_cleaning_history_pub, CleanHistoryEntry};
use crate::error::{AppError, AppResult};
use crate::licensing::Licensing;
use crate::rules;
use crate::safety;
use crate::scanner;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const TASK_NAME: &str = "SweeprScheduledClean";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ScheduleConfig {
    pub enabled: bool,
    /// "daily" | "weekly" | "monthly"
    pub frequency: String,
    /// "HH:MM" in 24-hour time (e.g. "09:00", "18:30")
    pub time: String,
    /// "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN"
    pub day_of_week: String,
    /// 1..=28
    pub day_of_month: u8,
    /// "scan_and_clean" | "scan_only"
    pub action: String,
    /// Category IDs to include in scheduled runs
    pub categories: Vec<String>,
    /// Whether the native OS scheduled task is currently active
    #[serde(default)]
    pub os_task_registered: bool,
    pub last_run_at: Option<u64>,
    pub last_bytes_found: Option<u64>,
    pub last_bytes_freed: Option<u64>,
    pub last_files_removed: Option<u64>,
}

impl Default for ScheduleConfig {
    fn default() -> Self {
        let categories = rules::all().into_iter().map(|r| r.id.to_string()).collect();
        Self {
            enabled: false,
            frequency: "daily".into(),
            time: "12:00".into(),
            day_of_week: "MON".into(),
            day_of_month: 1,
            action: "scan_and_clean".into(),
            categories,
            os_task_registered: false,
            last_run_at: None,
            last_bytes_found: None,
            last_bytes_freed: None,
            last_files_removed: None,
        }
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn config_path(data_dir: &Path) -> PathBuf {
    data_dir.join("schedule_config.json")
}

fn normalize_time(raw: &str) -> String {
    let parts: Vec<&str> = raw.trim().split(':').collect();
    if parts.len() >= 2 {
        let h = parts[0].parse::<u32>().unwrap_or(12).min(23);
        let m = parts[1].parse::<u32>().unwrap_or(0).min(59);
        format!("{h:02}:{m:02}")
    } else {
        "12:00".into()
    }
}

fn normalize_day_of_week(raw: &str) -> String {
    match raw.trim().to_ascii_uppercase().as_str() {
        "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN" => raw.trim().to_ascii_uppercase(),
        _ => "MON".into(),
    }
}

pub fn load_config(data_dir: &Path) -> ScheduleConfig {
    let path = config_path(data_dir);
    let mut cfg: ScheduleConfig = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    if cfg.categories.is_empty() {
        cfg.categories = rules::all().into_iter().map(|r| r.id.to_string()).collect();
    }
    cfg.time = normalize_time(&cfg.time);
    cfg.day_of_week = normalize_day_of_week(&cfg.day_of_week);
    cfg.day_of_month = cfg.day_of_month.clamp(1, 28);
    cfg.os_task_registered = is_os_task_registered();
    cfg
}

pub fn save_config(data_dir: &Path, mut cfg: ScheduleConfig) -> AppResult<ScheduleConfig> {
    let _ = std::fs::create_dir_all(data_dir);
    cfg.frequency = match cfg.frequency.trim().to_ascii_lowercase().as_str() {
        "weekly" => "weekly".into(),
        "monthly" => "monthly".into(),
        _ => "daily".into(),
    };
    cfg.action = match cfg.action.trim().to_ascii_lowercase().as_str() {
        "scan_only" => "scan_only".into(),
        _ => "scan_and_clean".into(),
    };
    cfg.time = normalize_time(&cfg.time);
    cfg.day_of_week = normalize_day_of_week(&cfg.day_of_week);
    cfg.day_of_month = cfg.day_of_month.clamp(1, 28);

    // Sync with OS Task Scheduler
    sync_os_task(&cfg, data_dir)?;
    cfg.os_task_registered = is_os_task_registered();

    let json = serde_json::to_string_pretty(&cfg)
        .map_err(|e| AppError::Other(format!("Failed to serialize schedule config: {e}")))?;
    std::fs::write(config_path(data_dir), json)
        .map_err(|e| AppError::Other(format!("Failed to save schedule config: {e}")))?;
    Ok(cfg)
}

#[cfg(target_os = "windows")]
fn is_os_task_registered() -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    std::process::Command::new("schtasks")
        .args(["/Query", "/TN", TASK_NAME])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn is_os_task_registered() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn sync_os_task(cfg: &ScheduleConfig, data_dir: &Path) -> AppResult<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    if !cfg.enabled {
        let _ = std::process::Command::new("schtasks")
            .args(["/Delete", "/F", "/TN", TASK_NAME])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        return Ok(());
    }

    let exe = std::env::current_exe()
        .map_err(|e| AppError::Other(format!("Could not determine application executable path: {e}")))?;
    let tr = format!(
        "\"{}\" --scheduled-clean --data-dir \"{}\"",
        exe.display(),
        data_dir.display()
    );

    let mut cmd = std::process::Command::new("schtasks");
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.args(["/Create", "/F", "/TN", TASK_NAME, "/TR", &tr]);

    match cfg.frequency.as_str() {
        "weekly" => {
            cmd.args(["/SC", "WEEKLY", "/D", &cfg.day_of_week, "/ST", &cfg.time]);
        }
        "monthly" => {
            let dom = cfg.day_of_month.clamp(1, 28).to_string();
            cmd.args(["/SC", "MONTHLY", "/D", &dom, "/ST", &cfg.time]);
        }
        _ => {
            cmd.args(["/SC", "DAILY", "/ST", &cfg.time]);
        }
    }

    let output = cmd
        .output()
        .map_err(|e| AppError::Other(format!("Failed to launch Windows Task Scheduler (schtasks): {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(AppError::Other(format!(
            "Windows Task Scheduler could not register schedule: {} {}",
            stderr.trim(),
            stdout.trim()
        )));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn sync_os_task(_cfg: &ScheduleConfig, _data_dir: &Path) -> AppResult<()> {
    Ok(())
}

pub async fn execute_scheduled_run(data_dir: &Path, licensing: &Licensing) -> AppResult<ScheduleConfig> {
    licensing.require_active().await?;
    let mut cfg = load_config(data_dir);
    let exclusions = safety::load_exclusions(data_dir);
    let all_rules = rules::all();

    let selected_rules: Vec<rules::Rule> = if cfg.categories.is_empty() {
        all_rules
    } else {
        all_rules
            .into_iter()
            .filter(|r| cfg.categories.iter().any(|id| id == r.id))
            .collect()
    };

    let exclusions_scan = exclusions.clone();
    let rules_scan = selected_rules.clone();
    let report = tokio::task::spawn_blocking(move || {
        scanner::scan_all_with_exclusions(&rules_scan, &exclusions_scan, |_| {})
    })
    .await
    .map_err(|e| AppError::Other(format!("Scheduled scan task failed: {e}")))?;

    let mut total_freed = 0u64;
    let mut total_removed = 0u64;

    if cfg.action == "scan_and_clean" {
        let cleanable_rules = selected_rules;

        let clean_ids: Vec<String> = cleanable_rules.iter().map(|r| r.id.to_string()).collect();
        let data_dir_clean = data_dir.to_path_buf();
        let reports = tokio::task::spawn_blocking(move || {
            cleanable_rules
                .iter()
                .map(|r| {
                    cleaner::clean_with_exclusions_and_quarantine(
                        r,
                        false,
                        &exclusions,
                        Some(&data_dir_clean),
                    )
                })
                .collect::<Vec<_>>()
        })
        .await
        .map_err(|e| AppError::Other(format!("Scheduled clean task failed: {e}")))?;

        total_freed = reports.iter().map(|r| r.bytes_freed).sum();
        total_removed = reports.iter().map(|r| r.files_removed).sum();

        let entry = CleanHistoryEntry {
            id: format!("sched_{}", now_secs()),
            timestamp: now_secs(),
            bytes_freed: total_freed,
            files_removed: total_removed,
            categories: clean_ids,
            mode: "Scheduled Auto-Clean".into(),
        };
        let _ = append_cleaning_history_pub(data_dir, entry);
    } else {
        let entry = CleanHistoryEntry {
            id: format!("sched_scan_{}", now_secs()),
            timestamp: now_secs(),
            bytes_freed: 0,
            files_removed: 0,
            categories: cfg.categories.clone(),
            mode: format!("Scheduled Scan ({} found)", report.total_bytes),
        };
        let _ = append_cleaning_history_pub(data_dir, entry);
    }

    cfg.last_run_at = Some(now_secs());
    cfg.last_bytes_found = Some(report.total_bytes);
    cfg.last_bytes_freed = Some(total_freed);
    cfg.last_files_removed = Some(total_removed);
    cfg.os_task_registered = is_os_task_registered();

    if let Ok(json) = serde_json::to_string_pretty(&cfg) {
        let _ = std::fs::write(config_path(data_dir), json);
    }

    Ok(cfg)
}

/// Check CLI arguments on process start. If `--scheduled-clean` was passed by
/// the OS Task Scheduler, run the scheduled scan/clean headlessly without
/// opening a GUI window and return `true`.
pub fn run_headless_if_requested() -> bool {
    let args: Vec<String> = std::env::args().collect();
    if !args.iter().any(|a| a == "--scheduled-clean") {
        return false;
    }

    let mut data_dir = dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("com.sweepr.app");

    for i in 0..args.len() {
        if args[i] == "--data-dir" {
            if let Some(custom) = args.get(i + 1) {
                data_dir = PathBuf::from(custom);
            }
        }
    }

    let _ = std::fs::create_dir_all(&data_dir);
    cleaner::purge_expired_quarantine_in(&data_dir);

    if let Ok(rt) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        let licensing = Licensing::new(data_dir.clone());
        let _ = rt.block_on(execute_scheduled_run(&data_dir, &licensing));
    }

    true
}

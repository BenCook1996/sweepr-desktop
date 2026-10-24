//! "Total Battery & Mac/Phone Care" — Device Lifespan Extender.
//!
//! * Free diagnostic hook: reads real battery telemetry (health, cycles, charge,
//!   power draw, temperature) and finds background apps that burn CPU / block sleep.
//! * Paid core (gated in `commands.rs` behind the `battery_care` add-on):
//!   smart charge limiter, automatic thermal throttling and browser tab hibernation.
//!
//! Honesty rule: we never fabricate sensor values. When a machine has no battery
//! (desktop PC) or the OS hides a sensor, the field is `None` and the UI says so.

use crate::error::{AppError, AppResult};
use crate::memory;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

const CONFIG_FILE: &str = "battery_care.json";
/// Typical Li-ion wear: ~20% capacity lost over ~1000 full cycles.
const NORMAL_WEAR_PER_CYCLE: f64 = 0.02;
const MIN_CHARGE_LIMIT: u8 = 50;
const MAX_CHARGE_LIMIT: u8 = 100;
const DEFAULT_CHARGE_LIMIT: u8 = 80;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct BatteryCareConfig {
    pub charge_limit_enabled: bool,
    pub charge_limit_percent: u8,
    pub charge_limit_hardware_applied: bool,
    pub charge_limit_method: String,
    pub charge_limit_message: String,
    pub thermal_throttling_enabled: bool,
    pub auto_hibernate_tabs: bool,
}

impl Default for BatteryCareConfig {
    fn default() -> Self {
        Self {
            charge_limit_enabled: false,
            charge_limit_percent: DEFAULT_CHARGE_LIMIT,
            charge_limit_hardware_applied: false,
            charge_limit_method: "none".into(),
            charge_limit_message: String::new(),
            thermal_throttling_enabled: false,
            auto_hibernate_tabs: false,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct RunawayApp {
    pub name: String,
    pub pid: u32,
    pub processes: u32,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub blocks_sleep: bool,
    pub drain_share_percent: f32,
}

#[derive(Serialize, Clone, Debug)]
pub struct BatteryDiagnostics {
    pub has_battery: bool,
    pub platform: String,
    pub health_percent: Option<f32>,
    pub degradation_multiplier: Option<f32>,
    pub design_capacity_mwh: Option<u64>,
    pub full_charge_capacity_mwh: Option<u64>,
    pub cycle_count: Option<u32>,
    pub charge_percent: Option<u8>,
    pub ac_connected: bool,
    pub charging: bool,
    pub power_draw_watts: Option<f32>,
    pub temperature_c: Option<f32>,
    pub estimated_replacement_cost_usd: u32,
    pub sleep_drain_percent: f32,
    pub hook_headline: String,
    pub runaway_apps: Vec<RunawayApp>,
    pub inactive_browser_tabs_count: u32,
    pub config: BatteryCareConfig,
}

#[derive(Serialize, Clone, Debug)]
pub struct ThermalThrottleResult {
    pub enabled: bool,
    pub processes_throttled: u32,
    pub throttled_apps: Vec<String>,
    pub turbo_capped: bool,
    pub message: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct HibernateTabsResult {
    pub tabs_hibernated: u32,
    pub bytes_freed: u64,
    pub browsers: Vec<String>,
    pub memory_saver_policy_applied: bool,
    pub estimated_extra_minutes: u32,
    pub auto_enabled: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct UnplugAlert {
    pub charge_percent: u8,
    pub limit_percent: u8,
    pub hardware_applied: bool,
    pub title: String,
    pub message: String,
    pub timestamp: u64,
}

/// Raw sensor readings, normalised across platforms.
#[derive(Default, Debug, Clone, PartialEq)]
struct RawBattery {
    present: bool,
    design_mwh: Option<u64>,
    full_mwh: Option<u64>,
    cycles: Option<u32>,
    charge_percent: Option<u8>,
    ac_connected: bool,
    charging: bool,
    power_watts: Option<f32>,
    temperature_c: Option<f32>,
    manufacturer: String,
}

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

pub fn load_config(data_dir: &Path) -> BatteryCareConfig {
    std::fs::read_to_string(data_dir.join(CONFIG_FILE))
        .ok()
        .and_then(|s| serde_json::from_str::<BatteryCareConfig>(&s).ok())
        .map(|mut c| {
            c.charge_limit_percent = clamp_limit(c.charge_limit_percent);
            c
        })
        .unwrap_or_default()
}

fn save_config(data_dir: &Path, cfg: &BatteryCareConfig) -> AppResult<()> {
    let _ = std::fs::create_dir_all(data_dir);
    let json = serde_json::to_string_pretty(cfg).map_err(|e| AppError::Other(e.to_string()))?;
    std::fs::write(data_dir.join(CONFIG_FILE), json)
        .map_err(|e| AppError::Other(format!("Could not save Battery Care settings: {e}")))
}

fn clamp_limit(p: u8) -> u8 {
    p.clamp(MIN_CHARGE_LIMIT, MAX_CHARGE_LIMIT)
}

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

fn health_percent(design: Option<u64>, full: Option<u64>) -> Option<f32> {
    match (design, full) {
        (Some(d), Some(f)) if d > 0 && f > 0 => Some(((f as f64 / d as f64) * 100.0).min(100.0) as f32),
        _ => None,
    }
}

/// How many times faster than normal Li-ion wear this battery is degrading.
fn degradation_multiplier(health: Option<f32>, cycles: Option<u32>) -> Option<f32> {
    let h = health? as f64;
    let c = cycles? as f64;
    let actual_loss = (100.0 - h).max(0.0);
    let expected_loss = (c * NORMAL_WEAR_PER_CYCLE).max(2.0);
    Some(((actual_loss / expected_loss).clamp(0.3, 9.9) * 10.0).round() as f32 / 10.0)
}

fn replacement_cost_usd(platform: &str) -> u32 {
    match platform {
        "macos" => 199,
        _ => 129,
    }
}

fn round1(v: f32) -> f32 {
    (v * 10.0).round() / 10.0
}

fn build_headline(d: &BatteryDiagnostics) -> String {
    let runaway = d.runaway_apps.len();
    let apps_part = if runaway > 0 {
        format!(
            "{runaway} runaway background app{} {} using ~{:.0}% of your background power.",
            if runaway == 1 { "" } else { "s" },
            if runaway == 1 { "is" } else { "are" },
            d.sleep_drain_percent
        )
    } else {
        "No runaway background apps detected right now.".to_string()
    };
    if !d.has_battery {
        return format!("No battery detected (desktop PC). {apps_part}");
    }
    match (d.health_percent, d.degradation_multiplier) {
        (Some(h), Some(m)) if m >= 1.3 => format!(
            "Your battery health is at {h:.0}% (degrading {m:.1}x faster than normal). {apps_part}"
        ),
        (Some(h), _) => format!("Your battery health is at {h:.0}%. {apps_part}"),
        _ => format!("Battery detected, but your device hides its health sensor. {apps_part}"),
    }
}

/// Extra runtime gained from hibernating `tabs` background renderers.
fn estimate_extra_minutes(tabs: u32, battery_wh: f32, draw_watts: f32) -> u32 {
    if tabs == 0 || battery_wh <= 0.0 || draw_watts <= 0.5 {
        return 0;
    }
    let saved = (tabs as f32 * 0.15).min(draw_watts * 0.4);
    let before = battery_wh / draw_watts * 60.0;
    let after = battery_wh / (draw_watts - saved) * 60.0;
    (after - before).max(0.0).round() as u32
}

/// Parse `ioreg -rn AppleSmartBattery` output.
#[cfg(any(target_os = "macos", test))]
fn parse_ioreg(out: &str) -> RawBattery {
    let mut kv: HashMap<String, String> = HashMap::new();
    for line in out.lines() {
        let l = line.trim();
        if !l.starts_with('"') {
            continue;
        }
        if let Some((k, v)) = l.split_once(" = ") {
            kv.insert(k.trim_matches('"').to_string(), v.trim().to_string());
        }
    }
    if kv.is_empty() {
        return RawBattery::default();
    }
    let num = |k: &str| kv.get(k).and_then(|v| v.parse::<i64>().ok());
    let yes = |k: &str| kv.get(k).map(|v| v == "Yes").unwrap_or(false);
    let voltage_mv = num("Voltage").unwrap_or(0).max(0) as u64;
    let to_mwh = |mah: i64| -> u64 {
        let v = if voltage_mv > 0 { voltage_mv } else { 11_400 };
        (mah.max(0) as u64) * v / 1000
    };
    let design = num("DesignCapacity").map(to_mwh);
    let full = num("AppleRawMaxCapacity").or_else(|| num("NominalChargeCapacity")).map(to_mwh);
    // On Apple Silicon `CurrentCapacity`/`MaxCapacity` are already percentages.
    let charge = match (num("CurrentCapacity"), num("MaxCapacity")) {
        (Some(c), Some(m)) if m > 0 => Some(((c as f64 / m as f64) * 100.0).round().clamp(0.0, 100.0) as u8),
        _ => None,
    };
    // ioreg reports negative amperage as a two's-complement unsigned 64-bit integer.
    let signed = |k: &str| {
        kv.get(k).and_then(|v| v.parse::<i64>().ok().or_else(|| v.parse::<u64>().ok().map(|u| u as i64)))
    };
    let amps_ma = signed("InstantAmperage").or_else(|| signed("Amperage"));
    let power = amps_ma
        .filter(|a| *a != 0 && voltage_mv > 0)
        .map(|a| round1((a.unsigned_abs() as f32 * voltage_mv as f32) / 1_000_000.0));
    RawBattery {
        present: num("DesignCapacity").is_some() || yes("BatteryInstalled"),
        design_mwh: design,
        full_mwh: full,
        cycles: num("CycleCount").map(|c| c.max(0) as u32),
        charge_percent: charge,
        ac_connected: yes("ExternalConnected"),
        charging: yes("IsCharging"),
        power_watts: power,
        temperature_c: num("Temperature").map(|t| round1(t as f32 / 100.0)),
        manufacturer: "Apple".into(),
    }
}

/// Parse the JSON emitted by the Windows WMI probe script.
fn parse_windows_probe(json: &str) -> RawBattery {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json.trim()) else {
        return RawBattery::default();
    };
    let u = |k: &str| v.get(k).and_then(|x| x.as_u64());
    let b = |k: &str| v.get(k).and_then(|x| x.as_bool()).unwrap_or(false);
    let present = b("present");
    let status = u("status").unwrap_or(0);
    let charging = b("charging") || matches!(status, 6..=9);
    let ac = b("online") || status == 2 || charging;
    let rate_mw = if charging { u("chargeRate") } else { u("dischargeRate") };
    RawBattery {
        present,
        design_mwh: u("design").filter(|x| *x > 0),
        full_mwh: u("full").filter(|x| *x > 0),
        cycles: u("cycles").filter(|c| *c > 0).map(|c| c as u32),
        charge_percent: u("charge").map(|c| c.min(100) as u8),
        ac_connected: ac,
        charging,
        power_watts: rate_mw.filter(|r| *r > 0 && *r < 500_000).map(|r| round1(r as f32 / 1000.0)),
        // MSAcpi reports tenths of Kelvin.
        temperature_c: u("tz")
            .filter(|t| *t > 2732)
            .map(|t| round1((t as f32 - 2731.5) / 10.0))
            .filter(|t| *t > 0.0 && *t < 110.0),
        manufacturer: v.get("mfr").and_then(|x| x.as_str()).unwrap_or("").trim().to_string(),
    }
}

/// Executable names that blocked sleep, from `pmset -g assertions` / `powercfg /requests`.
fn parse_sleep_blockers(out: &str) -> Vec<String> {
    let mut names = Vec::new();
    for line in out.lines() {
        let l = line.trim();
        // macOS: "pid 123(coreaudiod): [0x...] 00:01:02 PreventUserIdleSystemSleep named: ..."
        if let Some(rest) = l.strip_prefix("pid ") {
            if let (Some(a), Some(b)) = (rest.find('('), rest.find(')')) {
                if b > a + 1 && (l.contains("PreventUserIdleSystemSleep") || l.contains("PreventSystemSleep")) {
                    names.push(rest[a + 1..b].to_ascii_lowercase());
                }
            }
        }
        // Windows: "[PROCESS] \Device\HarddiskVolume3\Program Files\App\app.exe"
        if let Some(rest) = l.strip_prefix("[PROCESS]") {
            if let Some(file) = rest.trim().rsplit(['\\', '/']).next() {
                names.push(file.trim_end_matches(".exe").trim_end_matches(".EXE").to_ascii_lowercase());
            }
        }
    }
    names.sort();
    names.dedup();
    names
}

fn is_protected_process(name: &str) -> bool {
    const PROTECTED: &[&str] = &[
        "system", "idle", "system idle process", "registry", "smss", "csrss", "wininit", "winlogon",
        "services", "lsass", "svchost", "dwm", "explorer", "fontdrvhost", "audiodg", "memcompression",
        "searchhost", "startmenuexperiencehost", "sihost", "taskhostw", "ctfmon", "msmpeng",
        "securityhealthservice", "kernel_task", "launchd", "windowserver", "coreaudiod", "loginwindow",
        "mds", "mds_stores", "hidd", "powerd", "systemd", "kworker", "sweepr", "sweepr-cleaner",
        "msedgewebview2",
    ];
    let n = name.to_ascii_lowercase();
    PROTECTED.iter().any(|p| n == *p)
}

// ---------------------------------------------------------------------------
// Platform probes
// ---------------------------------------------------------------------------

fn run_hidden(program: impl AsRef<std::ffi::OsStr>, args: &[&str]) -> Option<String> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(windows)]
fn powershell(script: &str) -> Option<String> {
    let exe = crate::safety::system_powershell_path();
    run_hidden(&exe, &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
}

#[cfg(windows)]
fn read_raw_battery() -> RawBattery {
    const SCRIPT: &str = r#"$ErrorActionPreference='SilentlyContinue'
$b = Get-CimInstance -ClassName Win32_Battery | Select-Object -First 1
$fc = (Get-CimInstance -Namespace root/wmi -ClassName BatteryFullChargedCapacity | Select-Object -First 1).FullChargedCapacity
$dc = (Get-CimInstance -Namespace root/wmi -ClassName BatteryStaticData | Select-Object -First 1).DesignedCapacity
$cc = (Get-CimInstance -Namespace root/wmi -ClassName BatteryCycleCount | Select-Object -First 1).CycleCount
$st = Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus | Select-Object -First 1
$tz = (Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | Select-Object -First 1).CurrentTemperature
$mf = (Get-CimInstance -ClassName Win32_ComputerSystem).Manufacturer
[pscustomobject]@{present=[bool]$b; charge=$b.EstimatedChargeRemaining; status=$b.BatteryStatus; full=$fc; design=$dc; cycles=$cc; online=[bool]$st.PowerOnline; charging=[bool]$st.Charging; chargeRate=$st.ChargeRate; dischargeRate=$st.DischargeRate; tz=$tz; mfr=$mf} | ConvertTo-Json -Compress"#;
    powershell(SCRIPT).map(|s| parse_windows_probe(&s)).unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn read_raw_battery() -> RawBattery {
    run_hidden("ioreg", &["-rn", "AppleSmartBattery"]).map(|s| parse_ioreg(&s)).unwrap_or_default()
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn read_raw_battery() -> RawBattery {
    let base = Path::new("/sys/class/power_supply");
    let Some(dir) = ["BAT0", "BAT1", "BATT"].iter().map(|n| base.join(n)).find(|p| p.exists()) else {
        return RawBattery::default();
    };
    let rd = |f: &str| std::fs::read_to_string(dir.join(f)).ok().map(|s| s.trim().to_string());
    let n = |f: &str| rd(f).and_then(|s| s.parse::<u64>().ok());
    let status = rd("status").unwrap_or_default();
    let uwh = |a: &str, b: &str| n(a).or_else(|| {
        let v = n("voltage_min_design")?;
        n(b).map(|c| c * v / 1_000_000)
    });
    RawBattery {
        present: true,
        design_mwh: uwh("energy_full_design", "charge_full_design").map(|v| v / 1000),
        full_mwh: uwh("energy_full", "charge_full").map(|v| v / 1000),
        cycles: n("cycle_count").filter(|c| *c > 0).map(|c| c as u32),
        charge_percent: n("capacity").map(|c| c.min(100) as u8),
        ac_connected: status != "Discharging",
        charging: status == "Charging",
        power_watts: n("power_now").filter(|p| *p > 0).map(|p| round1(p as f32 / 1_000_000.0)),
        temperature_c: None,
        manufacturer: rd("manufacturer").unwrap_or_default(),
    }
}

fn sleep_blocker_output() -> String {
    #[cfg(target_os = "macos")]
    {
        return run_hidden("pmset", &["-g", "assertions"]).unwrap_or_default();
    }
    #[cfg(windows)]
    {
        // Requires elevation on most systems; silently empty otherwise.
        return run_hidden(crate::safety::system32_binary("powercfg"), &["/requests"]).unwrap_or_default();
    }
    #[allow(unreachable_code)]
    String::new()
}

#[cfg(windows)]
fn foreground_pid() -> Option<u32> {
    use std::ffi::c_void;
    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> *mut c_void;
        fn GetWindowThreadProcessId(hwnd: *mut c_void, pid: *mut u32) -> u32;
    }
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        (pid != 0).then_some(pid)
    }
}

#[cfg(not(windows))]
fn foreground_pid() -> Option<u32> {
    None
}

/// Samples CPU over a short window and returns background apps burning power.
fn find_runaway_apps(blockers: &[String]) -> (Vec<RunawayApp>, f32) {
    let mut sys = System::new();
    let kind = ProcessRefreshKind::nothing().with_cpu().with_memory().with_exe(UpdateKind::OnlyIfNotSet);
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
    std::thread::sleep(std::time::Duration::from_millis(800));
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);

    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f32;
    let me = std::process::id();
    let fg = foreground_pid();

    // name -> (top pid, process count, cpu, mem)
    let mut grouped: HashMap<String, (u32, u32, f32, u64)> = HashMap::new();
    let mut total_cpu = 0f32;
    for (pid, p) in sys.processes() {
        let cpu = p.cpu_usage() / cores;
        total_cpu += cpu;
        let pid = pid.as_u32();
        if pid == me || Some(pid) == fg {
            continue;
        }
        let name = p.name().to_string_lossy().trim_end_matches(".exe").trim_end_matches(".EXE").to_string();
        if name.is_empty() || is_protected_process(&name) {
            continue;
        }
        let e = grouped.entry(name).or_insert((pid, 0, 0.0, 0));
        e.1 += 1;
        e.2 += cpu;
        e.3 += p.memory();
    }

    let total_cpu = total_cpu.max(1.0);
    let mut apps: Vec<RunawayApp> = grouped
        .into_iter()
        .filter_map(|(name, (pid, processes, cpu, mem))| {
            let blocks_sleep = blockers.iter().any(|b| b.eq_ignore_ascii_case(&name));
            (cpu >= 1.5 || blocks_sleep).then(|| RunawayApp {
                drain_share_percent: round1((cpu / total_cpu * 100.0).min(100.0)),
                cpu_percent: round1(cpu),
                name,
                pid,
                processes,
                memory_bytes: mem,
                blocks_sleep,
            })
        })
        .collect();
    apps.sort_by(|a, b| {
        b.blocks_sleep
            .cmp(&a.blocks_sleep)
            .then(b.cpu_percent.partial_cmp(&a.cpu_percent).unwrap_or(std::cmp::Ordering::Equal))
    });
    apps.truncate(12);
    let share = apps.iter().map(|a| a.drain_share_percent).sum::<f32>().min(100.0);
    (apps, round1(share))
}

// ---------------------------------------------------------------------------
// Free diagnostic hook
// ---------------------------------------------------------------------------

pub fn battery_diagnostics(data_dir: &Path) -> BatteryDiagnostics {
    let raw = read_raw_battery();
    let blockers = parse_sleep_blockers(&sleep_blocker_output());
    let (runaway_apps, sleep_drain_percent) = find_runaway_apps(&blockers);
    let tabs = memory::browser_memory_report().total_tab_processes;
    let platform = std::env::consts::OS.to_string();
    let health = if raw.present { health_percent(raw.design_mwh, raw.full_mwh) } else { None };

    let mut d = BatteryDiagnostics {
        has_battery: raw.present,
        health_percent: health.map(round1),
        degradation_multiplier: degradation_multiplier(health, raw.cycles),
        design_capacity_mwh: raw.design_mwh,
        full_charge_capacity_mwh: raw.full_mwh,
        cycle_count: raw.cycles,
        charge_percent: raw.charge_percent,
        ac_connected: raw.ac_connected || !raw.present,
        charging: raw.charging,
        power_draw_watts: raw.power_watts,
        temperature_c: raw.temperature_c,
        estimated_replacement_cost_usd: replacement_cost_usd(&platform),
        platform,
        sleep_drain_percent,
        hook_headline: String::new(),
        runaway_apps,
        inactive_browser_tabs_count: tabs,
        config: load_config(data_dir),
    };
    d.hook_headline = build_headline(&d);
    d
}

// ---------------------------------------------------------------------------
// Paid: smart charge limiter
// ---------------------------------------------------------------------------

/// Attempts to program a firmware charge cap. Returns (applied, method, message).
fn apply_hardware_charge_limit(enabled: bool, limit: u8, manufacturer: &str) -> (bool, String, String) {
    let target = if enabled { limit } else { 100 };
    #[cfg(windows)]
    {
        let mfr = manufacturer.to_ascii_lowercase();
        if mfr.contains("asus") {
            let script = format!(
                "$ErrorActionPreference='Stop'; Get-CimInstance -Namespace root/wmi -ClassName AsusAtkWmi_WMNB | Invoke-CimMethod -MethodName DEVS -Arguments @{{Device_ID=[uint32]0x00120057; Control_status=[uint32]{target}}} | Out-Null; 'ok'"
            );
            if powershell(&script).map(|s| s.contains("ok")).unwrap_or(false) {
                return (true, "asus_wmi".into(), format!("ASUS Battery Health Charging set to {target}%."));
            }
        }
        if mfr.contains("dell") {
            for cctk in [
                r"C:\Program Files (x86)\Dell\Command Configure\X86_64\cctk.exe",
                r"C:\Program Files\Dell\Command Configure\X86_64\cctk.exe",
            ] {
                if Path::new(cctk).exists() {
                    let arg = if enabled {
                        format!("--PrimaryBattChargeCfg=Custom:{}-{}", limit.saturating_sub(5).max(50), limit)
                    } else {
                        "--PrimaryBattChargeCfg=Standard".to_string()
                    };
                    if run_hidden(cctk, &[&arg]).is_some() {
                        return (true, "dell_cctk".into(), format!("Dell firmware charge cap set to {target}%."));
                    }
                }
            }
        }
        let _ = target;
        return (
            false,
            "software_guard".into(),
            if enabled {
                format!("Your laptop firmware doesn't expose a charge cap to apps. SWEEPR will alert you to unplug at {limit}% and keep background drain low.")
            } else {
                "Charge limiter disabled.".into()
            },
        );
    }
    #[cfg(target_os = "macos")]
    {
        let _ = (manufacturer, target);
        return (
            false,
            "macos_optimized_charging".into(),
            if enabled {
                format!("macOS restricts direct SMC writes. SWEEPR will alert you at {limit}% — also enable System Settings › Battery › Optimized Battery Charging.")
            } else {
                "Charge limiter disabled.".into()
            },
        );
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let _ = manufacturer;
        for bat in ["BAT0", "BAT1"] {
            let p = Path::new("/sys/class/power_supply").join(bat).join("charge_control_end_threshold");
            if p.exists() && std::fs::write(&p, target.to_string()).is_ok() {
                return (true, "linux_sysfs".into(), format!("Kernel charge threshold set to {target}%."));
            }
        }
        (false, "software_guard".into(), format!("Could not write the kernel charge threshold (root required). SWEEPR will alert you at {limit}%."))
    }
}

pub fn set_charge_limit(data_dir: &Path, enabled: bool, limit_percent: u8) -> AppResult<BatteryCareConfig> {
    let mut cfg = load_config(data_dir);
    let limit = clamp_limit(limit_percent);
    let raw = read_raw_battery();
    if enabled && !raw.present {
        return Err(AppError::Other("No battery detected — the charge limiter only applies to laptops.".into()));
    }
    let (applied, method, message) = apply_hardware_charge_limit(enabled, limit, &raw.manufacturer);
    cfg.charge_limit_enabled = enabled;
    cfg.charge_limit_percent = limit;
    cfg.charge_limit_hardware_applied = applied && enabled;
    cfg.charge_limit_method = if enabled { method } else { "none".into() };
    cfg.charge_limit_message = message;
    save_config(data_dir, &cfg)?;
    Ok(cfg)
}

// ---------------------------------------------------------------------------
// Paid: automatic thermal throttling
// ---------------------------------------------------------------------------

fn cap_turbo(enabled: bool) -> bool {
    #[cfg(windows)]
    {
        let max = if enabled { "99" } else { "100" };
        let powercfg = crate::safety::system32_binary("powercfg");
        let mut ok = true;
        for mode in ["/setacvalueindex", "/setdcvalueindex"] {
            ok &= run_hidden(&powercfg, &[mode, "SCHEME_CURRENT", "SUB_PROCESSOR", "PROCTHROTTLEMAX", max]).is_some();
        }
        let _ = run_hidden(&powercfg, &["/setactive", "SCHEME_CURRENT"]);
        return ok;
    }
    #[cfg(target_os = "macos")]
    {
        // Low Power Mode needs admin rights; best effort only.
        let v = if enabled { "1" } else { "0" };
        return std::process::Command::new("pmset")
            .args(["-a", "lowpowermode", v])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
    }
    #[allow(unreachable_code)]
    {
        let _ = enabled;
        false
    }
}

pub fn set_thermal_throttling(data_dir: &Path, enabled: bool) -> AppResult<ThermalThrottleResult> {
    let mut cfg = load_config(data_dir);
    cfg.thermal_throttling_enabled = enabled;
    save_config(data_dir, &cfg)?;

    let turbo_capped = cap_turbo(enabled) && enabled;
    let mut throttled_apps = Vec::new();
    let mut processes_throttled = 0u32;
    if enabled {
        let (apps, _) = find_runaway_apps(&[]);
        for app in apps.iter().filter(|a| a.cpu_percent >= 3.0) {
            memory::trim_and_eco_process(app.pid);
            processes_throttled += 1;
            throttled_apps.push(app.name.clone());
        }
    }
    let message = if !enabled {
        "Thermal throttling off — full CPU turbo restored.".to_string()
    } else if processes_throttled > 0 {
        format!(
            "Moved {processes_throttled} hot background app{} to efficiency mode{}.",
            if processes_throttled == 1 { "" } else { "s" },
            if turbo_capped { " and capped CPU turbo boost" } else { "" }
        )
    } else if turbo_capped {
        "CPU turbo boost capped to keep temperatures down.".to_string()
    } else {
        "Thermal guard enabled. No hot background apps right now.".to_string()
    };
    Ok(ThermalThrottleResult { enabled, processes_throttled, throttled_apps, turbo_capped, message })
}

// ---------------------------------------------------------------------------
// Paid: browser tab hibernation
// ---------------------------------------------------------------------------

pub fn hibernate_browser_tabs(data_dir: &Path, auto_enabled: Option<bool>) -> AppResult<HibernateTabsResult> {
    let mut cfg = load_config(data_dir);
    if let Some(a) = auto_enabled {
        cfg.auto_hibernate_tabs = a;
        save_config(data_dir, &cfg)?;
    }
    let r = memory::tame_browser_memory(None, cfg.auto_hibernate_tabs)?;
    let raw = read_raw_battery();
    let wh = raw.full_mwh.map(|m| m as f32 / 1000.0).unwrap_or(50.0);
    let draw = raw.power_watts.filter(|w| *w > 1.0).unwrap_or(8.0);
    Ok(HibernateTabsResult {
        tabs_hibernated: r.tabs_tamed,
        bytes_freed: r.bytes_freed,
        browsers: r.browsers_optimized,
        memory_saver_policy_applied: r.policy_applied,
        estimated_extra_minutes: if raw.present { estimate_extra_minutes(r.tabs_tamed, wh, draw) } else { 0 },
        auto_enabled: cfg.auto_hibernate_tabs,
    })
}

// ---------------------------------------------------------------------------
// System tray indicator & background unplug-alert monitor
// ---------------------------------------------------------------------------

pub const TRAY_ID: &str = "sweepr-battery-tray";
const UNPLUG_ALERT_COOLDOWN_SECS: u64 = 30 * 60;

pub struct TrayState {
    pub status_item: tauri::menu::MenuItem<tauri::Wry>,
    pub limit_item: tauri::menu::MenuItem<tauri::Wry>,
}

fn now_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Pure evaluation of whether the background monitor should trigger an unplug alert.
fn evaluate_unplug_alert(
    raw: &RawBattery,
    cfg: &BatteryCareConfig,
    now_ts: u64,
    last_alert_ts: &mut u64,
) -> Option<UnplugAlert> {
    if !cfg.charge_limit_enabled || !raw.present {
        *last_alert_ts = 0;
        return None;
    }
    let charge = raw.charge_percent?;
    let limit = clamp_limit(cfg.charge_limit_percent);
    if !raw.ac_connected || charge < limit {
        // Reset cooldown once the user unplugs or charge drops below the limit.
        *last_alert_ts = 0;
        return None;
    }
    // If firmware charge cap is active and holding at `limit` (not actively charging past it), no unplug needed.
    if cfg.charge_limit_hardware_applied && !raw.charging && charge <= limit.saturating_add(1) {
        return None;
    }
    if *last_alert_ts > 0 && now_ts.saturating_sub(*last_alert_ts) < UNPLUG_ALERT_COOLDOWN_SECS {
        return None;
    }
    *last_alert_ts = now_ts;
    let title = format!("SWEEPR Battery Care — {charge}% reached (limit {limit}%)");
    let message = format!(
        "Your battery is at {charge}% while plugged in. Unplug now to keep it near your {limit}% lifespan target and reduce lithium-ion wear."
    );
    Some(UnplugAlert {
        charge_percent: charge,
        limit_percent: limit,
        hardware_applied: cfg.charge_limit_hardware_applied,
        title,
        message,
        timestamp: now_ts,
    })
}

/// Formats `(tooltip, status_line, limit_line)` for the system tray icon and menu.
fn format_tray_status(raw: &RawBattery, cfg: &BatteryCareConfig) -> (String, String, String) {
    let limit_line = if cfg.charge_limit_enabled {
        let mode = if cfg.charge_limit_hardware_applied {
            "Firmware Cap"
        } else {
            "Unplug Alert"
        };
        format!(
            "Charge Limit: {}% ({mode}){}",
            cfg.charge_limit_percent,
            if cfg.thermal_throttling_enabled { " · Thermal Guard On" } else { "" }
        )
    } else if cfg.thermal_throttling_enabled {
        "Charge Limit: Off · Thermal Guard On".to_string()
    } else {
        "Charge Limit: Off".to_string()
    };

    if !raw.present {
        let status_line = "Battery: Desktop PC (AC Power)".to_string();
        let tooltip = format!("SWEEPR Battery Care — Desktop PC · {limit_line}");
        return (tooltip, status_line, limit_line);
    }

    let charge_str = raw
        .charge_percent
        .map(|c| format!("{c}%"))
        .unwrap_or_else(|| "—".to_string());
    let state_str = if raw.charging {
        "Charging"
    } else if raw.ac_connected {
        "Plugged in"
    } else {
        "On battery"
    };
    let health_str = health_percent(raw.design_mwh, raw.full_mwh)
        .map(|h| format!(" · Health {:.0}%", round1(h)))
        .unwrap_or_default();
    let over_limit = cfg.charge_limit_enabled
        && raw.ac_connected
        && raw.charge_percent.map(|c| c >= cfg.charge_limit_percent).unwrap_or(false)
        && (!cfg.charge_limit_hardware_applied || raw.charging);

    let status_line = if over_limit {
        format!("⚠ Battery: {charge_str} ({state_str} — Unplug at {}%)", cfg.charge_limit_percent)
    } else {
        format!("Battery: {charge_str} ({state_str}){health_str}")
    };
    let tooltip = format!("SWEEPR — {status_line} · {limit_line}");
    (tooltip, status_line, limit_line)
}

fn send_native_unplug_notification(alert: &UnplugAlert) {
    #[cfg(windows)]
    {
        let title = alert.title.replace('\'', "''");
        let msg = alert.message.replace('\'', "''");
        let script = format!(
            r#"$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Warning
$n.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
$n.BalloonTipTitle = '{title}'
$n.BalloonTipText = '{msg}'
$n.Visible = $true
$n.ShowBalloonTip(8000)
Start-Sleep -Milliseconds 8500
$n.Dispose()"#
        );
        let _ = powershell(&script);
    }
    #[cfg(target_os = "macos")]
    {
        let title = alert.title.replace('"', "\\\"");
        let msg = alert.message.replace('"', "\\\"");
        let script = format!("display notification \"{msg}\" with title \"{title}\"");
        let _ = run_hidden("osascript", &["-e", &script]);
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let _ = run_hidden("notify-send", &[&alert.title, &alert.message]);
    }
}

pub fn refresh_tray(app: &tauri::AppHandle, data_dir: &Path) {
    use tauri::Manager;
    let raw = read_raw_battery();
    let cfg = load_config(data_dir);
    let (tooltip, status_line, limit_line) = format_tray_status(&raw, &cfg);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(&tooltip));
    }
    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state.status_item.set_text(&status_line);
        let _ = state.limit_item.set_text(&limit_line);
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn setup_tray_and_monitor(app: &tauri::AppHandle, data_dir: std::path::PathBuf) {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{Emitter, Manager};

    let raw = read_raw_battery();
    let cfg = load_config(&data_dir);
    let (tooltip, status_line, limit_line) = format_tray_status(&raw, &cfg);

    let Ok(status_item) = MenuItem::with_id(app, "tray_status", &status_line, false, None::<&str>) else {
        return;
    };
    let Ok(limit_item) = MenuItem::with_id(app, "tray_limit", &limit_line, false, None::<&str>) else {
        return;
    };
    let Ok(sep1) = PredefinedMenuItem::separator(app) else { return };
    let Ok(quick_scan) = MenuItem::with_id(
        app,
        "tray_quick_scan",
        "Quick Scan & Clean…",
        true,
        None::<&str>,
    ) else {
        return;
    };
    let Ok(open_battery) = MenuItem::with_id(
        app,
        "tray_open_battery",
        "Open Battery Care Diagnostic…",
        true,
        None::<&str>,
    ) else {
        return;
    };
    let Ok(hibernate_item) = MenuItem::with_id(
        app,
        "tray_hibernate_tabs",
        "Hibernate Idle Browser Tabs Now",
        true,
        None::<&str>,
    ) else {
        return;
    };
    let Ok(open_app) = MenuItem::with_id(app, "tray_open_app", "Open SWEEPR Cleaner", true, None::<&str>) else {
        return;
    };
    let Ok(sep2) = PredefinedMenuItem::separator(app) else { return };
    let Ok(quit_item) = MenuItem::with_id(app, "tray_quit", "Quit SWEEPR Cleaner", true, None::<&str>) else {
        return;
    };

    let Ok(menu) = Menu::with_items(
        app,
        &[
            &status_item,
            &limit_item,
            &sep1,
            &quick_scan,
            &open_battery,
            &hibernate_item,
            &open_app,
            &sep2,
            &quit_item,
        ],
    ) else {
        return;
    };

    app.manage(TrayState {
        status_item: status_item.clone(),
        limit_item: limit_item.clone(),
    });

    let icon = app
        .default_window_icon()
        .cloned()
        .unwrap_or_else(|| tauri::image::Image::new_owned(vec![16, 185, 129, 255].repeat(16 * 16), 16, 16));

    let data_dir_for_menu = data_dir.clone();
    let _ = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip(&tooltip)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app_handle, event| match event.id().as_ref() {
            "tray_quick_scan" => {
                show_main_window(app_handle);
                let _ = app_handle.emit("tray://navigate", "scan");
            }
            "tray_open_battery" => {
                show_main_window(app_handle);
                let _ = app_handle.emit("tray://navigate", "battery");
            }
            "tray_hibernate_tabs" => {
                let dir = data_dir_for_menu.clone();
                let handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(st) = handle.try_state::<crate::commands::AppState>() {
                        if st.licensing.require_addon("battery_care").await.is_ok() {
                            let _ = tauri::async_runtime::spawn_blocking(move || {
                                hibernate_browser_tabs(&dir, None)
                            })
                            .await;
                            return;
                        }
                    }
                    show_main_window(&handle);
                    let _ = handle.emit("tray://navigate", "battery");
                });
            }
            "tray_open_app" => {
                show_main_window(app_handle);
            }
            "tray_quit" => {
                app_handle.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app);

    let monitor_handle = app.clone();
    std::thread::spawn(move || {
        let mut last_alert_ts = 0u64;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
            let raw = read_raw_battery();
            let cfg = load_config(&data_dir);
            let (tip, s_line, l_line) = format_tray_status(&raw, &cfg);
            if let Some(tray) = monitor_handle.tray_by_id(TRAY_ID) {
                let _ = tray.set_tooltip(Some(&tip));
            }
            if let Some(st) = monitor_handle.try_state::<TrayState>() {
                let _ = st.status_item.set_text(&s_line);
                let _ = st.limit_item.set_text(&l_line);
            }
            if let Some(alert) = evaluate_unplug_alert(&raw, &cfg, now_unix_secs(), &mut last_alert_ts) {
                let _ = monitor_handle.emit("battery://unplug-alert", &alert);
                send_native_unplug_notification(&alert);
            }
            if cfg.thermal_throttling_enabled {
                let (apps, _) = find_runaway_apps(&[]);
                for a in apps.iter().filter(|a| a.cpu_percent >= 5.0) {
                    memory::trim_and_eco_process(a.pid);
                }
            }
            if cfg.auto_hibernate_tabs {
                let _ = memory::tame_browser_memory(None, false);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_and_degradation() {
        assert_eq!(health_percent(Some(50_000), Some(39_000)), Some(78.0));
        assert_eq!(health_percent(None, Some(1)), None);
        assert_eq!(health_percent(Some(50_000), Some(60_000)), Some(100.0));
        // 22% loss after 550 cycles vs 11% expected => 2.0x faster than normal
        assert_eq!(degradation_multiplier(Some(78.0), Some(550)), Some(2.0));
        assert_eq!(degradation_multiplier(Some(78.0), None), None);
    }

    #[test]
    fn charge_limit_is_clamped() {
        assert_eq!(clamp_limit(10), 50);
        assert_eq!(clamp_limit(80), 80);
        assert_eq!(clamp_limit(120), 100);
    }

    #[test]
    fn config_roundtrip() {
        let dir = std::env::temp_dir().join(format!("sweepr-battery-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(load_config(&dir), BatteryCareConfig::default());
        let mut c = BatteryCareConfig::default();
        c.charge_limit_enabled = true;
        c.charge_limit_percent = 85;
        c.auto_hibernate_tabs = true;
        save_config(&dir, &c).unwrap();
        assert_eq!(load_config(&dir), c);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_macos_ioreg() {
        let out = r#"
    +-o AppleSmartBattery
      {
        "DesignCapacity" = 5000
        "AppleRawMaxCapacity" = 4000
        "CycleCount" = 412
        "CurrentCapacity" = 64
        "MaxCapacity" = 100
        "ExternalConnected" = Yes
        "IsCharging" = No
        "Temperature" = 3150
        "Voltage" = 12000
        "InstantAmperage" = 18446744073709550616
      }"#;
        let r = parse_ioreg(out);
        assert!(r.present);
        assert_eq!(r.design_mwh, Some(60_000));
        assert_eq!(r.full_mwh, Some(48_000));
        assert_eq!(r.cycles, Some(412));
        assert_eq!(r.charge_percent, Some(64));
        assert!(r.ac_connected && !r.charging);
        assert_eq!(r.temperature_c, Some(31.5));
        assert_eq!(r.power_watts, Some(12.0));
        assert_eq!(health_percent(r.design_mwh, r.full_mwh), Some(80.0));
    }

    #[test]
    fn parses_windows_probe() {
        let r = parse_windows_probe(
            r#"{"present":true,"charge":91,"status":2,"full":42000,"design":54000,"cycles":300,"online":true,"charging":false,"chargeRate":0,"dischargeRate":0,"tz":3132,"mfr":"ASUSTeK COMPUTER INC."}"#,
        );
        assert!(r.present && r.ac_connected && !r.charging);
        assert_eq!(r.charge_percent, Some(91));
        assert_eq!(r.temperature_c, Some(40.1));
        assert_eq!(r.power_watts, None);
        assert!(parse_windows_probe("").design_mwh.is_none());
        assert!(!parse_windows_probe(r#"{"present":false}"#).present);
    }

    #[test]
    fn parses_sleep_blockers() {
        let mac = "   pid 312(Spotify): [0x0001] 00:10:00 PreventUserIdleSystemSleep named: \"Playing audio\"\n   pid 90(WindowServer): [0x2] 00:00:01 UserIsActive named: \"x\"";
        assert_eq!(parse_sleep_blockers(mac), vec!["spotify".to_string()]);
        let win = "SYSTEM:\n[PROCESS] \\Device\\HarddiskVolume3\\Program Files\\Zoom\\Zoom.exe\nAWAYMODE:\nNone.";
        assert_eq!(parse_sleep_blockers(win), vec!["zoom".to_string()]);
    }

    #[test]
    fn headline_and_minutes() {
        let mut d = BatteryDiagnostics {
            has_battery: true,
            platform: "windows".into(),
            health_percent: Some(78.0),
            degradation_multiplier: Some(2.0),
            design_capacity_mwh: None,
            full_charge_capacity_mwh: None,
            cycle_count: Some(550),
            charge_percent: Some(80),
            ac_connected: true,
            charging: false,
            power_draw_watts: None,
            temperature_c: None,
            estimated_replacement_cost_usd: 129,
            sleep_drain_percent: 35.0,
            hook_headline: String::new(),
            runaway_apps: vec![],
            inactive_browser_tabs_count: 0,
            config: BatteryCareConfig::default(),
        };
        d.runaway_apps = (0..6)
            .map(|i| RunawayApp {
                name: format!("app{i}"),
                pid: i,
                processes: 1,
                cpu_percent: 2.0,
                memory_bytes: 0,
                blocks_sleep: false,
                drain_share_percent: 5.8,
            })
            .collect();
        let h = build_headline(&d);
        assert!(h.contains("78%") && h.contains("2.0x") && h.contains("6 runaway") && h.contains("35%"));
        d.has_battery = false;
        assert!(build_headline(&d).starts_with("No battery detected"));

        assert_eq!(estimate_extra_minutes(0, 50.0, 8.0), 0);
        assert!(estimate_extra_minutes(10, 50.0, 8.0) > 0);
        assert!(!is_protected_process("Spotify") && is_protected_process("svchost"));
    }

    #[test]
    fn unplug_alert_and_tray_formatting() {
        let mut raw = RawBattery {
            present: true,
            design_mwh: Some(50_000),
            full_mwh: Some(45_000),
            cycles: Some(200),
            charge_percent: Some(82),
            ac_connected: true,
            charging: true,
            power_watts: Some(15.0),
            temperature_c: Some(34.0),
            manufacturer: "Generic".into(),
        };
        let mut cfg = BatteryCareConfig::default();
        cfg.charge_limit_enabled = true;
        cfg.charge_limit_percent = 80;

        let mut last_ts = 0u64;
        // Triggers on first check when plugged in >= limit
        let alert = evaluate_unplug_alert(&raw, &cfg, 1_000, &mut last_ts).expect("should alert");
        assert_eq!(alert.charge_percent, 82);
        assert_eq!(alert.limit_percent, 80);
        assert_eq!(last_ts, 1_000);

        // Cooldown suppresses duplicate alert 5 minutes later
        assert!(evaluate_unplug_alert(&raw, &cfg, 1_300, &mut last_ts).is_none());

        // Fires again after 30-minute cooldown
        assert!(evaluate_unplug_alert(&raw, &cfg, 1_000 + UNPLUG_ALERT_COOLDOWN_SECS + 1, &mut last_ts).is_some());

        // Unplugging resets cooldown
        raw.ac_connected = false;
        raw.charging = false;
        assert!(evaluate_unplug_alert(&raw, &cfg, 5_000, &mut last_ts).is_none());
        assert_eq!(last_ts, 0);

        // Tray formatting reflects over-limit warning when plugged in
        raw.ac_connected = true;
        let (tooltip, status_line, limit_line) = format_tray_status(&raw, &cfg);
        assert!(tooltip.contains("82%"));
        assert!(status_line.contains("Unplug at 80%"));
        assert!(limit_line.contains("80%"));
    }
}

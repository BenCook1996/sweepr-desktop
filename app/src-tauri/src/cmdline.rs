//! Parsing of Windows-style command lines stored in the registry
//! (UninstallString, Run entries, App Paths). We never hand these to a shell;
//! instead we split them into an executable path and a raw argument string.

/// Split a registry command line into `(program, args)`.
///
/// Handles the common forms:
/// - `"C:\Program Files\App\unins000.exe" /SILENT`
/// - `C:\Program Files\App\uninstall.exe /S` (unquoted path containing spaces)
/// - `MsiExec.exe /X{GUID}` / `RunDll32 shell32.dll,...` (bare program name)
pub fn split_command(cmd: &str) -> (String, String) {
    let cmd = cmd.trim();
    if let Some(rest) = cmd.strip_prefix('"') {
        return match rest.find('"') {
            Some(end) => (rest[..end].to_string(), rest[end + 1..].trim().to_string()),
            None => (rest.to_string(), String::new()),
        };
    }
    // Unquoted: if an executable extension appears, the program runs up to it
    // (this copes with unquoted paths that contain spaces). Only .exe binaries
    // are accepted (never .bat/.cmd/.com scripts).
    let lower = cmd.to_ascii_lowercase();
    for ext in [".exe"] {
        let mut search_from = 0;
        while let Some(pos) = lower[search_from..].find(ext) {
            let end = search_from + pos + ext.len();
            // The extension must end the token (followed by whitespace or end).
            if end == cmd.len() || cmd[end..].starts_with(char::is_whitespace) {
                return (cmd[..end].to_string(), cmd[end..].trim().to_string());
            }
            search_from = end;
        }
    }
    match cmd.split_once(char::is_whitespace) {
        Some((p, a)) => (p.to_string(), a.trim().to_string()),
        None => (cmd.to_string(), String::new()),
    }
}

/// Expand `%VAR%` references using the current environment. Unknown variables
/// are left untouched.
pub fn expand_env(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(v) if !name.is_empty() => out.push_str(&v),
                    _ => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_quoted() {
        let (p, a) = split_command(r#""C:\Program Files\App\unins000.exe" /SILENT"#);
        assert_eq!(p, r"C:\Program Files\App\unins000.exe");
        assert_eq!(a, "/SILENT");
    }

    #[test]
    fn splits_unquoted_with_spaces() {
        let (p, a) = split_command(r"C:\Program Files\App\uninstall.exe /S");
        assert_eq!(p, r"C:\Program Files\App\uninstall.exe");
        assert_eq!(a, "/S");
        let (p, a) = split_command(r"C:\Program Files\My.exeTools\run.exe");
        assert_eq!(p, r"C:\Program Files\My.exeTools\run.exe");
        assert_eq!(a, "");
    }

    #[test]
    fn splits_bare_program() {
        let (p, a) = split_command("MsiExec.exe /X{1234}");
        assert_eq!(p, "MsiExec.exe");
        assert_eq!(a, "/X{1234}");
        let (p, a) = split_command("RunDll32 shell32.dll,Foo");
        assert_eq!(p, "RunDll32");
        assert_eq!(a, "shell32.dll,Foo");
    }

    #[test]
    fn expands_known_vars_only() {
        std::env::set_var("SWEEPR_TEST_VAR", "X");
        assert_eq!(expand_env("%SWEEPR_TEST_VAR%\\a %NOPE_NOT_SET% 50%"), "X\\a %NOPE_NOT_SET% 50%");
    }
}

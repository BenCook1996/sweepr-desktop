fn main() {
    println!("cargo:rerun-if-changed=../.env");
    if let Ok(contents) = std::fs::read_to_string("../.env") {
        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((k, v)) = line.split_once('=') {
                let k = k.trim();
                let v = v.trim().trim_matches('"').trim_matches('\'');
                if matches!(k, "SWEEPR_LICENSE_PUBKEY" | "SWEEPR_API_URL") && std::env::var(k).is_err() {
                    println!("cargo:rustc-env={k}={v}");
                }
            }
        }
    }
    tauri_build::build()
}

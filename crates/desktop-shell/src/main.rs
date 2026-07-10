// my-agent desktop shell (§25.3) — Tauri wrapper around the gateway web SPA.
// The TS contract (deep-link/IPC/updater/sidecar) lives in @my-agent/desktop;
// this native side wires the OS window + tray + deep-link scheme + IPC bridge.
#![deny(clippy::exit)]

use tauri::Manager;

/// Validate a `myagent://` deep-link (mirrors the TS validateDeepLink).
fn validate_deep_link(uri: &str) -> Result<(String, std::collections::HashMap<String, String>), String> {
    let parsed = url::Url::parse(uri).map_err(|e| format!("malformed: {e}"))?;
    if parsed.scheme() != "myagent" {
        return Err(format!("wrong scheme: {}", parsed.scheme()));
    }
    let host = parsed.host_str().unwrap_or("").to_string();
    let allowed: &[&str] = &["open", "approve", "install", "focus"];
    if !allowed.contains(&host.as_str()) {
        return Err(format!("unknown action: {host}"));
    }
    let params: std::collections::HashMap<String, String> = parsed
        .query_pairs()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    Ok((host, params))
}

#[tauri::command]
fn deep_link(uri: String) -> Result<(String, std::collections::HashMap<String, String>), String> {
    validate_deep_link(&uri)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![deep_link])
        .setup(|app| {
            // gate the window on readiness (§25.3 sidecar lifecycle) — the webview
            // loads the gateway SPA which shows its own readiness state.
            let _win = app.get_webview_window("main").expect("main window");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running my-agent desktop shell");
}

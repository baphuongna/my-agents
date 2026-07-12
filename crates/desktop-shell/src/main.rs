// my-agent desktop shell (§25.3) — Tauri wrapper around the gateway web SPA.
// The TS contract (deep-link/IPC/updater/sidecar) lives in @my-agent/desktop;
// this native side wires the OS window + tray + deep-link scheme + IPC bridge
// and owns the sidecar lifecycle for `mya serve` (spawn / readiness poll /
// window-gate / clean shutdown).
#![deny(clippy::exit)]

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_deep_link::DeepLinkExt;

// ─── deep-link URI scheme (mirrors TS validateDeepLink) ──────────────────────

/// Validate a `myagent://` deep-link. Mirrors the TS `validateDeepLink` in
/// `packages/desktop/src/index.ts` — same allowed actions, same param model.
/// Keeping the two in lockstep is critical: malformed or unknown URIs must be
/// rejected uniformly on both sides (§25.3).
fn validate_deep_link(
    uri: &str,
) -> Result<(String, std::collections::HashMap<String, String>), String> {
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

/// Validate a `myagent://` URI from the webview (defence-in-depth — the
/// renderer's input is untrusted even if the OS only delivers well-formed
/// URIs, since a renderer compromise could synthesize arbitrary strings).
#[tauri::command]
fn deep_link_validate(
    uri: String,
) -> Result<(String, std::collections::HashMap<String, String>), String> {
    validate_deep_link(&uri)
}

/// Drain any deep-link URIs that arrived before the renderer was ready.
/// Idempotent: calling it twice returns `[]` on the second call. Mirrors
/// `PendingDeepLinks.drain()` semantics from the TS contract.
#[tauri::command]
fn deep_link_take_pending(state: tauri::State<'_, Arc<Mutex<Vec<String>>>>) -> Vec<String> {
    std::mem::take(&mut *state.lock().expect("pending lock poisoned"))
}

/// Return the sidecar port + WS token so the renderer can connect.
#[tauri::command]
fn gateway_info(state: tauri::State<'_, GatewayInfo>) -> GatewayInfo {
    GatewayInfo {
        port: state.port,
        ws_token: state.ws_token.clone(),
    }
}

/// Shared gateway connection info (injected via `.manage()`).
#[derive(Clone, serde::Serialize)]
struct GatewayInfo {
    port: u16,
    ws_token: String,
}

// ─── sidecar lifecycle (§25.3 gates window on §13 readiness) ─────────────────

/// Default port for the `mya serve` sidecar. Matches `packages/print/src/main.ts`'s
/// `--port 3000` default; overridable via the `MYA_PORT` env var so contributors
/// can run two sidecars side-by-side during development.
const DEFAULT_SIDECAR_PORT: u16 = 3000;
/// Max seconds to wait for `GET /ready` to return 2xx. After this the window
/// is unhidden regardless and `SidecarState::Degraded` is emitted so the UI
/// can show a degraded banner.
const READINESS_TIMEOUT_SECS: u64 = 30;
/// Sleep between readiness probes. Short enough that the window reveal feels
/// snappy on a healthy boot (~1–2 polls) but long enough to avoid hammering
/// the loopback interface on a degraded start.
const READINESS_POLL_MS: u64 = 500;
/// Tray menu item IDs. Kept as constants so the renderer can pattern-match
/// the same IDs in tray event listeners if needed in the future.
const TRAY_OPEN_ID: &str = "tray_open";
const TRAY_QUIT_ID: &str = "tray_quit";

/// Sidecar state reported to the renderer over `sidecar://state` events.
/// Matches `SidecarState` in `packages/desktop/src/index.ts`. `Booting` and
/// `Stopped` are not produced by this binary yet — they're emitted by the
/// renderer when it takes over the lifecycle — so we silence the dead-code
/// warning while keeping the enum exhaustive.
#[derive(Clone, Serialize)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
enum SidecarState {
    Booting,
    Ready,
    Degraded,
    Stopped,
}

#[derive(Clone, Serialize)]
struct SidecarStatus {
    state: SidecarState,
    port: u16,
    detail: Option<String>,
}

/// Push onto the shared pending-deeplinks slot. Used by the setup closure
/// (draining `app.deep_link().get_current()`) and the live `on_open_url`
/// listener. Free function so the closures only need the cloned `Arc`.
fn pending_push(slot: &Arc<Mutex<Vec<String>>>, uri: String) {
    slot.lock().expect("pending lock poisoned").push(uri);
}

/// Spawn `mya serve --port <port>` as a child process. The child is returned
/// (not stored) so the caller can place it in a shared slot for later kill.
/// stdout/stderr are piped — the Tauri parent process is the only place they
/// could land meaningfully, and we don't want them bleeding onto the GUI
/// stderr in production builds.
fn spawn_sidecar(port: u16) -> std::io::Result<Child> {
    let bin = resolve_sidecar_path();
    Command::new(&bin)
        .args(["serve", "--port", &port.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
}

/// Resolve the `mya` binary path. In a bundled app it sits next to the Tauri
/// shell (same directory as `current_exe()`); in `cargo run` there's no
/// sibling binary so we fall back to a PATH lookup.
fn resolve_sidecar_path() -> std::path::PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("mya");
            if candidate.exists() {
                return candidate;
            }
            // macOS bundles put binaries under a per-arch subdir; try one level
            // down too before falling back to PATH.
            if let Some(parent) = dir.parent() {
                let nested = parent.join("mya");
                if nested.exists() {
                    return nested;
                }
            }
        }
    }
    std::path::PathBuf::from("mya")
}

/// Issue a blocking HTTP/1.0 `GET /ready` against the loopback sidecar. Returns
/// true iff the server responds with a 2xx status line. We deliberately do NOT
/// pull in `ureq`/`reqwest` — this is ~25 lines of `std::net` and avoids the
/// transitive dep explosion for what is, fundamentally, "is the loopback port
/// speaking HTTP?".
fn probe_ready(port: u16) -> bool {
    let addr = match format!("127.0.0.1:{port}").to_socket_addrs() {
        Ok(mut addrs) => match addrs.next() {
            Some(a) => a,
            None => return false,
        },
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_secs(2)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let request = format!(
        "GET /ready HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut buf = Vec::with_capacity(512);
    if stream.read_to_end(&mut buf).is_err() {
        return false;
    }
    let head = String::from_utf8_lossy(&buf);
    // HTTP status line: "HTTP/<ver> <code> <reason>". We accept any 2xx.
    // Parse the status code properly (was: fragile substring check).
    head.lines().next().is_some_and(|line| {
        if !line.starts_with("HTTP/") {
            return false;
        }
        let code = line.split_whitespace().nth(1).and_then(|s| s.parse::<u16>().ok());
        matches!(code, Some(200..=299))
    })
}

/// Block until `probe_ready` returns true or the timeout elapses. Runs on a
/// dedicated OS thread (NOT in Tauri's async runtime) so a slow loopback
/// probe can't stall the setup of other plugins or the renderer.
fn wait_for_ready(port: u16, timeout: Duration, poll: Duration) -> SidecarState {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if probe_ready(port) {
            return SidecarState::Ready;
        }
        std::thread::sleep(poll);
    }
    SidecarState::Degraded
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// `tauri::generate_context!()` emits a `process::exit(101)` in its generated
// code if context creation panics on a worker thread (tauri-codegen 2.6.3
// src/context.rs:485). That panic-recovery code is third-party macro output,
// not ours — allow the lint at the function so the crate-level
// `deny(clippy::exit)` still catches real `exit()` uses in our own code below.
#[allow(clippy::exit)]
fn main() {
    let sidecar_port: u16 = std::env::var("MYA_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_SIDECAR_PORT);

    let pending: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let pending_for_setup = Arc::clone(&pending);

    // Holds the sidecar child between setup (which spawns it) and the exit
    // handler (which kills it). Wrapped in Arc<Mutex<Option<_>>> so both
    // closures can borrow the same slot without a lifetime tie.
    let child_slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let child_for_exit = Arc::clone(&child_slot);

    let app = tauri::Builder::default()
        // Single-instance: a second `mya-desktop` launch (e.g. user clicked
        // a `myagent://` link while the app was already running) MUST focus
        // the existing window — never spawn a second sidecar that would
        // collide on the loopback port.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        // Deep-link: registers the `myagent://` scheme with the OS and
        // delivers incoming URIs to the `deep-link://new-url` listener we
        // wire in setup. The plugin is platform-symmetric at the listener
        // level, so we register one handler unconditionally.
        .plugin(tauri_plugin_deep_link::init())
        .manage(pending.clone())
        .manage(GatewayInfo { port: sidecar_port, ws_token: std::env::var("MYA_WS_TOKEN").unwrap_or_default() })
        .invoke_handler(tauri::generate_handler![deep_link_validate, deep_link_take_pending, gateway_info])
        .setup(move |app| {
            // ── 1. Spawn the `mya serve` sidecar ─────────────────────────
            match spawn_sidecar(sidecar_port) {
                Ok(child) => {
                    *child_slot.lock().expect("child slot poisoned") = Some(child);
                }
                Err(err) => {
                    // Don't abort: the gateway may already be running on
                    // this port (developer reuse). The readiness probe will
                    // succeed and we'll skip the spawn.
                    eprintln!("[desktop-shell] spawn `mya serve` failed: {err}");
                }
            }

            // ── 2. Register `myagent://` scheme + listen for OS delivery ──
            // Linux/Windows need runtime registration via xdg-mime / the
            // registry; macOS registers at install time via Info.plist, so
            // `register_all` is a no-op there but harmless to call.
            if let Err(err) = app.deep_link().register_all() {
                eprintln!("[desktop-shell] deep-link register_all: {err}");
            }

            // Drain any deep-link the OS delivered via CLI argv before the
            // webview was ready (single-instance launch with argv, or a
            // cold-start via `myagent://`).
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    pending_push(&pending_for_setup, url.to_string());
                }
            }

            // Live handler for deep-links that arrive after setup completes.
            // Emit on `deep-link://received` so the renderer can show a
            // toast / navigate, AND stash in pending so a late-mounting
            // renderer can drain it via `deep_link_take_pending`.
            let app_handle_for_event = app.handle().clone();
            let pending_for_event = Arc::clone(&pending_for_setup);
            app.deep_link().on_open_url(move |event| {
                let uris: Vec<String> =
                    event.urls().iter().map(|u| u.to_string()).collect();
                for uri in &uris {
                    pending_push(&pending_for_event, uri.clone());
                }
                // Emit each URI as a separate string event (HTML expects string, not array).
                for uri in &uris {
                    let _ = app_handle_for_event.emit("deep-link://received", uri);
                }
            });

            // ── 3. Window starts hidden (§25.3 readiness gate) ───────────
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }

            // ── 4. Tray icon + menu (Open / Quit) ────────────────────────
            let open_item =
                MenuItemBuilder::with_id(TRAY_OPEN_ID, "Open").build(app)?;
            let quit_item =
                MenuItemBuilder::with_id(TRAY_QUIT_ID, "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&open_item)
                .item(&quit_item)
                .build()?;

            // Use the bundle icon if tauri-build resolved one; otherwise
            // skip the icon (Tauri will draw an empty placeholder).
            let icon = app.default_window_icon().cloned();

            let mut tray_builder = TrayIconBuilder::with_id("my-agent-tray")
                .tooltip("my-agent")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    TRAY_OPEN_ID => show_main_window(app),
                    TRAY_QUIT_ID => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click reveals the main window (matches macOS dock
                    // and Windows tray convention). Right-click is handled by
                    // the menu, which `show_menu_on_left_click(false)` keeps
                    // exclusive to that button.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = icon {
                tray_builder = tray_builder.icon(icon);
            }
            let _tray = tray_builder.build(app)?;

            // ── 5. Poll /ready on a worker thread; unhide window when ready ──
            // `std::thread::spawn` is intentional: the readiness probe is
            // blocking I/O and using Tauri's async runtime would mean
            // hopping between executor workers for what is fundamentally a
            // sequential poll/sleep loop. A dedicated OS thread is cheaper.
            let app_handle_for_poll = app.handle().clone();
            std::thread::spawn(move || {
                let state = wait_for_ready(
                    sidecar_port,
                    Duration::from_secs(READINESS_TIMEOUT_SECS),
                    Duration::from_millis(READINESS_POLL_MS),
                );
                let detail = match &state {
                    SidecarState::Degraded => Some(format!(
                        "no 2xx from /ready within {READINESS_TIMEOUT_SECS}s"
                    )),
                    _ => None,
                };
                let _ = app_handle_for_poll.emit(
                    "sidecar://state",
                    SidecarStatus {
                        state: state.clone(),
                        port: sidecar_port,
                        detail,
                    },
                );
                // Unhide on BOTH Ready and Degraded — the UI shows a
                // "gateway unreachable, retrying" banner for Degraded, which
                // is more useful than a permanently-hidden window.
                show_main_window(&app_handle_for_poll);
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Close button → hide to tray (X ≠ quit). The user exits via the
            // tray menu's Quit entry, which fires ExitRequested and runs
            // sidecar cleanup. This matches macOS dock convention and the
            // behavior the existing MyAgents reference uses.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building my-agent desktop shell");

    // ── 6. Clean shutdown: kill sidecar on exit ────────────────────────────
    // `ExitRequested` fires before `Exit`, so we kill there for both the
    // user-quit path (Cmd+Q / Dock right-click / tray Quit → app.exit(0))
    // and any OS-initiated shutdown (SIGTERM, log-out, etc).
    app.run(move |_app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            if let Some(mut child) = child_for_exit
                .lock()
                .expect("child slot poisoned")
                .take()
            {
                let _ = child.kill();
                // Reap so we don't leave a zombie; `wait` after `kill` returns
                // quickly on Unix and is a no-op once the process is gone.
                let _ = child.wait();
            }
        }
    });
}
// main.rs - FRIDAY Core Backend
// Tauri v2 desktop widget: circular, transparent, always-on-top
//
// Responsibilities:
//   - Window creation (frameless, 280x280, transparent, always-on-top)
//   - Position persistence (save/restore from JSON)
//   - Position lock toggle (prevents dragging)
//   - System tray menu (lock/unlock, reset, quit)
//   - Global shortcut (Cmd+Shift+L to toggle lock)
//   - Drag support (frontend-driven via Tauri command)

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow, Wry,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

// ───────────────────────────────────────────────────────────────
// Data Structures
// ───────────────────────────────────────────────────────────────

/// Shared application state, managed by Tauri and accessible from commands.
#[derive(Debug)]
struct AppState {
    /// When true, the widget cannot be dragged.
    position_locked: Arc<Mutex<bool>>,
    /// Multi-turn conversation history (role + content).
    chat_history: Arc<Mutex<Vec<serde_json::Value>>>,
    /// True while a chat turn is in flight — second clicks are ignored.
    busy: Arc<Mutex<bool>>,
}

/// Serializable struct representing the saved window position.
#[derive(Debug, Serialize, Deserialize, Clone)]
struct SavedPosition {
    x: f64,
    y: f64,
}

/// Holds references to the tray icon and menu for later updates.
#[allow(dead_code)]
struct TrayState {
    menu: Menu<Wry>,
    tray: tauri::tray::TrayIcon<Wry>,
}

// ───────────────────────────────────────────────────────────────
// Path Helpers
// ───────────────────────────────────────────────────────────────

/// Returns the path to `position.json` inside the app's config directory.
/// Uses Tauri v2's `app_config_dir()` via the PathResolver API.
fn get_position_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve app config dir: {e}"))
        .map(|mut p| {
            p.push("position.json");
            p
        })
}

// ───────────────────────────────────────────────────────────────
// Tauri Commands (all async, return Result<T, String>)
// ───────────────────────────────────────────────────────────────

/// Save the current window position to `position.json`.
/// Called by the frontend after each drag operation.
#[tauri::command]
async fn save_position(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    let path = get_position_file_path(&app)?;

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {e}"))?;
    }

    let pos = SavedPosition { x, y };
    let json = serde_json::to_string_pretty(&pos)
        .map_err(|e| format!("Failed to serialize position: {e}"))?;

    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write position file: {e}"))?;

    Ok(())
}

/// Load the saved window position from `position.json`.
/// Returns (0.0, 0.0) if the file does not exist yet.
#[tauri::command]
async fn load_position(app: AppHandle) -> Result<(f64, f64), String> {
    let path = get_position_file_path(&app)?;

    if !path.exists() {
        // First launch — return default position (0,0 means "let OS decide" or
        // the frontend can interpret this as "center me").
        return Ok((0.0, 0.0));
    }

    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read position file: {e}"))?;

    let pos: SavedPosition = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse position file: {e}"))?;

    Ok((pos.x, pos.y))
}

/// Toggle the position lock state.
/// Returns the new lock state (true = locked).
#[tauri::command]
async fn toggle_lock(state: State<'_, AppState>) -> Result<bool, String> {
    let mut locked = state.position_locked.lock().map_err(|e| e.to_string())?;
    *locked = !*locked;
    Ok(*locked)
}

/// Query the current lock state.
#[tauri::command]
async fn is_locked(state: State<'_, AppState>) -> Result<bool, String> {
    let locked = state.position_locked.lock().map_err(|e| e.to_string())?;
    Ok(*locked)
}

/// Reset the widget to the center of the primary monitor.
/// The frontend should call `save_position` after a successful reset.
#[tauri::command]
async fn reset_position(window: WebviewWindow) -> Result<(), String> {
    // Get the monitor where the window currently resides
    let monitor = window
        .current_monitor()
        .map_err(|e| format!("Failed to get current monitor: {e}"))?
        .ok_or("No monitor found")?;

    let monitor_size = monitor.size();
    let monitor_pos = monitor.position();

    // Widget dimensions (must match tauri.conf.json)
    const WIDGET_W: i32 = 140;
    const WIDGET_H: i32 = 140;

    // Center = monitor origin + (monitor size / 2) - (widget size / 2)
    let center_x = monitor_pos.x as f64 + (monitor_size.width as f64 / 2.0) - (WIDGET_W as f64 / 2.0);
    let center_y = monitor_pos.y as f64 + (monitor_size.height as f64 / 2.0) - (WIDGET_H as f64 / 2.0);

    window
        .set_position(PhysicalPosition::new(center_x, center_y))
        .map_err(|e| format!("Failed to reset position: {e}"))?;

    Ok(())
}

/// Move the widget to a new absolute position during a drag operation.
/// Does nothing if the position is currently locked.
///
/// The frontend tracks mouse events and sends the absolute coordinates here.
#[tauri::command]
async fn update_drag_position(
    window: WebviewWindow,
    state: State<'_, AppState>,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let locked = state.position_locked.lock().map_err(|e| e.to_string())?;

    if *locked {
        // Position is locked — silently ignore the drag
        return Ok(());
    }

    window
        .set_position(PhysicalPosition::new(x as i32, y as i32))
        .map_err(|e| format!("Failed to update drag position: {e}"))?;

    Ok(())
}

// ───────────────────────────────────────────────────────────────
// Tray & Menu Setup
// ───────────────────────────────────────────────────────────────

/// IDs for tray menu items so we can identify clicks.
const MENU_ID_LOCK: &str = "lock_unlock";
const MENU_ID_RESET: &str = "reset_position";
const MENU_ID_QUIT: &str = "quit";

/// Create the system tray icon and its context menu.
///
/// Menu layout:
///   FRIDAY Core (disabled label)
///   ———————————
///   Lock/Unlock Position
///   Reset Position
///   ———————————
///   Quit
fn setup_tray(app: &AppHandle) -> Result<(), String> {
    // ── Build individual menu items ─────────────────────────────
    let title_item = MenuItemBuilder::new("Veronica")
        .enabled(false)
        .build(app)
        .map_err(|e| format!("Failed to build title menu item: {e}"))?;

    let lock_item = MenuItemBuilder::new("Lock Position")
        .id(MENU_ID_LOCK)
        .build(app)
        .map_err(|e| format!("Failed to build lock menu item: {e}"))?;

    let reset_item = MenuItemBuilder::new("Reset Position")
        .id(MENU_ID_RESET)
        .build(app)
        .map_err(|e| format!("Failed to build reset menu item: {e}"))?;

    let quit_item = MenuItemBuilder::new("Quit")
        .id(MENU_ID_QUIT)
        .build(app)
        .map_err(|e| format!("Failed to build quit menu item: {e}"))?;

    let sep1 = PredefinedMenuItem::separator(app)
        .map_err(|e| format!("Failed to build separator: {e}"))?;
    let sep2 = PredefinedMenuItem::separator(app)
        .map_err(|e| format!("Failed to build separator: {e}"))?;

    // ── Assemble the menu ───────────────────────────────────────
    let menu = MenuBuilder::new(app)
        .item(&title_item)
        .item(&sep1)
        .item(&lock_item)
        .item(&reset_item)
        .item(&sep2)
        .item(&quit_item)
        .build()
        .map_err(|e| format!("Failed to build tray menu: {e}"))?;

    // ── Build the tray icon ─────────────────────────────────────
    let tray = TrayIconBuilder::new()
        .tooltip("Veronica")
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            handle_tray_menu_click(app, event.id().as_ref());
        })
        .build(app)
        .map_err(|e| format!("Failed to create tray icon: {e}"))?;

    // Store tray/menu references so commands can update them later
    app.manage(TrayState { menu, tray });

    Ok(())
}

/// Handle a click on a tray menu item.
fn handle_tray_menu_click(app: &AppHandle, menu_id: &str) {
    match menu_id {
        MENU_ID_LOCK => {
            // Toggle lock and emit event
            let state = app.state::<AppState>();
            let new_locked = {
                let mut guard = state
                    .position_locked
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                *guard = !*guard;
                *guard
            };

            // Notify frontend about the lock-state change
            let _ = app.emit("lock-state-changed", new_locked);

            // Update the tray menu label (best-effort via event emission;
            // dynamic label changes require menu rebuild in Tauri v2)
            let _ = app.emit("tray-lock-label-update", new_locked);
        }
        MENU_ID_RESET => {
            // Trigger reset via command by getting the main window
            if let Some(window) = app.get_webview_window("main") {
                let app_clone = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = reset_position(window).await {
                        eprintln!("[Veronica] Tray reset failed: {e}");
                        return;
                    }
                    // Save the new centered position
                    if let Some(window) = app_clone.get_webview_window("main") {
                        if let Ok(Some(monitor)) = window.current_monitor() {
                            let mx = monitor.position().x as f64
                                + (monitor.size().width as f64 / 2.0)
                                - 100.0;
                            let my = monitor.position().y as f64
                                + (monitor.size().height as f64 / 2.0)
                                - 100.0;
                            let _ = save_position(app_clone, mx, my).await;
                        }
                    }
                });
            }
        }
        MENU_ID_QUIT => {
            app.exit(0);
        }
        _ => {}
    }
}

// ───────────────────────────────────────────────────────────────
// Global Shortcut Setup
// ───────────────────────────────────────────────────────────────

/// Register the Cmd+Shift+L (macOS) / Ctrl+Shift+L (other) global shortcut
/// to toggle the lock state. The callback is wired in the plugin builder
/// (see `main()`); here we just register the chord.
fn setup_global_shortcut(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let shortcut_str = "Cmd+Shift+L";
    #[cfg(not(target_os = "macos"))]
    let shortcut_str = "Ctrl+Shift+L";

    app.global_shortcut()
        .register(shortcut_str)
        .map_err(|e| format!("Failed to register global shortcut '{}': {}", shortcut_str, e))?;

    Ok(())
}

// ───────────────────────────────────────────────────────────────
// Window Setup (position restoration)
// ───────────────────────────────────────────────────────────────

/// On startup, restore the window to its previously saved position.
/// If no saved position exists, center the widget on the primary monitor.
fn restore_window_position(app: &AppHandle) -> Result<(), String> {
    let path = get_position_file_path(app)?;

    if !path.exists() {
        // No saved position — center the window on the primary monitor
        if let Some(window) = app.get_webview_window("main") {
            if let Ok(Some(monitor)) = window.current_monitor() {
                let mx = monitor.position().x as f64
                    + (monitor.size().width as f64 / 2.0)
                    - 100.0; // 200 / 2
                let my = monitor.position().y as f64
                    + (monitor.size().height as f64 / 2.0)
                    - 100.0;
                let _ = window.set_position(PhysicalPosition::new(mx as i32, my as i32));
            }
        }
        return Ok(());
    }

    // File exists — read and apply the saved position
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read position file: {e}"))?;

    let pos: SavedPosition = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse position file: {e}"))?;

    if let Some(window) = app.get_webview_window("main") {
        window
            .set_position(PhysicalPosition::new(pos.x as i32, pos.y as i32))
            .map_err(|e| format!("Failed to restore position: {e}"))?;
    }

    Ok(())
}

/// Quit the application cleanly.
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Background watcher: makes the window click-through everywhere except inside
/// the circular widget. Polls the global cursor at ~30Hz; flips
/// `set_ignore_cursor_events` whenever the cursor crosses the circle boundary.
fn start_passthrough_watcher(app: AppHandle) {
    use core_graphics::event::CGEvent;
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    std::thread::spawn(move || {
        // Start in passthrough so first frame doesn't catch a stray click.
        let mut current_passthrough: Option<bool> = None;
        let mut tick: u64 = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(33));
            let Some(window) = app.get_webview_window("main") else { continue };
            let Ok(pos) = window.outer_position() else { continue };
            let Ok(size) = window.outer_size() else { continue };
            let scale = window.scale_factor().unwrap_or(1.0);
            // Get global cursor pos via CoreGraphics (no Accessibility perm required).
            let (mouse_x, mouse_y) = match CGEventSource::new(CGEventSourceStateID::HIDSystemState)
                .ok()
                .and_then(|src| CGEvent::new(src).ok())
                .map(|ev| ev.location())
            {
                Some(pt) => (pt.x, pt.y),
                None => continue,
            };
            let wx = pos.x as f64 / scale;
            let wy = pos.y as f64 / scale;
            let ww = size.width as f64 / scale;
            let wh = size.height as f64 / scale;
            let cx_widget = wx + ww / 2.0;
            let cy_widget = wy + wh / 2.0;
            // Shrink hit radius slightly so corners always pass through.
            let radius = (ww.min(wh) / 2.0) - 4.0;
            let dx = mouse_x - cx_widget;
            let dy = mouse_y - cy_widget;
            let inside = (dx * dx + dy * dy) <= (radius * radius);
            let want = !inside;
            if current_passthrough != Some(want) {
                if window.set_ignore_cursor_events(want).is_ok() {
                    current_passthrough = Some(want);
                    eprintln!(
                        "[Veronica] passthrough={} mouse=({:.0},{:.0}) widget=({:.0},{:.0}) r={:.0}",
                        want, mouse_x, mouse_y, cx_widget, cy_widget, radius
                    );
                }
            }
            tick = tick.wrapping_add(1);
            if tick % 90 == 0 {
                eprintln!(
                    "[Veronica] watcher alive tick={} mouse=({:.0},{:.0}) inside={}",
                    tick, mouse_x, mouse_y, inside
                );
            }
        }
    });
}

// ───────────────────────────────────────────────────────────────
// AI Chat — Bedrock or Anthropic direct
// ───────────────────────────────────────────────────────────────

/// Read the saved API key. Supports two locations:
///   ~/.friday/anthropic-key  (sk-ant-...) — used directly against api.anthropic.com
///   ~/.friday/bedrock-key    (Bedrock long-term key) — used against bedrock-runtime
fn read_key(name: &str) -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let path = std::path::Path::new(&home).join(".friday").join(name);
    let s = std::fs::read_to_string(path).ok()?;
    let trimmed = s.trim().to_string();
    if trimmed.is_empty() { None } else { Some(trimmed) }
}

#[derive(Serialize, Deserialize, Debug)]
struct ChatMsg {
    role: String,
    content: String,
}

/// Tool registry — built-in capabilities exposed to the LLM.
fn tool_schemas() -> serde_json::Value {
    serde_json::json!([
        { "type":"function","function":{
            "name":"get_time","description":"Return the current local date and time.",
            "parameters":{"type":"object","properties":{}}
        }},
        { "type":"function","function":{
            "name":"read_file","description":"Read a UTF-8 text file from the user's machine.",
            "parameters":{"type":"object","required":["path"],
                "properties":{"path":{"type":"string","description":"Absolute or ~-relative path"}}}
        }},
        { "type":"function","function":{
            "name":"write_file","description":"Write text to a file (overwrites). Use sparingly.",
            "parameters":{"type":"object","required":["path","content"],
                "properties":{"path":{"type":"string"},"content":{"type":"string"}}}
        }},
        { "type":"function","function":{
            "name":"list_dir","description":"List entries in a directory.",
            "parameters":{"type":"object","required":["path"],
                "properties":{"path":{"type":"string"}}}
        }},
        { "type":"function","function":{
            "name":"run_shell","description":"Run a non-interactive shell command and capture stdout/stderr. Avoid destructive commands.",
            "parameters":{"type":"object","required":["command"],
                "properties":{"command":{"type":"string"}}}
        }},
        { "type":"function","function":{
            "name":"open_app","description":"Open a macOS application by name (uses /usr/bin/open -a).",
            "parameters":{"type":"object","required":["name"],
                "properties":{"name":{"type":"string"}}}
        }},
        { "type":"function","function":{
            "name":"web_search","description":"Search the web via DuckDuckGo and return top result snippets.",
            "parameters":{"type":"object","required":["query"],
                "properties":{"query":{"type":"string"}}}
        }},
        { "type":"function","function":{
            "name":"get_battery","description":"Return Mac battery level and charging state.",
            "parameters":{"type":"object","properties":{}}
        }},
        { "type":"function","function":{
            "name":"calendar_today","description":"Return today's calendar events from macOS Calendar.app.",
            "parameters":{"type":"object","properties":{}}
        }},
        { "type":"function","function":{
            "name":"set_volume","description":"Set system output volume (0-100).",
            "parameters":{"type":"object","required":["level"],
                "properties":{"level":{"type":"integer"}}}
        }},
        // ── Project Friday tools (via bridge on port 8001) ──────────────────
        { "type":"function","function":{
            "name":"get_world_news","description":"Fetch the latest global headlines from BBC, CNBC, NYT, and Al Jazeera. Use when the user asks what's happening in the world, for news, or to be briefed on current events.",
            "parameters":{"type":"object","properties":{}}
        }},
        { "type":"function","function":{
            "name":"open_world_monitor","description":"Open the World Monitor live dashboard (worldmonitor.app) in the browser. Always call this after delivering a world news brief.",
            "parameters":{"type":"object","properties":{}}
        }},
        { "type":"function","function":{
            "name":"friday_fetch_url","description":"Fetch the text content of any URL. Use when the user wants to read a webpage or article.",
            "parameters":{"type":"object","required":["url"],
                "properties":{"url":{"type":"string","description":"The full URL to fetch"}}}
        }},
        { "type":"function","function":{
            "name":"friday_system_info","description":"Return detailed system information from the Friday backend: OS, version, machine type, Python version.",
            "parameters":{"type":"object","properties":{}}
        }}
    ])
}

fn expand_path(p: &str) -> String {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{}/{}", home, rest);
        }
    }
    p.to_string()
}

async fn execute_tool(name: &str, args: &serde_json::Value) -> String {
    match name {
        "get_time" => {
            let out = std::process::Command::new("/bin/date").output();
            match out {
                Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
                Err(e) => format!("error: {e}"),
            }
        }
        "read_file" => {
            let p = expand_path(args["path"].as_str().unwrap_or(""));
            match std::fs::read_to_string(&p) {
                Ok(s) => s.chars().take(8000).collect(),
                Err(e) => format!("error: {e}"),
            }
        }
        "write_file" => {
            let p = expand_path(args["path"].as_str().unwrap_or(""));
            let c = args["content"].as_str().unwrap_or("");
            match std::fs::write(&p, c) {
                Ok(_) => format!("wrote {} bytes to {}", c.len(), p),
                Err(e) => format!("error: {e}"),
            }
        }
        "list_dir" => {
            let p = expand_path(args["path"].as_str().unwrap_or("."));
            match std::fs::read_dir(&p) {
                Ok(rd) => {
                    let names: Vec<String> = rd
                        .filter_map(|e| e.ok())
                        .map(|e| e.file_name().to_string_lossy().to_string())
                        .take(200)
                        .collect();
                    names.join("\n")
                }
                Err(e) => format!("error: {e}"),
            }
        }
        "run_shell" => {
            let cmd = args["command"].as_str().unwrap_or("");
            let o = std::process::Command::new("/bin/zsh")
                .arg("-c")
                .arg(cmd)
                .output();
            match o {
                Ok(o) => {
                    let s = format!(
                        "STDOUT:\n{}\nSTDERR:\n{}",
                        String::from_utf8_lossy(&o.stdout),
                        String::from_utf8_lossy(&o.stderr)
                    );
                    s.chars().take(4000).collect()
                }
                Err(e) => format!("error: {e}"),
            }
        }
        "open_app" => {
            let name = args["name"].as_str().unwrap_or("");
            let o = std::process::Command::new("/usr/bin/open")
                .arg("-a")
                .arg(name)
                .status();
            match o {
                Ok(s) if s.success() => format!("opened {}", name),
                Ok(s) => format!("open exited {}", s),
                Err(e) => format!("error: {e}"),
            }
        }
        "web_search" => {
            let q = args["query"].as_str().unwrap_or("");
            let url = format!("https://api.duckduckgo.com/?q={}&format=json&no_html=1", urlencoding_encode(q));
            let client = reqwest::Client::new();
            match client.get(&url).timeout(std::time::Duration::from_secs(10)).send().await {
                Ok(r) => match r.text().await {
                    Ok(t) => t.chars().take(4000).collect(),
                    Err(e) => format!("error: {e}"),
                },
                Err(e) => format!("error: {e}"),
            }
        }
        "get_battery" => {
            let o = std::process::Command::new("/usr/bin/pmset").arg("-g").arg("batt").output();
            match o {
                Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
                Err(e) => format!("error: {e}"),
            }
        }
        "calendar_today" => {
            let script = r#"set startD to current date
set time of startD to 0
set endD to startD + (1 * days)
set output to ""
tell application "Calendar"
  repeat with cal in calendars
    repeat with ev in (every event of cal whose start date >= startD and start date < endD)
      set output to output & (summary of ev) & " — " & (start date of ev as string) & linefeed
    end repeat
  end repeat
end tell
return output"#;
            let o = std::process::Command::new("osascript").arg("-e").arg(script).output();
            match o {
                Ok(o) => {
                    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    if s.is_empty() { "no events today".into() } else { s }
                }
                Err(e) => format!("error: {e}"),
            }
        }
        "set_volume" => {
            let lvl = args["level"].as_i64().unwrap_or(50).clamp(0, 100);
            let script = format!("set volume output volume {}", lvl);
            let o = std::process::Command::new("osascript").arg("-e").arg(&script).status();
            match o {
                Ok(_) => format!("volume set to {}", lvl),
                Err(e) => format!("error: {e}"),
            }
        }
        // ── Project Friday tools — proxied to the bridge on port 8001 ──────
        "get_world_news" => {
            friday_bridge_get("http://127.0.0.1:8001/tools/world_news").await
        }
        "open_world_monitor" => {
            friday_bridge_post("http://127.0.0.1:8001/tools/open_world_monitor", serde_json::json!({})).await
        }
        "friday_fetch_url" => {
            let url = args["url"].as_str().unwrap_or("").to_string();
            friday_bridge_post("http://127.0.0.1:8001/tools/fetch_url",
                serde_json::json!({ "url": url })).await
        }
        "friday_system_info" => {
            friday_bridge_get("http://127.0.0.1:8001/tools/system_info").await
        }
        _ => format!("unknown tool: {}", name),
    }
}

/// Call a Friday bridge GET endpoint. Returns the "result" field or an error string.
async fn friday_bridge_get(url: &str) -> String {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build() {
        Ok(c) => c,
        Err(e) => return format!("bridge error: {e}"),
    };
    match client.get(url).send().await {
        Ok(r) => match r.json::<serde_json::Value>().await {
            Ok(v) => {
                if let Some(s) = v["result"].as_str() {
                    return s.to_string();
                }
                v["result"].to_string()
            }
            Err(e) => format!("bridge parse error: {e}"),
        },
        Err(_) => "Friday bridge is offline. Start it with: cd backend && uv run bridge".to_string(),
    }
}

/// Call a Friday bridge POST endpoint with a JSON body.
async fn friday_bridge_post(url: &str, body: serde_json::Value) -> String {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build() {
        Ok(c) => c,
        Err(e) => return format!("bridge error: {e}"),
    };
    match client.post(url).json(&body).send().await {
        Ok(r) => match r.json::<serde_json::Value>().await {
            Ok(v) => {
                if let Some(s) = v["result"].as_str() {
                    return s.to_string();
                }
                v["result"].to_string()
            }
            Err(e) => format!("bridge parse error: {e}"),
        },
        Err(_) => "Friday bridge is offline. Start it with: cd backend && uv run bridge".to_string(),
    }
}

fn urlencoding_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{:02X}", b),
        })
        .collect()
}

const HISTORY_LIMIT: usize = 24; // last 12 user/assistant pairs
const MAX_TOOL_TURNS: u32 = 6;

/// Multi-turn chat with memory and tool calling via Ollama.
#[tauri::command]
async fn chat(prompt: String, state: State<'_, AppState>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let system_prompt = "You are Veronica, an autonomous Mac desktop AI assistant — the next evolution of F.R.I.D.A.Y. \
        Core tools (always available): read/write files, run shell commands, open apps, web search, time, battery, calendar, volume. \
        Friday tools (when bridge is running on port 8001): get_world_news, open_world_monitor, friday_fetch_url, friday_system_info. \
        Use tools whenever they help. After a world news brief, always call open_world_monitor. \
        Be concise, sharp, plain text — your reply is spoken aloud. Keep replies under 60 words unless asked for detail.";

    // Build messages: system + history + new user turn.
    let mut messages: Vec<serde_json::Value> = vec![
        serde_json::json!({"role":"system","content":system_prompt})
    ];
    {
        let hist = state.chat_history.lock().map_err(|e| e.to_string())?;
        messages.extend(hist.iter().cloned());
    }
    messages.push(serde_json::json!({"role":"user","content":prompt.clone()}));

    let model = std::env::var("FRIDAY_LLM_MODEL").unwrap_or_else(|_| "qwen2.5:7b".to_string());
    let tools = tool_schemas();

    // Ollama tool-calling loop.
    let mut final_text = String::new();
    let mut new_msgs: Vec<serde_json::Value> = vec![
        serde_json::json!({"role":"user","content":prompt})
    ];

    for _turn in 0..MAX_TOOL_TURNS {
        let body = serde_json::json!({
            "model": model,
            "messages": messages,
            "tools": tools,
            "stream": false
        });
        let resp = client
            .post("http://127.0.0.1:11434/api/chat")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("ollama request failed: {e}"))?;
        if !resp.status().is_success() {
            let s = resp.status();
            let t = resp.text().await.unwrap_or_default();
            return Err(format!("ollama {}: {}", s, t));
        }
        let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let msg = v["message"].clone();
        messages.push(msg.clone());
        new_msgs.push(msg.clone());

        // Tool calls?
        if let Some(tool_calls) = msg["tool_calls"].as_array() {
            if !tool_calls.is_empty() {
                for tc in tool_calls {
                    let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
                    let args = tc["function"]["arguments"].clone();
                    let parsed_args = if args.is_string() {
                        serde_json::from_str::<serde_json::Value>(args.as_str().unwrap())
                            .unwrap_or(serde_json::json!({}))
                    } else {
                        args
                    };
                    let result = execute_tool(&name, &parsed_args).await;
                    let tool_msg = serde_json::json!({
                        "role": "tool",
                        "name": name,
                        "content": result
                    });
                    messages.push(tool_msg.clone());
                    new_msgs.push(tool_msg);
                }
                continue; // loop again to let model use tool result
            }
        }

        // No tool calls — done.
        final_text = msg["content"].as_str().unwrap_or("").trim().to_string();
        break;
    }

    if final_text.is_empty() {
        final_text = "I'm not sure how to respond to that.".to_string();
    }

    // Append to history, trim to limit.
    {
        let mut hist = state.chat_history.lock().map_err(|e| e.to_string())?;
        hist.extend(new_msgs);
        // Keep only the last HISTORY_LIMIT non-system messages.
        let len = hist.len();
        if len > HISTORY_LIMIT {
            let drop = len - HISTORY_LIMIT;
            hist.drain(0..drop);
        }
    }

    Ok(final_text)
}

/// Clear conversation memory.
#[tauri::command]
async fn clear_history(state: State<'_, AppState>) -> Result<(), String> {
    let mut hist = state.chat_history.lock().map_err(|e| e.to_string())?;
    hist.clear();
    Ok(())
}

/// Old single-shot chat path (Anthropic / Bedrock fallback) — kept for emergencies.
#[allow(dead_code)]
async fn chat_remote(prompt: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let system_prompt = "You are Veronica. Reply in 1-3 sentences, plain text.";

    if let Some(key) = read_key("anthropic-key") {
        let body = serde_json::json!({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 400,
            "system": system_prompt,
            "messages": [{ "role": "user", "content": prompt }]
        });
        let resp = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("anthropic request failed: {e}"))?;
        let status = resp.status();
        let txt = resp.text().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(format!("anthropic {}: {}", status, txt));
        }
        let v: serde_json::Value = serde_json::from_str(&txt).map_err(|e| e.to_string())?;
        let out = v["content"][0]["text"].as_str().unwrap_or("").to_string();
        return Ok(out);
    }

    if let Some(key) = read_key("bedrock-key") {
        // Try cheapest available — Haiku 4.5 then Haiku 3.5 then Sonnet 3.7
        let models = [
            "anthropic.claude-haiku-4-5-20251001-v1:0",
            "us.anthropic.claude-3-5-haiku-20241022-v1:0",
            "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
        ];
        let mut last_err = String::from("no bedrock model accepted");
        for model in models {
            let url = format!(
                "https://bedrock-runtime.us-east-1.amazonaws.com/model/{}/converse",
                model
            );
            let body = serde_json::json!({
                "system": [{"text": system_prompt}],
                "messages": [{ "role": "user", "content": [{ "text": prompt }] }],
                "inferenceConfig": { "maxTokens": 400 }
            });
            let resp = client
                .post(&url)
                .header("Authorization", format!("Bearer {}", key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("bedrock request failed: {e}"))?;
            let status = resp.status();
            let txt = resp.text().await.map_err(|e| e.to_string())?;
            if status.is_success() {
                let v: serde_json::Value =
                    serde_json::from_str(&txt).map_err(|e| e.to_string())?;
                let out = v["output"]["message"]["content"][0]["text"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                return Ok(out);
            }
            last_err = format!("bedrock {} {}: {}", model, status, txt);
        }
        return Err(last_err);
    }

    Err("No API key configured. Place key in ~/.friday/anthropic-key or ~/.friday/bedrock-key".into())
}

/// Speak text. Prefers Lemonfox TTS (richer voice), falls back to macOS `say`.
/// Returns immediately; playback happens in a background thread.
#[tauri::command]
fn speak(text: String) -> Result<(), String> {
    std::thread::spawn(move || {
        if let Some(key) = read_key("lemonfox-key") {
            let body = serde_json::json!({
                "input": text,
                "voice": std::env::var("FRIDAY_TTS_VOICE").unwrap_or_else(|_| "heart".to_string()),
                "response_format": "mp3"
            });
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build();
            if let Ok(client) = client {
                let resp = client
                    .post("https://api.lemonfox.ai/v1/audio/speech")
                    .header("Authorization", format!("Bearer {}", key))
                    .header("Content-Type", "application/json")
                    .json(&body)
                    .send();
                if let Ok(resp) = resp {
                    if resp.status().is_success() {
                        if let Ok(bytes) = resp.bytes() {
                            let path = std::env::temp_dir().join("friday-tts.mp3");
                            if std::fs::write(&path, &bytes).is_ok() {
                                let _ = std::process::Command::new("/usr/bin/afplay")
                                    .arg(&path)
                                    .status();
                                return;
                            }
                        }
                    }
                }
            }
        }
        // Fallback: macOS say
        let _ = std::process::Command::new("say")
            .arg("-v")
            .arg("Samantha")
            .arg(&text)
            .status();
    });
    Ok(())
}

/// Record mic with sox (auto-stops on silence) and transcribe via Lemonfox.
/// Returns the recognized text, or empty string on failure.
#[tauri::command]
async fn voice_input() -> Result<String, String> {
    // 1. Record into temp file. sox stops after 2s of silence.
    let wav_path = std::env::temp_dir().join("friday-mic.wav");
    let _ = std::fs::remove_file(&wav_path);

    let sox = which_bin("sox").ok_or_else(|| {
        "sox not installed. Run: brew install sox".to_string()
    })?;

    let path_clone = wav_path.clone();
    let rec_status = tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new(sox)
            .args([
                "-q",
                "-d",                                 // default mic
                "-r", "16000", "-c", "1", "-b", "16",
            ])
            .arg(&path_clone)
            .args([
                "silence",
                "1", "0.2", "1%",     // start when sound > 1% RMS for 0.2s
                "1", "2.0", "2%",     // stop after 2.0s of silence below 2%
                "trim", "0", "30",   // hard cap: 30 sec
            ])
            .status()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    if !rec_status.success() {
        return Err(format!("sox exited {}", rec_status));
    }
    if !wav_path.exists() {
        return Err("no audio captured".into());
    }

    // 2. Send to Lemonfox.
    let key = read_key("lemonfox-key")
        .ok_or_else(|| "lemonfox-key missing in ~/.friday/".to_string())?;

    let bytes = std::fs::read(&wav_path).map_err(|e| e.to_string())?;
    if bytes.len() < 2000 {
        return Ok(String::new()); // too short, treat as empty input
    }

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name("mic.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("language", "english")
        .text("response_format", "json");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post("https://api.lemonfox.ai/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("lemonfox stt failed: {e}"))?;
    if !resp.status().is_success() {
        let s = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("stt {}: {}", s, t));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(v["text"].as_str().unwrap_or("").trim().to_string())
}

fn which_bin(name: &str) -> Option<String> {
    for p in &[
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ] {
        let cand = format!("{}/{}", p, name);
        if std::path::Path::new(&cand).exists() {
            return Some(cand);
        }
    }
    None
}

/// Pop a macOS dialog asking for user input. Returns the typed string,
/// or empty string if user cancelled.
fn ask_user_text(title: &str) -> Result<String, String> {
    let script = format!(
        r#"try
  set theResp to display dialog "{}" default answer "" with title "Veronica" with icon note buttons {{"Cancel","Send"}} default button "Send"
  return text returned of theResp
on error
  return ""
end try"#,
        title
    );
    let out = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| e.to_string())?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Ok(s)
}

/// Full conversation cycle:
///   widget LISTENING → input dialog → THINKING → chat → SPEAKING → IDLE
#[tauri::command]
async fn start_chat(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // Reentrancy guard: ignore concurrent clicks while a chat is in flight.
    {
        let mut busy = state.busy.lock().map_err(|e| e.to_string())?;
        if *busy {
            return Ok(());
        }
        *busy = true;
    }
    let app_busy = app.clone();
    let release_busy = move || {
        if let Some(st) = app_busy.try_state::<AppState>() {
            if let Ok(mut b) = st.busy.lock() { *b = false; }
        }
    };

    let _ = app.emit("state-command", "LISTENING");

    // Voice off by default — set FRIDAY_VOICE_MODE=1 to enable mic input.
    let voice_mode = std::env::var("FRIDAY_VOICE_MODE").unwrap_or_else(|_| "0".to_string());
    let prompt = if voice_mode == "1" {
        match voice_input().await {
            Ok(t) if !t.is_empty() => t,
            _ => {
                tauri::async_runtime::spawn_blocking(|| ask_user_text("Speech not detected — type instead:"))
                    .await
                    .map_err(|e| { release_busy(); e.to_string() })??
            }
        }
    } else {
        match tauri::async_runtime::spawn_blocking(|| ask_user_text("What can I do for you?"))
            .await
        {
            Ok(Ok(t)) => t,
            _ => { release_busy(); return Ok(()); }
        }
    };

    if prompt.is_empty() {
        let _ = app.emit("state-command", "IDLE");
        release_busy();
        return Ok(());
    }
    let _ = app.emit("state-command", "THINKING");
    let reply = match chat(prompt, state).await {
        Ok(r) => r,
        Err(e) => {
            let _ = app.emit("state-command", "ALERT");
            // Show the error to the user immediately
            let err_msg = e.replace('"', "'");
            let trimmed: String = err_msg.chars().take(400).collect();
            let script = format!(
                r#"display dialog "Veronica chat failed:\n\n{}" with title "Veronica Error" buttons {{"OK"}} default button "OK""#,
                trimmed
            );
            let _ = std::process::Command::new("osascript").arg("-e").arg(&script).status();
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                let _ = app2.emit("state-command", "IDLE");
                if let Some(st) = app2.try_state::<AppState>() {
                    if let Ok(mut b) = st.busy.lock() { *b = false; }
                }
            });
            return Err(e);
        }
    };
    let _ = app.emit("state-command", "SPEAKING");
    let _ = speak(reply.clone());

    // Approx speech duration: 12 chars/sec; min 1.5s
    let dur_ms = ((reply.len() as f64 / 12.0) * 1000.0).max(1500.0) as u64;
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(dur_ms)).await;
        let _ = app2.emit("state-command", "IDLE");
        let _ = app2.emit("chat-reply", reply);
        if let Some(st) = app2.try_state::<AppState>() {
            if let Ok(mut b) = st.busy.lock() { *b = false; }
        }
    });
    Ok(())
}

// ───────────────────────────────────────────────────────────────
// Main Entry Point
// ───────────────────────────────────────────────────────────────

fn main() {
    // Initialise shared application state
    let app_state = AppState {
        position_locked: Arc::new(Mutex::new(false)),
        chat_history: Arc::new(Mutex::new(Vec::new())),
        busy: Arc::new(Mutex::new(false)),
    };

    tauri::Builder::default()
        // Inject shared state accessible from all commands
        .manage(app_state)
        // Global shortcut plugin (Tauri v2) — handler toggles the lock
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        return;
                    }
                    let state = app.state::<AppState>();
                    let new_locked = {
                        let mut guard = state
                            .position_locked
                            .lock()
                            .unwrap_or_else(|p| p.into_inner());
                        *guard = !*guard;
                        *guard
                    };
                    let _ = app.emit("lock-state-changed", new_locked);
                })
                .build(),
        )
        // ── Setup hook ────────────────────────────────────────────
        .setup(|app| {
            // 1. System tray
            if let Err(e) = setup_tray(app.handle()) {
                eprintln!("[Veronica] Tray setup warning: {e}");
            }

            // 2. Global shortcut (Cmd+Shift+L)
            if let Err(e) = setup_global_shortcut(app.handle()) {
                eprintln!("[Veronica] Shortcut setup warning: {e}");
            }

            // 3. Restore saved window position
            if let Err(e) = restore_window_position(app.handle()) {
                eprintln!("[Veronica] Position restore warning: {e}");
            }

            // 4. Click-through outside the circular widget bounds
            start_passthrough_watcher(app.handle().clone());

            Ok(())
        })
        // ── Command router ────────────────────────────────────────
        .invoke_handler(tauri::generate_handler![
            save_position,
            load_position,
            toggle_lock,
            is_locked,
            reset_position,
            update_drag_position,
            quit_app,
            chat,
            speak,
            start_chat,
            clear_history,
            voice_input,
        ])
        // ── Run ───────────────────────────────────────────────────
        .run(tauri::generate_context!())
        .expect("error while running Veronica");
}

use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;
use tauri::Manager;

// ── App state ──────────────────────────────────────────────────────────────────

struct SidecarState(Mutex<Option<Child>>);

// ── Entry point ────────────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // A second instance tried to launch — focus the existing window instead.
            if let Some(win) = app.get_webview_window("main") {
                win.show().ok();
                win.set_focus().ok();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            if std::env::var("SENNI_SKIP_SIDECAR").is_ok() {
                // Dev mode: Python server assumed to be running on :8000 externally
                show_window(app.handle());
                spawn_update_check(app.handle());
                setup_tray(app)?;
                return Ok(());
            }

            let child = spawn_sidecar(app.handle())?;
            *app.state::<SidecarState>().0.lock().unwrap() = Some(child);

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                match poll_health(60) {
                    Ok(()) => {
                        show_window(&handle);
                        spawn_update_check(&handle);
                    }
                    Err(e) => {
                        eprintln!("SENNI: sidecar health check failed: {e}");
                        use tauri_plugin_dialog::DialogExt;
                        handle.dialog()
                            .message(format!(
                                "SENNI failed to start.\n\n{e}\n\nCheck that no other instance is running, then try again."
                            ))
                            .title("SENNI startup failed")
                            .blocking_show();
                        handle.exit(1);
                    }
                }
            });

            setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Hide to tray rather than closing the app
                window.hide().ok();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error building SENNI")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                shutdown_sidecar(app);
            }
        });
}

// ── Sidecar spawn ──────────────────────────────────────────────────────────────

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<Child, Box<dyn std::error::Error>> {
    // The full PyInstaller one-dir output is bundled under resources/senni-backend/.
    let bin_name = if cfg!(windows) { "senni-backend.exe" } else { "senni-backend" };

    let bin_path = app
        .path()
        .resource_dir()?
        .join("senni-backend")
        .join(bin_name);

    if !bin_path.exists() {
        return Err(format!("sidecar binary not found at {}", bin_path.display()).into());
    }

    let data_root = platform_data_root();
    std::fs::create_dir_all(&data_root)?;

    let child = std::process::Command::new(&bin_path)
        .env("SENNI_DATA_ROOT", &data_root)
        .env("SENNI_TAURI", "1")
        .spawn()?;

    eprintln!("SENNI: sidecar spawned (pid {})", child.id());
    Ok(child)
}

fn platform_data_root() -> PathBuf {
    // Explicit override wins (portable installs, CI, dev overrides)
    if let Ok(v) = std::env::var("SENNI_DATA_ROOT") {
        return PathBuf::from(v);
    }
    #[cfg(windows)]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        PathBuf::from(appdata).join("SENNI")
    }
    #[cfg(not(windows))]
    {
        let base = std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                dirs_home().join(".local").join("share")
            });
        base.join("SENNI")
    }
}

#[cfg(not(windows))]
fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

// ── Health poll ────────────────────────────────────────────────────────────────

fn poll_health(timeout_secs: u64) -> Result<(), String> {
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);

    loop {
        if std::time::Instant::now() >= deadline {
            return Err(format!("health check timed out after {timeout_secs}s"));
        }
        let result = ureq::get("http://localhost:8000/api/health")
            .timeout(std::time::Duration::from_secs(2))
            .call();
        if let Ok(resp) = result {
            if resp.status() == 200 {
                return Ok(());
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
}

// ── Window helpers ─────────────────────────────────────────────────────────────

fn show_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        win.show().ok();
        win.set_focus().ok();
    }
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────

fn shutdown_sidecar(app: &tauri::AppHandle) {
    // Ask the sidecar to shut down cleanly first
    let _ = ureq::post("http://localhost:8000/api/shutdown")
        .timeout(std::time::Duration::from_secs(2))
        .call();

    // Wait up to 5 s for the process to exit, then force-kill
    let state = app.state::<SidecarState>();
    let mut guard = state.0.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        let deadline =
            std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break, // exited cleanly
                Ok(None) if std::time::Instant::now() >= deadline => {
                    eprintln!("SENNI: sidecar did not exit in time — force-killing");
                    force_kill(child);
                    break;
                }
                _ => std::thread::sleep(std::time::Duration::from_millis(200)),
            }
        }
    }
    *guard = None;
}

fn force_kill(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &child.id().to_string()])
            .status();
    }
    #[cfg(not(windows))]
    {
        // SIGKILL — atexit won't run, but we already sent /api/shutdown above
        let _ = child.kill();
    }
}

// ── Auto-updater ───────────────────────────────────────────────────────────────

fn spawn_update_check(app: &tauri::AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = check_for_updates(&handle).await {
            eprintln!("SENNI: update check: {e}");
        }
    });
}

async fn check_for_updates(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_dialog::DialogExt;
    use tauri_plugin_updater::UpdaterExt;

    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };

    let version = update.version.clone();
    let notes   = update.body.clone().unwrap_or_default();
    let msg     = format!("SENNI {version} is available.\n\n{notes}\n\nInstall now?");

    let install = app.dialog()
        .message(msg)
        .title("Update Available")
        .blocking_show();

    if install {
        update.download_and_install(|_, _| {}, || {}).await?;
        app.restart();
    }
    Ok(())
}

// ── System tray ────────────────────────────────────────────────────────────────

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let show_hide = MenuItem::with_id(app, "show_hide", "Show / Hide", true, None::<&str>)?;
    let quit      = MenuItem::with_id(app, "quit",      "Quit SENNI",  true, None::<&str>)?;
    let menu      = Menu::with_items(app, &[&show_hide, &quit])?;

    // Decode the embedded PNG to raw RGBA at startup — Image::new requires raw pixels.
    let png_bytes = include_bytes!("../icons/128x128.png");
    let decoded = image::load_from_memory(png_bytes)
        .expect("failed to decode tray icon")
        .into_rgba8();
    let (w, h) = decoded.dimensions();
    let icon = tauri::image::Image::new_owned(decoded.into_raw(), w, h);

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("SENNI")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show_hide" => {
                if let Some(win) = app.get_webview_window("main") {
                    if win.is_visible().unwrap_or(false) {
                        win.hide().ok();
                    } else {
                        win.show().ok();
                        win.set_focus().ok();
                    }
                }
            }
            "quit" => {
                let app = app.clone();
                std::thread::spawn(move || {
                    shutdown_sidecar(&app);
                    app.exit(0);
                });
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

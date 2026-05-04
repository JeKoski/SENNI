use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::Manager;

// ── App state ──────────────────────────────────────────────────────────────────

struct SidecarState(Mutex<Option<Child>>);
struct ShutdownFlag(AtomicBool);
struct SidecarLog(Mutex<VecDeque<String>>);

// ── Tauri prefs (tauri-prefs.json in data root) ────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct TauriPrefs {
    show_console: bool,
}

fn read_tauri_prefs(data_root: &std::path::Path) -> TauriPrefs {
    std::fs::read_to_string(data_root.join("tauri-prefs.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

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
        .manage(ShutdownFlag(AtomicBool::new(false)))
        .manage(SidecarLog(Mutex::new(VecDeque::new())))
        .invoke_handler(tauri::generate_handler![
            get_sidecar_log,
            get_log_file_path,
            get_tauri_prefs_cmd,
            set_show_console,
        ])
        .setup(|app| {
            // Show the loading screen immediately so the window appears at once.
            show_loading(app.handle());

            if std::env::var("SENNI_SKIP_SIDECAR").is_ok() {
                // Dev mode: Python server assumed to be running on :8000 externally
                navigate_to_app(app.handle());
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
                        navigate_to_app(&handle);
                        spawn_update_check(&handle);
                        spawn_crash_monitor(&handle);
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

#[cfg(windows)]
use std::os::windows::process::CommandExt;

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

    let mut cmd = std::process::Command::new(&bin_path);
    cmd.env("SENNI_DATA_ROOT", &data_root)
       .env("SENNI_TAURI", "1")
       .stdout(std::process::Stdio::piped())
       .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        // Hide the console window unless the user has opted in via tauri-prefs.json.
        // Windows 11 shows a cmd.exe window for console-subsystem executables spawned
        // from a GUI process unless CREATE_NO_WINDOW is set.
        if !read_tauri_prefs(&data_root).show_console {
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
    }

    let mut child = cmd.spawn()?;
    eprintln!("SENNI: sidecar spawned (pid {})", child.id());

    // Place all child processes under a Windows Job Object so they are
    // automatically terminated when SENNI.exe exits (even on hard crash).
    #[cfg(windows)]
    attach_job_object(&child);

    // Take pipe handles before storing child; spawn log reader threads.
    if let Some(stdout) = child.stdout.take() {
        spawn_log_reader(app.clone(), Box::new(stdout));
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_log_reader(app.clone(), Box::new(stderr));
    }

    Ok(child)
}

fn spawn_log_reader(app: tauri::AppHandle, reader: Box<dyn std::io::Read + Send>) {
    std::thread::spawn(move || {
        use std::io::BufRead;
        for line in std::io::BufReader::new(reader).lines().flatten() {
            let log_state = app.state::<SidecarLog>();
            let mut log = log_state.0.lock().unwrap();
            if log.len() >= 500 { log.pop_front(); }
            log.push_back(line);
        }
    });
}

// ── Windows Job Object ─────────────────────────────────────────────────────────

#[cfg(windows)]
fn attach_job_object(child: &std::process::Child) {
    use std::os::windows::io::AsRawHandle;

    extern "system" {
        fn CreateJobObjectW(attrs: usize, name: usize) -> isize;
        fn SetInformationJobObject(job: isize, class: u32, info: *const u8, len: u32) -> i32;
        fn AssignProcessToJobObject(job: isize, process: isize) -> i32;
    }

    unsafe {
        let job = CreateJobObjectW(0, 0);
        if job == 0 { return; }

        // JOBOBJECT_EXTENDED_LIMIT_INFORMATION — 144 bytes on x64 Windows.
        // LimitFlags (u32) lives at offset 16 (after two LARGE_INTEGER fields).
        // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000: all processes in the job
        // are killed when the last handle to the job object is closed (i.e. when
        // SENNI.exe exits), preventing orphaned llama-server processes.
        let mut info = [0u8; 144];
        info[16..20].copy_from_slice(&0x2000u32.to_ne_bytes());
        SetInformationJobObject(job, 9, info.as_ptr(), 144); // 9 = JobObjectExtendedLimitInformation
        AssignProcessToJobObject(job, child.as_raw_handle() as isize);

        // The job handle (isize = Copy, no Drop) is intentionally never closed here.
        // The OS holds it open for the lifetime of SENNI.exe and auto-closes on exit.
    }
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
    // Use 127.0.0.1 explicitly — on Windows 11 "localhost" resolves to ::1 (IPv6)
    // first, but uvicorn binds to 127.0.0.1 (IPv4), causing every attempt to fail.
    let url      = "http://127.0.0.1:8000/api/health";
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
    let mut last_err = String::from("no attempts made");

    loop {
        if std::time::Instant::now() >= deadline {
            return Err(format!(
                "health check timed out after {timeout_secs}s\nLast error: {last_err}"
            ));
        }
        match ureq::get(url).timeout(std::time::Duration::from_secs(2)).call() {
            Ok(resp) if resp.status() == 200 => return Ok(()),
            Ok(resp) => last_err = format!("HTTP {}", resp.status()),
            Err(e)   => last_err = e.to_string(),
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
}

// ── Crash monitor ──────────────────────────────────────────────────────────────

fn spawn_crash_monitor(app: &tauri::AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));

            if handle.state::<ShutdownFlag>().0.load(Ordering::SeqCst) { break; }

            let exit_status = {
                let sidecar_state = handle.state::<SidecarState>();
                let mut state = sidecar_state.0.lock().unwrap();
                match state.as_mut() {
                    Some(child) => match child.try_wait() {
                        Ok(Some(status)) => Some(status),
                        _ => None,
                    },
                    None => break, // child was cleared by shutdown
                }
            };

            if let Some(status) = exit_status {
                // Double-check flag — shutdown might have raced us.
                if handle.state::<ShutdownFlag>().0.load(Ordering::SeqCst) { break; }
                use tauri_plugin_dialog::DialogExt;
                handle.dialog()
                    .message(format!(
                        "The SENNI backend stopped unexpectedly.\n\nExit code: {}\n\nOpen the server log in Settings \u{2192} About for details.",
                        status.code().map(|c| c.to_string()).unwrap_or_else(|| "unknown".into())
                    ))
                    .title("SENNI backend stopped")
                    .blocking_show();
                handle.exit(1);
                break;
            }
        }
    });
}

// ── Window helpers ─────────────────────────────────────────────────────────────

fn try_read_avatar_data_uri(data_root: &std::path::Path) -> Option<String> {
    use base64::Engine;
    let cfg: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(data_root.join("config.json")).ok()?
    ).ok()?;
    let folder = cfg["companion_folder"].as_str()?;
    let comp: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(
            data_root.join("companions").join(folder).join("config.json")
        ).ok()?
    ).ok()?;
    let avatar_file = comp["avatar_path"].as_str()?;
    let avatar_path = data_root.join("companions").join(folder).join(avatar_file);
    let ext = avatar_path.extension()?.to_str()?.to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png"          => "image/png",
        "webp"         => "image/webp",
        _              => return None,
    };
    let bytes = std::fs::read(&avatar_path).ok()?;
    Some(format!(
        "data:{};base64,{}",
        mime,
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

fn build_loading_html(avatar_uri: Option<&str>) -> String {
    let avatar_html = match avatar_uri {
        Some(uri) => format!("<img class='av' src='{}'>", uri),
        None      => String::new(),
    };
    format!(
        "<!DOCTYPE html><html><head><meta charset='utf-8'><style>\
        *{{margin:0;padding:0;box-sizing:border-box}}\
        body{{background:#0d0d0f;display:flex;flex-direction:column;\
          align-items:center;justify-content:center;height:100vh;gap:18px;\
          font-family:Georgia,'Times New Roman',serif}}\
        .av{{width:88px;height:88px;border-radius:50%;object-fit:cover;\
          border:2px solid rgba(129,140,248,0.25);margin-bottom:6px}}\
        .sp{{width:34px;height:34px;border-radius:50%;\
          border:2px solid rgba(129,140,248,0.15);border-top-color:#818cf8;\
          animation:spin 1s linear infinite}}\
        .lb{{font-size:16px;color:#eef0fb;letter-spacing:.04em}}\
        @keyframes spin{{to{{transform:rotate(360deg)}}}}\
        </style></head><body>\
        {}\
        <div class='sp'></div>\
        <div class='lb'>Starting SENNI\u{2026}</div>\
        </body></html>",
        avatar_html
    )
}

fn show_loading(app: &tauri::AppHandle) {
    use base64::Engine;
    let data_root  = platform_data_root();
    let avatar_uri = try_read_avatar_data_uri(&data_root);
    let html       = build_loading_html(avatar_uri.as_deref());
    let b64        = base64::engine::general_purpose::STANDARD.encode(html.as_bytes());
    let url        = format!("data:text/html;base64,{b64}");

    if let Some(win) = app.get_webview_window("main") {
        let _ = win.navigate(url.parse().expect("loading URL"));
        win.show().ok();
        win.set_focus().ok();
    }
}

fn navigate_to_app(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        // Fade out the loading screen over 1 s before handing off to the app.
        win.eval(
            "document.body.style.transition='opacity 1s ease';\
             document.body.style.opacity='0'"
        ).ok();
        std::thread::sleep(std::time::Duration::from_millis(1050));
        let _ = win.navigate("http://127.0.0.1:8000".parse().expect("app URL"));
    }
}

fn build_shutdown_html() -> String {
    "<!DOCTYPE html><html><head><meta charset='utf-8'><style>\
    *{margin:0;padding:0;box-sizing:border-box}\
    body{background:#0d0d0f;display:flex;flex-direction:column;\
      align-items:center;justify-content:center;height:100vh;gap:14px;\
      font-family:Georgia,'Times New Roman',serif;\
      opacity:0;animation:fi .5s ease forwards}\
    .lb{font-size:16px;color:rgba(238,240,251,0.7);letter-spacing:.04em}\
    @keyframes fi{to{opacity:1}}\
    </style></head><body>\
    <div class='lb'>Shutting down\u{2026}</div>\
    </body></html>".into()
}

fn show_shutdown_screen(app: &tauri::AppHandle) {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(build_shutdown_html().as_bytes());
    let url = format!("data:text/html;base64,{b64}");
    if let Some(win) = app.get_webview_window("main") {
        win.show().ok();
        let _ = win.navigate(url.parse().expect("shutdown URL"));
    }
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────

fn shutdown_sidecar(app: &tauri::AppHandle) {
    // Signal the crash monitor not to fire on this intentional exit.
    app.state::<ShutdownFlag>().0.store(true, Ordering::SeqCst);

    // Use 127.0.0.1 explicitly — same IPv6 resolution issue as the health poll.
    let _ = ureq::post("http://127.0.0.1:8000/api/shutdown")
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

// ── Tauri commands ─────────────────────────────────────────────────────────────

#[tauri::command]
fn get_sidecar_log(state: tauri::State<'_, SidecarLog>) -> Vec<String> {
    // Prefer the persistent log file — it includes Python logging + llama-server output.
    let log_path = platform_data_root().join("senni.log");
    if let Ok(content) = std::fs::read_to_string(&log_path) {
        let all: Vec<String> = content.lines().map(String::from).collect();
        if !all.is_empty() {
            let start = all.len().saturating_sub(1000);
            return all[start..].to_vec();
        }
    }
    // Fall back to in-memory stdout/stderr capture
    state.0.lock().unwrap().iter().cloned().collect()
}

#[tauri::command]
fn get_log_file_path() -> Option<String> {
    let path = platform_data_root().join("senni.log");
    path.exists().then(|| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_tauri_prefs_cmd() -> TauriPrefs {
    read_tauri_prefs(&platform_data_root())
}

#[tauri::command]
fn set_show_console(value: bool) -> Result<(), String> {
    let prefs = TauriPrefs { show_console: value };
    let path  = platform_data_root().join("tauri-prefs.json");
    let json  = serde_json::to_string_pretty(&prefs).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

// ── System tray ────────────────────────────────────────────────────────────────

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;

    let show_hide  = MenuItem::with_id(app, "show_hide",  "Show / Hide", true, None::<&str>)?;
    let server_log = MenuItem::with_id(app, "server_log", "Server Log",  true, None::<&str>)?;
    let sep        = PredefinedMenuItem::separator(app)?;
    let quit       = MenuItem::with_id(app, "quit",       "Quit SENNI",  true, None::<&str>)?;
    let menu       = Menu::with_items(app, &[&show_hide, &server_log, &sep, &quit])?;

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
            "server_log" => {
                if let Some(win) = app.get_webview_window("main") {
                    win.show().ok();
                    win.set_focus().ok();
                    // Open settings → About tab and show log panel
                    win.eval(
                        "typeof openServerLog === 'function' && openServerLog(true)"
                    ).ok();
                }
            }
            "quit" => {
                let app = app.clone();
                std::thread::spawn(move || {
                    show_shutdown_screen(&app);
                    std::thread::sleep(std::time::Duration::from_millis(600));
                    shutdown_sidecar(&app);
                    app.exit(0);
                });
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

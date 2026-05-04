@echo off
setlocal

REM ── Verify prerequisites ──────────────────────────────────────────────────────

where cargo >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [!] Rust not found. Run setup-tauri.bat first.
    echo.
    pause
    exit /b 1
)

cargo tauri --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [!] tauri-cli not found. Run setup-tauri.bat first.
    echo.
    pause
    exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [!] Python not found. Run start.bat at least once to set up dependencies.
    echo.
    pause
    exit /b 1
)

REM ── Launch Python server in a separate window ─────────────────────────────────

echo.
echo  Starting Python server...
start "SENNI - Python server" cmd /k "python main.py"
timeout /t 2 /nobreak >nul

REM ── Launch Tauri dev shell ────────────────────────────────────────────────────

echo  Starting Tauri shell (SENNI_SKIP_SIDECAR=1)...
echo  First run compiles ~200 crates - expect 10-15 minutes.
echo  Subsequent runs are fast.
echo.

set SENNI_SKIP_SIDECAR=1
cargo tauri dev

pause

@echo off
setlocal

echo.
echo  SENNI - Tauri setup
echo  ===================

REM ── Check / install Rust ──────────────────────────────────────────────────────

where cargo >nul 2>&1
if not errorlevel 1 goto rust_ok

echo.
echo  Rust not found. Downloading rustup-init.exe...
curl -sSfL "https://win.rustup.rs/x86_64" -o "%TEMP%\rustup-init.exe"
if errorlevel 1 (
    echo.
    echo  [!] Download failed. Install Rust manually from https://rustup.rs
    echo.
    pause
    exit /b 1
)

echo  Running rustup installer (stable toolchain, minimal profile)...
"%TEMP%\rustup-init.exe" -y --default-toolchain stable --profile minimal
del "%TEMP%\rustup-init.exe" >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [!] Rust install failed.
    echo.
    pause
    exit /b 1
)

REM Make cargo available in this session
set PATH=%USERPROFILE%\.cargo\bin;%PATH%

:rust_ok
for /f "tokens=*" %%v in ('cargo --version 2^>nul') do echo  Rust  :  %%v

REM ── Check / install tauri-cli v2 ──────────────────────────────────────────────

cargo tauri --version >nul 2>&1
if not errorlevel 1 goto tauri_ok

echo.
echo  Installing tauri-cli v2 (compiles from source - a few minutes)...
cargo install tauri-cli --version "^2.0" --locked
if errorlevel 1 (
    echo.
    echo  [!] tauri-cli install failed.
    echo.
    pause
    exit /b 1
)

:tauri_ok
for /f "tokens=*" %%v in ('cargo tauri --version 2^>nul') do echo  Tauri :  %%v

echo.
echo  All set. Run dev-tauri.bat to start the dev environment.
echo.
pause

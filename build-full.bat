@echo off
setlocal

REM ── build-full.bat ─────────────────────────────────────────────────────────────
REM Full SENNI build from a clean worktree. Installs all prerequisites, builds the
REM Python sidecar via PyInstaller, then builds the Tauri installer.
REM
REM Usage:
REM   build-full.bat            — skip PyInstaller if sidecar already built
REM   build-full.bat --rebuild  — force-rebuild the Python sidecar too

set EMBED=python-embed
set PYTHON=%EMBED%\python.exe
set SIDECAR=dist\senni-backend\senni-backend.exe
set REBUILD=0
if "%1"=="--rebuild" set REBUILD=1

echo.
echo  SENNI build
echo  ===========
echo.

REM ── 1. Rust ────────────────────────────────────────────────────────────────────

where cargo >nul 2>&1
if not errorlevel 1 goto rust_ok

echo  [1/4] Rust not found — installing via rustup...
curl -sSfL "https://win.rustup.rs/x86_64" -o "%TEMP%\rustup-init.exe"
if errorlevel 1 ( echo  [!] Failed to download rustup. & exit /b 1 )
"%TEMP%\rustup-init.exe" -y --default-toolchain stable --profile minimal
del "%TEMP%\rustup-init.exe" >nul 2>&1
if errorlevel 1 ( echo  [!] Rust install failed. & exit /b 1 )
set PATH=%USERPROFILE%\.cargo\bin;%PATH%

:rust_ok
for /f "tokens=*" %%v in ('cargo --version 2^>nul') do echo  [1/4] %%v

REM ── 2. tauri-cli ───────────────────────────────────────────────────────────────

cargo tauri --version >nul 2>&1
if not errorlevel 1 goto tauri_ok

echo  [2/4] tauri-cli not found — installing (compiles from source, a few minutes)...
cargo install tauri-cli --version "^2.0" --locked
if errorlevel 1 ( echo  [!] tauri-cli install failed. & exit /b 1 )

:tauri_ok
for /f "tokens=*" %%v in ('cargo tauri --version 2^>nul') do echo  [2/4] %%v

REM ── 3. python-embed ────────────────────────────────────────────────────────────

if exist "%EMBED%\python.exe" goto embed_ok

echo  [3/4] python-embed not found — running build_prep.py...
where python >nul 2>&1
if errorlevel 1 ( echo  [!] System Python not found. Install Python 3.12 to bootstrap python-embed. & exit /b 1 )
python scripts/build_prep.py
if errorlevel 1 ( echo  [!] build_prep.py failed. & exit /b 1 )

:embed_ok
echo  [3/4] python-embed OK

REM ── 4. Python sidecar ──────────────────────────────────────────────────────────

if "%REBUILD%"=="0" if exist "%SIDECAR%" (
    echo  [4/4] Sidecar already built — skipping PyInstaller. ^(--rebuild to force^)
    goto tauri_build
)

echo  [4/4] Building Python sidecar...

"%PYTHON%" -c "import fastapi" 2>nul
if errorlevel 1 (
    echo         Installing runtime deps into python-embed...
    "%PYTHON%" -m pip install --no-warn-script-location fastapi "uvicorn[standard]" python-multipart ddgs httpx beautifulsoup4 Pillow
    if errorlevel 1 ( echo  [!] Dependency install failed. & exit /b 1 )
)

"%PYTHON%" -c "import PyInstaller" 2>nul
if errorlevel 1 (
    echo         Installing PyInstaller into python-embed...
    "%PYTHON%" -m pip install --no-warn-script-location pyinstaller
    if errorlevel 1 ( echo  [!] PyInstaller install failed. & exit /b 1 )
)

"%PYTHON%" -m PyInstaller senni-backend.spec
if errorlevel 1 ( echo  [!] PyInstaller build failed. & exit /b 1 )

echo  [4/4] Sidecar built.

REM ── Tauri installer ────────────────────────────────────────────────────────────

:tauri_build
echo.
echo  Building Tauri installer...
echo.
cargo tauri build
if errorlevel 1 ( echo. & echo  [!] Tauri build failed. & exit /b 1 )

echo.
echo  Done! Installers in src-tauri\target\release\bundle\
echo.

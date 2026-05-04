@echo off
setlocal

REM ── build-full.bat ─────────────────────────────────────────────────────────────
REM Builds the complete SENNI installer (PyInstaller sidecar + Tauri shell).
REM
REM Usage:
REM   build-full.bat            — skip PyInstaller if sidecar already exists
REM   build-full.bat --rebuild  — always rebuild the Python sidecar too

set EMBED=python-embed
set PYTHON=%EMBED%\python.exe
set SIDECAR=dist\senni-backend\senni-backend.exe
set REBUILD=0

if "%1"=="--rebuild" set REBUILD=1

REM ── Prerequisites ──────────────────────────────────────────────────────────────

where cargo >nul 2>&1
if errorlevel 1 (
    echo [!] Rust not found. Run setup-tauri.bat first.
    exit /b 1
)

if not exist "%EMBED%\" (
    echo [!] python-embed\ not found. Run build_prep.py or build-embed.bat first.
    exit /b 1
)

if not exist "%PYTHON%" (
    echo [!] %PYTHON% not found.
    exit /b 1
)

REM ── Python sidecar ─────────────────────────────────────────────────────────────

if "%REBUILD%"=="0" if exist "%SIDECAR%" (
    echo [sidecar] Already built — skipping PyInstaller. Pass --rebuild to force.
    goto tauri
)

echo [sidecar] Installing dependencies...
"%PYTHON%" -c "import fastapi" 2>nul
if errorlevel 1 (
    "%PYTHON%" -m pip install --no-warn-script-location fastapi "uvicorn[standard]" python-multipart ddgs httpx beautifulsoup4 Pillow
    if errorlevel 1 ( echo [!] Dependency install failed & exit /b 1 )
)

"%PYTHON%" -c "import PyInstaller" 2>nul
if errorlevel 1 (
    "%PYTHON%" -m pip install --no-warn-script-location pyinstaller
    if errorlevel 1 ( echo [!] PyInstaller install failed & exit /b 1 )
)

echo [sidecar] Running PyInstaller...
"%PYTHON%" -m PyInstaller senni-backend.spec
if errorlevel 1 ( echo [!] PyInstaller build failed & exit /b 1 )

echo [sidecar] Done.

REM ── Tauri installer ────────────────────────────────────────────────────────────

:tauri
echo [tauri] Building installer...
cargo tauri build
if errorlevel 1 ( echo [!] Tauri build failed & exit /b 1 )

echo.
echo Done! Installer is in src-tauri\target\release\bundle\

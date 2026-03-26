@echo off
title SENNI

:: ── Check Python ─────────────────────────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [!] Python not found.
    echo      Download it from https://www.python.org/downloads/
    echo      Make sure to tick "Add Python to PATH" during install.
    echo.
    pause
    exit /b 1
)

:: ── Install / verify dependencies ────────────────────────────────────────────
echo.
echo  Checking dependencies...
pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo.
    echo  [!] Failed to install dependencies.
    echo      Try running: pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

:: ── Launch ────────────────────────────────────────────────────────────────────
echo.
echo  Starting SENNI...
echo  The browser will open automatically.
echo  Press Ctrl+C to stop.
echo.
python main.py

pause

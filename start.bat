@echo off
title SENNI

REM Check Python
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

REM Install / verify dependencies
echo.
echo  Checking dependencies...
python -c "import fastapi, uvicorn, multipart" >nul 2>&1
if errorlevel 1 (
    echo  Missing core packages. Installing requirements...
    python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo  [!] Failed to install dependencies.
        echo      Try running: python -m pip install -r requirements.txt
        echo.
        pause
        exit /b 1
    )
) else (
    echo  Dependencies already available.
)

REM Launch
echo.
echo  Starting SENNI...
echo  The browser will open automatically.
echo  Press Ctrl+C to stop.
echo.
python main.py

pause

@echo off
setlocal

set EMBED=python-embed
set PYTHON=%EMBED%\python.exe

if not exist "%EMBED%\" (
    echo python-embed\ not found. Restore from backup or run build.bat with system Python first.
    pause & exit /b 1
)

if not exist "%PYTHON%" (
    echo %PYTHON% not found.
    pause & exit /b 1
)

:: Install PyInstaller into embed if not already present
"%PYTHON%" -c "import PyInstaller" 2>nul
if errorlevel 1 (
    echo Installing PyInstaller into python-embed...
    "%PYTHON%" -m pip install pyinstaller
    if errorlevel 1 ( echo PyInstaller install failed & pause & exit /b 1 )
)

"%PYTHON%" -m PyInstaller senni-backend.spec
pause

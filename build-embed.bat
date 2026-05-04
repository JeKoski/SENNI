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

:: Install core runtime deps into embed so PyInstaller can analyse them.
:: Excludes chromadb/sentence-transformers — heavy, and excluded in the spec anyway.
"%PYTHON%" -c "import fastapi" 2>nul
if errorlevel 1 (
    echo Installing core dependencies into python-embed...
    "%PYTHON%" -m pip install --no-warn-script-location fastapi "uvicorn[standard]" python-multipart ddgs httpx beautifulsoup4 Pillow
    if errorlevel 1 ( echo Dependency install failed & pause & exit /b 1 )
)

:: Install PyInstaller into embed if not already present
"%PYTHON%" -c "import PyInstaller" 2>nul
if errorlevel 1 (
    echo Installing PyInstaller into python-embed...
    "%PYTHON%" -m pip install --no-warn-script-location pyinstaller
    if errorlevel 1 ( echo PyInstaller install failed & pause & exit /b 1 )
)

"%PYTHON%" -m PyInstaller senni-backend.spec
if errorlevel 1 ( echo PyInstaller build failed & pause & exit /b 1 )

echo Build complete. dist\senni-backend\ is ready for Tauri bundling.
pause

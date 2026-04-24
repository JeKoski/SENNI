@echo off
if not exist "python-embed\" (
    echo python-embed not found, running build_prep...
    python scripts/build_prep.py
    if errorlevel 1 ( echo build_prep failed & exit /b 1 )
)
pyinstaller senni-backend.spec

pause
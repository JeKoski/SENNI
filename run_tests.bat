@echo off
title SENNI Test Harness

echo Running tests...
python --version >nul 2>&1

python -m pytest tests/ -v

pause
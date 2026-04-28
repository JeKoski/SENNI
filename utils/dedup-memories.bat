@echo off
curl -X POST "http://localhost:8000/api/memory/dedup?dry_run=false"
echo 
pause
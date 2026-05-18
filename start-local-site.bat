@echo off
cd /d "%~dp0"
echo Starting Bike Across America tracker...
echo.
"C:\Program Files\nodejs\node.exe" scripts\local-server.mjs
pause

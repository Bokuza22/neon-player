@echo off
title Neon Audio Player
cd /d "%~dp0"
echo Starting Neon Audio Player server...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1"
pause

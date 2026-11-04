@echo off
cd /d "%~dp0"
start "gif생성기" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"

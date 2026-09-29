@echo off
REM Double-click this once to put "MoneyView" and "Stop MoneyView" on the Desktop and Start menu.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install_shortcuts.ps1" %*
pause

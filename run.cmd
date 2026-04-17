@echo off
setlocal EnableDelayedExpansion

if /I not "%~1"=="MoneyView" goto usage

shift
set "launcher_args="

:collect_args
if "%~1"=="" goto launch
set "launcher_args=!launcher_args! %~1"
shift
goto collect_args

:launch
powershell.exe -ExecutionPolicy Bypass -File "%~dp0scripts\start_local.ps1" -OpenBrowser!launcher_args!
exit /b %errorlevel%

:usage
echo Usage: run MoneyView [launcher-options]
echo Example: run MoneyView
echo Example: run MoneyView -CheckOnly
exit /b 1

@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>nul
title Coaches Skin Studio - Launcher v0.4.1

cls
echo ================================================================
echo              COACHES SKIN STUDIO  v0.4.1
echo                  Windows Launcher
 echo ================================================================
echo.
echo [INFO] This window will stay open when the application stops.
echo [INFO] Keep it open while using the app.
echo.

set "APP_DIR=%~dp0"
if not exist "%APP_DIR%package.json" goto not_extracted
if not exist "%APP_DIR%electron\main.cjs" goto not_extracted
pushd "%APP_DIR%" 2>nul
if errorlevel 1 goto cannot_open_folder

echo [1/4] Checking Node.js...
where.exe node.exe >nul 2>nul
if errorlevel 1 goto no_node
node --version
if errorlevel 1 goto node_broken

echo.
echo [2/4] Checking npm...
where.exe npm.cmd >nul 2>nul
if errorlevel 1 goto no_npm
call npm.cmd --version
if errorlevel 1 goto npm_broken

echo.
echo [3/4] Checking dependencies...
if exist "node_modules\.bin\electron.cmd" if exist "node_modules\.bin\vite.cmd" goto dependencies_ok

echo [INFO] First launch: installing packages from npm.
echo [INFO] Internet access is needed. Watch for errors below.
call npm.cmd ci --no-audit --no-fund
if errorlevel 1 goto install_failed
:dependencies_ok

echo.
echo [4/4] Starting Coaches Skin Studio...
echo [INFO] Electron may download its runtime on first launch.
echo [INFO] Do not close this console while the app is running.
echo.
if not exist "%APP_DIR%dist\index.html" call npm.cmd run build
if errorlevel 1 goto finish
set "COACH_STUDIO_LOCAL_BUILD=1"
call "%APP_DIR%node_modules\.bin\electron.cmd" .
set "APP_EXIT_CODE=%ERRORLEVEL%"
echo.
echo ================================================================
echo [INFO] Application process stopped. Exit code: %APP_EXIT_CODE%
echo [INFO] If the app did not open, send a screenshot of this window.
echo ================================================================
goto finish

:not_extracted
echo [ERROR] Cannot find package.json and electron\main.cjs.
echo [FIX] Extract the ENTIRE ZIP first - do not double-click BAT inside ZIP.
echo [FIX] RUN_WINDOWS.bat must be in the same folder as package.json.
goto finish
:cannot_open_folder
echo [ERROR] Cannot access the application folder.
echo [FIX] Move the extracted folder to C:\Coaches_Skin_Studio and retry.
goto finish
:no_node
echo [ERROR] Node.js is not installed or not in PATH.
echo [FIX] Install Node.js LTS from https://nodejs.org/ then restart your PC or Terminal.
goto finish
:node_broken
echo [ERROR] The Node.js installation is not working.
echo [FIX] Reinstall Node.js LTS from https://nodejs.org/.
goto finish
:no_npm
echo [ERROR] npm.cmd was not found in PATH.
echo [FIX] Repair or reinstall Node.js LTS (with npm).
goto finish
:npm_broken
echo [ERROR] npm failed to start.
echo [FIX] Repair or reinstall Node.js LTS.
goto finish
:install_failed
echo.
echo [ERROR] npm install failed. Read the error printed above.
echo [FIX] Check your internet connection, VPN/proxy, and antivirus.
echo [FIX] If you see network errors, retry later or use another connection.
goto finish
:finish
echo.
echo Press any key to close this window...
pause >nul
popd 2>nul
endlocal

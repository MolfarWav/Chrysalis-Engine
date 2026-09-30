@echo off
setlocal
rem Chrysalis launcher (run from source).
rem   start-chrysalis.bat          start (installs and builds only what is missing)
rem   start-chrysalis.bat update   git pull, reinstall, rebuild, then start
rem   start-chrysalis.bat rebuild  rebuild the interface, then start

set "ROOT=C:\Users\sulaz\Chrysalis-Engine"
title Chrysalis
cd /d "%ROOT%" || (echo Folder not found: %ROOT% & pause & exit /b 1)

where bun >nul 2>nul || (echo Bun is not installed or not in PATH. Get it at https://bun.sh & pause & exit /b 1)

set "FULL="
if /i "%~1"=="update" (
  echo === Pulling the latest changes...
  git pull || (echo git pull failed. & pause & exit /b 1)
  set "FULL=1"
)
if /i "%~1"=="rebuild" set "FULL=1"

if defined FULL goto install
if not exist "node_modules" goto install
if not exist "client-agent\node_modules" goto install
goto build

:install
echo === Installing dependencies...
call bun install || (echo bun install failed. & pause & exit /b 1)
pushd client-agent
call bun install || (popd & echo bun install in client-agent failed. & pause & exit /b 1)
popd

:build
if defined FULL goto dobuild
if not exist "client\dist\index.html" goto dobuild
if not exist "client-agent\dist\index.html" goto dobuild
goto run

:dobuild
echo === Building the interface...
call bun run build:client || (echo Build failed. & pause & exit /b 1)

:run
echo === Starting Chrysalis. Close this window or press Ctrl+C to stop.
call bun start
echo.
echo Chrysalis stopped.
pause

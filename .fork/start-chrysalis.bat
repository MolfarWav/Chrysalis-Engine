@echo off
setlocal
rem Chrysalis launcher (run from source).
rem   start-chrysalis.bat          start (installs and builds only what is missing)
rem   start-chrysalis.bat update            pull the current branch, reinstall, rebuild, then start
rem   start-chrysalis.bat update <branch>   switch to <branch> from GitHub first (each Claude session works on its own branch)
rem   start-chrysalis.bat rebuild           rebuild the interface, then start

rem git may replace this very file mid-run; cmd reads a batch file as it goes,
rem so run from a copy in %TEMP% and let the original change freely
if not "%~1"=="--from-copy" (
  copy /y "%~f0" "%TEMP%\start-chrysalis.bat" >nul
  "%TEMP%\start-chrysalis.bat" --from-copy %*
)
shift

set "ROOT=C:\Users\sulaz\Chrysalis-Engine"
title Chrysalis
cd /d "%ROOT%" || (echo Folder not found: %ROOT% & pause & exit /b 1)

where bun >nul 2>nul || (echo Bun is not installed or not in PATH. Get it at https://bun.sh & pause & exit /b 1)

set "FULL="
if /i "%~1"=="update" (
  set "FULL=1"
  if not "%~2"=="" (
    echo === Switching to %~2...
    git fetch origin || (echo git fetch failed. & pause & exit /b 1)
    git checkout -B "%~2" "origin/%~2" || (echo Could not switch to %~2. & pause & exit /b 1)
  ) else (
    echo === Pulling the latest changes...
    git pull || (echo git pull failed. & pause & exit /b 1)
  )
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

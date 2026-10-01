@echo off
setlocal EnableExtensions
title Chrysalis
rem Molfar Vertep: install, update and start, in one file.
rem Keep this file OUTSIDE the app folder (for example D:\ROLEPlay\Chrysalis.bat).
rem
rem   Chrysalis.bat             update to the newest work branch, then start
rem   Chrysalis.bat <branch>    update to that branch, then start
rem   Chrysalis.bat nopull      start without checking for updates
rem   Chrysalis.bat rebuild     reinstall and rebuild, then start
rem
rem Your data (D:\ROLEPlay\Chrysalis-Engine\data) is never touched by an update:
rem git ignores that folder.

set "APP=D:\ROLEPlay\Chrysalis-Engine"
set "REPO=https://github.com/MolfarWav/Molfar.Vertep.git"
rem tools installed by this script are found without reopening the window
set "PATH=%USERPROFILE%\.bun\bin;%ProgramFiles%\Git\cmd;%PATH%"

rem ---------- tools ----------
where git >nul 2>nul
if errorlevel 1 (
  echo === Installing Git...
  winget install --id Git.Git -e --silent --accept-source-agreements --accept-package-agreements
)
where git >nul 2>nul
if errorlevel 1 (
  echo Git is not available. Close this window and run the file again.
  goto fail
)
where bun >nul 2>nul
if errorlevel 1 (
  echo === Installing Bun...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
)
where bun >nul 2>nul
if errorlevel 1 (
  echo Bun is not available. Close this window and run the file again.
  goto fail
)

rem ---------- first run: download ----------
set "FULL="
if not exist "%APP%\.git" (
  echo === Downloading Molfar Vertep to %APP%...
  git clone "%REPO%" "%APP%"
  if errorlevel 1 goto fail
  set "FULL=1"
)
cd /d "%APP%" || goto fail

if /i "%~1"=="rebuild" set "FULL=1"
if /i "%~1"=="rebuild" goto deps
if /i "%~1"=="nopull" goto deps

rem ---------- update ----------
rem a copy cloned before the repository was renamed follows it under its new name
git remote set-url origin "%REPO%"
echo === Checking for updates...
git fetch --prune origin
if errorlevel 1 (
  echo No connection to GitHub: starting the version you have.
  goto deps
)
set "BRANCH=%~1"
rem no branch named: the newest work branch (each Claude session makes its own)
if not defined BRANCH (
  for /f "delims=" %%b in ('git for-each-ref "--sort=-committerdate" "--format=%%(refname:lstrip=3)" refs/remotes/origin/claude/') do (
    if not defined BRANCH (
      echo %%b| findstr /b /c:"claude/upstream-" >nul || set "BRANCH=%%b"
    )
  )
)
if not defined BRANCH (
  for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
)
set "HERE="
set "THERE="
for /f "delims=" %%h in ('git rev-parse HEAD') do set "HERE=%%h"
for /f "delims=" %%h in ('git rev-parse --verify --quiet "origin/%BRANCH%"') do set "THERE=%%h"
if not defined THERE (
  echo There is no branch "%BRANCH%" on GitHub.
  goto fail
)
if "%HERE%"=="%THERE%" (
  echo Up to date: %BRANCH%
  goto deps
)
echo === Updating to %BRANCH%...
rem bun install rewrites the lock files; they are not ours to keep
git checkout -- bun.lock client-agent/bun.lock 2>nul
git checkout -B "%BRANCH%" "origin/%BRANCH%"
if errorlevel 1 goto fail
set "FULL=1"

rem ---------- install and build what is needed ----------
:deps
if defined FULL goto install
if not exist "node_modules" goto install
if not exist "client-agent\node_modules" goto install
goto build

:install
echo === Installing dependencies...
call bun install
if errorlevel 1 goto fail
pushd client-agent
call bun install
if errorlevel 1 (
  popd
  goto fail
)
popd

:build
if defined FULL goto dobuild
if not exist "client\dist\index.html" goto dobuild
if not exist "client-agent\dist\index.html" goto dobuild
goto run

:dobuild
echo === Building the interface...
call bun run build:client
if errorlevel 1 goto fail

rem ---------- start ----------
:run
echo === Starting Molfar Vertep. Close this window or press Ctrl+C to stop.
echo     First start: open the link with #setup= that appears below to create your account.
call bun start
echo.
echo Molfar Vertep stopped.
pause
exit /b 0

:fail
echo.
echo Something went wrong: see the messages above.
pause
exit /b 1

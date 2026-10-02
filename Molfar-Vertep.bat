@echo off
rem Molfar Vertep launcher: checks the tools, offers updates, starts the
rem engine and opens it in your browser. Works from wherever the app folder is.
rem
rem   Molfar-Vertep.bat            update to the latest release (asks first), then start
rem   Molfar-Vertep.bat dev        update to the newest work branch (claude/*) instead
rem   Molfar-Vertep.bat nopull     start without checking for updates
rem   Molfar-Vertep.bat yes        do not ask: take the update
rem   Molfar-Vertep.bat rebuild    reinstall packages and rebuild, then start
rem   Molfar-Vertep.bat tools      also check Git and Bun for updates
rem   Molfar-Vertep.bat shortcut   (re)create the desktop shortcut
rem Options combine: "Molfar-Vertep.bat dev yes".
rem
rem Where it runs: the folder this file sits in. A copy of this file kept
rem somewhere else finds the app through the path the last run remembered
rem (%LOCALAPPDATA%\Molfar Vertep\app-path.txt); a desktop shortcut points
rem at the original. With no app anywhere, it offers to download one here.
rem
rem The release channel checks out a release tag, which leaves git on a
rem detached HEAD: "git pull" will not work there, and you do not need it,
rem this file does the updating. "dev" puts you back on a branch.
rem
rem Your data (the data folder) is never touched by an update: git ignores it.
rem This file is plain ASCII on purpose: cmd reads it with the console code page.

setlocal EnableExtensions DisableDelayedExpansion
set "MV_RC=0"

rem ---------- run from a copy ----------
rem git may replace this very file during an update, and cmd reads a batch
rem file as it goes, so the work runs from a copy in %TEMP%.
if /i "%~1"=="--from-copy" goto copied
rem copies left by windows closed with X; a newer one may still be running
forfiles /p "%TEMP%" /m "molfar-vertep-*.bat" /d -1 /c "cmd /c del /q @path" >nul 2>nul
set "MV_COPY=%TEMP%\molfar-vertep-%RANDOM%%RANDOM%.bat"
copy /y "%~f0" "%MV_COPY%" >nul 2>nul
if errorlevel 1 (
  echo Could not copy the launcher to %TEMP%. Starting from the original instead.
  set "MV_COPY="
  goto copied_direct
)
"%MV_COPY%" --from-copy "%~f0" %*

:copied_direct
set "MV_SELF=%~f0"
set "MV_RUNNING=%~f0"
goto args

:copied
rem %0 moves with shift: keep the running copy's path first
set "MV_RUNNING=%~f0"
set "MV_SELF=%~f2"
shift
shift

rem ---------- options ----------
:args
set "MV_DEV="
set "MV_NOPULL="
set "MV_YES="
set "MV_FULL="
set "MV_TOOLS="
set "MV_SHORTCUT="
:args_loop
if "%~1"=="" goto args_done
if /i "%~1"=="dev" set "MV_DEV=1"
if /i "%~1"=="nopull" set "MV_NOPULL=1"
if /i "%~1"=="yes" set "MV_YES=1"
if /i "%~1"=="-y" set "MV_YES=1"
if /i "%~1"=="rebuild" set "MV_FULL=1"
if /i "%~1"=="tools" set "MV_TOOLS=1"
if /i "%~1"=="shortcut" set "MV_SHORTCUT=1"
shift
goto args_loop
:args_done

rem UTF-8 output, so folder names in any language print correctly
chcp 65001 >nul
title Molfar Vertep
set "MV_REPO=https://github.com/MolfarWav/Molfar.Vertep.git"
set "MV_STATE=%LOCALAPPDATA%\Molfar Vertep"
rem tools this file installs are found without reopening the window
set "PATH=%USERPROFILE%\.bun\bin;%ProgramFiles%\Git\cmd;%PATH%"

rem ---------- where the app is ----------
for %%I in ("%MV_SELF%") do set "MV_HERE=%%~dpI"
if "%MV_HERE:~-1%"=="\" set "MV_HERE=%MV_HERE:~0,-1%"
set "APP=%MV_HERE%"
if exist "%APP%\package.json" if exist "%APP%\src\index.ts" goto app_found
rem (no paths inside parenthesized blocks below: a ")" in a folder name would end them)
set "APP="
if exist "%MV_STATE%\app-path.txt" set /p APP=<"%MV_STATE%\app-path.txt"
if not defined APP goto no_app_yet
if not exist "%APP%\package.json" goto no_app_yet
if not exist "%APP%\src\index.ts" goto no_app_yet
echo This launcher is not in the Molfar Vertep folder; using the one found last time:
echo   %APP%
goto app_found
:no_app_yet
set "APP="

rem ---------- tools ----------
:tools
where git >nul 2>nul
if errorlevel 1 (
  echo === Installing Git, which Molfar Vertep needs ^(winget^)...
  winget install --id Git.Git -e --silent --accept-source-agreements --accept-package-agreements
)
where git >nul 2>nul
if errorlevel 1 (
  echo Git is still not available. Install it from https://git-scm.com, then run this file again.
  goto fail
)
where bun >nul 2>nul
if errorlevel 1 (
  echo === Installing Bun, which Molfar Vertep needs...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
)
where bun >nul 2>nul
if errorlevel 1 (
  echo Bun is still not available. Install it from https://bun.sh, then run this file again.
  goto fail
)
set "MV_BUNV="
for /f "delims=" %%v in ('bun --version 2^>nul') do set "MV_BUNV=%%v"
set "MV_BMAJ=0"
set "MV_BMIN=0"
for /f "tokens=1,2 delims=." %%a in ("%MV_BUNV%") do (
  set "MV_BMAJ=%%a"
  set "MV_BMIN=%%b"
)
set "MV_BUN_OLD="
if %MV_BMAJ% LSS 1 set "MV_BUN_OLD=1"
if %MV_BMAJ% EQU 1 if %MV_BMIN% LSS 4 set "MV_BUN_OLD=1"
if defined MV_BUN_OLD (
  echo Bun %MV_BUNV% is older than 1.4.0, the version Molfar Vertep needs.
  call :ask "Update Bun now"
  if errorlevel 2 (
    echo Molfar Vertep may not install or build with this Bun.
  ) else (
    echo === Updating Bun...
    call bun upgrade
  )
)
if defined MV_TOOLS (
  echo === Checking Git for updates ^(winget^)...
  winget upgrade --id Git.Git -e --silent --accept-source-agreements --accept-package-agreements
  echo === Checking Bun for updates...
  call bun upgrade
)
if defined APP goto app_ready

rem ---------- no app anywhere: download it ----------
set "APP=%MV_HERE%\Molfar-Vertep"
echo Molfar Vertep is not installed next to this file.
echo It can download it into:
echo   %APP%
call :ask "Download Molfar Vertep there"
if errorlevel 2 goto declined
echo === Downloading Molfar Vertep...
git clone "%MV_REPO%" "%APP%"
if errorlevel 1 goto fail
set "MV_FULL=1"
goto app_ready

:app_found
rem the tool checks still run, then come back here
if not defined MV_TOOLS_DONE (
  set "MV_TOOLS_DONE=1"
  goto tools
)

:app_ready
cd /d "%APP%" || goto fail
if not exist "%MV_STATE%" mkdir "%MV_STATE%" >nul 2>nul
>"%MV_STATE%\app-path.txt" echo(%APP%
rem a copy cloned before the repository was renamed follows it under its new name
git remote set-url origin "%MV_REPO%" >nul 2>nul

if defined MV_NOPULL goto deps

rem ---------- updates ----------
echo === Checking for updates...
git fetch --prune --tags --force origin
if errorlevel 1 (
  echo No connection to GitHub: starting the version you have.
  goto deps
)
rem your own changes to the engine's files are never overwritten
git diff --quiet HEAD -- . ":(exclude)bun.lock" ":(exclude)client-agent/bun.lock"
if not errorlevel 1 goto clean
echo Molfar Vertep's own files have local changes, so no update is applied.
echo "git status" in the app folder shows them. Starting the version you have.
goto deps
:clean

set "MV_TARGET="
set "MV_LABEL="
set "MV_BRANCH="
if defined MV_DEV goto pick_branch
for /f "delims=" %%t in ('git tag -l "v*" --sort^=-v:refname') do (
  if not defined MV_TARGET (
    echo %%t| findstr /r /x "v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*" >nul && set "MV_TARGET=%%t"
  )
)
if not defined MV_TARGET (
  echo No release found on GitHub: starting the version you have.
  goto deps
)
set "MV_LABEL=release %MV_TARGET%"
goto compare

:pick_branch
rem the newest work branch (each Claude session makes its own), not upstream ones
for /f "delims=" %%b in ('git for-each-ref "--sort=-committerdate" "--format=%%(refname:lstrip=3)" refs/remotes/origin/claude/') do (
  if not defined MV_BRANCH (
    echo %%b| findstr /b /c:"claude/upstream-" >nul || set "MV_BRANCH=%%b"
  )
)
if not defined MV_BRANCH (
  echo No work branch found on GitHub: starting the version you have.
  goto deps
)
set "MV_TARGET=origin/%MV_BRANCH%"
set "MV_LABEL=branch %MV_BRANCH%"

:compare
set "MV_HEAD="
set "MV_WANT="
for /f "delims=" %%h in ('git rev-parse HEAD') do set "MV_HEAD=%%h"
for /f "delims=" %%h in ('git rev-parse --verify --quiet "%MV_TARGET%^{commit}"') do set "MV_WANT=%%h"
if "%MV_HEAD%"=="%MV_WANT%" (
  echo Up to date: %MV_LABEL%.
  goto deps
)
call :version MV_NOW
set "MV_ON="
for /f "delims=" %%b in ('git symbolic-ref --quiet --short HEAD 2^>nul') do set "MV_ON=%%b"
if defined MV_ON echo You are on branch %MV_ON% ^(Molfar Vertep %MV_NOW%^).
if not defined MV_ON echo Installed: Molfar Vertep %MV_NOW%.
call :ask "Update to %MV_LABEL%"
if errorlevel 2 (
  echo Keeping the version you have.
  goto deps
)
echo === Updating to %MV_LABEL%...
rem bun install rewrites the lock files; they are not ours to keep
git checkout -- bun.lock client-agent/bun.lock 2>nul
rem a launcher copied into the folder by hand would block a version that
rem ships its own: git refuses to overwrite an untracked file
git ls-files --error-unmatch Molfar-Vertep.bat >nul 2>nul
if errorlevel 1 git cat-file -e "%MV_TARGET%:Molfar-Vertep.bat" 2>nul && del /q "Molfar-Vertep.bat" 2>nul
if defined MV_DEV (
  git checkout -B "%MV_BRANCH%" "origin/%MV_BRANCH%"
) else (
  git checkout --quiet --detach "%MV_TARGET%"
)
if errorlevel 1 goto fail
rem a version without this launcher keeps it, so the desktop shortcut still works
if not exist "Molfar-Vertep.bat" copy /y "%MV_RUNNING%" "Molfar-Vertep.bat" >nul 2>nul
set "MV_FULL=1"

rem ---------- install and build only what is needed ----------
:deps
if defined MV_FULL goto install
if not exist "node_modules" goto install
if not exist "client-agent\node_modules" goto install
goto build

:install
echo === Installing packages...
call bun install
if errorlevel 1 goto fail
pushd client-agent
call bun install
if errorlevel 1 (
  popd
  goto fail
)
popd
git checkout -- bun.lock client-agent/bun.lock 2>nul

:build
if defined MV_FULL goto dobuild
if not exist "client\dist\index.html" goto dobuild
if not exist "client-agent\dist\index.html" goto dobuild
goto shortcut

:dobuild
echo === Building the interface...
call bun run build:client
if errorlevel 1 goto fail

rem ---------- desktop shortcut ----------
:shortcut
if defined MV_SHORTCUT goto make_shortcut
if exist "%MV_STATE%\shortcut-asked" goto run
call :ask "Put a Molfar Vertep shortcut on your desktop"
set "MV_NO_SC=%errorlevel%"
>"%MV_STATE%\shortcut-asked" echo asked
if "%MV_NO_SC%"=="2" goto run

:make_shortcut
rem the shortcut opens the launcher inside the app folder, never a stray copy
set "MV_LNK=%MV_SELF%"
if exist "%APP%\Molfar-Vertep.bat" set "MV_LNK=%APP%\Molfar-Vertep.bat"
set "MV_PNG=%APP%\client\public\chrysalis_logo.png"
set "MV_ICO=%MV_STATE%\molfar-vertep.ico"
rem the icon: the logo as a 256 px PNG inside a one-image .ico
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap $env:MV_PNG; $r = New-Object System.Drawing.Bitmap $b, 256, 256; $m = New-Object System.IO.MemoryStream; $r.Save($m, [System.Drawing.Imaging.ImageFormat]::Png); $p = $m.ToArray(); $h = [byte[]](0,0,1,0,1,0,0,0,0,0,1,0,32,0) + [BitConverter]::GetBytes([int]$p.Length) + [BitConverter]::GetBytes([int]22); [System.IO.File]::WriteAllBytes($env:MV_ICO, [byte[]]($h + $p)) } catch {}; " ^
  "try { $d = [Environment]::GetFolderPath('Desktop'); $l = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'Molfar Vertep.lnk')); $l.TargetPath = $env:MV_LNK; $l.WorkingDirectory = $env:APP; $l.Description = 'Start Molfar Vertep'; if (Test-Path $env:MV_ICO) { $l.IconLocation = $env:MV_ICO }; $l.Save() } catch { exit 1 }"
if errorlevel 1 (
  echo Could not create the desktop shortcut. You can still start Molfar Vertep with this file.
) else (
  echo Desktop shortcut: Molfar Vertep.
)

rem ---------- start ----------
:run
call :version MV_NOW
echo === Starting Molfar Vertep %MV_NOW%. Your browser opens by itself.
echo     Keep this window open while you use it; close it or press Ctrl+C to stop.
echo     First start: the link with #setup= creates your account.
rem tells the engine its launcher started it, so it opens the browser
set "CHRYSALIS_LAUNCHER=1"
call bun start
echo.
echo Molfar Vertep stopped.
pause
goto done

:declined
echo Nothing was downloaded.
pause
goto done

:fail
echo.
echo Something went wrong: see the messages above.
pause
set "MV_RC=1"
goto done

rem ---------- helpers ----------
rem :ask "question"  ->  errorlevel 1 = yes, 2 = no. Yes after 20 seconds
rem without an answer, and always with the "yes" option.
:ask
if defined MV_YES exit /b 1
choice /c YN /t 20 /d Y /m "%~1"
exit /b %errorlevel%

rem :version VAR  ->  the version in package.json
:version
set "%~1=?"
for /f "tokens=2 delims=:, " %%v in ('findstr /c:"\"version\"" package.json 2^>nul') do set "%~1=%%~v"
exit /b 0

:done
rem the temporary copy removes itself on the way out
if /i not "%MV_RUNNING%"=="%MV_SELF%" (goto) 2>nul & del "%MV_RUNNING%"
exit /b %MV_RC%

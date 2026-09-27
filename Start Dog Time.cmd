@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node "%~dp0server.js"
) else (
  if exist "%~dp0..\project-hub\runtime\node.exe" (
    "%~dp0..\project-hub\runtime\node.exe" "%~dp0server.js"
  ) else (
    echo Node.js was not found. Please install Node.js, then run this file again.
  )
)
if errorlevel 1 pause

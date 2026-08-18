@echo off
rem Employee Scheduling - portable launcher
rem Keep this window open while using the app. Close this window to stop the app.
title Employee Scheduling
echo Starting Employee Scheduling...
echo The app will open in your browser at http://localhost:8080
start "" /min cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:8080"
"%~dp0employee-scheduling.exe"

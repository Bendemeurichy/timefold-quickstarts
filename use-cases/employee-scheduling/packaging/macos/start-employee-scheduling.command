#!/bin/sh
# Employee Scheduling - portable launcher
# Keep this window open while using the app. Close this window to stop the app.
cd "$(dirname "$0")"
echo "Starting Employee Scheduling..."
echo "The app will open in your browser at http://localhost:8080"
( sleep 3 && open http://localhost:8080 ) &
exec ./employee-scheduling

@echo off
REM Double-click this file (Windows) to install what is needed and start SANCHARA.
cd /d "%~dp0"
set PY=py
where py >nul 2>nul
if errorlevel 1 set PY=python
%PY% -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo Could not install the Python packages. Is Python installed? Get it from https://www.python.org/downloads/
  pause
  exit /b 1
)
echo.
echo Starting SANCHARA...  your browser will open at http://localhost:5000/   (press Ctrl+C here to stop)
start "" http://localhost:5000/
%PY% run_server.py
pause

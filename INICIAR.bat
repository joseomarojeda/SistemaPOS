@echo off
title Punto de Venta - NO CERRAR
cd /d "%~dp0"
set "NODE_EXE="
for %%P in (node.exe) do if not "%%~$PATH:P"=="" set "NODE_EXE=%%~$PATH:P"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE (
  echo Node.js no esta instalado. Abre primero INSTALAR.bat
  pause
  exit /b 1
)

rem Si el sistema ya esta corriendo, solo abre el navegador
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:3000/api/info) | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  start "" http://localhost:3000
  exit /b 0
)

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 3; Start-Process http://localhost:3000"
"%NODE_EXE%" --disable-warning=ExperimentalWarning server.js
echo.
echo El sistema se detuvo. Presiona una tecla para cerrar.
pause >nul

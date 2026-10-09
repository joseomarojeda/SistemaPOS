@echo off
title Instalar Punto de Venta
cd /d "%~dp0"
echo.
echo ==============================================
echo   INSTALACION DEL SISTEMA PUNTO DE VENTA
echo ==============================================
echo.

call :buscar_node
if defined NODE_OK goto node_listo

echo Node.js no esta instalado (o es muy antiguo). Instalando con winget...
echo Si Windows pregunta permisos, acepta.
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
call :buscar_node
if defined NODE_OK goto node_listo
echo.
echo No se pudo instalar Node.js automaticamente.
echo Descargalo de https://nodejs.org (version LTS), instalalo y vuelve a abrir este archivo.
start "" https://nodejs.org/es/download
pause
exit /b 1

:node_listo
echo [OK] Node.js encontrado: %NODE_EXE%

echo.
echo Creando el acceso directo del escritorio y desactivando el inicio automatico...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = New-Object -ComObject WScript.Shell;" ^
  "$dir = [Environment]::GetFolderPath('Desktop');" ^
  "$l = $s.CreateShortcut((Join-Path $dir 'Punto de Venta.lnk'));" ^
  "$l.TargetPath = '%~dp0INICIAR.bat'; $l.WorkingDirectory = '%~dp0';" ^
  "$l.IconLocation = '%SystemRoot%\System32\shell32.dll,43'; $l.WindowStyle = 7; $l.Save();" ^
  "$auto = Join-Path ([Environment]::GetFolderPath('Startup')) 'Punto de Venta.lnk';" ^
  "if (Test-Path -LiteralPath $auto) { Remove-Item -LiteralPath $auto -Force }"
echo [OK] Acceso directo creado; inicio automatico desactivado.

echo.
echo Abriendo el puerto 3000 en el Firewall para que entren celulares y tablets.
echo Windows pedira permiso de administrador: presiona "Si".
powershell -NoProfile -Command "Start-Process cmd -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '/c netsh advfirewall firewall delete rule name=PuntoDeVenta & netsh advfirewall firewall add rule name=PuntoDeVenta dir=in action=allow protocol=TCP localport=3000 profile=any'"
echo [OK] Firewall configurado.

echo.
echo ==============================================
echo   LISTO. El sistema solo iniciara cuando abras
echo   el icono Punto de Venta del escritorio.
echo   PIN administrador: 1234   PIN vendedor: 1111
echo   (cambialos en el menu Usuarios)
echo ==============================================
echo.
pause
exit /b 0

:buscar_node
set "NODE_OK="
set "NODE_EXE="
for %%P in (node.exe) do if not "%%~$PATH:P"=="" set "NODE_EXE=%%~$PATH:P"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE exit /b 0
"%NODE_EXE%" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if not errorlevel 1 set "NODE_OK=1"
exit /b 0

@echo off
rem Opens the game port in Windows Firewall so other PCs on your home/office network can join.
rem Usage: double-click (port 3000), or run  allow-lan.cmd 8080
set PORT=%1
if "%PORT%"=="" set PORT=3000

net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%PORT%' -Verb RunAs"
  exit /b
)

netsh advfirewall firewall delete rule name="Stickman Warfare (TCP %PORT%)" >nul 2>&1
netsh advfirewall firewall add rule name="Stickman Warfare (TCP %PORT%)" dir=in action=allow protocol=TCP localport=%PORT% profile=private,domain
echo.
echo Port %PORT% is open for Private networks.
echo If friends still cannot connect, set your Wi-Fi to "Private" in
echo Settings ^> Network ^& internet ^> Wi-Fi ^> (your network) ^> Network profile type.
echo.
pause

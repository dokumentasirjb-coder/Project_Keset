@echo off
title ERP Usaha Keset (SAK EMKM)
color 0A

echo ========================================================
echo   MEMULAI APLIKASI WEB ERP USAHA KESET (SAK EMKM)
echo ========================================================
echo.

:: 1. Periksa apakah Node.js sudah terpasang
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js belum terpasang di laptop ini!
    echo Silakan unduh dan pasang Node.js terlebih dahulu di:
    echo https://nodejs.org/ (Pilih versi LTS)
    echo.
    pause
    exit /b
)

:: 2. Periksa apakah folder node_modules sudah ada, jika belum lakukan npm install
if not exist "node_modules\" (
    echo [INFO] Menyiapkan modul pertama kali (npm install)...
    call npm install
    echo.
)

:: 3. Jalankan server dan buka browser secara otomatis
echo [INFO] Menjalankan server aplikasi...
echo Aplikasi dapat diakses di: http://localhost:3000
echo.

:: Buka browser setelah jeda 2 detik
start "" http://localhost:3000

:: Jalankan Node.js server
node server.js

pause


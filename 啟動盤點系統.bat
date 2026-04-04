@echo off
title 庫存盤點系統
echo ==========================================
echo    庫存盤點系統 - 本機伺服器
echo ==========================================
echo.
echo 啟動中...
echo 請用瀏覽器開啟: http://localhost:3456
echo.
echo 手機/iPad 同網路下也可以用:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    echo   http://%%a:3456
)
echo.
echo 按 Ctrl+C 停止伺服器
echo ==========================================
start http://localhost:3456
npx serve "%~dp0" -l 3456 --no-clipboard
pause

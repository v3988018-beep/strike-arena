@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Strike Arena — игра через интернет

rem Сервер игры: запускаем в отдельном окне, если он ещё не работает
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if %errorlevel%==0 (
  echo Запускаю сервер игры в отдельном окне...
  start "Strike Arena — сервер" cmd /k python server.py
  timeout /t 3 >nul
) else (
  echo Сервер игры уже работает.
)

echo.
echo ============================================================
echo  Открываю туннель Cloudflare.
echo  Через несколько секунд ниже появится ссылка вида
echo      https://что-то.trycloudflare.com
echo  Отправь её друзьям — по ней они зайдут в игру.
echo.
echo  Ссылка работает, пока открыто это окно. Закрыл окно —
echo  туннель выключен. При следующем запуске ссылка будет новой.
echo  Не выкладывай ссылку в открытый доступ: пароля в игре нет.
echo ============================================================
echo.
tools\cloudflared\cloudflared.exe tunnel --no-autoupdate --url http://localhost:8080
pause

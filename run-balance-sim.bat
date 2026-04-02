@echo off
setlocal

REM Change to script directory (project root)
cd /d "%~dp0"

echo ===== War Drone Balance Simulator =====

REM Check Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js не найден. Установи Node.js с сайта https://nodejs.org/ и запусти скрипт снова.
  pause
  exit /b 1
)

REM Check npm
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm не найден. Проверь установку Node.js.
  pause
  exit /b 1
)

REM Install dependencies if node_modules is missing
if not exist "node_modules" (
  echo [INFO] Зависимости не найдены. Запускаю "npm install"...
  npm install
  if errorlevel 1 (
    echo [ERROR] Ошибка при установке зависимостей.
    pause
    exit /b 1
  )
) else (
  echo [INFO] Зависимости уже установлены.
)

REM Start dev server
REM Kill any process bound to port 5173 (safe best-effort)
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo [INFO] Запускаю веб-симулятор баланса (npm run dev)...
start "War Drone Balance Dev Server" cmd /c "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort > vite-dev.log 2>&1"

REM Ждём, пока сервер действительно поднимется
echo [INFO] Ожидаю ответ от http://127.0.0.1:5173 ...
set "READY=0"
for /L %%i in (1,1,60) do (
  powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/ | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 (
    set "READY=1"
    goto :server_ready
  )
  timeout /t 1 >nul
)

:server_ready
if "%READY%"=="1" (
  start "" "http://127.0.0.1:5173/"
) else (
  echo [ERROR] Сервер не ответил за 60 секунд. Проверь vite-dev.log в корне проекта.
  pause
  exit /b 1
)

echo [OK] Если браузер не открылся, открой http://127.0.0.1:5173 вручную
pause

endlocal
exit /b 0


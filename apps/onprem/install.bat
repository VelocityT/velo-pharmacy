@echo off
REM ═══════════════════════════════════════════════════════════════
REM  Velocare Pharmacy Server — on-site installer
REM  Run once on the hospital's server PC. Requires Docker Desktop.
REM ═══════════════════════════════════════════════════════════════
setlocal

echo.
echo   Velocare Pharmacy Server — installation
echo   ---------------------------------------
echo.

where docker >nul 2>nul
if errorlevel 1 (
  echo   ERROR: Docker is not installed.
  echo   Install Docker Desktop first, then run this again.
  pause & exit /b 1
)

if not exist .env (
  echo   Generating .env with a unique secret for this hospital...
  for /f %%i in ('powershell -NoProfile -Command "[Convert]::ToBase64String((1..48^|%%{Get-Random -Max 256}))"') do set SECRET=%%i
  for /f %%i in ('powershell -NoProfile -Command "[Convert]::ToBase64String((1..18^|%%{Get-Random -Max 256}))"') do set DBPASS=%%i
  (
    echo NODE_MODE=ONPREM_SERVER
    echo NODE_KEY=HOSP-SERVER
    echo DB_PASSWORD=%DBPASS%
    echo DATABASE_URL=postgresql://velocare:%DBPASS%@db:5432/velocare_pharmacy?schema=public
    echo DIRECT_URL=postgresql://velocare:%DBPASS%@db:5432/velocare_pharmacy?schema=public
    echo JWT_SECRET=%SECRET%
    echo SYNC_ENABLED=false
    echo SEQUENCE_BLOCK_SIZE=1000
  ) > .env
  echo   Done. Secrets are unique to this machine.
) else (
  echo   .env already exists — leaving it alone.
)

echo.
echo   Starting database and application...
docker compose up -d
if errorlevel 1 ( echo   ERROR: startup failed. & pause & exit /b 1 )

echo.
echo   Waiting for the database...
timeout /t 20 /nobreak >nul

echo   Applying database schema...
docker compose exec -T app npx prisma migrate deploy

echo.
for /f "tokens=14" %%i in ('ipconfig ^| findstr /c:"IPv4"') do set IP=%%i
echo   ═══════════════════════════════════════════════════
echo    Installed.
echo.
echo    This server:   http://localhost:3000
echo    Counters use:  http://%IP%:3000
echo.
echo    Backups write nightly to the .\backups folder.
echo    Point the hospital's own backup at that folder.
echo   ═══════════════════════════════════════════════════
echo.
pause

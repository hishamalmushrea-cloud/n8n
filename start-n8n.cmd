@echo off
rem n8n offline launcher - place this file NEXT TO the extracted "n8n" folder, then double-click
setlocal
set "DIR=%~dp0"
set "N8N_USER_FOLDER=%N8N_USER_FOLDER%"
if "%N8N_USER_FOLDER%"=="" set "N8N_USER_FOLDER=%USERPROFILE%\.n8n"
set "N8N_SECURE_COOKIE="
set "N8N_DIAGNOSTICS_ENABLED=false"
echo Starting n8n ... editor will be at http://localhost:5678
node "%DIR%n8n\bin\n8n" start
pause

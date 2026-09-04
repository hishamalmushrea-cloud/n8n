@echo off
rem ============================================================
rem  Arena-Blender Link : SETUP (شغّل هذا الملف مرة واحدة فقط)
rem ============================================================
chcp 65001 >nul
setlocal
title Arena-Blender Link Setup

echo ============================================================
echo    Arena - Blender Link : التجهيز (مرة واحدة فقط)
echo ============================================================
echo.

where git >nul 2>nul
if errorlevel 1 (
    echo [X] برنامج git غير مثبت.
    echo     نزّله من: https://git-scm.com/download/win
    echo     ثبّته باعداداته الافتراضية ثم أعد تشغيل هذا الملف.
    pause & exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
    echo [X] برنامج Python غير مثبت.
    echo     نزّله من: https://python.org/downloads
    echo     مهم: فعّل خيار "Add python.exe to PATH" أثناء التثبيت.
    pause & exit /b 1
)

set "REPO=https://github.com/hishamalmushrea-cloud/n8n.git"
set "DEST=%USERPROFILE%\arena-link"

echo [1/3] نسخ ملفات الربط الخفيفة (لن تُنزَّل الحزمة الكبيرة)...
if exist "%DEST%\.git" (
    cd /d "%DEST%"
    git fetch --depth 1 origin arena/01a05efe-n8n
    git reset --hard origin/arena/01a05efe-n8n
) else (
    git clone --depth 1 --branch arena/01a05efe-n8n --filter=blob:none --no-checkout %REPO% "%DEST%" 2>nul
    if not exist "%DEST%\.git" (
        echo     النسخة الخفيفة غير مدعومة في نسختك من git — يتم النسخ العادي...
        git clone --depth 1 --branch arena/01a05efe-n8n %REPO% "%DEST%"
    )
    cd /d "%DEST%"
)

echo [2/3] تفعيل مجلد الربط فقط...
git sparse-checkout set arena-bridge 2>nul
git checkout arena/01a05efe-n8n 2>nul
if not exist "arena-bridge\arena_sync.py" (
    echo [!] تعذر إيجاد ملفات الربط — تأكد من اتصال الإنترنت ثم أعد المحاولة.
    pause & exit /b 1
)

echo [3/3] جاهز! الخطوتان الأخيرتان يدوياً (مرة واحدة فقط):
echo.
echo   أ) ثبت إضافة الجسر في Blender:
echo        1. افتح Blender ثم:  Edit -^> Preferences -^> Add-ons
echo        2. اضغط Install... واختر الملف:
echo           %DEST%\arena-bridge\blender_bridge_addon.py
echo        3. فعّل الخيار "Arena / n8n Bridge" من القائمة.
echo        ^(منذ الآن الجسر يعمل تلقائياً مع كل فتح لبلندر^)
echo.
echo   ب) شغّل وكيل الربط:
echo        انقر مرتين على:  %DEST%\arena-bridge\start-link.cmd
echo        ^(أو شغّل install-autostart.cmd ليعمل تلقائياً مع تشغيل الويندوز^)
echo.
echo   بعدها كل شيء أوتوماتيك: اطلب من الوكيل في المحادثة
echo   "صمم لي بيتاً" وستراه يُبنى مباشرة في Blender !
echo.
echo  ملاحظة: عند أول رفع قد يطلب git تسجيل دخول GitHub — اتبع النافذة.
pause

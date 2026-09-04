@echo off
rem يجعل وكيل Arena-Blender يعمل تلقائياً مع تشغيل الويندوز (مرة واحدة)
chcp 65001 >nul
set "TARGET=%~dp0start-link.cmd"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
powershell -NoProfile -Command ^
 "$ws = New-Object -ComObject WScript.Shell;" ^
 "$s = $ws.CreateShortcut('%STARTUP%\Arena Blender Link.lnk');" ^
 "$s.TargetPath = '%TARGET%';" ^
 "$s.WorkingDirectory = '%~dp0..';" ^
 "$s.WindowStyle = 7;" ^
 "$s.Save()"
if exist "%STARTUP%\Arena Blender Link.lnk" (
    echo تم! الوكيل سيعمل تلقائياً مع كل تشغيل للويندوز ^(بنافذة مصغّرة^).
    echo لإلغائه: احذف الملف "%STARTUP%\Arena Blender Link.lnk"
) else (
    echo تعذّر الإنشاء — شغّل start-link.cmd يدوياً عند الحاجة.
)
pause

@echo off
rem يشغّل وكيل مزامنة Arena-Blender (اترك النافذة مفتوحة)
chcp 65001 >nul
title Arena-Blender Link Agent
cd /d "%~dp0.."
echo ============================================================
echo   Arena-Blender Link Agent يعمل الآن...
echo   - Blender يجب أن يكون مفتوحاً (الإضافة تشغّل الجسر تلقائياً)
echo   - اترك هذه النافذة مفتوحة — تصغيرها لا يضر
echo   للإيقاف: أغلق النافذة
echo ============================================================
python arena-bridge\arena_sync.py
pause

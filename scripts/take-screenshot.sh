#!/bin/bash
# take-screenshot.sh - يأخذ Screenshot + معلومات أداء للـ Arena.ai Vision Review
# جزء من المصنع الكامل Arena.ai ONLY

PROJECT_PATH="${1:-/home/node/android_projects/WaterApp}"
OUTPUT_DIR="/tmp/arena_screenshots"
mkdir -p $OUTPUT_DIR

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SCREENSHOT="$OUTPUT_DIR/screen_$TIMESTAMP.png"
MEMINFO="$OUTPUT_DIR/meminfo_$TIMESTAMP.txt"
LOGCAT="$OUTPUT_DIR/logcat_$TIMESTAMP.txt"
BUILD_INFO="$OUTPUT_DIR/build_$TIMESTAMP.txt"

echo "=== Taking Screenshot + Performance Info ==="

# 1. Screenshot من Emulator/Device
if command -v adb &> /dev/null; then
  adb devices | grep -q "device$"
  if [ $? -eq 0 ]; then
    echo "📸 Taking screenshot..."
    adb exec-out screencap -p > "$SCREENSHOT" 2>/dev/null
    if [ -f "$SCREENSHOT" ]; then
      echo "✅ Screenshot: $SCREENSHOT ($(du -h $SCREENSHOT | cut -f1))"
    else
      echo "⚠️ Screenshot failed"
    fi

    echo "📊 Getting meminfo..."
    adb shell dumpsys meminfo com.example.app 2>/dev/null | head -n 100 > "$MEMINFO" || adb shell dumpsys meminfo | head -n 100 > "$MEMINFO"

    echo "📝 Getting logcat (last 200 lines)..."
    adb logcat -d -t 200 > "$LOGCAT" 2>/dev/null || echo "No logcat" > "$LOGCAT"

    echo "📦 APK info..."
    APK_PATH="$PROJECT_PATH/app/build/outputs/apk/debug/app-debug.apk"
    if [ -f "$APK_PATH" ]; then
      ls -lh "$APK_PATH" > "$BUILD_INFO"
      echo "APK Size: $(du -h $APK_PATH | cut -f1)" >> "$BUILD_INFO"
      # Build time from log
      cat /tmp/android_logs/build.log 2>/dev/null | tail -n 20 >> "$BUILD_INFO"
    fi

  else
    echo "⚠️ No device/emulator connected, creating placeholder"
    echo "No device connected at $TIMESTAMP" > "$SCREENSHOT.txt"
  fi
else
  echo "⚠️ ADB not found"
fi

# 2. أنشئ JSON للـ n8n + Arena.ai
cat > /tmp/screenshot_info.json <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "screenshot": "$SCREENSHOT",
  "meminfo": "$MEMINFO",
  "logcat": "$LOGCAT",
  "build_info": "$BUILD_INFO",
  "project": "$PROJECT_PATH",
  "has_device": $(adb devices 2>/dev/null | grep -q "device$" && echo true || echo false)
}
EOF

echo "=== Screenshot Info ==="
cat /tmp/screenshot_info.json
ls -lh $OUTPUT_DIR/ | tail -n 10

# 3. انسخ آخر Screenshot كـ latest للـ Dashboard
cp "$SCREENSHOT" "$OUTPUT_DIR/latest.png" 2>/dev/null || true
cp /tmp/screenshot_info.json "$OUTPUT_DIR/latest.json" 2>/dev/null || true

echo "✅ Done - Latest: $OUTPUT_DIR/latest.png"

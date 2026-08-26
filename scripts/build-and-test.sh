#!/bin/bash
# Script يشغله n8n عبر Execute Command Node
# يبني مشروع اندرويد ويكتشف الأخطاء

PROJECT_PATH="$1"  # مثلا /home/node/android_projects/MyApp
LOG_DIR="/tmp/android_logs"
mkdir -p $LOG_DIR

echo "=== Starting Build for $PROJECT_PATH at $(date) ===" | tee $LOG_DIR/build.log

cd "$PROJECT_PATH" || exit 1

# 1. Clean previous build
./gradlew clean >> $LOG_DIR/build.log 2>&1

# 2. Build Debug APK
./gradlew assembleDebug --stacktrace --info > $LOG_DIR/build_full.log 2>&1
BUILD_EXIT_CODE=$?

cat $LOG_DIR/build_full.log | tail -n 200 > $LOG_DIR/build.log

if [ $BUILD_EXIT_CODE -ne 0 ]; then
  echo "BUILD_FAILED"
  # استخراج أهم خطأ
  grep -A 10 "FAILED\|error:\|Exception" $LOG_DIR/build_full.log | head -n 50 > $LOG_DIR/error_summary.txt
  cat $LOG_DIR/error_summary.txt
  exit 1
fi

echo "BUILD_SUCCESS"

# 3. Run Unit Tests
./gradlew testDebugUnitTest > $LOG_DIR/test.log 2>&1
TEST_EXIT_CODE=$?
if [ $TEST_EXIT_CODE -ne 0 ]; then
  echo "TESTS_FAILED"
  grep -A 5 "FAILED" $LOG_DIR/test.log | head -n 100
else
  echo "TESTS_PASSED"
fi

# 4. Install on Emulator/Device if available
if command -v adb &> /dev/null; then
  adb devices | grep -q "device$"
  if [ $? -eq 0 ]; then
    echo "DEVICE_FOUND - Installing..."
    adb install -r app/build/outputs/apk/debug/app-debug.apk > $LOG_DIR/adb.log 2>&1
    adb shell am start -n com.example.myapp/.MainActivity >> $LOG_DIR/adb.log 2>&1
    sleep 5
    adb exec-out screencap -p > $LOG_DIR/screenshot.png
    echo "SCREENSHOT_TAKEN: $LOG_DIR/screenshot.png"
    adb logcat -d -t 200 > $LOG_DIR/logcat.txt
  else
    echo "NO_DEVICE_CONNECTED"
  fi
fi

# 5. Output JSON for n8n
cat <<EOF
{
  "build_status": "$([ $BUILD_EXIT_CODE -eq 0 ] && echo "success" || echo "failed")",
  "test_status": "$([ $TEST_EXIT_CODE -eq 0 ] && echo "passed" || echo "failed")",
  "build_log_path": "$LOG_DIR/build.log",
  "error_summary_path": "$LOG_DIR/error_summary.txt",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

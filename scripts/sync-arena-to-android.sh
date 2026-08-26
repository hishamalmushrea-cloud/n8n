#!/bin/bash
# sync-arena-to-android.sh
# ينسخ ملفات Arena.ai إلى مجلد Android Studio
# يعتمد 100% على Arena.ai فقط

ARENA_OUTPUT_DIR="${1:-/tmp/arena_output}"
ANDROID_PROJECT_PATH="${2:-/home/node/android_projects/MyApp}"

echo "=== Syncing Arena.ai output to Android Studio ==="
echo "From: $ARENA_OUTPUT_DIR"
echo "To: $ANDROID_PROJECT_PATH"

mkdir -p "$ANDROID_PROJECT_PATH"

# 1. لو فيه ZIP files من Arena.ai، فك ضغطها
for zip in "$ARENA_OUTPUT_DIR"/*.zip; do
  if [ -f "$zip" ]; then
    echo "Unzipping $zip..."
    unzip -o "$zip" -d "$ANDROID_PROJECT_PATH" 2>&1 | tail -n 20
  fi
done

# 2. انسخ كل الملفات المستخرجة (التي استخرجها arena-pure.js من النص)
# arena-pure.js يحفظ الملفات بهيكلها الصحيح داخل /tmp/arena_output
if [ -d "$ARENA_OUTPUT_DIR/app" ]; then
  echo "Copying app/ folder..."
  cp -r "$ARENA_OUTPUT_DIR/app" "$ANDROID_PROJECT_PATH/" 2>&1
fi

# انسخ كل ملف يحمل هيكل Android
find "$ARENA_OUTPUT_DIR" -type f \( -name "*.kt" -o -name "*.java" -o -name "*.xml" -o -name "*.gradle" -o -name "*.kts" -o -name "*.properties" \) | while read file; do
  # احسب المسار النسبي
  rel_path=$(echo "$file" | sed "s|$ARENA_OUTPUT_DIR/||")
  
  # لو المسار يحتوي على app/src أو build.gradle، انسخه
  if [[ "$rel_path" == app/* ]] || [[ "$rel_path" == *"build.gradle"* ]] || [[ "$rel_path" == *"settings.gradle"* ]] || [[ "$rel_path" == *"AndroidManifest"* ]] || [[ "$rel_path" == "gradle"* ]]; then
    dest="$ANDROID_PROJECT_PATH/$rel_path"
    mkdir -p "$(dirname "$dest")"
    cp "$file" "$dest"
    echo "Copied: $rel_path"
  fi
done

# 3. تأكد من وجود ملفات أساسية
if [ ! -f "$ANDROID_PROJECT_PATH/settings.gradle.kts" ] && [ ! -f "$ANDROID_PROJECT_PATH/settings.gradle" ]; then
  echo "WARNING: settings.gradle not found, creating minimal one"
  cat > "$ANDROID_PROJECT_PATH/settings.gradle.kts" <<'EOF'
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "MyApp"
include(":app")
EOF
fi

if [ ! -f "$ANDROID_PROJECT_PATH/build.gradle.kts" ] && [ ! -f "$ANDROID_PROJECT_PATH/build.gradle" ]; then
  cat > "$ANDROID_PROJECT_PATH/build.gradle.kts" <<'EOF'
// Top-level build file
plugins {
    id("com.android.application") version "8.2.0" apply false
    id("org.jetbrains.kotlin.android") version "1.9.10" apply false
}
EOF
fi

# 4. اجعل gradlew قابل للتنفيذ
chmod +x "$ANDROID_PROJECT_PATH/gradlew" 2>/dev/null || true

echo "=== Sync Complete ==="
echo "Files in project:"
find "$ANDROID_PROJECT_PATH" -type f -name "*.kt" | head -n 20
ls -lh "$ANDROID_PROJECT_PATH/app/build.gradle"* 2>&1 | head -n 5

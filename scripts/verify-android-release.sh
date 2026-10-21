#!/usr/bin/env bash
# Verify every release APK against the intended key before publishing any of them.
set -euo pipefail
apk_dir=${1:?APK directory required}
keystore=${2:?Release keystore required}
alias_name=${3:?Key alias required}
: "${ANDROID_KEYSTORE_PASSWORD:?Keystore password required}"
: "${ANDROID_HOME:?Android SDK required}"
java_bin=${JAVA_HOME:+$JAVA_HOME/bin/}java
keytool_bin=${JAVA_HOME:+$JAVA_HOME/bin/}keytool
build_tools="$ANDROID_HOME/build-tools/35.0.0"
expected=$("$keytool_bin" -exportcert -keystore "$keystore" -alias "$alias_name" \
  -storepass:env ANDROID_KEYSTORE_PASSWORD | sha256sum | cut -d ' ' -f 1)
mapfile -d '' apks < <(find "$apk_dir" -path '*/release/*.apk' -print0)
if ((${#apks[@]} == 0)); then
  echo "No release APKs found" >&2
  exit 1
fi
for apk in "${apks[@]}"; do
  signatures=$("$java_bin" -jar "$build_tools/lib/apksigner.jar" verify --verbose --print-certs "$apk")
  if grep -Eq '^Signer #[0-9]+ certificate DN: .*CN=Android Debug' <<< "$signatures"; then
    echo "Refusing an Android debug signing certificate: $apk" >&2
    exit 1
  fi
  actual=$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<< "$signatures")
  if [[ "$actual" != "$expected" ]]; then
    echo "Unexpected signing certificate: $apk" >&2
    exit 1
  fi
  badging=$("$build_tools/aapt" dump badging "$apk")
  if grep -q '^application-debuggable' <<< "$badging"; then
    echo "Refusing a debuggable APK: $apk" >&2
    exit 1
  fi
  if ! grep -q "^package: name='com.wave.desktop'" <<< "$badging"; then
    echo "Unexpected application ID: $apk" >&2
    exit 1
  fi
  echo "Verified release: $(basename "$apk") ($(du -h "$apk" | cut -f1))"
done

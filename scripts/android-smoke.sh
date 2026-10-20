#!/usr/bin/env bash
set -euo pipefail
apk=${1:?APK required}
api=${2:?API level required}
package=com.wave.desktop
capture() {
  adb logcat -d > "boot-api${api}.log" || true
  adb exec-out screencap -p > "boot-api${api}.png" || true
}
trap capture EXIT
adb install -r "$apk"
adb shell am force-stop "$package"
adb logcat -c
adb shell am start -W -n "$package/.MainActivity"
initial_pid=""
for attempt in {1..15}; do
  initial_pid=$(adb shell pidof "$package" | tr -d '\r' || true)
  if test -n "$initial_pid"; then break; fi
  sleep 2
done
test -n "$initial_pid"
# Require the same process to survive startup, rather than only finding a PID once.
for sample in {1..6}; do
  sleep 5
  current_pid=$(adb shell pidof "$package" | tr -d '\r' || true)
  test "$current_pid" = "$initial_pid"
done
adb logcat -b crash -d > "boot-api${api}-crash.log"
if grep -Eq 'Process: com\.wave\.desktop|>>> com\.wave\.desktop <<<' "boot-api${api}-crash.log"; then
  echo "Wave crashed during smoke test" >&2
  exit 1
fi

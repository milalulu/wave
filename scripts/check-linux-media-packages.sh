#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

bundle=$(realpath "${1:-src-tauri/target/release/bundle}")
deb=("$bundle"/deb/*.deb)
rpm=("$bundle"/rpm/*.rpm)
appimage=("$bundle"/appimage/*.AppImage)
if (( ${#deb[@]} != 1 || ${#rpm[@]} != 1 || ${#appimage[@]} != 1 )); then
  echo "Expected one DEB, one RPM and one AppImage in $bundle" >&2
  exit 1
fi

dependencies=$(dpkg-deb --field "${deb[0]}" Depends | tr ',' '\n' | sed 's/^ *//; s/ *$//')
for package in gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav; do
  grep -Fx "$package" <<< "$dependencies"
done

# Verify that a clean Fedora install gets the required plugins via RPM metadata.
docker run --rm -v "$bundle/rpm:/packages:ro" fedora:44 bash -euc '
  dnf install -y --setopt=install_weak_deps=False /packages/*.rpm
  rpm -q gstreamer1-plugins-base gstreamer1-plugins-good gstreamer1-plugins-bad-free gstreamer1-plugin-libav
  gst-inspect-1.0 hlsdemux2 >/dev/null || gst-inspect-1.0 hlsdemux >/dev/null
  for element in avdec_aac opusdec mpg123audiodec qtdemux; do
    gst-inspect-1.0 "$element" >/dev/null
  done
'

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
cd "$scratch"
"${appimage[0]}" --appimage-extract 'usr/lib/gstreamer-1.0/*' >/dev/null
plugins=squashfs-root/usr/lib/gstreamer-1.0
test -s "$plugins/libgsthls.so" || test -s "$plugins/libgstadaptivedemux2.so"
test -s "$plugins/libgstlibav.so"
test -s "$plugins/libgstopus.so"
test -s "$plugins/libgstmpg123.so"
echo 'Linux packages include the HLS media dependencies.'

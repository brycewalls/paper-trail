#!/usr/bin/env bash
# Builds an unsigned PaperTrail.ipa for sideloading with SideStore (free Apple ID). SideStore signs
# it on the phone with Bryce's own certificate, so nothing here needs a team or a certificate.
#   bash tools/build_ipa.sh            -> ios/build/PaperTrail.ipa
#   OUT=dist bash tools/build_ipa.sh   -> dist/PaperTrail.ipa
# Needs Xcode and XcodeGen (brew install xcodegen). Outputs are gitignored.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS="$ROOT/ios"
BUILD="$IOS/build"
OUT="${OUT:-$BUILD}"
case "$OUT" in /*) ;; *) OUT="$ROOT/$OUT" ;; esac
ARCHIVE="$BUILD/PaperTrail.xcarchive"
DERIVED="${DERIVED_DATA:-$BUILD/DerivedData}"

cd "$IOS"
xcodegen --quiet
rm -rf "$ARCHIVE" "$BUILD/Payload"
mkdir -p "$BUILD" "$OUT"

xcodebuild archive \
  -project PaperTrail.xcodeproj \
  -scheme PaperTrail \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  | grep -E "error:|warning: |ARCHIVE (SUCCEEDED|FAILED)" || true

APP="$ARCHIVE/Products/Applications/PaperTrail.app"
[ -d "$APP" ] || { echo "Archive failed: no PaperTrail.app in $ARCHIVE" >&2; exit 1; }

mkdir -p "$BUILD/Payload"
cp -R "$APP" "$BUILD/Payload/"
rm -f "$OUT/PaperTrail.ipa"
(cd "$BUILD" && /usr/bin/zip -qry "$OUT/PaperTrail.ipa" Payload)
rm -rf "$BUILD/Payload"

echo "Built $OUT/PaperTrail.ipa ($(du -h "$OUT/PaperTrail.ipa" | cut -f1))"

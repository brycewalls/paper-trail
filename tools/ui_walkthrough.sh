#!/usr/bin/env bash
# Runs the XCUITest walk-through (ios/PaperTrailUITests, scheme PaperTrailUI) in light and then
# dark mode on its own simulator, and writes every screenshot to dist/qa/ as <name>-<light|dark>.png.
# The screenshots are also attached to the result bundles (dist/qa/ui-light.xcresult, ui-dark.xcresult).
#
#   bash tools/ui_walkthrough.sh            # both appearances
#   APPEARANCES=dark bash tools/ui_walkthrough.sh
#   OUT=dist/qa-r2 bash tools/ui_walkthrough.sh
#
# Needs Xcode and XcodeGen. Creates a throwaway "PT UI walkthrough" iPhone 18 Pro Max simulator
# and deletes it at the end.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-dist/qa}"
case "$OUT" in /*) ;; *) OUT="$ROOT/$OUT" ;; esac
APPEARANCES="${APPEARANCES:-light dark}"
DEVICE_TYPE="${DEVICE_TYPE:-iPhone 18 Pro Max}"
DERIVED="${DERIVED:-$ROOT/ios/build/ui-walkthrough}"

mkdir -p "$OUT"
cd "$ROOT/ios"
xcodegen --quiet

UDID="$(xcrun simctl create "PT UI walkthrough" "$DEVICE_TYPE")"
cleanup() {
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
  xcrun simctl delete "$UDID" >/dev/null 2>&1 || true
}
trap cleanup EXIT
xcrun simctl boot "$UDID"

xcodebuild build-for-testing -scheme PaperTrailUI -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath "$DERIVED" -quiet

status=0
for look in $APPEARANCES; do
  xcrun simctl ui "$UDID" appearance "$look"
  rm -rf "$OUT/ui-$look.xcresult"
  TEST_RUNNER_PT_APPEARANCE="$look" TEST_RUNNER_PT_SHOTS_DIR="$OUT" \
    xcodebuild test-without-building -scheme PaperTrailUI -destination "platform=iOS Simulator,id=$UDID" \
    -derivedDataPath "$DERIVED" -resultBundlePath "$OUT/ui-$look.xcresult" || status=$?
done

echo "Screenshots: $OUT"
exit $status

#!/bin/sh
# $BROWSER for the E2E run (Linux): xdg-open hands web links here. Report the URL to the mock server
# (so a test can see what Flo opened) and, for pages on the mock itself, fetch them like a browser.
url="$1"
curl -s -m 5 -G --data-urlencode "url=$url" "$FLO_E2E_MOCK/__e2e/open" >/dev/null 2>&1
case "$url" in
  "$FLO_E2E_MOCK"/*) curl -s -m 5 "$url" >/dev/null 2>&1 ;;
esac
exit 0

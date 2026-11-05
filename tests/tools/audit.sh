#!/usr/bin/env bash
# The full audit: every server suite, every browser suite against fresh
# Domebox and Lite servers, the website package, both click-through crawls,
# every website page, secrets, and nothing lost since BASE.
#   bash tests/tools/audit.sh [base-commit]
BASE=${1:-HEAD~1}
cd "$(dirname "$0")/.." || exit 1
L=$(mktemp -d)
for f in $(ls *-test.js lint-codegs.js | grep -v -- "-ui-test\|^ui-test\|netlify-package-test\|recurring-test"); do
  timeout 300 node "$f" > "$L/srv-$f.log" 2>&1 || echo "FAILED $f: $(grep -m3 FAIL "$L/srv-$f.log")"
done
echo "server: $(ls "$L"/srv-*.log | wc -l) suites, $(cat "$L"/srv-*.log | grep -hE '^[0-9]+ passed, [0-9]+ failed' | awk '{p+=$1; f+=$3} END {print p" passed, "f" failed"}')"
LITE_ENV="DBX_CODE=$PWD/../dist/lite/Code.gs DBX_HTML=$PWD/../dist/lite-upload/index.html DBX_SITE=$PWD/../dist/lite-upload"
(nohup node server.js > /dev/null 2>&1 &)
(env DBX_PORT=8096 $LITE_ENV nohup node server.js > /dev/null 2>&1 &)
sleep 3
for t in $(ls *ui-test.js | sed 's/\.js$//'); do
  timeout 400 node "$t.js" > "$L/$t.log" 2>&1 || echo "FAILED $t: $(grep FAIL "$L/$t.log" | head -3)"
done
echo "browser: $(ls "$L"/*ui-test.log | wc -l) suites, $(grep -hE '^[0-9]+ passed, [0-9]+ failed' "$L"/*ui-test.log | awk '{p+=$1; f+=$3} END {print p" passed, "f" failed"}')"
timeout 300 node netlify-package-test.js > "$L/netpkg.log" 2>&1; echo "website package: $(grep -E '^[0-9]+ passed' "$L/netpkg.log")"
echo "crawl domebox: $(timeout 600 node tools/crawl.js 2>&1 | tail -1)"
(env DBX_PORT=8099 $LITE_ENV nohup node server.js > /dev/null 2>&1 &)
sleep 3
echo "crawl lite: $(PORT=8099 LITE=1 timeout 600 node tools/crawl.js 2>&1 | tail -1)"
(cd ../dist/netlify-upload && nohup python3 -m http.server 8097 > /dev/null 2>&1 &)
(cd ../dist/lite-upload && nohup python3 -m http.server 8098 > /dev/null 2>&1 &)
sleep 2
echo "website pages: $(timeout 300 node tools/site.js 2>&1 | tail -2 | tr '\n' ' ')"
echo "secrets in repo: $(cd .. && git grep -c '4fc67c60\|6cb63d3f' | wc -l)"
node tools/lost.js "$BASE" | tail -1
echo "logs: $L"
echo AUDITDONE

#!/bin/bash
# The whole rules audit, in one command.
#
# Every file here checks the system against the rules written out in words at
# the top of that file - never against what the code happens to do, and never
# on a clean full month, because clean data hides the faults that cost money.
#
#   ./run-audit.sh [base-url]
#
# base-url is a workspace serving index.html and /exec; it defaults to
# http://127.0.0.1:8101. Run it against a TEST workspace, never the live
# sheet: these files write employees, attendance, leave and payroll rows.

BASE="${1:-http://127.0.0.1:8101}"
cd "$(dirname "$0")" || exit 1

echo "auditing $BASE"
echo

pass=0; fail=0; failed=""
for t in payroll-rules payroll-tabs attendance-rules leave-rules policy-rules \
         request-punch-rules latemark-punch-rules permissions consistency browse lock-contention; do
  printf '  %-24s ' "$t"
  out=$(node "$t.test.js" "$BASE" 2>&1); code=$?
  if [ $code -eq 0 ]; then
    pass=$((pass+1)); echo "ok"
  else
    fail=$((fail+1)); failed="$failed $t"
    echo "FAILED"
    echo "$out" | grep -E '\*\*' | sed 's/^/      /'
  fi
done

# One more, written as a module because it drives the page as well as the API.
printf '  %-24s ' "legacy-bonus"
out=$(node legacy-bonus.test.mjs "$BASE" 2>&1); code=$?
if [ $code -eq 0 ]; then pass=$((pass+1)); echo "ok"
else fail=$((fail+1)); failed="$failed legacy-bonus"; echo "FAILED"
  echo "$out" | grep -E '\*\*' | sed 's/^/      /'
fi

echo
if [ $fail -eq 0 ]; then
  echo "all $pass checks passed - every figure matched the rule as written"
else
  echo "passed $pass, FAILED $fail:$failed"
  echo "run one on its own to see the whole table, e.g."
  echo "  node${failed%% *}.test.js $BASE" | sed 's/node/node /'
fi
exit $fail

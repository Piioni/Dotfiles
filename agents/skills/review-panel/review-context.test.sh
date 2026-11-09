#!/usr/bin/env bash
# Run: bash review-context.test.sh  (prints FAIL lines, exits 1 on any failure)
script="$(cd "$(dirname "$0")" && pwd)/review-context.sh"
fail=0
ok() { [[ $1 == 0 ]] || { echo "FAIL: $2"; fail=1; }; }

repo=$(mktemp -d); cd "$repo" || exit 1
git init -q . && git config user.email t@t && git config user.name t
echo one > a.txt && git add . && git commit -qm base
echo two >> a.txt && git add . && git commit -qm "change a" -m "why: body text"

f=$("$script" HEAD~1 HEAD); ok $? "script runs on a valid range"
grep -q '^+two' "$f"; ok $? "patch present"
grep -q 'why: body text' "$f"; ok $? "commit body present"
grep -q "^range: $(git rev-parse HEAD~1)..$(git rev-parse HEAD)" "$f"; ok $? "range resolved to SHAs"
grep -q TRUNCATED "$f"; [[ $? != 0 ]]; ok $? "no truncation marker when small"

full=$(stat -c%s "$f")
f=$(REVIEW_CONTEXT_MAX_BYTES=60 "$script" HEAD~1 HEAD)
grep -q '^## TRUNCATED' "$f"; ok $? "truncation marker when over cap"
[[ $(stat -c%s "$f") -lt $full ]]; ok $? "file is actually cut, not just marked"

"$script" nope HEAD >/dev/null 2>&1; [[ $? != 0 ]]; ok $? "bad BASE fails"
"$script" HEAD~1 nope >/dev/null 2>&1; [[ $? != 0 ]]; ok $? "bad HEAD fails"

rm -rf "$repo"
[[ $fail == 0 ]] && echo "all ok"
exit $fail

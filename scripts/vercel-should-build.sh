#!/usr/bin/env bash
# Vercel Ignored Build Step: 0 skips the build; 1 builds it.
# Compare with the last successful deployment, not HEAD^: a failed deployment
# must not cause a later documentation commit to hide pending application code.
set -u

PREVIOUS_SHA="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [[ ! "$PREVIOUS_SHA" =~ ^[0-9a-f]{40}$ ]] \
  || ! git cat-file -e "${PREVIOUS_SHA}^{commit}" 2>/dev/null \
  || ! git merge-base --is-ancestor "$PREVIOUS_SHA" HEAD; then
  echo "最後に成功した配信コミットを安全に確認できないためビルドします"
  exit 1
fi

git diff --quiet "$PREVIOUS_SHA" HEAD --
DIFF_STATUS=$?
if [ "$DIFF_STATUS" -ne 1 ]; then
  echo "差分なし、または差分を確認できないためビルドします"
  exit 1
fi

# Only files known not to affect the deployed application may skip a build.
# Build scripts other than this pre-build guard are deliberately excluded.
SAFE_TO_SKIP='^(\.github/|docs/|e2e/|supabase/migrations/|[^/]+\.md$|src/.*/__tests__/|src/.*\.test\.tsx?$|scripts/vercel-should-build\.sh$)'
CHANGED_COUNT=0
UNSAFE_PATH=''
while IFS= read -r -d '' path; do
  CHANGED_COUNT=$((CHANGED_COUNT + 1))
  if [[ ! "$path" =~ $SAFE_TO_SKIP ]]; then
    UNSAFE_PATH="$path"
    break
  fi
done < <(git diff --no-renames --name-only -z "$PREVIOUS_SHA" HEAD --)

if [ "$CHANGED_COUNT" -eq 0 ] || [ -n "$UNSAFE_PATH" ]; then
  echo "配信物に影響する変更または不明な差分があるためビルドします"
  exit 1
fi

echo "前回の成功配信以降、配信物に影響しない変更のみのためビルドをスキップします"
exit 0

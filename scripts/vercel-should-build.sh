#!/usr/bin/env bash
# Vercel Ignored Build Step: 0 skips the build; 1 builds it.
# Compare with the last successful deployment, not HEAD^: a failed deployment
# must not cause a later documentation commit to hide pending application code.
set -u

PREVIOUS_SHA="${VERCEL_GIT_PREVIOUS_SHA:-}"
HISTORY_FETCH=no
GITHUB_COMPARE=no
CHANGED_LIST=''
trap 'rm -f "$CHANGED_LIST"' EXIT
if [ "${VERCEL_ENV:-}" = preview ] && { [[ ! "$PREVIOUS_SHA" =~ ^[0-9a-f]{40}$ ]] \
  || ! git cat-file -e "${PREVIOUS_SHA}^{commit}" 2>/dev/null \
  || ! git merge-base --is-ancestor "$PREVIOUS_SHA" HEAD; }; then
  # Vercel leaves PREVIOUS_SHA empty on a branch's first preview. It can also
  # refer to an unrelated commit after a branch rebase. In either case compare
  # with the actual live application revision instead of assuming main deployed:
  # main may contain application commits whose production deployment failed.
  LIVE_VERSION="$(curl --fail --silent --show-error --max-time 5 \
    https://carelink-jp.com/api/health 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const v=JSON.parse(s).version;if(typeof v==="string"&&/^[0-9a-f]{7}$/.test(v))process.stdout.write(v)}catch{}})' \
    2>/dev/null)"
  if [[ "$LIVE_VERSION" =~ ^[0-9a-f]{7}$ ]] \
    && { git fetch --quiet --no-tags --deepen=200 origin "$(git rev-parse HEAD)" >/dev/null 2>&1 \
      || git fetch --quiet --no-tags --deepen=200 https://github.com/jimuin0/carelink.git "$(git rev-parse HEAD)" >/dev/null 2>&1; }; then
    HISTORY_FETCH=yes
    # A short hash is accepted only when it identifies exactly one fetched
    # commit. Missing history, network failure, or ambiguity means build.
    MATCHES="$(git rev-list HEAD | grep -E "^${LIVE_VERSION}[0-9a-f]{33}$" || true)"
    if [ "$(printf '%s\n' "$MATCHES" | grep -c .)" -eq 1 ]; then
      PREVIOUS_SHA="$MATCHES"
    fi
  fi
  HEAD_SHA="$(git rev-parse HEAD 2>/dev/null)"
  if [[ "$LIVE_VERSION" =~ ^[0-9a-f]{7}$ ]] && [[ "$HEAD_SHA" =~ ^[0-9a-f]{40}$ ]] \
    && { [[ ! "$PREVIOUS_SHA" =~ ^[0-9a-f]{40}$ ]] \
      || ! git cat-file -e "${PREVIOUS_SHA}^{commit}" 2>/dev/null \
      || ! git merge-base --is-ancestor "$PREVIOUS_SHA" HEAD; }; then
    # On Vercel the history fetch above fails on a branch's first preview
    # (measured 2026-10-29: 履歴取得=no), so docs-only branches still built.
    # Ask GitHub to compare the live revision with this exact commit instead.
    # Anything incomplete, truncated, diverged or unreachable means build.
    GITHUB_COMPARE=failed
    CHANGED_LIST="$(mktemp)"
    if curl --fail --silent --show-error --max-time 10 \
      -H 'Accept: application/vnd.github+json' \
      "https://api.github.com/repos/jimuin0/carelink/compare/${LIVE_VERSION}...${HEAD_SHA}" 2>/dev/null \
      | node -e '
        const [live, head] = process.argv.slice(1);
        let s = "";
        process.stdin.on("data", (c) => { s += c; });
        process.stdin.on("end", () => {
          try {
            const r = JSON.parse(s);
            const base = r.base_commit && r.base_commit.sha;
            const commits = Array.isArray(r.commits) ? r.commits : [];
            const files = Array.isArray(r.files) ? r.files : [];
            // GitHub lists at most 250 commits and 300 files per comparison.
            if (r.status !== "ahead" || typeof base !== "string" || !/^[0-9a-f]{40}$/.test(base)
              || !base.startsWith(live) || !r.merge_base_commit || r.merge_base_commit.sha !== base
              || !Number.isInteger(r.total_commits) || r.total_commits < 1
              || r.total_commits !== commits.length || commits.length >= 250
              || commits[commits.length - 1].sha !== head
              || files.length < 1 || files.length >= 300) process.exit(1);
            const paths = [];
            for (const f of files) {
              // A rename counts as both paths, like git diff --no-renames.
              for (const key of ["filename", "previous_filename"]) {
                if (key === "previous_filename" && f[key] === undefined) continue;
                if (typeof f[key] !== "string" || !f[key] || f[key].includes("\0")) process.exit(1);
                paths.push(f[key]);
              }
            }
            process.stdout.write(paths.map((p) => p + "\0").join(""));
          } catch {
            process.exit(1);
          }
        });
      ' "$LIVE_VERSION" "$HEAD_SHA" > "$CHANGED_LIST" 2>/dev/null; then
      GITHUB_COMPARE=yes
    fi
  fi
fi

if [ "$GITHUB_COMPARE" != yes ]; then
  if [[ ! "$PREVIOUS_SHA" =~ ^[0-9a-f]{40}$ ]] \
    || ! git cat-file -e "${PREVIOUS_SHA}^{commit}" 2>/dev/null \
    || ! git merge-base --is-ancestor "$PREVIOUS_SHA" HEAD; then
    echo "判定情報: 環境=${VERCEL_ENV:-unset} SHA文字数=${#PREVIOUS_SHA} 公開版取得=$([ -n "${LIVE_VERSION:-}" ] && echo yes || echo no) 履歴取得=$HISTORY_FETCH 履歴照合=$([ -n "${MATCHES:-}" ] && echo yes || echo no) GitHub照合=$GITHUB_COMPARE"
    echo "最後に成功した配信コミットを安全に確認できないためビルドします"
    exit 1
  fi

  git diff --quiet "$PREVIOUS_SHA" HEAD --
  DIFF_STATUS=$?
  if [ "$DIFF_STATUS" -ne 1 ]; then
    echo "差分なし、または差分を確認できないためビルドします"
    exit 1
  fi

  CHANGED_LIST="${CHANGED_LIST:-$(mktemp)}"
  if ! git diff --no-renames --name-only -z "$PREVIOUS_SHA" HEAD -- > "$CHANGED_LIST"; then
    echo "差分を確認できないためビルドします"
    exit 1
  fi
fi

# Only files known not to affect the deployed application may skip a build.
# Build scripts other than this pre-build guard are deliberately excluded.
SAFE_TO_SKIP='^(\.github/|docs/|e2e/|supabase/migrations/|[^/]+\.md$|src/.*/__tests__/|src/.*\.test\.tsx?$|scripts/(vercel-should-build\.sh|check-local-postgrest-head(\.test)?\.py)$)'
CHANGED_COUNT=0
UNSAFE_PATH=''
while IFS= read -r -d '' path; do
  CHANGED_COUNT=$((CHANGED_COUNT + 1))
  if [[ ! "$path" =~ $SAFE_TO_SKIP ]]; then
    UNSAFE_PATH="$path"
    break
  fi
done < "$CHANGED_LIST"

if [ "$CHANGED_COUNT" -eq 0 ] || [ -n "$UNSAFE_PATH" ]; then
  echo "配信物に影響する変更または不明な差分があるためビルドします"
  exit 1
fi

echo "前回の成功配信以降、配信物に影響しない変更のみのためビルドをスキップします"
exit 0

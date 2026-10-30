#!/usr/bin/env bash
# Vercel Ignored Build Step: 0 skips the build; 1 builds it.
# Compare with the last successful deployment, not HEAD^: a failed deployment
# must not cause a later documentation commit to hide pending application code.
#
# .vercelignore removes .git before this step runs (measured 2026-10-30:
# "fatal: not a git repository"), so git cannot answer anything here. The
# changed files come from GitHub's compare API between a known-good base and
# the exact commit Vercel is building. Anything unknown means build.
set -u

PREVIOUS_SHA="${VERCEL_GIT_PREVIOUS_SHA:-}"
HEAD_SHA="${VERCEL_GIT_COMMIT_SHA:-}"
LIVE_VERSION=''
CHANGED_LIST="$(mktemp)" || exit 1
trap 'rm -f "$CHANGED_LIST"' EXIT

# Base candidates, most specific first. Vercel leaves PREVIOUS_SHA empty on a
# branch's first preview, and after a rebase it may no longer be an ancestor.
# Previews may then compare with the live application revision instead of
# assuming main deployed: main may contain commits whose deployment failed.
BASES=()
if [[ "$PREVIOUS_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  BASES+=("$PREVIOUS_SHA")
fi
if [ "${VERCEL_ENV:-}" = preview ]; then
  LIVE_VERSION="$(curl --fail --silent --show-error --max-time 5 \
    https://carelink-jp.com/api/health 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const v=JSON.parse(s).version;if(typeof v==="string"&&/^[0-9a-f]{7}$/.test(v))process.stdout.write(v)}catch{}})' \
    2>/dev/null)"
  if [[ "$LIVE_VERSION" =~ ^[0-9a-f]{7}$ ]]; then
    BASES+=("$LIVE_VERSION")
  fi
fi

COMPARED_WITH=''
if [[ "$HEAD_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  for base in ${BASES[@]+"${BASES[@]}"}; do
    if curl --fail --silent --show-error --max-time 10 \
      -H 'Accept: application/vnd.github+json' \
      "https://api.github.com/repos/jimuin0/carelink/compare/${base}...${HEAD_SHA}" 2>/dev/null \
      | node -e '
        const [base, head] = process.argv.slice(1);
        let s = "";
        process.stdin.on("data", (c) => { s += c; });
        process.stdin.on("end", () => {
          try {
            const r = JSON.parse(s);
            const resolved = r.base_commit && r.base_commit.sha;
            const commits = Array.isArray(r.commits) ? r.commits : [];
            const files = Array.isArray(r.files) ? r.files : [];
            // HEAD must descend from the base. GitHub lists at most 250
            // commits and 300 files per comparison; a truncated answer is unknown.
            if (r.status !== "ahead" || typeof resolved !== "string" || !/^[0-9a-f]{40}$/.test(resolved)
              || !resolved.startsWith(base) || !r.merge_base_commit || r.merge_base_commit.sha !== resolved
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
      ' "$base" "$HEAD_SHA" > "$CHANGED_LIST" 2>/dev/null; then
      COMPARED_WITH="$base"
      break
    fi
  done
fi

if [ -z "$COMPARED_WITH" ]; then
  echo "判定情報: 環境=${VERCEL_ENV:-unset} SHA文字数=${#PREVIOUS_SHA} 対象SHA文字数=${#HEAD_SHA} 公開版取得=$([ -n "$LIVE_VERSION" ] && echo yes || echo no) 比較候補=${#BASES[@]} GitHub照合=no"
  echo "最後に成功した配信コミットからの差分を安全に確認できないためビルドします"
  exit 1
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
  echo "判定情報: 比較元=${COMPARED_WITH:0:7} 変更=${CHANGED_COUNT}件"
  echo "配信物に影響する変更または不明な差分があるためビルドします"
  exit 1
fi

echo "判定情報: 比較元=${COMPARED_WITH:0:7} 変更=${CHANGED_COUNT}件 GitHub照合=yes"
echo "前回の成功配信以降、配信物に影響しない変更のみのためビルドをスキップします"
exit 0

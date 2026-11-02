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

# Production is often idle, so this request usually boots a cold instance first
# (measured 2026-11-01: about 5.6 s end to end, past the old 5 s limit, which
# made the docs-only #879 deployment build). Allow 15 s and one retry; a failure
# still only means "unknown", which builds.
LIVE_ATTEMPTS=0
while [ "$LIVE_ATTEMPTS" -lt 2 ] && [ -z "$LIVE_VERSION" ]; do
  LIVE_ATTEMPTS=$((LIVE_ATTEMPTS + 1))
  LIVE_VERSION="$(curl --fail --silent --show-error --max-time 15 \
    https://carelink-jp.com/api/health 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const v=JSON.parse(s).version;if(typeof v==="string"&&/^[0-9a-f]{7}$/.test(v))process.stdout.write(v)}catch{}})' \
    2>/dev/null)"
  [[ "$LIVE_VERSION" =~ ^[0-9a-f]{7}$ ]] || LIVE_VERSION=''
done

# Base candidates, most specific first. Vercel leaves PREVIOUS_SHA empty on a
# branch's first preview, and after a rebase it may no longer be an ancestor.
# Previews may then compare with the live application revision instead of
# assuming main deployed: main may contain commits whose deployment failed.
# PREVIOUS_SHA is only "the last successful deployment for the branch": a
# production build that was never served (promotion of another deployment,
# deployment checks, rollback) would otherwise hide its application changes
# behind a later docs-only commit. Production therefore skips only when that
# deployment is the one actually live.
BASES=()
if [[ "$PREVIOUS_SHA" =~ ^[0-9a-f]{40}$ ]] \
  && { [ "${VERCEL_ENV:-}" = preview ] \
    || { [ -n "$LIVE_VERSION" ] && [ "${PREVIOUS_SHA:0:7}" = "$LIVE_VERSION" ]; }; }; then
  BASES+=("$PREVIOUS_SHA")
fi
if [ "${VERCEL_ENV:-}" = preview ] && [ -n "$LIVE_VERSION" ]; then
  BASES+=("$LIVE_VERSION")
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

# A skipped deployment shows as a green "success" on GitHub, so every decision
# leaves enough in the build log to audit it afterwards.
echo "判定情報: 環境=${VERCEL_ENV:-unset} 対象=${HEAD_SHA:-なし} 前回成功=${PREVIOUS_SHA:-なし} 稼働中=${LIVE_VERSION:-不明} 稼働中の取得回数=${LIVE_ATTEMPTS} 比較候補=${#BASES[@]}"

if [ -z "$COMPARED_WITH" ]; then
  if [ "${VERCEL_ENV:-}" != preview ] && [[ "$PREVIOUS_SHA" =~ ^[0-9a-f]{40}$ ]] \
    && [ "${PREVIOUS_SHA:0:7}" != "${LIVE_VERSION:-}" ]; then
    echo "前回成功した配信が本番で稼働中の版と一致しない（または稼働中の版を確認できない）ためビルドします"
  fi
  echo "判定情報: GitHub照合=no"
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
  if [[ ! "$path" =~ $SAFE_TO_SKIP ]] && [ -z "$UNSAFE_PATH" ]; then
    UNSAFE_PATH="$path"
  fi
done < "$CHANGED_LIST"

echo "判定情報: 比較元=${COMPARED_WITH} 変更=${CHANGED_COUNT}件 GitHub照合=yes"
if [ "$CHANGED_COUNT" -eq 0 ] || [ -n "$UNSAFE_PATH" ]; then
  [ -z "$UNSAFE_PATH" ] || echo "配信物に影響する変更: ${UNSAFE_PATH}"
  echo "配信物に影響する変更または不明な差分があるためビルドします"
  exit 1
fi

tr '\0' '\n' < "$CHANGED_LIST" | head -n 50 | sed 's/^/省略対象の変更: /'
[ "$CHANGED_COUNT" -le 50 ] || echo "省略対象の変更: ほか $((CHANGED_COUNT - 50)) 件"
echo "前回の成功配信以降、配信物に影響しない変更のみのためビルドをスキップします"
exit 0

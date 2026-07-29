#!/usr/bin/env bash
#
# Vercel の Ignored Build Step。
# 終了コード 0 = ビルドをスキップ / 1 = ビルドする（Vercel の仕様。直感と逆なので注意）。
#
# 【背景・2026年7月29日】Vercel Hobby プランの日次ビルド枠を実際に使い切り、
# 「Deployment rate limited — retry in 24 hours」で24時間デプロイ不能になった。
# 本番は既存デプロイで動き続けるが、この状態でバグが出ると緊急修正を出せない。
# 神原さんの判断で Hobby を継続するため（2026年7月29日）、枠を食う原因を機械的に減らす。
#
# 当日の実績9マージのうち2件（CLAUDE.md のみ / supabase migration のみ）は、
# 配信物を一切変えないのにビルドを1回消費していた。この種の変更を確実にスキップする。
#
# 【安全側の設計】判定に迷ったら必ずビルドする（exit 1）。
# スキップの誤判定は「修正が本番に出ない」という最悪の事故になるため、
# 「ビルド不要と確信できる変更だけ」をスキップ対象にするホワイトリスト方式にする。
set -u

# 本番ブランチは常にビルドする。main に入ったものが本番へ出ないと、
# main と本番が乖離して「直したつもりが直っていない」状態になる。
if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "production 環境のため必ずビルドします"
  exit 1
fi

# 直前のコミットとの差分。取得できない場合は安全側でビルドする。
CHANGED="$(git diff --name-only HEAD^ HEAD 2>/dev/null)" || {
  echo "差分を取得できないため安全側でビルドします"
  exit 1
}

if [ -z "$CHANGED" ]; then
  echo "差分が空のため安全側でビルドします"
  exit 1
fi

# 配信物に影響しないと確信できるパスだけを列挙する（ホワイトリスト）。
# ここに無いファイルが1つでも含まれていればビルドする。
#   - supabase/migrations : DB スキーマ。Next.js の出力には含まれない
#   - .github             : CI 設定。Vercel のビルドとは無関係
#   - docs / *.md         : ドキュメント。ただし配信される MDX 等は含めない
#   - e2e / scripts       : ビルド成果物に入らない開発用
#   - src/__tests__ 等    : テストはビルド対象外
SAFE_TO_SKIP='^(supabase/migrations/|\.github/|docs/|e2e/|scripts/|[^/]*\.md$|src/.*__tests__/|src/.*\.test\.tsx?$)'

UNSAFE="$(echo "$CHANGED" | grep -Ev "$SAFE_TO_SKIP" || true)"

if [ -z "$UNSAFE" ]; then
  echo "配信物に影響しない変更のみのためビルドをスキップします:"
  echo "$CHANGED" | sed 's/^/  /'
  exit 0
fi

echo "配信物に影響する変更があるためビルドします:"
echo "$UNSAFE" | sed 's/^/  /'
exit 1

#!/usr/bin/env bash
# ============================================================================
# 期待スキーマ（= migration を全適用した結果）のフィンガープリントを生成する。
# ============================================================================
# 🔴 これが「手管理をやめる」ための本体（2026年8月2日）。
#   旧方式は src/lib/schema-constraints-snapshot.json を人が更新する前提で、
#   migration 20260722000005 が UNIQUE を意図的に DROP した際に JSON だけ取り残され、
#   **毎日「制約欠落1」を誤報し続けていた**。期待値を migration から毎回導出すれば
#   陳腐化という class が構造的に消える。
#
# 使い方:
#   scripts/gen-schema-fingerprint.sh            # 生成して所定パスへ書く
#   scripts/gen-schema-fingerprint.sh --check    # 生成物とコミット済みを比較（書かない）
#
# 前提: psql が PATH にあり、PGHOST/PGPORT/PGUSER 等で空の Postgres に接続できること。
#   CI では postgis 入りイメージの service を使う（バージョンは
#   .github/workflows/schema-fingerprint.yml が唯一の宣言箇所）。
#   ⚠️ 本番と **PostgreSQL メジャーバージョンを揃えること**。pg_get_constraintdef /
#     pg_get_indexdef / pg_get_expr の整形はバージョン間で変わり得るため、
#     揃えないと「差分ではない差分」が出て誤報になる。
#   ⚠️ 手元で再生成する場合、CI と違うメジャーで生成した結果をコミットしてはいけない
#     （meta|server_version_major 行が食い違って CI が赤くなる）。用意できないときは
#     CI を落として成果物 schema-fingerprint-expected か CI ログの出力をコミットする。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/src/lib/schema-fingerprint.expected.json"
DB="${SHADOW_DB:-carelink_shadow}"
PSQL=(psql -X -v ON_ERROR_STOP=1 -q)

MODE="${1:-write}"

if [[ ! "$DB" =~ ^carelink_(shadow|monitor)[a-z0-9_]*$ ]]; then
  echo 'Refusing to recreate a database outside the disposable shadow namespace.' >&2
  exit 1
fi
LOCALE="${SHADOW_LOCALE:-}"
if [[ -n "$LOCALE" && ! "$LOCALE" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo 'Invalid shadow locale.' >&2
  exit 1
fi

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null
if [[ -n "$LOCALE" ]]; then
  "${PSQL[@]}" -d postgres -c "CREATE DATABASE $DB TEMPLATE template0 ENCODING 'UTF8' LOCALE '$LOCALE';" >/dev/null
else
  "${PSQL[@]}" -d postgres -c "CREATE DATABASE $DB;" >/dev/null
fi

# Supabase が既定で用意しているものだけを再現する（業務テーブルは 1 つも作らない）。
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/shadow/00_bootstrap.sql" >/dev/null

applied=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null
  applied=$((applied + 1))
done

# 走査が空振りしていないことの下限。migration が 1 本も当たっていないのに
# 「一致」と言えてしまう状態を作らない。
if [ "$applied" -lt 100 ]; then
  echo "🔴 適用した migration が $applied 本しかない（下限 100）。走査が空振りしている。" >&2
  exit 1
fi

# 🔴 フィンガープリントは【必ず RPC 経由】で取る（2026年8月2日・敵対検証で発見）。
#   scripts/schema-fingerprint.sql を psql で直実行すると search_path に public が
#   入っているため `pg_get_constraintdef` / `format_type` が名前を修飾しない。
#   一方、本番側は `SET search_path = ''` の SECURITY DEFINER 関数なので
#   `public.facility_profiles` / `public.geography(Point,4326)` と修飾される。
#   方式を混ぜると **全 FK と全 geography 列が差分になる**（実測: 直実行と RPC で
#   FK/geography 行が全滅した）。両側とも RPC を呼べば構造的に一致する。
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
"${PSQL[@]}" -d "$DB" -tAc \
  "SELECT public.get_schema_fingerprint();" \
  > "$TMP"
# JSON parseとUTF8 byte sortをwrite/checkで共有する。本文LFは配列要素内に残す。
node "$ROOT/scripts/fingerprint-json.mjs" "$MODE" "$TMP" "$OUT"
echo "migration replay：$applied"

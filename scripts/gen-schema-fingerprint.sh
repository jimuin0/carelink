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
#   CI では postgis 入りイメージ（postgis/postgis:16-3.4）の service を使う。
#   ⚠️ 本番と **PostgreSQL メジャーバージョンを揃えること**。pg_get_constraintdef /
#     pg_get_indexdef / pg_get_expr の整形はバージョン間で変わり得るため、
#     揃えないと「差分ではない差分」が出て誤報になる。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/src/lib/schema-fingerprint.expected.json"
DB="${SHADOW_DB:-carelink_shadow}"
PSQL=(psql -v ON_ERROR_STOP=1 -q)

MODE="${1:-write}"

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $DB;" >/dev/null

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
#   2028 行中の FK/geography 行が全滅した）。両側とも RPC を呼べば構造的に一致する。
TMP="$(mktemp)"
psql -d "$DB" -tAc \
  "SELECT string_agg(value, E'\n' ORDER BY value COLLATE \"C\") FROM jsonb_array_elements_text(public.get_schema_fingerprint());" \
  > "$TMP"

lines=$(wc -l < "$TMP")
if [ "$lines" -lt 500 ]; then
  echo "🔴 フィンガープリントが $lines 行しかない（下限 500）。introspection が空振りしている。" >&2
  exit 1
fi

if [ "$MODE" = "--check" ]; then
  CUR="$(mktemp)"
  python3 -c "
import json,sys
print('\n'.join(json.load(open(sys.argv[1],encoding='utf-8'))))
" "$OUT" > "$CUR"
  # 🔴 比較前に両側を LC_ALL=C で並べ直す（2026年8月2日）。
  #   SQL 側は COLLATE "C" で固定済みだが、シェルの sort/diff も環境ロケールに
  #   引きずられ得る。二重に固定して「中身は同じなのに並びで差分」を構造的に潰す。
  LC_ALL=C sort -o "$CUR" "$CUR"
  LC_ALL=C sort -o "$TMP" "$TMP"
  if diff -u "$CUR" "$TMP" > /tmp/fingerprint.diff 2>&1; then
    echo "✅ コミット済みの期待フィンガープリントは最新（migration $applied 本 / $lines 項目）"
    exit 0
  fi
  echo "🔴 コミット済みの期待フィンガープリントが migration とズレています。" >&2
  echo "   → scripts/gen-schema-fingerprint.sh を実行して結果をコミットしてください。" >&2
  head -60 /tmp/fingerprint.diff >&2
  exit 1
fi

python3 -c "
import json,sys
lines=[l for l in open(sys.argv[1],encoding='utf-8').read().split('\n') if l.strip()]
json.dump(lines, open(sys.argv[2],'w',encoding='utf-8'), ensure_ascii=False, indent=0)
open(sys.argv[2],'a',encoding='utf-8').write('\n')
" "$TMP" "$OUT"
echo "✅ 生成しました: $OUT （migration $applied 本 / $lines 項目）"

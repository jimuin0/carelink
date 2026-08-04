-- ============================================================================
-- 使われていない旧シグネチャのオーバーロードを撤去する（2026年8月4日）
-- ============================================================================
-- 🔴 どうやって見つけたか:
--   スキーマ・フィンガープリント監視の初回突合で、「migration にはあるのに本番に無い」
--   関数が 2 本あることを実測した。旧監視は関数を名前でしか見ておらず（シグネチャ非考慮・
--   かつ prod→migration の逆方向は未検査）、構造的に検知不能だった。
--
-- 実測（本番 xzafxiupbflvgbarrihe・2026年8月3日）:
--   consume_subscription_session … 本番は (uuid, uuid, text) の 1 本のみ
--   search_facilities_nearby      … 本番は 7 引数版の 1 本のみ
--   一方 migration を全適用した shadow には【旧シグネチャも残る】。
--   20260628000001 が 1 引数版を、20260729000001 が 3 引数版を作り、
--   20260710000001 が 7 引数版を作ったが、いずれも旧版を DROP していなかったため。
--
-- なぜ消すのが正しいか（抑制ではなく撤去）:
--   - アプリは新シグネチャしか呼んでいない（実測: user-subscriptions/route.ts は
--     p_subscription_id / p_booking_id / p_notes の 3 引数、lib/facilities.ts は
--     keyword_filter / features_filter を含む 7 引数）
--   - 本番には既に存在しない＝旧版は「新規環境にだけ生える死んだ関数」だった
--   - 同名オーバーロードが 2 本あると、引数の与え方によっては解決が曖昧になり得る
--   - 除外リストで黙らせると、この死んだ関数が永久に fresh 環境へ複製され続ける
--
-- 副作用: 本番では IF EXISTS により no-op（存在しないため）。
--   fresh-apply（CI/E2E のローカル DB）でのみ旧版が消え、本番と一致する。
--   旧版への GRANT は作成元 migration の中だけに在り、本 migration より先に走るため
--   参照エラーは起きない。

DROP FUNCTION IF EXISTS public.consume_subscription_session(uuid);

DROP FUNCTION IF EXISTS public.search_facilities_nearby(
  double precision, double precision, double precision, text, integer
);

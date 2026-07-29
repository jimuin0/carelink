-- 口コミの真正性を DB レベルで担保する CHECK 制約（2026年7月29日）。
--
-- 【背景・実データで確定】
--   本番 facility_reviews に、サイト経由でない口コミ13件が一括 INSERT されていた。
--   created_at がマイクロ秒まで完全一致（10件が 2026-03-28T04:26:31.002831、
--   3件が同日 12:39:45.357269）＝それぞれ1回の INSERT 文で入った証拠。
--   13件すべて user_id / booking_id / reviewer_ip / visit_date が NULL だった。
--   これが facility_profiles.rating_avg（トリガ再計算）を通じて公開ページに
--   ★4.6〜4.8 として表示され、うち3件は is_verified_visit=true ＝ ReviewList の
--   「来店確認済み」バッジまで出ていた（予約実績は存在しない）。
--   表示確認用に作った文面であることを神原さんに確認し、14件（テスト投稿1件を含む）を
--   削除済み。本 migration は「同じことが二度と起きない」ための入口封鎖である。
--
-- 【なぜこの2条件で必要十分か（コード実測）】
--   facility_reviews への INSERT 経路はアプリ全体で src/app/api/review/route.ts の
--   1箇所のみ（他は select / update）。そこでは:
--     - reviewer_ip に getClientIp(request) の戻り値を必ず書く。同関数は
--       src/lib/client-ip.ts で戻り型 string を宣言し、ヘッダが一切無い場合でも
--       'unknown' を返すため NULL になり得ない。
--     - is_verified_visit は「ログイン済み」かつ「当該施設に status='completed' の
--       予約がある」場合のみ true になる（未ログインでは列自体を書かない）。
--   したがって正規経路では、
--     (a) reviewer_ip IS NULL
--     (b) is_verified_visit = true かつ user_id IS NULL
--   のどちらも原理的に発生しない。発生していれば out-of-band な直接投入である。
--
-- 【なぜ CHECK 制約か（症状ブロックではなく発症前の予防）】
--   アプリ側の入口は既に塞がっているが、今回の混入はアプリを通っていない。
--   service_role スクリプト・SQL Editor・将来の別経路からの投入は、DB 側でしか止められない。
--   運用ルールや監視（発症後の検知）ではなく、物理的に INSERT を失敗させる。
--
-- 副作用の確認：適用時点で facility_reviews は 0 行のため、既存行が制約に抵触して
-- ALTER が失敗することはない。正規の口コミ投稿は上記のとおり両条件を必ず満たす。

ALTER TABLE public.facility_reviews
  ADD CONSTRAINT facility_reviews_reviewer_ip_required
  CHECK (reviewer_ip IS NOT NULL);

ALTER TABLE public.facility_reviews
  ADD CONSTRAINT facility_reviews_verified_visit_requires_user
  CHECK (is_verified_visit IS NOT TRUE OR user_id IS NOT NULL);

COMMENT ON CONSTRAINT facility_reviews_reviewer_ip_required ON public.facility_reviews IS
  'サイト経由(/api/review)でない口コミの直接投入を禁止する。同ルートは getClientIp() の戻り値（取得不能時も ''unknown''）を必ず書くため、正規投稿がこの制約に抵触することはない。';

COMMENT ON CONSTRAINT facility_reviews_verified_visit_requires_user ON public.facility_reviews IS
  '「来店確認済み」表示を裏付けの無いまま立てることを禁止する。/api/review は is_verified_visit をログイン済みかつ completed 予約がある場合のみ true にするため、正規投稿は user_id を必ず伴う。';

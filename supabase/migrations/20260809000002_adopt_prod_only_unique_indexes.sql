-- ============================================================================
-- 🔴 接続先ガード（誤ったプロジェクトへ適用したら何も作らずに落ちる）
-- ============================================================================
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION
      'このデータベースは CareLink ではありません（public.facility_profiles が存在しない）。'
      ' 接続先プロジェクトを確認してください。CareLink の本番 ref は xzafxiupbflvgbarrihe です。';
  END IF;
END
$guard$;

-- ============================================================================
-- 本番にだけ存在していた UNIQUE インデックス 3 本を migration へ取り込む（2026-08-09）
-- ============================================================================
-- 【発見経緯】本番DBとshadow（全 migration 適用済みDB）を pg_index で突合した結果、
--   本番には実在するのに、どの migration にも定義されていない UNIQUE インデックスが
--   3 本見つかった（本ファイル追加前に grep で再確認済み・下記コミットメッセージ相当の
--   確認結果は STEP4 報告に記載）。
--
-- 【実害】これら 3 本は本番で実際に一意性を守っている物理防御なのに、CI の fresh-apply
--   DB（supabase start で migration だけを時系列適用した空DB）や E2E にはこの防御が
--   【存在しない】。つまり「二重待機登録」「同名メニュー重複」「メール重複購読」を
--   防ぐ本番の最終防衛線が、回帰テストでは一度も検証されていなかった。
--
-- 【本番への影響】3 本とも本番には既に存在する。IF NOT EXISTS を使うため、本番へ
--   このファイルを適用しても実質 no-op（何も変更しない）。真の狙いは CI/fresh-apply
--   側にこの防御を追加し、本番と同じ安全度で検証できるようにすること。
--
-- 【前提（why これが安全に通るか）】
--   CREATE UNIQUE INDEX は対象列（の組）に重複行が既に存在すると失敗する。
--   - 本番: 対象の UNIQUE インデックスが既に存在し実際に重複を排除し続けているため、
--     重複行はそもそも存在し得ない（IF NOT EXISTS で no-op になるだけで、この失敗経路は通らない）。
--   - CI / fresh-apply: 空の DB に migration を時系列適用した直後の状態なので、
--     対象テーブルは空 or この migration より後に投入されるテストデータのみであり、
--     このファイルの適用時点では重複行は存在しない。
--   将来 CI のシードデータが重複を持つ形に変わった場合はこの CREATE UNIQUE INDEX が
--   23505 で fail-closed する（無音でスキップされるのではなく、その場で気付ける）。
--
-- 【定義は本番 introspection の実測値をそのまま使用】
--   WHERE 句・btrim 式・列順を本番と一字一句同じにする（独自解釈で近い形を作らない）。
--   3 本とも列挙元は司令塔による本番 pg_index 実測。
-- ============================================================================

-- ── 1. booking_waitlist: 同一施設・同一日時枠・同一ユーザーの二重「待機中」登録を防ぐ ──
-- why: 1 ユーザーが同じ空き待ち枠に何度も waiting 登録できてしまうと、キャンセル発生時の
--   自動通知（notified 遷移）が同一ユーザーへ重複して飛ぶ。status='waiting' の部分インデックス
--   なので、notified/booked/expired/cancelled に遷移した後の再登録は妨げない。
-- when: 違反時は INSERT が 23505 で拒否される（アプリ側は ON CONFLICT 前提の設計ではないため、
--   呼出元でハンドリングが必要。既存の /api/waitlist 実装は本番の物理防御を前提に書かれている）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_user_slot_waiting
  ON public.booking_waitlist USING btree (facility_id, date, start_time, user_id)
  WHERE ((user_id IS NOT NULL) AND (status = 'waiting'::text));

-- ── 2. facility_menus: 同一施設内の同名メニュー（前後空白違いを除く）の重複を防ぐ ──
-- why: btrim(name) の式インデックスにより「クレンジング」と「クレンジング 」（末尾全角/半角
--   空白違い）のような表記ゆれ重複を同一名として扱い拒否する。HPB 反映・手入力・API 経由の
--   複数書込経路が同名メニューを二重作成することを最後の物理防御として防ぐ。
-- when: 違反時は INSERT/UPDATE が 23505 で拒否される。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_facility_menu_name
  ON public.facility_menus USING btree (facility_id, btrim(name));

-- ── 3. newsletter_subscriptions: メールアドレスの重複購読を防ぐ ──
-- why: 既存の idx_newsletter_subs_email は non-unique（検索高速化のみ）で重複購読を防げない。
--   本番は別名で UNIQUE を併設しており、同一メールが複数回 INSERT されて同一キャンペーンの
--   メールが二重配信される事故を防ぐ。email は NULL 許容列だが、UNIQUE 制約は SQL 標準どおり
--   NULL 同士は重複とみなさない（NULL の行が複数あっても違反しない）。
-- when: 違反時は INSERT が 23505 で拒否される。
CREATE UNIQUE INDEX IF NOT EXISTS uq_newsletter_subs_email
  ON public.newsletter_subscriptions USING btree (email);

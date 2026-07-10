-- user_points の TOCTOU（select→insert 非原子）による二重ポイント付与を防ぐ部分UNIQUEインデックス。
--
-- 対象は2箇所のみ。いずれも既存コードが「unique index が 23505 を返せばスキップ」という
-- 前提のコメント/実装を先に持っていたが、対応する制約が本番に一度も適用されていなかった
-- （get_public_constraints RPC で id 主キーのみと実データ確認済み・2026年7月10日）。
--
-- 1) 口コミポイント（src/app/api/review/route.ts）
--    reason = `口コミポイント:${facility_id}` で1ユーザー・1施設あたり1回のみ。
-- 2) 誕生日ポイント（src/app/api/cron/birthday-coupon/route.ts）
--    reason = `birthday_${year}` で1ユーザー・1年あたり1回のみ（年が変われば reason も変わるため
--    翌年分の正当な付与は妨げない）。
--
-- グローバル UNIQUE(user_id, reason) にしない理由（根拠・実コード調査済み）:
-- user_points は他に以下の理由で「同一 reason が同一ユーザーで正当に複数回」発生する:
--   - '来店ポイント'（src/lib/booking-completion.ts）: 予約完了のたびに1行増える来店実績の本体。
--     dedup は呼び出し側の bookings.status CAS（confirmed→completed）で保証済み、reason 側の
--     一意性は不要かつ課すと2回目以降の来店ポイントが23505で無音消失する重大回帰になる。
--   - 'キャンセル返還'（src/app/api/booking/[id]/cancel/route.ts）: キャンセルのたびに1行増える
--     返還記録。dedup は bookings.status の条件付き UPDATE（CAS）で保証済み。
--   - '紹介ボーナス' / '紹介コード利用ボーナス'（src/lib/referral.ts）: 紹介者が複数の友人を紹介
--     すれば同一 reason で複数回付与されるのが正しい仕様。dedup は referral_uses.points_awarded
--     の CAS で保証済み（user_points 側の一意制約は不要かつ課すと2人目以降の紹介ボーナスが
--     23505で無音消失する）。
-- そのため reason プレフィックスで対象を厳密に絞った部分インデックスのみを追加する。

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_points_review
  ON user_points (user_id, reason)
  WHERE reason LIKE '口コミポイント:%';

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_points_birthday
  ON user_points (user_id, reason)
  WHERE reason LIKE 'birthday\_%' ESCAPE '\';

-- CL-10: 紹介ボーナスの部分成功を再試行で回復できる一意性。
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_points_referral_booking
  ON public.user_points (user_id, reason, booking_id)
  WHERE reason IN ('紹介ボーナス', '紹介コード利用ボーナス') AND booking_id IS NOT NULL;

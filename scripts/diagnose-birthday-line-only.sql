-- =============================================================================
-- 誕生日クーポンの LINE 撤去（Issue #527）で、通知が届かなくなる人がいるかを数える
--
-- 【使い方】Supabase Dashboard → SQL Editor に貼って実行する。
--   project ref は必ず xzafxiupbflvgbarrihe（CareLink 本番）であることを確認すること。
--   https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe/sql
--   SQL Editor は postgres 権限で走るので RLS を素通しし、真の全件が見える。
--
-- 【なぜ数えるのか】口コミ依頼（PR #526）の撤去では、メールを全予約へ無条件送信していたため
--   LINE は完全な重複だった。誕生日クーポンは違う。メールは
--   「メールアドレスがあり、かつ配信停止していない人」にしか送らないので、
--   【LINE 連携済みだがメールで受け取れない人】は撤去後に誕生日通知を受け取らなくなる。
--   これは仕様どおりだが（配信停止の意思を LINE で迂回していたのが誤り）、
--   人数を知らずに出すべき変更ではないので実データで確かめる。
--
-- 【安全性】本ファイルは SELECT のみ。1行も書き換えない。
--
-- @check profiles.birth_md
-- @check profiles.email
-- @check profiles.email_unsubscribed
-- @check profiles.id
-- @check profiles.line_user_id
-- =============================================================================

-- =============================================================================
-- 接続先の自己検査。
-- Supabase の SQL Editor はプロジェクトごとにタブが開くため、【別プロジェクトのタブに
-- 貼ってしまう】事故が繰り返し起きている（2026年8月2日 soel で実行し「RLS が90本欠落」
-- という存在しない事故を報告しかけた／2026年8月12日 admin-dashboard で実行し
-- 「audit_logs が存在しない」となった）。人の注意力では防げないので、SQL 自身に検査させる。
--
-- CareLink 本番 project ref = xzafxiupbflvgbarrihe
-- 目印テーブルが揃っていなければ、以降を1行も実行せずに落とす。
-- =============================================================================
DO $connguard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL
     OR to_regclass('public.facility_menus') IS NULL
     OR to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION
      '接続先が CareLink 本番ではありません。project ref = xzafxiupbflvgbarrihe のタブで実行してください（現在の接続先には facility_profiles / facility_menus / audit_logs のいずれかがありません）';
  END IF;
END
$connguard$;

-- (1) 誕生日通知の到達可否を人数で出す。
--     line_only が【今回の変更で通知を受け取らなくなる人数】。
select
  count(*) filter (where birth_md is not null)                                as 誕生日登録あり,
  count(*) filter (where birth_md is not null
                     and email is not null
                     and email_unsubscribed is not true)                      as メールで届く,
  count(*) filter (where birth_md is not null
                     and line_user_id is not null)                            as line連携あり,
  count(*) filter (where birth_md is not null
                     and line_user_id is not null
                     and (email is null or email_unsubscribed is true))       as line_only,
  count(*) filter (where birth_md is not null
                     and (email is null or email_unsubscribed is true)
                     and line_user_id is null)                                as 元々どちらでも届かない
from public.profiles;

-- (2) line_only の内訳。「メールアドレスが無い」のか「本人が配信停止した」のかで意味が違う。
--     配信停止なら、届かなくなるのは本人の意思どおり（旧実装が LINE で迂回していた）。
--     メール未登録なら、連絡手段が LINE しか無い人なので別途検討の余地がある。
select
  case
    when email is null then 'メールアドレスが無い'
    else '本人がメール配信停止'
  end as 理由,
  count(*) as 人数
from public.profiles
where birth_md is not null
  and line_user_id is not null
  and (email is null or email_unsubscribed is true)
group by 1
order by 2 desc;

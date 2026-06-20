-- 客↔店アプリ内チャット（chat_rooms / chat_messages）とコミュニティ
-- （community_posts / community_replies / community_likes）機能の物理削除。
--
-- 背景: アプリ側の実装（admin/mypage ページ・admin API・ナビ/mypage リンク・
-- account/delete の community_likes 参照）は PR #195 / 本 PR で全て撤去済み。
-- 残るテーブルは UI から到達不可で無参照となったため、ここで物理削除して
-- 「機能は消えたがスキーマが残る」ドリフトと、退会処理での GDPR 削除ノイズを根絶する。
--
-- 安全性: これらテーブルへの被参照 FK は全て同ファミリー内（community_replies→posts /
-- community_likes→posts・replies / chat_messages→rooms）のみで、保持する他テーブルからの
-- 参照は存在しない。よって CASCADE が保持テーブルへ波及することはない。
-- CASCADE は各テーブル付随の index / RLS policy / trigger / FK 制約も同時に除去する。
--
-- 冪等: 全て IF EXISTS。再実行・未適用環境でも安全。

-- 依存（子）から先に削除（CASCADE があるため順序は厳密には不問だが明示する）
DROP TABLE IF EXISTS public.community_likes   CASCADE;
DROP TABLE IF EXISTS public.community_replies CASCADE;
DROP TABLE IF EXISTS public.community_posts   CASCADE;
DROP TABLE IF EXISTS public.chat_messages     CASCADE;
DROP TABLE IF EXISTS public.chat_rooms        CASCADE;

-- community のトリガー関数はテーブルから独立しており、テーブル削除では自動消去されない。
-- （chat 側にトリガー関数は存在しない）
DROP FUNCTION IF EXISTS public.update_community_post_stats() CASCADE;

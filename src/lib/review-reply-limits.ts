/**
 * 口コミへの店舗返信の上限（画面・API・DB で同じ値）。
 *
 * 管理画面の入力欄（maxLength）、API の検証（src/lib/admin-review-reply.ts）、
 * DB の RPC（supabase/migrations/20261022140000_review_reply_edit_delete.sql の
 * char_length(p_content) > 500）が同じ上限を使う。画面だけの上限は PostgREST を直接叩けば
 * 越えられるため、DB 側でも同じ値で弾いている。
 *
 * 画面（クライアント）からも読むので、サーバー専用のモジュールを import しないこと。
 */
export const REVIEW_REPLY_MAX_LENGTH = 500;

export const REVIEW_REPLY_LENGTH_MESSAGE = `返信は1〜${REVIEW_REPLY_MAX_LENGTH}文字で入力してください`;

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * LINE 連携の単一ソース解決ヘルパー（監査C2・2026年7月22日 恒久根治）。
 *
 * 【背景】LINE 連携の書き込みは `profiles.line_user_id`（POST /api/liff/link が
 * `profiles.id = auth.uid()` の行へ保存する唯一の場所・UNIQUE）へ移行済みだが、
 * サーバ起点の全 LINE 送信経路（予約確認・キャンセル・リマインダー・レビュー依頼・
 * 誕生日クーポン・時間調整依頼）と連携バッジ表示は、旧テーブル `line_user_links` を
 * `user_id` で引いて `line_user_id` を得る実装のまま残っていた。ところが
 * `line_user_links.user_id` を非 NULL に設定するコードはアプリ・DB トリガのどこにも
 * 存在せず（webhook follow は user_id=NULL で upsert するのみ）、`user_id` 引きは
 * 常に 0 件ヒット → 顧客向け LINE 通知が全て無音で送られない状態だった。
 *
 * 本ヘルパーで読み取りを `profiles.line_user_id`（実際に書き込まれる唯一の正）へ
 * 一本化し、書き込みと読み取りの単一ソースを一致させる。
 *
 * RLS 注意：`profiles` の SELECT ポリシーは own 行のみ（auth.uid()=id）のため、
 * 他ユーザー（顧客）の連携を解決する送信経路では必ず service role クライアントを渡す
 * こと（全既存呼び出し元は service role 経由）。
 */
export async function resolveLineUserIdForUser(
  client: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await client
    .from('profiles')
    .select('line_user_id')
    .eq('id', userId)
    .maybeSingle();
  return (data as { line_user_id: string | null } | null)?.line_user_id ?? null;
}

/**
 * 複数ユーザー分の連携を一括解決する（cron の一斉送信用）。
 * 連携済み（line_user_id が非 NULL）のユーザーのみを user_id → line_user_id の Map で返す。
 */
export async function resolveLineUserIdsForUsers(
  client: SupabaseClient,
  userIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  const { data } = await client
    .from('profiles')
    .select('id, line_user_id')
    .in('id', userIds);
  for (const row of (data as Array<{ id: string; line_user_id: string | null }> | null) ?? []) {
    if (row.line_user_id) map.set(row.id, row.line_user_id);
  }
  return map;
}

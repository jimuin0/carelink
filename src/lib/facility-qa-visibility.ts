import { createServerSupabaseClient } from './supabase-server';

/**
 * 施設ページに「Q&A」タブを出すかどうか（神原さん判断 2026年10月23日）。
 *
 * 公開中の Q&A（回答済み・公開）が 1 件も無い施設でタブを出すと、押しても
 * 「Q&Aはまだありません」だけが出る空のタブになる。1 件以上あるときだけタブを出す。
 *
 * 読むのは来訪者と同じ anon の権限で見える行だけ（facility_qa_public_read＝回答済み・公開）。
 * 列も画面が既に使っている列単位 GRANT の範囲（id・facility_id・status・is_public）に留める。
 * 件数そのものは要らないので 1 行だけ取る。
 *
 * 読み取りに失敗したら例外を投げる（呼び出し側が通知したうえで、内容を隠さない側＝タブを出す側に倒す）。
 */
export async function hasPublicQa(facilityId: string): Promise<boolean> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from('facility_qa').select('id').eq('facility_id', facilityId).eq('status', 'answered').eq('is_public', true).limit(1);
  if (error) throw new Error(`facility_qa visibility lookup failed: ${error.message}`);
  return (data ?? []).length > 0;
}

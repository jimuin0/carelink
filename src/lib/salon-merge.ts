import type { Database } from '@/types/database.types';

export type SalonRow = Database['public']['Tables']['salons']['Row'];

// 【2026年8月20日 新設】/register（全項目＋写真7枚）と /recruit（10項目のみ）は同じ
// /api/salons へ POST し、同じ salons テーブルに行を作る（重複ガード無し・email に
// UNIQUE 無し）。引き継ぎ側 /api/facility/setup は
// `.order('created_at', { ascending: false }).limit(1)` で「最新1件だけ」を採用するため、
// /register を出した後に /recruit も出すと、/recruit が送らない列
// （photo_url / photo_urls / business_hours / regular_holiday / seat_count /
// staff_count / has_parking / features / nearest_station / building_name /
// desired_start_date）が全部 null（または未指定のDB既定値）の新しい行に丸ごと
// 上書きされ、利用者が実際に入力した内容が無音で消える。
//
// この関数は「最新の行が丸ごと勝つ」のではなく「列ごとに、新しい順に見て
// 最初に見つかった “意味のある値” が勝つ」方式でこれを防ぐ。利用者はその情報を
// 実際に入力しており、後から別フォームを出しただけで消えるのは、いま塞ごうとしている
// 「無音でデータが消える」故障そのものだからである。

/**
 * 「意味のある値」の判定。
 *
 * - null / undefined は「未入力」として無し扱い。
 * - 空文字列 '' も「未入力」として無し扱い（フォームの空欄はサーバーに空文字列として
 *   届くことがあり、null と区別する理由が無い）。
 * - 空配列（features: [] / photo_urls: [] など）も無し扱いにする。/recruit はこれらの
 *   キー自体を送らないため、DBの列がどちらの経路で埋まったにせよ「空配列」は
 *   「利用者が0件を明示的に選んだ」のではなく「そのフォームに項目自体が無かった」を
 *   表している可能性が高く、区別する手段がこの関数には無い。空配列を「意味のある値」
 *   として扱うと、/register で7枚登録した写真が /recruit 由来の空配列で上書きされる
 *   ケースを再現してしまうため、安全側（空配列は無し扱い）に倒す。
 * - 0 と false は有効な値として扱う（seat_count: 0 や has_parking: false は実際の
 *   入力結果であり、欠落ではない）。`||` で判定すると falsy な 0/false が「無し」に
 *   落ちてしまう既知の事故パターン（CLAUDE.md 記載）を踏むため、ここでは `??` 相当の
 *   明示的な null/undefined/空文字/空配列チェックのみを行い、`||` は使わない。
 */
function isMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

/**
 * salons の行の配列（新しい順・rows[0] が最新）を受け取り、列ごとに
 * 「新しい行から順に、最初に見つかった意味のある値」を採用して1行に統合する。
 *
 * - 引数が空配列なら null を返す。
 * - 1行しか無ければその行をそのまま返す（統合の余地が無い）。
 * - どの行にも意味のある値が無い列（全行が null/''/[] など）は、
 *   最新行（rows[0]）の値をそのまま残す（無理に別の値を捏造しない）。
 *
 * 純粋関数。DB へのアクセスや副作用は一切持たない（呼び出し側が rows を用意し、
 * 統合結果をどう使うか＝実際に更新をかけるかどうかも呼び出し側の責務）。
 */
export function mergeSalonRows(rows: readonly SalonRow[]): SalonRow | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];

  // 🔴 列は rows[0] だけでなく【全行の和集合】から取る。rows[0]（最新行）の方が
  //   列数が少ない select で渡されると、古い行にしか無い列が黙って落ちる＝この関数が
  //   防ごうとしている「無音でデータが消える」故障を関数自身が作ってしまう。
  //   PostgREST の `.select('*')` なら全行同じ列集合になるので今日は到達しないが、
  //   呼び出し側の select を狭めた瞬間に発症する形を残さない。
  //   併せて「その列を最初に持っていた行」も覚えておく。どの行にも意味のある値が
  //   無い列の据え置き先がこれで一意に決まり、`rows[0]` を仮定した到達不能な
  //   フォールバック分岐（＝branches 100% を崩す死に枝）を作らずに済む。
  const keys: (keyof SalonRow)[] = [];
  const holderOf = new Map<string, SalonRow>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (holderOf.has(key)) continue;
      holderOf.set(key, row);
      keys.push(key as keyof SalonRow);
    }
  }
  const merged: Record<string, unknown> = {};

  for (const key of keys) {
    let chosen: unknown;
    let found = false;
    for (const row of rows) {
      const value = row[key];
      if (isMeaningfulValue(value)) {
        chosen = value;
        found = true;
        break;
      }
    }
    // どの行にも意味のある値が無い列は、その列を持つ最も新しい行の値をそのまま残す
    // （無理に別の値を捏造しない）。holderOf は keys と同時に埋めているので必ず引ける。
    merged[key] = found ? chosen : (holderOf.get(key as string) as SalonRow)[key];
  }

  return merged as SalonRow;
}

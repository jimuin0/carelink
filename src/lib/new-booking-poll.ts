/**
 * 管理画面の「新規予約」通知（1分ごとの確認）で、サーバーとブラウザが共有する取り決め。
 *
 * 以前は Supabase Realtime の postgres_changes を購読していたが、bookings が
 * supabase_realtime の配信対象に入っておらず、ログイン中の接続も 401 で拒否されていたため、
 * 本番で一度も通知が出ていなかった（2026年10月21日に確認）。予約データの配信経路を
 * 増やさずに済むよう、既存の認証・店舗権限・RLS を通る API を定期的に読む方式へ置き換えた。
 */

/** 通常表示中の確認間隔。 */
export const NEW_BOOKING_POLL_INTERVAL_MS = 60_000;

/**
 * 確認のたびにさかのぼる幅。予約の created_at は挿入トランザクション開始時刻なので、
 * 確認の直後にコミットされた予約は前回の基準時刻より古い created_at を持ち得る。
 * アプリサーバーと DB の時計のずれも吸収するため重ねて読み、重複は予約 ID で除く。
 */
export const NEW_BOOKING_OVERLAP_MS = 120_000;

/** 1 回の応答で返す最大件数。 */
export const NEW_BOOKING_MAX_ROWS = 20;

/** since として受け付ける最古の時刻（これより古い指定は丸める）。 */
export const NEW_BOOKING_MAX_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export type NewBookingNotice = {
  id: string;
  customer_name: string;
  booking_date: string;
  start_time: string;
  created_at: string;
};

/**
 * 問い合わせの起点時刻を決める。未指定・不正値は「今から重ね幅ぶん前」、
 * 未来や 24 時間より前の指定は範囲内へ丸める。
 */
export function resolveSince(raw: string | null, nowMs: number): string {
  const fallback = nowMs - NEW_BOOKING_OVERLAP_MS;
  const parsed = raw === null ? Number.NaN : Date.parse(raw);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  const clamped = Math.min(Math.max(value, nowMs - NEW_BOOKING_MAX_LOOKBACK_MS), nowMs);
  return new Date(clamped).toISOString();
}

/** 次回の問い合わせに使う since（前回の応答時刻から重ね幅ぶん戻す）。 */
export function nextSince(serverNow: string): string {
  return new Date(Date.parse(serverNow) - NEW_BOOKING_OVERLAP_MS).toISOString();
}

/**
 * 応答のうち、まだ見ていない予約だけを返し、見た ID を記録する。
 * seen は呼び出し側が保持する（店舗を切り替えたら作り直す）。
 */
export function takeUnseen(rows: NewBookingNotice[], seen: Set<string>): NewBookingNotice[] {
  const fresh: NewBookingNotice[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    fresh.push(row);
  }
  return fresh;
}

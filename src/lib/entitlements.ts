/**
 * 施設エンタイトルメント（有料オプション購入状態）ヘルパー
 *
 * option_catalog のオプションを施設が購入すると facility_entitlements に
 * status='active' の行が作られる（Stripe webhook が自動管理）。
 * cron / API は本ヘルパーで「その施設がオプションを使えるか」を判定する。
 *
 * クライアントは呼び出し側から注入する（cron は service role / API は server client）。
 */

export type OptionKey =
  | 'reminder_email_3d'
  | 'reminder_line'
  | 'time_adjust_line'
  | 'hpb_integration';

type EntitlementRow = { facility_id: string; option_key: string };

/** Supabase クライアントの必要最小インターフェース（テスト容易性のため構造的型付け） */
export interface EntitlementsClient {
  from(table: string): {
    select(columns: string): {
      in(column: string, values: string[]): {
        eq(column: string, value: string): PromiseLike<{ data: EntitlementRow[] | null; error: unknown }>;
      };
    };
  };
}

/** PostgREST の .in() URL 長制限を避ける chunk サイズ */
const IN_CHUNK = 500;

/**
 * 複数施設の active なエンタイトルメントを一括取得する。
 * 戻り値: facility_id → 購入済み option_key の Set
 *
 * fail-open しない（DB エラー時は該当 chunk の施設が「未購入」扱いになる=安全側。
 * 有料機能が誤って無料開放されるより、一時的に送られない方を選ぶ）。
 * エラーは呼び出し側で可視化できるよう errors 配列でも返す。
 */
export async function getEntitlementsByFacility(
  client: EntitlementsClient,
  facilityIds: string[],
): Promise<{ map: Map<string, Set<string>>; errors: unknown[] }> {
  const map = new Map<string, Set<string>>();
  const errors: unknown[] = [];
  const unique = Array.from(new Set(facilityIds));

  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const chunk = unique.slice(i, i + IN_CHUNK);
    const { data, error } = await client
      .from('facility_entitlements')
      .select('facility_id, option_key')
      .in('facility_id', chunk)
      .eq('status', 'active');
    if (error) {
      errors.push(error);
      continue;
    }
    for (const row of data ?? []) {
      if (!map.has(row.facility_id)) map.set(row.facility_id, new Set());
      map.get(row.facility_id)!.add(row.option_key);
    }
  }

  return { map, errors };
}

/** 単一施設が指定オプションを購入済みか */
export async function hasEntitlement(
  client: EntitlementsClient,
  facilityId: string,
  optionKey: OptionKey,
): Promise<boolean> {
  const { map } = await getEntitlementsByFacility(client, [facilityId]);
  return map.get(facilityId)?.has(optionKey) ?? false;
}

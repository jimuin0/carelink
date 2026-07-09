import { createServiceRoleClient } from '@/lib/supabase-server';

export interface RegisteredSalonSummary {
  name: string;
  type: string;
  area: string;
}

const EMPTY_SUMMARY: RegisteredSalonSummary = { name: '', type: '', area: '' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// /register/complete の表示内容は、クライアントが URL に載せた値ではなく
// サーバー側で salons テーブルの実データを引いて確定させる。id が実在しない
// 場合は空サマリーを返し、呼び出し側は「登録内容」ブロックを表示しない。
export async function resolveRegisteredSalon(id: string | undefined): Promise<RegisteredSalonSummary> {
  if (!id || !UUID_RE.test(id)) return EMPTY_SUMMARY;

  const supabase = createServiceRoleClient();
  const { data: salon } = await supabase
    .from('salons')
    .select('facility_name, business_type, address')
    .eq('id', id)
    .maybeSingle();

  if (!salon) return EMPTY_SUMMARY;

  return {
    name: salon.facility_name || '',
    type: salon.business_type || '',
    area: salon.address || '',
  };
}

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkRateLimit, mutationRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { withRoute, serverError } from '@/lib/with-route';
import { UUID_REGEX } from '@/lib/constants';

export const dynamic = 'force-dynamic';

// GET（匿名・認証なし）で返してよい公開安全カラムのみ。
// email / phone / contact_phone / contact_name / representative_name（登録者PII）と
// is_public / status / desired_start_date（内部情報）は select('*') だと匿名露出するため除外。
const PUBLIC_SALON_COLUMNS =
  'id, facility_name, business_type, address, building_name, nearest_station, ' +
  'business_hours, regular_holiday, seat_count, staff_count, has_parking, ' +
  'features, pr_text, photo_url, photo_urls, website, postal_code, created_at';

// Retired V1 has no request identity. A refusal here is not proof that an
// earlier request never committed. Old consumers classify 409 as unknown and
// retain their input/retry fence. Fresh forms use prepare/commit/status only.
export const POST = withRoute(async () => NextResponse.json({
  code: 'REGISTRATION_LEGACY_CLOSED',
  error: '旧登録経路の受付を終了しました。以前の申込結果が不明な場合は、新たに申し込まず受付状況をお問い合わせください。',
}, { status: 409, headers: { 'Cache-Control': 'no-store' } }), {
  csrf: true,
  rateLimit: { limiter: mutationRateLimit, limit: 5, windowMs: 60_000, prefix: 'salon-register' },
  sentryTag: 'salons',
});

export async function GET(req: NextRequest) {
  try {
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 20, 60_000, 'salons')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  // 【2026年7月16日 恒久根治・新規eslintルール no-anon-select-rls-protected-table が検知】
  // `salons` は RLS 有効かつ anon 向け SELECT ポリシーが1件も存在しない（INSERT ポリシーのみ
  // だった旧 "Allow anonymous insert" も migration 20260604000002 で削除済み）。そのため
  // createServerSupabaseClient()（anon）で読むと常に0行/404になり、この公開一覧 GET が
  // 本番で常に空を返す無音バグだった（facilities.ts の #483/#484 と同型・本ルール導入時に発見）。
  // 返却列は PUBLIC_SALON_COLUMNS のみ・is_public=true 限定のため PII 漏洩は無い。
  const supabase = createServiceRoleClient();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (id !== null && !UUID_REGEX.test(id)) {
    return NextResponse.json({ error: '施設IDの形式が正しくありません' }, { status: 400 });
  }

  if (id !== null) {
    const { data, error } = await supabase
      .from('salons')
      .select(PUBLIC_SALON_COLUMNS)
      .eq('id', id)
      .eq('is_public', true)
      .maybeSingle();
    if (error) return serverError('salons-get-single', error, '/api/salons', 'データの取得に失敗しました');
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(data);
  }

  let query = supabase
    .from('salons')
    .select(PUBLIC_SALON_COLUMNS)
    .eq('is_public', true)
    .order('created_at', { ascending: false });

  const businessType = searchParams.get('business_type');
  if (businessType) query = query.eq('business_type', businessType);

  const area = searchParams.get('area')?.trim().slice(0, 100);
  if (area) {
    const escaped = area.replace(/[%_\\]/g, '\\$&');
    query = query.ilike('address', `%${escaped}%`);
  }

  query = query.limit(50);

  const { data, error } = await query;
  if (error) return serverError('salons-get-list', error, '/api/salons', 'データの取得に失敗しました');
  return NextResponse.json(data || []);
  } catch (e) {
    return serverError('salons', e, '/api/salons');
  }
}

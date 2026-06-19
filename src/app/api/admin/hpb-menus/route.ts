import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { listHpbMenus, scrapeAndSaveFacility } from '@/lib/hpb-menu';

// HPB 予約ページを多数 fetch するため、取得トリガー(POST)は時間がかかる。
// Hobby 上限60s / Pro 上限300s のいずれでも有効な明示値。大規模カタログは
// タイムアウトしても upsert は冪等(手直しは温存)なので再実行で続行できる。
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** 認可: ログインユーザーが facility_id の owner/admin か検証。可なら facilityId を返す。 */
async function getAdminFacilityId(request: NextRequest): Promise<string | null> {
  const supabase = await createServerSupabaseAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) return null;

  const { data } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .single();

  return data?.facility_id ?? null;
}

/** GET: facility の HPB メニュー一覧(手直し列含む)。 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 30, 60_000, 'hpb-menus-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const facilityId = await getAdminFacilityId(request);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const menus = await listHpbMenus(admin, facilityId);
  if (menus === null) {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
  return NextResponse.json({ menus });
}

/** POST: HPB から取得して hpb_menu_durations に保存(手直しは温存)。 */
export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 5, 60_000, 'hpb-menus-scrape')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const facilityId = await getAdminFacilityId(request);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const result = await scrapeAndSaveFacility(admin, facilityId);
  if (!result.slnId) {
    return NextResponse.json(
      { error: 'この施設の HPB 店舗ID(hpb_sln_id)が未設定です。設定画面で登録してください。' },
      { status: 400 },
    );
  }
  return NextResponse.json({
    sln_id: result.slnId,
    fetched: result.fetched,
    saved: result.ok,
    skipped: result.skipped,
    failed: result.failed,
  });
}

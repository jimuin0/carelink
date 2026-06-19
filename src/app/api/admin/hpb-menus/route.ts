import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import {
  listHpbMenus,
  scrapeAndSaveFacility,
  setFacilitySlnId,
  updateHpbMenuOverride,
  type HpbMenuOverridePatch,
} from '@/lib/hpb-menu';

// HPB 店舗ID(slnID)は英数字のみ(例 H000537368)。空文字は「未設定に戻す」。
const slnSchema = z.object({
  hpb_sln_id: z.union([z.string().regex(/^[A-Za-z0-9]{1,32}$/), z.literal(''), z.null()]),
});

// 手直し(override / is_hidden)。ref_id 必須・他は任意(指定列だけ更新)。
const overrideSchema = z.object({
  ref_id: z.string().min(1).max(200),
  name_override: z.string().max(200).nullable().optional(),
  duration_min_override: z.number().int().min(0).max(1440).nullable().optional(),
  price_override: z.number().int().min(0).max(9999999).nullable().optional(),
  description_override: z.string().max(2000).nullable().optional(),
  is_hidden: z.boolean().optional(),
});

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

/** PUT: facility の HPB 店舗ID(hpb_sln_id)を設定。空文字/null で未設定に戻す。 */
export async function PUT(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'hpb-menus-sln')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const facilityId = await getAdminFacilityId(request);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = slnSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'HPB 店舗IDは英数字で入力してください' }, { status: 400 });
  }

  const slnId = parsed.data.hpb_sln_id ? parsed.data.hpb_sln_id : null;
  const admin = createServiceRoleClient();
  const ok = await setFacilitySlnId(admin, facilityId, slnId);
  if (!ok) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ hpb_sln_id: slnId });
}

/** PATCH: 手直し(name/duration/price/description の override・is_hidden)を1行に反映。 */
export async function PATCH(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 30, 60_000, 'hpb-menus-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const facilityId = await getAdminFacilityId(request);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const { ref_id, ...rest } = parsed.data;
  const patch: HpbMenuOverridePatch = {};
  if ('name_override' in rest) patch.name_override = rest.name_override;
  if ('duration_min_override' in rest) patch.duration_min_override = rest.duration_min_override;
  if ('price_override' in rest) patch.price_override = rest.price_override;
  if ('description_override' in rest) patch.description_override = rest.description_override;
  if ('is_hidden' in rest) patch.is_hidden = rest.is_hidden;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: '更新する項目がありません' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const result = await updateHpbMenuOverride(admin, facilityId, ref_id, patch);
  if (result.notFound) {
    return NextResponse.json({ error: 'メニューが見つかりません' }, { status: 404 });
  }
  if (!result.ok) {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

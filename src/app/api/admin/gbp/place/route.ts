import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { fetchPlaceDetails, calculateGbpScore } from '@/lib/gbp';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { getAdminFacilityIds, resolveTargetFacilityId } from '@/lib/facility-membership';

export async function GET(req: NextRequest) {
  // この GET は外部 Places API 取得＋facility_profiles の google_rating 上書き＋
  // gbp_audit_cache への書き込みという副作用を持つ。副作用のある操作を CSRF 検証
  // 配下に置かないと、ログイン中の施設オーナーに任意サイトから
  // `<img src=".../gbp/place?placeId=任意">` を踏ませるだけで本人 Cookie で
  // 自施設データを上書きできてしまう（CSRF）。同一オリジンの管理 UI からの
  // fetch は Origin/Referer が一致して通過し、クロスサイト誘発は 403 で遮断する。
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 20, 60_000, 'gbp-place-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  try {
    const supabase = await createServerSupabaseAuthClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // 監査A2: facility_id をクエリから受け取り所属集合で検証する（非決定的なlimit(1)決め打ち排除）。
    const facilityIds = await getAdminFacilityIds(supabase, user.id);
    const requested = req.nextUrl.searchParams.get('facility_id');
    const { facilityId, reason } = resolveTargetFacilityId(facilityIds, requested);
    if (reason === 'none') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (reason === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (reason === 'ambiguous') return NextResponse.json({ error: '施設を指定してください', facilityIds }, { status: 400 });

    const { data: facility } = await supabase
      .from('facility_profiles')
      .select('gbp_place_id, name, description, phone, website_url, business_hours, main_photo_url')
      .eq('id', facilityId)
      .single();

    if (!facility) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // google_rating を永続上書きするため、参照する place_id は「自店に保存済みの gbp_place_id」に
    // 限定する。クエリの任意 placeId を受理すると、他店の高評価 place_id を渡すだけで自店の公開評価を
    // 捏造できた（#2）。正規の管理 UI は placeId クエリを渡さないため機能は不変・攻撃面のみを断つ。
    const placeId = facility.gbp_place_id;

    const placeData = placeId ? await fetchPlaceDetails(placeId) : null;
    const audit = calculateGbpScore(placeData, facility);

    if (placeData) {
      // facility_profiles は SELECT ポリシー（status='published' 限定）のみで UPDATE 用 RLS
      // ポリシーが存在しないため、createServerSupabaseAuthClient（RLS適用）で .update() すると
      // 拒否/0行になり google_rating が無音で更新されない（gbp/place と同型の書込RLS拒否バグ）。
      // settings/route.ts と同型に service role（RLS バイパス）へ切替。所有権は上で確認済み。
      const admin = createServiceRoleClient();
      const [cacheResult, ratingResult] = await Promise.allSettled([
        supabase.from('gbp_audit_cache').upsert({
          facility_id: facilityId,
          score: audit.score,
          details: { audit, placeData },
          fetched_at: new Date().toISOString(),
        }),
        admin.from('facility_profiles').update({
          google_rating: placeData.rating ?? null,
          google_review_count: placeData.user_ratings_total ?? 0,
        }).eq('id', facilityId).select('id'),
      ]);
      if (cacheResult.status === 'rejected' || (cacheResult.status === 'fulfilled' && cacheResult.value.error)) {
        console.error('[gbp/place] audit cache upsert failed', { facilityId });
      }
      // phantom success 防止: エラーが無くても実際に更新された行が0件（facility_id不一致・
      // 直前の削除等のTOCTOU）なら無音成功と誤認せず明示的にログする。
      if (
        ratingResult.status === 'rejected' ||
        (ratingResult.status === 'fulfilled' && (ratingResult.value.error || !ratingResult.value.data || ratingResult.value.data.length === 0))
      ) {
        console.error('[gbp/place] google_rating update failed', { facilityId });
      }
    }

    return NextResponse.json({ placeData, audit, facilityId });
  } catch (e) {
    console.error('[gbp/place] GET error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 10, 60_000, 'gbp-place')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  // place_id を facility_profiles に保存
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { gbp_place_id, gbp_cid, facility_id } = body;

  const facilityIds = await getAdminFacilityIds(supabase, user.id);
  const { facilityId, reason } = resolveTargetFacilityId(facilityIds, facility_id);
  if (reason === 'none') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (reason === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (reason === 'ambiguous') return NextResponse.json({ error: '施設を指定してください', facilityIds }, { status: 400 });

  // 保存時に形式を検証し、DB へ不正値が入るのを発症前に防ぐ（読み手側の防御に依存しない根治）。
  // place_id は fetchPlaceDetails（src/lib/gbp.ts）の読み取り検証と同一規則に揃える。
  if (gbp_place_id && (typeof gbp_place_id !== 'string' || !/^[A-Za-z0-9_\-:]{1,300}$/.test(gbp_place_id))) {
    return NextResponse.json({ error: 'Place ID の形式が正しくありません' }, { status: 400 });
  }
  // CID は数値だが、フォーム入力の表記ゆれを壊さないため安全な文字種＋長さ上限のみ課す。
  if (gbp_cid && (typeof gbp_cid !== 'string' || !/^[A-Za-z0-9_\-:]{1,64}$/.test(gbp_cid))) {
    return NextResponse.json({ error: 'CID の形式が正しくありません' }, { status: 400 });
  }

  // facility_profiles は SELECT ポリシー（status='published' 限定）のみで UPDATE 用 RLS
  // ポリシーが存在しないため、createServerSupabaseAuthClient（RLS適用）で .update() すると
  // 拒否/0行になり Place ID 保存が無音で失敗する（GBP連携が死ぬ実バグ）。settings/route.ts と
  // 同型に service role（RLS バイパス）へ切替。facilityId の所有権は上の
  // getAdminFacilityIds/resolveTargetFacilityId で確認済み。
  const admin = createServiceRoleClient();
  const { data: updated, error } = await admin
    .from('facility_profiles')
    .update({
      gbp_place_id: gbp_place_id || null,
      gbp_cid: gbp_cid || null,
      gbp_connected_at: gbp_place_id ? new Date().toISOString() : null,
    })
    .eq('id', facilityId)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  // phantom success 防止: service role は RLS をバイパスするため、facilityId に対応する行が
  // 実在しない場合でもエラーにならず0行更新のまま ok:true を返しかねない（8本の admin変異
  // ハンドラで根治した #470 と同型）。.select().maybeSingle() で実際に更新された行を確認する。
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { releaseMismatchedGbpPlace } from '@/lib/gbp-place-release';
import { saveAdminFacilityIntegration } from '@/lib/admin-facility-integration-write';
import { databaseDiagnostic } from '@/lib/database-diagnostic';
import { fetchPlaceDetails, calculateGbpScore } from '@/lib/gbp';
import {
  FACILITY_IDENTITY_COLUMNS, GBP_PLACE_LOOKUP_FAILED_MESSAGE, GBP_PLACE_MISMATCH_MESSAGE, GBP_PLACE_MISMATCH_NOTICE,
  placeMatchesFacility,
} from '@/lib/gbp-ownership';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { getAdminFacilityIds, resolveTargetFacilityId } from '@/lib/facility-membership';
import { toJsonValue } from '@/lib/json-value';
import { serverError, authUnavailable } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';


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
    const verification = await verifyAuthUser(supabase.auth);
    if (verification.state === 'unavailable') return authUnavailable('admin-facility-auth', '/api/admin/gbp/place');
    const user = verification.state === 'verified' ? verification.user : null;
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // 監査A2: facility_id をクエリから受け取り所属集合で検証する（非決定的なlimit(1)決め打ち排除）。
    const facilityIds = await getAdminFacilityIds(supabase, user.id, '/api/admin/gbp/place');
    if (facilityIds instanceof NextResponse) return facilityIds;
    const requested = req.nextUrl.searchParams.get('facility_id');
    const { facilityId, reason } = resolveTargetFacilityId(facilityIds, requested);
    if (reason === 'none') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (reason === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (reason === 'ambiguous') return NextResponse.json({ error: '施設を指定してください', facilityIds }, { status: 400 });

    const { data: facility, error: facilityError } = await supabase
      .from('facility_profiles')
      .select(`gbp_place_id, description, website_url, business_hours, main_photo_url, ${FACILITY_IDENTITY_COLUMNS}`)
      .eq('id', facilityId)
      .maybeSingle();

    if (facilityError) return serverError('admin-gbp-place-read', databaseDiagnostic(facilityError), '/api/admin/gbp/place');
    if (!facility) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // google_rating を永続上書きするため、参照する place_id は「自店に保存済みの gbp_place_id」に
    // 限定する。クエリの任意 placeId を受理すると、他店の高評価 place_id を渡すだけで自店の公開評価を
    // 捏造できた（#2）。正規の管理 UI は placeId クエリを渡さないため機能は不変・攻撃面のみを断つ。
    const placeId = facility.gbp_place_id;

    const fetched = placeId ? await fetchPlaceDetails(placeId) : null;
    // 保存済みの Place が施設の登録内容（電話番号、または店舗名＋住所）と合わなければ、その店舗の評価は
    // 書き込まず、Place ID ごと外す（照合の導入前に保存された ID・Google 側の店舗情報が変わった場合でも、
    // 他店の評価・地図・口コミのリンクを自店の掲載に出さず、一意索引でその ID を占有し続けない）。
    const ownershipMismatch = placeId !== null && fetched !== null && !placeMatchesFacility(fetched, facility);
    const placeData = ownershipMismatch ? null : fetched;
    // facility.business_hours は DB 上 jsonb で Json 型（string|number|boolean|null|object|配列の合併）
    // だが、calculateGbpScore は object 形状（Record<string, unknown> | null）だけを想定している。
    // supabase/migrations 上 business_hours は「曜日→時間帯」の JSON オブジェクトとして書き込まれる
    // 設計（settings/route.ts 参照）であり、文字列や配列が入る運用は無い。実行時に object 判定で
    // 絞り込むことで、既存の「object ならそのまま渡す・でなければ null」という挙動は変えずに型を合わせる。
    const businessHours =
      facility.business_hours &&
      typeof facility.business_hours === 'object' &&
      !Array.isArray(facility.business_hours)
        ? facility.business_hours
        : null;
    const audit = calculateGbpScore(placeData, { ...facility, business_hours: businessHours });

    if (ownershipMismatch) {
      // 所属（owner/admin）は上で確認済み。照合した Place ID のままのときだけ外す（gbp-place-release.ts）。
      const released = await releaseMismatchedGbpPlace(createServiceRoleClient(), facilityId, placeId);
      if (released === 'failed') return serverError('admin-gbp-place-release', new Error('GBP_PLACE_RELEASE_FAILED'), '/api/admin/gbp/place');
      return NextResponse.json({ placeData, audit, facilityId, ownershipMismatch: true, released: released === 'released', notice: GBP_PLACE_MISMATCH_NOTICE });
    }

    if (fetched) {
      const saved = await saveAdminFacilityIntegration({actorId:user.id,facilityId,kind:'gbp:refresh',expected:{place_id:placeId},values:{rating:placeData?.rating ?? null,review_count:placeData?.user_ratings_total ?? 0,score:audit.score,details:toJsonValue({audit,placeData})}});
      if(saved instanceof NextResponse)return saved;
    }

    return NextResponse.json({ placeData, audit, facilityId });
  } catch (e) {
    return serverError('admin-gbp-place-get', e, '/api/admin/gbp/place', 'Internal Server Error');
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
  const verification = await verifyAuthUser(supabase.auth);
  if (verification.state === 'unavailable') return authUnavailable('admin-facility-auth', '/api/admin/gbp/place');
  const user = verification.state === 'verified' ? verification.user : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if(body===null||typeof body!=='object'||Array.isArray(body))return NextResponse.json({error:'Invalid request'},{status:400});
  const { gbp_place_id, gbp_cid, facility_id } = body;
  if([gbp_place_id,gbp_cid].some(v=>v!=null&&typeof v!=='string'))return NextResponse.json({error:'Invalid request'},{status:400});

  const facilityIds = await getAdminFacilityIds(supabase, user.id, '/api/admin/gbp/place');
  if (facilityIds instanceof NextResponse) return facilityIds;
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

  // 他店の Place ID を保存すると、その店舗の Google 評価・件数が自店の掲載に Google ロゴ付きで出て、
  // 「地図を見る」も他店を指していた（形式しか見ていなかった）。保存する前に Google の店舗情報を取り、
  // 施設の登録内容（電話番号、または店舗名＋住所）と合うものだけを受け付ける。消す（空で保存）ときは照合しない。
  // 同じ ID を別の施設へ付けることは DB の部分ユニーク索引が止める（409・admin-facility-integration-write）。
  let verifiedIdentity: { [key: string]: string | null } | null = null;
  if (gbp_place_id) {
    const { data: facility, error: facilityError } = await supabase
      .from('facility_profiles')
      .select(FACILITY_IDENTITY_COLUMNS)
      .eq('id', facilityId)
      .maybeSingle();
    if (facilityError) return serverError('admin-gbp-place-identity-read', databaseDiagnostic(facilityError), '/api/admin/gbp/place');
    if (!facility) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const place = await fetchPlaceDetails(gbp_place_id);
    if (!place) return NextResponse.json({ code: 'GBP_PLACE_UNVERIFIED', error: GBP_PLACE_LOOKUP_FAILED_MESSAGE }, { status: 422 });
    if (!placeMatchesFacility(place, facility)) return NextResponse.json({ code: 'GBP_PLACE_MISMATCH', error: GBP_PLACE_MISMATCH_MESSAGE }, { status: 422 });
    // 照合に使った登録内容を保存へ渡す。照会の間に店名・電話・住所が変わっていれば、DB が行を
    // ロックしたうえで食い違いを検出して断る（古い照合結果で他店の Place ID を付けさせない）。
    const row = facility as Record<string, string | null | undefined>;
    verifiedIdentity = Object.fromEntries(
      (['name', 'phone', 'postal_code', 'prefecture', 'city', 'address'] as const).map((key) => [key, row[key] ?? null]),
    );
  }

  const saved = await saveAdminFacilityIntegration({actorId:user.id,facilityId,kind:'gbp:connect',expected:verifiedIdentity?{identity:verifiedIdentity}:{},values:{place_id:gbp_place_id || null,cid:gbp_cid || null}});
  if(saved instanceof NextResponse)return saved;
  return NextResponse.json({ok:true});
}

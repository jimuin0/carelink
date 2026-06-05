/**
 * 施設自動セットアップ API（v8.3）
 * POST /api/facility/setup
 * 認証済みユーザーが施設を新規作成し、facility_membersにowner登録
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { safeCaptureException } from '@/lib/safe';
import { sendWelcomeEmail } from '@/lib/email';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { createServiceRoleClient } from '@/lib/supabase-server';
import { isMissingColumnError, omitKeys, warnMissingColumnFallback } from '@/lib/db-fallback';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    if (await checkRateLimit(mutationRateLimit, ip, 5, 60_000, "mutation")) {
      return NextResponse.json({ error: "リクエストが多すぎます" }, { status: 429 });
    }
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const adminSupabase = createServiceRoleClient();

    // 既に施設を持っているか確認。1オーナーが複数施設を持つ正当な運用（HALグループ等）があるため、
    // .maybeSingle() だと2行以上で error になり existingMember が取れず重複作成してしまう。
    // .limit(1).maybeSingle() で「いずれかの所属があれば既存扱い」とし、オンボーディングからの重複作成を防ぐ。
    const { data: existingMember } = await adminSupabase
      .from('facility_members')
      .select('facility_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (existingMember) {
      return NextResponse.json({
        success: true,
        facilityId: existingMember.facility_id,
        message: '既に施設が登録されています',
      });
    }

    const body = await request.json().catch(() => ({}));
    let {
      facility_name,
      business_type,
      phone,
      prefecture,
      city,
      address,
    } = body;

    // register フォームのリード(salons)を email で1回取得し、必須項目の補完と詳細項目の引き継ぎに使う。
    // 旧実装は facility_name 空時のみ・4項目のみで、写真/PR/営業時間/席数等が消失し二重入力だった（受け入れ体制）。
    const { data: salonData } = await adminSupabase
      .from('salons')
      .select('*')
      .eq('email', user.email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (salonData) {
      if (!facility_name || facility_name === '未設定の施設') facility_name = salonData.facility_name;
      business_type = business_type || salonData.business_type;
      phone = phone || salonData.phone;
      address = address || salonData.address;
    }

    if (!facility_name || !business_type) {
      return NextResponse.json({ error: '施設名と業種は必須です' }, { status: 400 });
    }
    facility_name = String(facility_name).slice(0, 100);
    business_type = String(business_type).slice(0, 50);
    if (phone) phone = String(phone).slice(0, 20);
    if (prefecture) prefecture = String(prefecture).slice(0, 20);
    if (city) city = String(city).slice(0, 50);
    // settings の zod は address max(100)。ここで 200 まで保存すると、後でオーナーが管理画面で
    // 保存する際に address:max(100) 違反で原因不明の 400 になり詰まる。設定画面と同じ上限に揃える（本番監査#7）。
    if (address) address = String(address).slice(0, 100);

    // slug生成（施設名からローマ字変換は複雑なのでランダム）
    const slug = facility_name
      .toLowerCase()
      .replace(/[^a-zA-Z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `facility-${Date.now()}`;

    const uniqueSlug = `${slug}-${Date.now().toString(36)}`;

    // facility_profiles作成（draft状態）
    const { data: facility, error: facilityError } = await adminSupabase
      .from('facility_profiles')
      .insert({
        name: facility_name,
        slug: uniqueSlug,
        business_type,
        phone: phone || null,
        prefecture: prefecture || null,
        city: city || null,
        address: address || null,
        status: 'draft', // 公開前はdraft
      })
      .select('id')
      .single();

    if (facilityError || !facility) {
      console.error('[facility/setup] Insert error:', facilityError);
      return NextResponse.json({ error: '施設の作成に失敗しました' }, { status: 500 });
    }

    // facility_membersにowner登録
    const { error: memberError } = await adminSupabase
      .from('facility_members')
      .insert({
        facility_id: facility.id,
        user_id: user.id,
        role: 'owner',
      });

    if (memberError) {
      // owner 登録に失敗したら、作成済みの facility_profiles を破棄して孤児行を残さない（補償ロールバック）。
      const { error: rollbackErr } = await adminSupabase.from('facility_profiles').delete().eq('id', facility.id);
      if (rollbackErr) console.error('[facility/setup] rollback failed — orphaned facility_profile', { facilityId: facility.id, err: rollbackErr });
      console.error('[facility/setup] Member error:', memberError);
      return NextResponse.json({ error: 'オーナー登録に失敗しました' }, { status: 500 });
    }

    // リード(salons)の詳細項目・写真を施設プロフィールへ引き継ぐ（best-effort。施設作成は既に成立済みのため
    // 失敗しても 500 にせず、オーナーが管理画面で補完できる状態を維持する。受け入れ時の二重入力を解消）。
    if (salonData) {
      try {
        const clip = (v: unknown, n: number): string | null => (v == null || v === '' ? null : String(v).slice(0, n));
        const enrich: Record<string, unknown> = {
          postal_code: clip(salonData.postal_code, 8),
          building: clip(salonData.building_name, 100),
          access_info: clip(salonData.nearest_station, 200),
          regular_holiday: clip(salonData.regular_holiday, 100),
          seat_count: typeof salonData.seat_count === 'number' ? salonData.seat_count : null,
          staff_count: typeof salonData.staff_count === 'number' ? salonData.staff_count : null,
          parking: !!salonData.has_parking,
          features: Array.isArray(salonData.features) ? salonData.features.slice(0, 50) : [],
          description: clip(salonData.pr_text, 2000),
          website_url: clip(salonData.website, 200),
          main_photo_url: clip(salonData.photo_url, 200000),
          business_hours_text: clip(salonData.business_hours, 200), // 拡張カラム（未適用環境ではフォールバック除外）
        };
        let { error: enrichErr } = await adminSupabase.from('facility_profiles').update(enrich).eq('id', facility.id);
        if (isMissingColumnError(enrichErr)) {
          warnMissingColumnFallback('facility_profiles.setup-enrich');
          ({ error: enrichErr } = await adminSupabase.from('facility_profiles').update(omitKeys(enrich, ['business_hours_text'])).eq('id', facility.id));
        }
        if (enrichErr) console.error('[facility/setup] lead enrichment update failed (non-fatal)', { facilityId: facility.id, err: enrichErr.message });

        // 写真の引き継ぎ（register のカテゴリ順に photo_type を割当）
        if (Array.isArray(salonData.photo_urls) && salonData.photo_urls.length > 0) {
          const cats = ['exterior', 'interior_1', 'interior_2', 'interior_3', 'menu_1', 'menu_2', 'menu_3'];
          const typeOf = (i: number): string => {
            const c = cats[i] || '';
            if (c.startsWith('exterior')) return 'exterior';
            if (c.startsWith('interior')) return 'interior';
            if (c.startsWith('menu')) return 'menu';
            return 'other';
          };
          const photoRows = (salonData.photo_urls as unknown[])
            .filter((u): u is string => typeof u === 'string' && u.length > 0)
            .slice(0, 20)
            .map((u, i) => ({ facility_id: facility.id, photo_url: u, photo_type: typeOf(i), sort_order: i }));
          if (photoRows.length > 0) {
            const { error: photoErr } = await adminSupabase.from('facility_photos').insert(photoRows);
            if (photoErr) console.error('[facility/setup] photo carry-over failed (non-fatal)', { facilityId: facility.id, err: photoErr.message });
          }
        }
      } catch (enrichEx) {
        console.error('[facility/setup] lead enrichment threw (non-fatal)', { facilityId: facility.id, err: enrichEx instanceof Error ? enrichEx.message : String(enrichEx) });
      }
    }

    // ウェルカムメール（fire-and-forget）
    if (user.email) {
      sendWelcomeEmail({
        ownerEmail: user.email,
        facilityName: facility_name,
      }).catch((e) => safeCaptureException(e, 'welcome-email'));
    }

    return NextResponse.json({
      success: true,
      facilityId: facility.id,
      slug: uniqueSlug,
      message: '施設を作成しました。管理画面からメニューやスタッフを登録してください。',
    });
  } catch (e) {
    safeCaptureException(e, 'api/facility/setup');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

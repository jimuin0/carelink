/**
 * 施設自動セットアップ API（v8.3）
 * POST /api/facility/setup
 * 認証済みユーザーが施設を新規作成し、facility_membersにowner登録
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { sendWelcomeEmail } from '@/lib/email';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { createServiceRoleClient } from '@/lib/supabase-server';

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

    // 既に施設を持っているか確認
    const { data: existingMember } = await adminSupabase
      .from('facility_members')
      .select('facility_id')
      .eq('user_id', user.id)
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

    // salonsテーブルから登録済みデータを自動取得（registerフォームで入力済みの場合）
    if (!facility_name || facility_name === '未設定の施設') {
      const { data: salonData } = await adminSupabase
        .from('salons')
        .select('*')
        .eq('email', user.email)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (salonData) {
        facility_name = facility_name || salonData.facility_name;
        business_type = business_type || salonData.business_type;
        phone = phone || salonData.phone;
        prefecture = prefecture || null;
        city = city || null;
        address = address || salonData.address;
      }
    }

    if (!facility_name || !business_type) {
      return NextResponse.json({ error: '施設名と業種は必須です' }, { status: 400 });
    }
    facility_name = String(facility_name).slice(0, 100);
    business_type = String(business_type).slice(0, 50);
    if (phone) phone = String(phone).slice(0, 20);
    if (prefecture) prefecture = String(prefecture).slice(0, 20);
    if (city) city = String(city).slice(0, 50);
    if (address) address = String(address).slice(0, 200);

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
      console.error('[facility/setup] Member error:', memberError);
      // ロールバック
      await adminSupabase.from('facility_profiles').delete().eq('id', facility.id);
      return NextResponse.json({ error: 'オーナー登録に失敗しました' }, { status: 500 });
    }

    // ウェルカムメール（fire-and-forget）
    if (user.email) {
      sendWelcomeEmail({
        ownerEmail: user.email,
        facilityName: facility_name,
      }).catch((e) => Sentry.captureException(e, { tags: { feature: 'welcome-email' } }));
    }

    return NextResponse.json({
      success: true,
      facilityId: facility.id,
      slug: uniqueSlug,
      message: '施設を作成しました。管理画面からメニューやスタッフを登録してください。',
    });
  } catch (e) {
    Sentry.captureException(e);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

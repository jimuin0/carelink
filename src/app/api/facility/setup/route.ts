/**
 * 施設自動セットアップ API（v8.3）
 * POST /api/facility/setup
 * 認証済みユーザーが施設を新規作成し、facility_membersにowner登録
 */

import { NextRequest, NextResponse } from 'next/server';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { sendWelcomeEmail } from '@/lib/email';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { createServiceRoleClient } from '@/lib/supabase-server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;
    const ip = getClientIp(request);
    if (await checkRateLimit(mutationRateLimit, ip, 5, 60_000, "mutation")) {
      return NextResponse.json({ error: "リクエストが多すぎます" }, { status: 429 });
    }
    const supabase = await createServerSupabaseAuthClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const adminSupabase = createServiceRoleClient();

    // 既に施設を持っているか確認（1アカウント1施設の自己登録ガード）。
    // 注意: .maybeSingle() は複数行で error+data=null を返すため、既に 2 件以上
    // 所属している状態だとガードを素通りして 3 件目を作れてしまう。
    // limit(1) で「1 件でも存在すれば拒否」とし、複数行でも壊れないようにする。
    // 複数施設（チェーン）は運営が手動で facility_members を付与した場合のみ成立する。
    const { data: existingMembers } = await adminSupabase
      .from('facility_members')
      .select('facility_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1);

    if (existingMembers && existingMembers.length > 0) {
      return NextResponse.json({
        success: true,
        facilityId: existingMembers[0].facility_id,
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

    // register フォームで入力済みなら salons の全項目を facility に引き継ぐ（B: セルフサーブ・二度手間の解消）。
    // onboarding は facility_name 付きで来るため条件を付けず、常に email 一致の最新 salon を取得する
    // （旧実装は facility_name 未指定時のみ取得＝実運用では常にスキップされ、営業時間・写真・特徴・PR 等が
    //  一切引き継がれず管理画面で全て入力し直しになっていた）。email 未設定時は取得しない。
    const { data: salonData } = user.email
      ? await adminSupabase
          .from('salons')
          .select('*')
          .eq('email', user.email)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

    if (salonData) {
      facility_name = facility_name || salonData.facility_name;
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
        // register フォームの入力を引き継ぐ（salonData があれば）。営業時間は salons が自由文
        // （"10:00〜20:00"）で facility_profiles.business_hours は予約枠用の JSONB のため型が異なる。
        // 自由文は business_hours_text へ入れ、予約枠を制御する構造化 business_hours は owner が設定画面で設定する。
        postal_code: salonData?.postal_code || null,
        building: salonData?.building_name || null,
        nearest_station: salonData?.nearest_station || null,
        business_hours_text: salonData?.business_hours || null,
        regular_holiday: salonData?.regular_holiday || null,
        seat_count: typeof salonData?.seat_count === 'number' ? salonData.seat_count : null,
        staff_count: typeof salonData?.staff_count === 'number' ? salonData.staff_count : null,
        parking: salonData?.has_parking ?? false,
        features: Array.isArray(salonData?.features) ? salonData.features : [],
        website_url: salonData?.website || null,
        description: salonData?.pr_text || null,
        main_photo_url: salonData?.photo_url || null,
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
      const { error: rollbackErr } = await adminSupabase.from('facility_profiles').delete().eq('id', facility.id);
      if (rollbackErr) console.error('[facility/setup] rollback failed — orphaned facility_profile', { facilityId: facility.id, err: rollbackErr });
      return NextResponse.json({ error: 'オーナー登録に失敗しました' }, { status: 500 });
    }

    // register でアップした写真を facility_photos に引き継ぐ（既存ストレージの公開 URL を再利用）。
    // 先頭は外観（register で必須）＝ 'exterior'、以降は種別が配列から復元できないため 'other'
    // （photo_type は NOT NULL + CHECK 制約のため必ず有効値を入れる）。sort_order で並びを保持。
    // 失敗しても施設作成は成立させ owner は写真管理から追加できるため best-effort（ログのみ）。
    const salonPhotoUrls: string[] = Array.isArray(salonData?.photo_urls)
      ? (salonData.photo_urls as unknown[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
      : [];
    if (salonPhotoUrls.length > 0) {
      const photoRows = salonPhotoUrls.map((url, i) => ({
        facility_id: facility.id,
        photo_url: url,
        photo_type: i === 0 ? 'exterior' : 'other',
        sort_order: i,
      }));
      const { error: photoErr } = await adminSupabase.from('facility_photos').insert(photoRows);
      if (photoErr) console.error('[facility/setup] photo transfer failed', { facilityId: facility.id, err: photoErr.message });
    }

    // ウェルカムメール（fire-and-forget）
    // sendWelcomeEmail は送信失敗時も throw せず false を返す契約のため、.catch() だけでは
    // 失敗が無音化する（実際に例外を投げるのは Resend 呼び出し前の想定外エラーのみ）。
    // 戻り値を確認して両方の失敗経路を可視化する。
    if (user.email) {
      // 【2026年7月7日 本番実データで確定した恒久根治】waitUntil() の fire-and-forget は Fluid Compute
      // 無効の本番でレスポンス返却直後に凍結され後処理が全滅していた（/api/review と同一の欠陥・同一の
      // 根治）。レスポンス前に await して確実に送る。末尾 .catch で握るため本体レスポンスには影響しない。
      await sendWelcomeEmail({
        ownerEmail: user.email,
        facilityName: facility_name,
      }).then((ok) => {
        if (!ok) {
          const err = new Error('welcome email send failed');
          safeCaptureException(err, 'welcome-email');
          alertCaughtError('welcome-email', err, '/api/facility/setup');
        }
      }).catch((e) => {
        safeCaptureException(e, 'welcome-email');
        alertCaughtError('welcome-email', e, '/api/facility/setup');
      });
    }

    return NextResponse.json({
      success: true,
      facilityId: facility.id,
      slug: uniqueSlug,
      message: '施設を作成しました。管理画面からメニューやスタッフを登録してください。',
    });
  } catch (e) {
    safeCaptureException(e, 'api/facility/setup');
    alertCaughtError('api/facility/setup', e, '/api/facility/setup');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

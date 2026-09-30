import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkRateLimit, mutationRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { withRoute, serverError } from '@/lib/with-route';
import { isAllowedStorageUrl } from '@/lib/storage-url-guard';
import { salonInsertSchema } from '@/lib/validations';
import { salonFieldErrors, SALON_FIELD_MESSAGES } from '@/lib/salon-field-errors';
import { verifyRecaptcha } from '@/lib/recaptcha';
import { sendNotify } from '@/lib/notify';
import { sendRegistrationReceiptEmail } from '@/lib/email';
import { runAfterResponse } from '@/lib/after-response';
import { extractPrefecture, extractCity } from '@/lib/japan-address';
import { SALON_CLAIM_COOKIE_NAME, SALON_CLAIM_TTL_SECONDS, signSalonClaim } from '@/lib/salon-claim';

export const dynamic = 'force-dynamic';

// -----------------------------------------------------------------------------
// POST /api/salons : 施設掲載の唯一の登録経路（service_role でサーバ挿入）。
//
// 【背景・恒久対策】
//   従来はクライアントが anon キーで salons へ直接 INSERT していた。anon キーは
//   公開JSに含まれ誰でも入手できるため、RLS の anon INSERT ポリシーが開いている限り
//   reCAPTCHA / rate-limit / サーバ検証を一切経由しない無制限投入が可能だった
//   （発症前の構造的脆弱性）。本 API に集約し、対応する anon INSERT ポリシーを
//   DB から DROP することで「サーバを通さない投入」を物理的に不能化する。
//
// 【検証方針】
//   サーバを権威（authoritative）とする。register（全項目）と recruit（部分項目）の
//   両ページが送る項目の和集合を受理し、未送出項目は null 化して挿入する。
//   写真URLは Supabase Storage 公開バケットの自プレフィックス以外を拒否し、
//   任意URL混入（保存型の不正データ）を封じる。
// -----------------------------------------------------------------------------


// GET（匿名・認証なし）で返してよい公開安全カラムのみ。
// email / phone / contact_phone / contact_name / representative_name（登録者PII）と
// is_public / status / desired_start_date（内部情報）は select('*') だと匿名露出するため除外。
const PUBLIC_SALON_COLUMNS =
  'id, facility_name, business_type, address, building_name, nearest_station, ' +
  'business_hours, regular_holiday, seat_count, staff_count, has_parking, ' +
  'features, pr_text, photo_url, photo_urls, website, postal_code, created_at';

// Supabase Storage 公開バケットの自プレフィックスのみ許可（任意URL混入を拒否）。
// review/route.ts と共通のヘルパー（src/lib/storage-url-guard.ts）を使う。
function isAllowedPhotoUrl(url: string): boolean {
  return isAllowedStorageUrl(url, 'carelink-uploads');
}

export const POST = withRoute(async (request) => {
  const body = await request.json().catch(() => null);
  const parsed = salonInsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '入力内容を確認してください', fieldErrors: salonFieldErrors(parsed.error.issues) }, { status: 400 });
  }
  const d = parsed.data;

  // reCAPTCHA v3 検証（fail-closed: secret設定時=本番はtoken必須）。
  // 施設掲載登録は氏名・電話・メール等の実データを伴う無認証公開フォームのため、
  // review.ts/contact.ts と同一パターンでBot対策を配線する（未配線だと分散IPからの
  // 自動投入でsalonsテーブル汚染・登録者への誤通知が発生し得た）。
  if (process.env.RECAPTCHA_SECRET_KEY) {
    if (!d.recaptcha_token) {
      return NextResponse.json({ error: 'Bot検知: 時間をおいて再度お試しください' }, { status: 403 });
    }
    const captcha = await verifyRecaptcha(d.recaptcha_token, 'salons', 0.4);
    if (!captcha.success) {
      return NextResponse.json({ error: 'Bot検知: 時間をおいて再度お試しください' }, { status: 403 });
    }
  }

  // 写真URLの出所検証（自Storage公開URL以外は拒否）
  const photoUrls = (d.photo_urls ?? []).filter((u) => u.length > 0);
  if (photoUrls.some((u) => !isAllowedPhotoUrl(u))) {
    return NextResponse.json({ error: '施設写真を確認してください', fieldErrors: { photo_urls: SALON_FIELD_MESSAGES.photo_urls } }, { status: 400 });
  }
  if (d.photo_url && !isAllowedPhotoUrl(d.photo_url)) {
    return NextResponse.json({ error: '施設写真を確認してください', fieldErrors: { photo_url: SALON_FIELD_MESSAGES.photo_url } }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 【2026年8月20日 恒久根治】サーバーを権威とする（本ファイル冒頭コメントの検証方針）。
  // クライアントが明示的に送った値（zipcloud 由来）は無条件に優先し、未送出・空文字のときだけ
  // address からの復元にフォールバックする。復元もできなければ推測で埋めず null のままにする。
  const prefecture = d.prefecture || extractPrefecture(d.address) || null;
  const city = d.city || extractCity(d.address) || null;

  const { data, error } = await supabase
    .from('salons')
    .insert({
      facility_name: d.facility_name,
      business_type: d.business_type,
      representative_name: d.representative_name,
      contact_name: d.contact_name,
      email: d.email,
      phone: d.phone,
      contact_phone: d.contact_phone || null,
      website: d.website || null,
      postal_code: d.postal_code || null,
      address: d.address || null,
      prefecture,
      city,
      building_name: d.building_name || null,
      nearest_station: d.nearest_station || null,
      business_hours: d.business_hours || null,
      regular_holiday: d.regular_holiday || null,
      // seat_count / staff_count は JSON 経由のため NaN は到達不能（zod が int 範囲を検証済み）。
      seat_count: d.seat_count ?? null,
      staff_count: d.staff_count ?? null,
      has_parking: d.has_parking ?? false,
      features: d.features ?? [],
      pr_text: d.pr_text || null,
      photo_url: photoUrls[0] || null,
      photo_urls: photoUrls,
      desired_start_date: d.desired_start_date || null,
      // Store the trusted server-side entry point so registration reports do not infer
      // attribution from a completion-page visit or a client-provided event.
      source: d.source,
    })
    .select('id')
    .single();

  if (error || !data) {
    return serverError(
      'salons-insert',
      error ?? new Error('salons insert returned no row'),
      '/api/salons',
      '送信に失敗しました。時間をおいて再度お試しください。',
    );
  }

  // 【2026年8月20日 新設】所有権 claim Cookie（src/lib/salon-claim.ts）。
  // この登録内容を作った「その場のブラウザ」にだけ salons.id を運ぶ署名付き HttpOnly Cookie を
  // 発行し、/api/facility/setup がメール一致より優先して引き継ぎ元に使う。salons.id を
  // URL・メールリンクに載せる代替案は敵対検証で却下済み（アクセスログ/解析ツール/Referer への
  // 露出のため）。ADMIN_COOKIE_SECRET 未設定の環境では signSalonClaim が null を返し、
  // Cookie を発行しない（fail-safe・従来のメール一致のみに倒れる）。
  const res = NextResponse.json({ success: true, id: data.id });
  const signedClaim = signSalonClaim(data.id);
  if (signedClaim) {
    res.cookies.set(SALON_CLAIM_COOKIE_NAME, signedClaim, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SALON_CLAIM_TTL_SECONDS,
      path: '/',
    });
  }

  // Slack通知（fire-and-forget）
  // server-to-server の HTTP fetch は Origin/Referer を持たず /api/notify の CSRF で 403 になり
  // 通知が無音欠落する（contact.ts と同型）ため、共有ロジック sendNotify を直接呼ぶ。
  // d.source で recruit（掲載申し込み）/ register（無料掲載登録）を判定し、従来クライアントが
  // 送っていたのと同じ Slack メッセージ種別・内容を1件も欠落させず送る。
  if (d.source === 'register') {
    runAfterResponse(() => sendNotify({
      type: 'salon',
      data: {
        facility_name: d.facility_name,
        business_type: d.business_type,
        representative_name: d.representative_name,
        phone: d.phone,
        email: d.email,
        address: d.address || undefined,
        desired_start_date: d.desired_start_date || undefined,
      },
    }).then((r) => {
      if (!r.ok) console.error('[salons] Slack notification failed', { error: r.error });
    }).catch((err) => console.error('[salons] Slack notification failed', { err })));

    // 申込者への受付メール（fire-and-forget・runAfterResponse 経由）。
    // 【source='register' 限定の理由】recruit（掲載申し込み）は「担当者より2営業日以内に
    // ご連絡いたします」という別の運用文脈（人が個別に連絡する前提）で、無料掲載登録
    // （register）のような「アカウント作成まで自走してもらう」導線ではない。recruit にまで
    // 自動メールを広げると、担当者からの連絡と重複した案内を送ることになるため対象外にする。
    // 【失敗の扱い】sendRegistrationReceiptEmail は throw せず false を返す契約
    // （RESEND_API_KEY 未設定時も false）。false・例外の両方を拾ってログに残すが、
    // 登録自体は既に保存済みのため、メール失敗で応答を失敗させない（sendNotify と同型）。
    // 【PII】エラーログに生メールアドレスは含めない（既存の sendNotify 呼び出しより増やさない）。
    runAfterResponse(() => sendRegistrationReceiptEmail({
      email: d.email,
      facilityName: d.facility_name,
      businessType: d.business_type,
      contactName: d.contact_name,
    }).then((sent) => {
      if (!sent) console.error('[salons] Registration receipt email failed to send');
    }).catch((err) => console.error('[salons] Registration receipt email failed', { err })));
  } else {
    runAfterResponse(() => sendNotify({
      type: 'facility',
      data: {
        facility_name: d.facility_name,
        contact_name: d.contact_name,
        email: d.email,
        phone: d.phone,
        business_type: d.business_type,
      },
    }).then((r) => {
      if (!r.ok) console.error('[salons] Slack notification failed', { error: r.error });
    }).catch((err) => console.error('[salons] Slack notification failed', { err })));
  }

  return res;
}, {
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

  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    const { data, error } = await supabase
      .from('salons')
      .select(PUBLIC_SALON_COLUMNS)
      .eq('id', id)
      .eq('is_public', true)
      .single();
    if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
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

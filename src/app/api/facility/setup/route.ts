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
import { businessTypes } from '@/lib/constants';
import { getClientIp } from "@/lib/client-ip";
import { createServiceRoleClient } from '@/lib/supabase-server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { extractPrefecture, extractCity } from '@/lib/japan-address';
import { canonicalizeEmail } from '@/lib/email-canonical';
import { SALON_CLAIM_COOKIE_NAME, verifySalonClaim } from '@/lib/salon-claim';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { mergeSalonRows } from '@/lib/salon-merge';
import type { Database } from '@/types/database-overrides';

type SalonRow = Database['public']['Tables']['salons']['Row'];

// LINE ログインで email 未提供のユーザーに割り当てられる合成メールのドメイン
// （src/app/api/auth/line/callback/route.ts の syntheticLineEmail() が発行元）。
// この形は register フォーム（salons.email）に構造的に絶対一致しないため、
// 無駄な照合をせず「引き継ぎ対象なし」として扱う。
const LINE_SYNTHETIC_EMAIL_DOMAIN = '@line.carelink.local';

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
    //
    // 🔴 突合は canonical（正規化後）で行う。旧実装の `.eq('email', user.email)` はバイト完全一致
    // だったため、salons.email と auth のメールが大文字小文字違い・gmail の "+tag"/ドット違いだと
    // 一致せず引き継ぎが無音で失敗していた（src/lib/email-canonical.ts 参照・bookings/customer_visits
    // と同じ正規化を掲載店舗の引き継ぎにも適用する）。
    //
    // LINE ログインの合成メール（line_<hmac>@line.carelink.local）は register フォームの入力に
    // 構造的に絶対一致しないため、無駄な canonical 照合をせず「引き継ぎ対象なし」として扱う。
    const isLineSyntheticEmail = user.email?.toLowerCase().endsWith(LINE_SYNTHETIC_EMAIL_DOMAIN) ?? false;

    // 【2026年8月20日 新設・所有権の証明】メール一致だけでは所有権の証明にならない（salons.email は
    // 一度も検証されておらず、他人のメールで申し込んだ内容を横取りできてしまう）。POST /api/salons が
    // 成功した「その場のブラウザ」に発行した署名付き HttpOnly Cookie（src/lib/salon-claim.ts）を
    // 最優先の引き継ぎ元とし、Cookie が無い/壊れている/期限切れのときだけ従来のメール一致に倒れる。
    // どちらの経路も「未 claim（claimed_by_user_id が null）」の行に限定する — 片方だけに条件を
    // 付けると、既に他の施設へ取り込み済みの行をもう一方の経路から再取得できてしまい意味が無い。
    // 🔴 候補は「1件だけ」ではなく【全部】集めて統合する。salons.email には UNIQUE が無く、
    //   /register と /recruit は同じ表に別々の行を作る（本番にも同一メールの重複行が実在する）。
    //   最新1件だけを採ると、後から /recruit を出しただけで写真・営業時間・特徴など
    //   /recruit が送らない列が丸ごと消える。列ごとに新しい順で最初の「意味のある値」を採る
    //   mergeSalonRows で統合する（src/lib/salon-merge.ts）。
    //
    // 🔴 取得エラーを握り潰さない。`const { data } = await …` と書くと、列が存在しない
    //   （migration 未適用）ときの PostgREST 400 が data=null になって「申込が無い」と
    //   見分けられず、引き継ぎが【無音で全滅】する。このリポジトリが繰り返し踏んできた
    //   故障そのものなので、必ず error を見て通知する。
    const salonCandidates: SalonRow[] = [];

    const reportSalonLookupFailure = (where: string, err: unknown) => {
      const cause = new Error(
        `[facility/setup] salons lookup failed (${where}) — 引き継ぎが無音で失われる。` +
          `migration 20260820000004(email_canonical) / 20260820000005(claimed_by_user_id) の` +
          `本番適用状況を scripts/diagnose-handoff-readiness.sql で確認すること。` +
          `詳細: ${JSON.stringify(err)}`
      );
      safeCaptureException(cause, 'facility-setup-salon-lookup');
      alertCaughtError('facility-setup-salon-lookup', cause, '/api/facility/setup');
    };

    const claimCookieValue = request.cookies.get(SALON_CLAIM_COOKIE_NAME)?.value;
    const claimedSalonIdFromCookie = claimCookieValue ? verifySalonClaim(claimCookieValue) : null;
    if (claimedSalonIdFromCookie) {
      const { data: cookieSalon, error: cookieSalonErr } = await adminSupabase
        .from('salons')
        .select('*')
        .eq('id', claimedSalonIdFromCookie)
        .is('claimed_by_user_id', null)
        // 運営が却下した申込は引き継がない（メール経路と同じ扱い。下記コメント参照）。
        .or('status.is.null,status.neq.rejected')
        .maybeSingle();
      if (cookieSalonErr) reportSalonLookupFailure('cookie', cookieSalonErr);
      if (cookieSalon) salonCandidates.push(cookieSalon);
    }

    if (user.email && !isLineSyntheticEmail) {
      const { data: emailSalons, error: emailSalonsErr } = await adminSupabase
        .from('salons')
        .select('*')
        .eq('email_canonical', canonicalizeEmail(user.email))
        .is('claimed_by_user_id', null)
        // 運営が却下した申込は引き継がない。
        // 🔴 .neq('status','rejected') と書くと SQL は `status <> 'rejected'` になり、
        //   status が NULL の行は NULL 評価で【除外されてしまう】（salons.status は
        //   DEFAULT 'pending' だが NOT NULL ではない）。却下されていない行を落とすのは
        //   まさにいま潰している「引き継ぎが無音で消える」故障そのものなので、
        //   NULL を明示的に通す形にする。
        .or('status.is.null,status.neq.rejected')
        .order('created_at', { ascending: false });
      if (emailSalonsErr) reportSalonLookupFailure('email', emailSalonsErr);
      for (const row of emailSalons ?? []) salonCandidates.push(row);
    }

    // Cookie 経路とメール経路が同じ行を拾うことがあるので id で重複を除き、新しい順に並べる
    // （mergeSalonRows は「先にある行ほど新しい」ことを前提にする）。
    const seenSalonIds = new Set<string>();
    const dedupedSalons: SalonRow[] = [];
    for (const row of salonCandidates) {
      if (seenSalonIds.has(row.id)) continue;
      seenSalonIds.add(row.id);
      dedupedSalons.push(row);
    }
    dedupedSalons.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

    const salonData: SalonRow | null = mergeSalonRows(dedupedSalons);
    // 統合に使った行は【全部】claim する。1行だけ焼き切ると、残った重複行が未 claim のまま
    // 次の引き継ぎ候補として生き続ける（統合済みの内容がもう一度引き継がれる）。
    const salonIdsToClaim = dedupedSalons.map((row) => row.id);

    if (salonData) {
      facility_name = facility_name || salonData.facility_name;
      business_type = business_type || salonData.business_type;
      phone = phone || salonData.phone;
      address = address || salonData.address;
    }

    // prefecture / city の解決。/search の地域絞り込み（facilities.ts の .eq('prefecture', …)）と
    // getSimilarFacilities / getNearbyFacilities の結合キーで、ここが null のままだと
    // 「公開されているのに地域で探すと出てこない」状態になる（このモジュールの背景）。
    // 優先順位は body（フォームで明示入力）> salonData の列（register の入力を引き継ぐ）
    // > 住所文字列からの復元（zipcloud の address1/address2 が既に自由文へ連結されてしまっている
    //   場合の救済）> null（推測で埋めない。誤った地域を入れるより未設定と分かる方が安全）。
    // salonData は select('*') の生成型に prefecture/city が無くても存在しうる（別担当が
    // salons へ列を追加中）ため、生成型を締め出さずに widen して読む＝列が無ければ
    // undefined になり自然に次の手段（住所からの復元）へ倒れる。
    const salonPrefCity = salonData as { prefecture?: string | null; city?: string | null } | null;
    if (!prefecture) {
      prefecture = salonPrefCity?.prefecture || extractPrefecture(address) || null;
    }
    if (!city) {
      city = salonPrefCity?.city || extractCity(address) || null;
    }

    if (!facility_name || !business_type) {
      return NextResponse.json({ error: '施設名と業種は必須です' }, { status: 400 });
    }

    // 🔴 許認可・届出の表明（利用規約 第12条）はサーバー側で必須にする。
    //   画面側のチェックボックスだけでは、フォームを経由しない POST（curl・拡張機能・
    //   古いタブ）で表明を取らずに施設を作れてしまう。表明を取ったことにする画面は
    //   あるのに記録も強制も無い状態は、【取ったつもりで実際には取れていない】という
    //   最悪の形（規約上の根拠が無いのに有ると誤認する）なので、入口で倒す。
    if (body?.license_warranted !== true) {
      return NextResponse.json(
        { error: '許認可・届出に関する表明への同意が必要です' },
        { status: 400 },
      );
    }
    facility_name = String(facility_name).slice(0, 100);
    business_type = String(business_type).slice(0, 50);

    // 【2026年7月29日・恒久根治】business_type は検索・カテゴリ導線・SEOページの結合キーだが
    // DB に CHECK 制約が無く、任意の文字列を保存できていた。実際に本番で「まつげ・眉毛サロン」
    // 「hair_salon」のような正規タクソノミー外の値が保存され、トップページのカテゴリタイル・
    // 悩みナビ・特集バナー・/type/* が全て 0 件になり、掲載施設に到達する導線が消えていた
    // （施設は存在するのに誰も辿り着けない無音の断線）。
    // 値の妥当性は保存の入口で検証し、ズレた値がそもそも入らないようにする。
    if (!businessTypes.includes(business_type)) {
      return NextResponse.json(
        { error: `業種は次のいずれかを選択してください：${businessTypes.join('、')}` },
        { status: 400 },
      );
    }
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

    // 【2026年8月20日 新設】salons 行の claim を条件付き UPDATE（CAS）で立てる。
    // 前例: src/app/api/cron/onboarding-followup/route.ts の
    // `.is('registration_followup_sent_at', null)` 付き `.update().select('id')`。
    // 選定（上の SELECT）と本 UPDATE の間で別リクエストが先に claim した場合（TOCTOU）は
    // claimedRows が 0 件になる。エラーにはしない — facility_profiles への引き継ぎ自体は
    // 既に確定しており、claim という「印」だけを競合相手に譲る fail-open（(e) と同型）。
    // 以降の facility_members insert が失敗した場合は、下のロールバック経路でこの claim を
    // 必ず解放する（解放しないと当該 salons 行が永久に取り込み不能になる＝永久ロックアウト）。
    // 🔴 統合に使った行を【全部】claim する。1行だけ焼き切ると、統合で中身を吸い上げた
    //   残りの重複行が未 claim のまま次の候補として生き続け、同じ内容がもう一度引き継がれる。
    let claimedSalonIds: string[] = [];
    if (salonIdsToClaim.length > 0) {
      const { data: claimedRows, error: claimErr } = await adminSupabase
        .from('salons')
        .update({ claimed_by_user_id: user.id, claimed_at: new Date().toISOString() })
        .in('id', salonIdsToClaim)
        .is('claimed_by_user_id', null)
        .select('id');
      if (claimErr) {
        console.error('[facility/setup] salon claim update failed', { salonIds: salonIdsToClaim, err: claimErr });
      } else if (claimedRows) {
        claimedSalonIds = claimedRows.map((row: { id: string }) => row.id);
      }
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
      // claim も必ず解放する。解放しないと当該 salons 行が二度と取り込めない永久ロックアウトになる
      // （claimed_by_user_id が非 null のまま残り、以後どのユーザーの facility/setup からも
      //  「未 claim の行」として選定されなくなる）。.eq('claimed_by_user_id', user.id) は
      // 自分が立てた claim だけを戻す防御（万一の別経路での再 claim を巻き込まない）。
      if (claimedSalonIds.length > 0) {
        const { error: claimReleaseErr } = await adminSupabase
          .from('salons')
          .update({ claimed_by_user_id: null, claimed_at: null })
          .in('id', claimedSalonIds)
          .eq('claimed_by_user_id', user.id);
        if (claimReleaseErr) console.error('[facility/setup] claim release failed — salon permanently locked', { salonIds: claimedSalonIds, err: claimReleaseErr });
      }
      return NextResponse.json({ error: 'オーナー登録に失敗しました' }, { status: 500 });
    }

    // claim を監査ログへ記録する（他人の入力を自分の施設へ取り込む操作のため事後追跡が要る）。
    // AuditAction の14種に「claim」に直接合う値は無いため、salons 行に対する状態変更として
    // src/app/api/admin/registrations/[id]/route.ts が approve/reject に当たらない更新で
    // 使っているのと同じ 'update' を使う（新しい値を勝手に増やさない）。
    if (claimedSalonIds.length > 0) {
      const { ip: auditIp, ua } = getRequestContext(request);
      for (const claimedId of claimedSalonIds) {
        void writeAuditLog({
          userId: user.id,
          facilityId: facility.id,
          action: 'update',
          tableName: 'salons',
          recordId: claimedId,
          oldValues: { claimed_by_user_id: null, claimed_at: null },
          newValues: { claimed_by_user_id: user.id },
          ipAddress: auditIp,
          userAgent: ua,
        });
      }
    }

    // 🔴 表明そのものを監査ログへ残す。列を新設せず audit_logs に置くのは、
    //   (a) 「いつ・誰が・どの端末から」同意したかまで残るのは監査ログ側だけであり、
    //   (b) 新しい列を足すと migration の本番適用より先にデプロイが出た瞬間に
    //       施設作成が全滅する（このリポジトリが繰り返し踏んできた順序事故）ため。
    //   表明の文面は利用規約 第12条で、時点の文面は git 履歴と created_at で特定できる。
    {
      const { ip: attestIp, ua: attestUa } = getRequestContext(request);
      void writeAuditLog({
        userId: user.id,
        facilityId: facility.id,
        action: 'create',
        tableName: 'facility_profiles',
        recordId: facility.id,
        newValues: { license_warranted: true, terms_article: '第12条' },
        ipAddress: attestIp,
        userAgent: attestUa,
      });
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

    const successRes = NextResponse.json({
      success: true,
      facilityId: facility.id,
      slug: uniqueSlug,
      message: '施設を作成しました。管理画面からメニューやスタッフを登録してください。',
    });

    // 🔴 claim Cookie は【一度使ったら消す】。署名の期限は発行から3日あるため、消さないと
    //   同じブラウザで別の人がサインアップしたときに同じ Cookie がもう一度通り、
    //   前の人が入力した申込内容（住所・電話・写真）をその人の施設へ取り込めてしまう。
    //   共用端末・店頭端末で現実に起こり得る。使い終わった時点で無効化するのが正しい。
    //   claim できなかった場合（既に他人が取り込み済み等）も、その Cookie はもう何にも
    //   使えないので同様に消す（無効な資格情報を端末に残さない）。
    if (claimCookieValue) {
      successRes.cookies.set(SALON_CLAIM_COOKIE_NAME, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
      });
    }

    return successRes;
  } catch (e) {
    safeCaptureException(e, 'api/facility/setup');
    alertCaughtError('api/facility/setup', e, '/api/facility/setup');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

import { logCronRun } from '@/lib/cron-logger';
import { errorMessage } from '@/lib/err';
/**
 * お気に入り施設ダイジェスト Cron（v8.25）
 * GET /api/cron/favorites-digest
 * 毎週月曜 9:00 JST: お気に入り施設の新着情報をメール通知（週1回のみ）
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendFavoritesDigest, generateUnsubscribeToken } from '@/lib/email';
import { checkCronAuth } from '@/lib/cron-auth';
import { fetchAllPaged } from '@/lib/paginate';

export const dynamic = 'force-dynamic';
// 既定の低い上限を上書きし、下の時間予算ガードが確実に発火する既知の上限を与える。
export const maxDuration = 60;
// 送信ループの実時間予算。maxDuration(60s) 未満に設定し、超えたら残りを翌 run へ繰延。
const DIGEST_BUDGET_MS = 50 * 1000;

/** Returns the ISO week string "YYYY-WNN" for a given date. */
function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  // 遅延初期化: モジュールスコープで createClient を呼ぶとビルド時の
  // page data 収集フェーズで env 未設定環境（Vercel preview 等）が
  // "supabaseUrl is required" で落ちるため、リクエスト時に生成する。
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let sent = 0;
  let skipped = 0;
  const startedAt = new Date();
  const thisWeek = isoWeek(startedAt);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    // お気に入りを持つユーザー一覧を全件ページング取得（旧 .limit(500) は500行超で一部ユーザーの
    // ダイジェストが恒常的に欠落していた・本番監査）。
    const { rows: favUsers, error: favUsersError } = await fetchAllPaged<{ user_id: string; facility_id: string }>(
      async (offset, limit) => {
        const { data, error } = await supabase
          .from('favorites')
          .select('user_id, facility_id')
          .range(offset, offset + limit - 1);
        return { data: data as { user_id: string; facility_id: string }[] | null, error };
      },
    );

    // 先頭ページで DB エラーが出ると rows=[] となり「0 件＝skipped 成功」に化けて無音スキップになる。
    // error を error ログ＋500 で可視化する。
    if (favUsersError) {
      await logCronRun('favorites-digest', 'error', startedAt, { error_msg: errorMessage(favUsersError) });
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

    // favUsers は fetchAllPaged の戻り（常に配列）なので length 判定のみ（!favUsers は到達不能=branch穴）。
    // ログ・返却は main 側のリッチ版（superset）に統一。
    if (favUsers.length === 0) {
      await logCronRun('favorites-digest', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ processed: 0, skipped: 0, success: true, sent: 0 });
    }

    // ユーザーごとにお気に入り施設をグループ化
    const userFacilityMap = new Map<string, string[]>();
    for (const f of favUsers) {
      if (!userFacilityMap.has(f.user_id)) userFacilityMap.set(f.user_id, []);
      userFacilityMap.get(f.user_id)!.push(f.facility_id);
    }

    const allFacilityIds = Array.from(new Set(favUsers.map((f) => f.facility_id)));
    const FID_CHUNK = 1000;

    // 以下 3 つの .in('facility_id', allFacilityIds) は、お気に入りされた施設が 1000 件超だと
    // (a) URL 長制限 / (b) db-max-rows(1000) の二重で頭打ちし、一部施設の新着・施設情報が欠落して
    // 該当ユーザーのダイジェストから silent に抜け落ちる。施設 ID を 1000 件ずつ chunk し、
    // 各 chunk を全件ページングで取得して取りこぼしを解消する。
    const couponCountMap = new Map<string, number>();
    const newMenuFacilities = new Set<string>();
    const facilityMap = new Map<string, { id: string; name: string; slug: string }>();

    for (let i = 0; i < allFacilityIds.length; i += FID_CHUNK) {
      const idChunk = allFacilityIds.slice(i, i + FID_CHUNK);

      // 各施設の新着情報（クーポン）
      const { rows: newCoupons } = await fetchAllPaged<{ facility_id: string; id: string }>(
        async (offset, limit) => {
          const { data, error } = await supabase
            .from('coupons')
            .select('facility_id, id')
            .in('facility_id', idChunk)
            .gte('created_at', since)
            .eq('is_active', true)
            .range(offset, offset + limit - 1);
          return { data: data as { facility_id: string; id: string }[] | null, error };
        },
      );
      for (const c of newCoupons) {
        couponCountMap.set(c.facility_id, (couponCountMap.get(c.facility_id) || 0) + 1);
      }

      // 新メニュー追加された施設
      const { rows: newMenus } = await fetchAllPaged<{ facility_id: string }>(
        async (offset, limit) => {
          const { data, error } = await supabase
            // facility_menus に is_active 列は存在しない（公開メニュー表示も is_published 等で絞らず全件表示）。
            // 存在しない列での絞り込みは PostgREST 400 になり新メニュー判定が無音で死ぬため除去（#176 と同方針）。
            .from('facility_menus')
            .select('facility_id')
            .in('facility_id', idChunk)
            .gte('created_at', since)
            .range(offset, offset + limit - 1);
          return { data: data as { facility_id: string }[] | null, error };
        },
      );
      for (const m of newMenus) newMenuFacilities.add(m.facility_id);

      // 施設情報
      const { rows: facilities } = await fetchAllPaged<{ id: string; name: string; slug: string }>(
        async (offset, limit) => {
          const { data, error } = await supabase
            .from('facility_profiles')
            .select('id, name, slug')
            .in('id', idChunk)
            .range(offset, offset + limit - 1);
          return { data: data as { id: string; name: string; slug: string }[] | null, error };
        },
      );
      for (const f of facilities) facilityMap.set(f.id, f);
    }

    // ユーザー情報とメール送信
    // .in('id', userIds) は db-max-rows(1000) で頭打ちになるため 1000 件ずつ chunk し、
    // 各 chunk も全件ページングで取得する（お気に入りユーザーが 1000 人超でも全員分の profile を取得）。
    const userIds = Array.from(userFacilityMap.keys());
    const ID_CHUNK = 1000;
    type ProfileRow = { id: string; display_name: string | null; email_unsubscribed: boolean | null; favorites_digest_sent_week: string | null };
    const profiles: ProfileRow[] = [];
    for (let i = 0; i < userIds.length; i += ID_CHUNK) {
      const idChunk = userIds.slice(i, i + ID_CHUNK);
      const { rows } = await fetchAllPaged<ProfileRow>(
        async (offset, limit) => {
          const { data, error } = await supabase
            .from('profiles')
            .select('id, display_name, email_unsubscribed, favorites_digest_sent_week')
            .in('id', idChunk)
            .range(offset, offset + limit - 1);
          return { data: data as ProfileRow[] | null, error };
        },
      );
      profiles.push(...rows);
    }

    // auth ユーザーのメールを全ページ取得（旧実装は perPage:1000 の1ページのみ取得で、
    // ユーザー総数が 1000 を超えると 1001 件目以降の email が引けず該当ユーザーが silent に skip されていた）。
    const emailMap = new Map<string, string | undefined>();
    for (let page = 1; ; page++) {
      const { data: authUsers, error: authErr } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (authErr) {
        console.error('[favorites-digest] listUsers failed', { page, err: authErr });
        break;
      }
      const users = authUsers?.users || [];
      for (const u of users) emailMap.set(u.id, u.email);
      if (users.length < 1000) break; // 端数ページ＝最終ページ
    }

    let deferred = 0;
    const loopStart = Date.now();
    for (const profile of profiles) {
      // 時間予算超過で残りを翌 run へ繰延（ハード timeout で全停止するより graceful。
      // sent_week の CAS により未送ユーザーのみ次回処理され二重送信もしない）。
      if (Date.now() - loopStart > DIGEST_BUDGET_MS) {
        deferred = profiles.length - sent - skipped;
        console.warn('[favorites-digest] time budget exceeded, deferring rest to next run', { deferred });
        break;
      }
      if (profile.email_unsubscribed) { skipped++; continue; }
      // Skip if already sent this week (idempotency for double-fire)
      if (profile.favorites_digest_sent_week === thisWeek) { skipped++; continue; }

      const email = emailMap.get(profile.id);
      if (!email) { skipped++; continue; }

      const facilityIds = userFacilityMap.get(profile.id) || [];

      // 新着がある施設のみ
      const updatedFacilities = facilityIds
        .filter((fid) => couponCountMap.has(fid) || newMenuFacilities.has(fid))
        .map((fid) => {
          const fac = facilityMap.get(fid);
          if (!fac) return null;
          return {
            name: fac.name,
            slug: fac.slug,
            newCoupons: couponCountMap.get(fid) || 0,
            hasNewMenus: newMenuFacilities.has(fid),
          };
        })
        .filter(Boolean) as { name: string; slug: string; newCoupons: number; hasNewMenus: boolean }[];

      if (updatedFacilities.length === 0) { skipped++; continue; }

      // Claim this week's slot before sending (CAS guard).
      // 条件は「まだ今週送っていない」= favorites_digest_sent_week が NULL または thisWeek 以外。
      // 旧実装は `.neq('favorites_digest_sent_week', thisWeek)` 単独だったが、PostgREST の neq は
      // SQL `<>` を生成し、三値論理により `NULL <> 'YYYY-WNN'` は NULL（真でない）と評価されて
      // WHERE から除外される。favorites_digest_sent_week は列 DEFAULT が無く全ユーザー NULL 始まりで、
      // この列に非 NULL を書くのはこの CAS だけのため、NULL 行が永久に claim されず
      // 「お気に入りダイジェストが誰にも一度も送信されない」恒久バグだった。
      // `.or(is.null, neq)` で NULL 行も claim 対象に含める（他 cron の .is(col,null) と同方針）。
      const { data: claimed } = await supabase
        .from('profiles')
        .update({ favorites_digest_sent_week: thisWeek })
        .eq('id', profile.id)
        .or(`favorites_digest_sent_week.is.null,favorites_digest_sent_week.neq.${thisWeek}`)
        .select('id');

      if (!claimed || claimed.length === 0) { skipped++; continue; } // Another invocation claimed it

      // 配信停止トークン生成・保存
      const token = generateUnsubscribeToken();
      const { error: tokenErr } = await supabase.from('email_unsubscribe_tokens').insert({
        token,
        user_id: profile.id,
      });
      if (tokenErr) console.error('[favorites-digest] unsubscribe token insert failed', { userId: profile.id, err: tokenErr });

      // sendFavoritesDigest は throw せず送達可否を boolean で返す（safeSend 仕様）。
      const ok = await sendFavoritesDigest({
        userEmail: email,
        userName: profile.display_name ?? undefined,
        facilities: updatedFacilities,
        unsubscribeToken: token,
      });
      if (ok) {
        sent++;
      } else {
        console.error('[favorites-digest] email send failed', { userId: profile.id });
        // 送信が一過性失敗した場合、claim（sent_week=thisWeek）を握ったままにすると
        // 当該ユーザーはその週ずっと skip され恒久 miss になる。claim を直前の値へ戻し、
        // 同週の再 run で再送できるようにする（review-request と同じ恒久 miss 防止方針）。
        const { error: releaseErr } = await supabase
          .from('profiles')
          .update({ favorites_digest_sent_week: profile.favorites_digest_sent_week })
          .eq('id', profile.id);
        if (releaseErr) console.error('[favorites-digest] claim release failed', { userId: profile.id, err: releaseErr });
      }
    }

    await logCronRun('favorites-digest', 'success', startedAt, { processed: sent, skipped, meta: { deferred } });
    return NextResponse.json({ processed: sent, skipped, deferred });
  } catch (e) {
    console.error('favorites-digest error', e);
    await logCronRun('favorites-digest', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'error', sent }, { status: 500 });
  }
}

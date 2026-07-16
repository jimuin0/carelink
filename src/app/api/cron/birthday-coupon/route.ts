import { logCronRun } from '@/lib/cron-logger';
import { errorMessage } from '@/lib/err';
/**
 * 誕生日クーポン自動送信 Cron（v8.16）
 * GET /api/cron/birthday-coupon
 * 誕生日のユーザーに100ptボーナスとメール通知を送信
 *
 * v8.15 変更: ポイント付与済みでも通知失敗チャネルを翌 run で再送するよう改修。
 *   birthday_notifications テーブルで送達済みチャネルを管理し、
 *   失敗時は記録しないことで次回 run が再送を試みる（恒久 miss 解消）。
 *
 * v8.16 変更（2026年7月16日）: 誕生日検索を `.filter('birth_date::text','like',...)` から
 *   `.eq('birth_md', todayMD)` に切替。旧実装は PostgREST が date→text キャストの LIKE を
 *   演算子不在（42883・date ~~ unknown）で毎日 cron_logs に error 記録し本番で全滅していた。
 *   `birth_md` は migration 20260705000001 で追加済みの生成列（GENERATED ALWAYS STORED・索引付き）。
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { sendLineText } from '@/lib/line';
import { checkCronAuth } from '@/lib/cron-auth';
import { alertDeliveryFailures } from '@/lib/alert';
import { fetchAllPaged } from '@/lib/paginate';

export const dynamic = 'force-dynamic';
// 全プラン安全な明示値（Hobby 上限60s / Pro 上限300s のいずれでも有効）。
// 既定の低い値を上書きし、下の SEND_BUDGET_MS による予算ガードが確実に発火する既知の上限を与える。
// 旧実装はこの予算ガードが無く、同日誕生日が多いと送信ループがハード timeout で強制終了し、
// 「本日が誕生日」条件のため中断分は翌 run では対象外になり、その年の特典・通知が恒久欠落していた。
export const maxDuration = 60;
// 送信ループの実時間予算。maxDuration(60s) 未満に設定し、超えたら graceful に打ち切って
// deferred 件数を LOUD にログする。ポイント付与(reason=birthday_YYYY の unique index)と
// birthday_notifications はいずれも年内冪等のため、deferred が出た日は workflow_dispatch で
// 同日中に再実行すれば既処理ユーザーは 23505 / notifiedSet で skip され、残りだけ処理される。
const SEND_BUDGET_MS = 50 * 1000;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://carelink-jp.com';
const FROM = process.env.EMAIL_FROM || 'CareLink <noreply@carelink-jp.com>';
const BIRTHDAY_POINTS = 100;

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

  const startedAt = new Date();
  try {
    // 今日の日付（月・日のみ）
    const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const month = (jstNow.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = jstNow.getUTCDate().toString().padStart(2, '0');
    const todayMD = `${month}-${day}`;

    // birth_dateが今日（月日一致）のプロフィールを取得。
    //
    // 【本番500根治・2026年7月16日】旧実装は `.filter('birth_date::text', 'like', ...)` で
    // PostgREST に date→text キャストの LIKE を投げていたが、PostgREST はこのキャスト付き
    // フィルタを SQL へ素直に落とせず `date ~~ unknown`（演算子不在・42883）で本番 500 が
    // 毎日発生していた（cron_logs 実測・本 PR で prod service_role 直叩きで再現確認済み）。
    // 過去の "fix" (#286) はこの ::text キャストを追加しただけで、実際には直っていなかった。
    //
    // 恒久対策として migration 20260705000001_profiles_birth_md_prod_catchup.sql で
    // `profiles.birth_md`（IMMUTABLE な extract+lpad で組み立てた 'MM-DD' 生成列・GENERATED
    // ALWAYS STORED・索引付き）を追加済み（神原さんが本番へ適用済み・本 PR で prod 実データ
    // 確認済み）。当時のコメントでアプリ側の追従 PR が別途必要と明記されていたが未実施のまま
    // 放置されていたため、本 PR でその追従（`.eq('birth_md', todayMD)` への切替）を行う。
    // birth_date が NULL の行は birth_md も NULL のため `.not('birth_date','is',null)` は
    // 実質冗長だが、意図の明示と既存カバレッジ分岐を壊さないため維持する。
    // 本日が誕生日の profiles を全件ページング取得（旧 .limit(500) は同日誕生日が500人超で501人目以降に
    // ポイント付与・通知漏れ。本番監査）。email_unsubscribed も取得しメール送信のみ抑止する。
    type BirthdayProfile = { id: string; email: string | null; display_name: string | null; email_unsubscribed: boolean | null };
    const { rows: profiles, error: profilesError } = await fetchAllPaged<BirthdayProfile>(
      async (offset, limit) => {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, email, display_name, email_unsubscribed')
          .not('birth_date', 'is', null)
          .eq('birth_md', todayMD)
          .range(offset, offset + limit - 1);
        return { data: data as BirthdayProfile[] | null, error };
      },
    );

    // 先頭ページで DB エラーが出ると rows=[] となり「0 件＝skipped 成功」に化けて無音スキップになる。
    // error を error ログ＋500 で可視化する。
    if (profilesError) {
      await logCronRun('birthday-coupon', 'error', startedAt, { error_msg: errorMessage(profilesError) });
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

    // profiles は fetchAllPaged の戻り（常に配列）なので length 判定のみ（!profiles は到達不能=branch穴になる）。
    // ログ・返却は main 側のリッチ版（processed/skipped/status/sent を全て返す superset）に統一。
    if (profiles.length === 0) {
      await logCronRun('birthday-coupon', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ processed: 0, skipped: 0, status: 'ok', sent: 0 });
    }

    const birthdayYear = jstNow.getUTCFullYear();
    // Reason includes the year so the partial unique index (user_id, reason WHERE reason LIKE 'birthday_%')
    // atomically prevents double-awarding even if two cron instances run concurrently.
    const birthdayReason = `birthday_${birthdayYear}`;

    // 当年・全プロフィールの通知送達済みチャネルを一括取得してローカル Set に展開。
    // `${userId}:${channel}` 形式のキーで O(1) 検索。
    const profileIds = profiles.map((p) => p.id);
    const { data: existingNotifications, error: notifSelErr } = await supabase
      .from('birthday_notifications')
      .select('user_id, channel')
      .eq('year', birthdayYear)
      .in('user_id', profileIds);
    // birthday_notifications が未適用（migration 前にコードが先行デプロイ）や取得失敗時は
    // 送達管理ができない。再送ロジックを有効にすると notifiedSet が空のまま 23505（既付与）
    // ユーザーへ毎 run 通知を送り重複が出るため、旧来の冪等動作（23505 はスキップ）に
    // フォールバックする。これによりデプロイ順序に依存せず重複通知を防ぐ（発症前予防）。
    const notificationsTableReady = !notifSelErr;
    if (notifSelErr) {
      console.warn('[birthday-coupon] birthday_notifications 取得失敗のため再送ロジックを無効化（migration 未適用の可能性）', { code: (notifSelErr as { code?: string }).code });
    }
    const notifiedSet = new Set(
      (existingNotifications || []).map((n) => `${n.user_id}:${n.channel}`)
    );

    let sent = 0;
    let skipped = 0;
    let deferred = 0;
    let deliveryFailures = 0;
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

    const loopStart = Date.now();
    for (let pi = 0; pi < profiles.length; pi++) {
      const profile = profiles[pi];
      // 実時間予算ガード: 超過したら残りを graceful に打ち切る（ハード timeout での強制終了を避ける）。
      // deferred を LOUD にログして可視化する。ポイント/通知は年内冪等のため、同日中に
      // workflow_dispatch で再実行すれば残りだけが処理され二重付与・二重通知は起きない。
      if (Date.now() - loopStart > SEND_BUDGET_MS) {
        deferred = profiles.length - pi;
        console.warn('[birthday-coupon] time budget exceeded, deferring rest (re-run same day via workflow_dispatch to catch up)', { deferred, processed: sent, skipped });
        break;
      }
      const name = profile.display_name || 'お客様';

      // 誕生日ポイント付与（unique index が 23505 を返せばスキップ — TOCTOU対策）
      const { error: insertErr } = await supabase.from('user_points').insert({
        user_id: profile.id,
        points: BIRTHDAY_POINTS,
        reason: birthdayReason,
      });

      if (insertErr) {
        if ((insertErr as { code?: string }).code === '23505') {
          // 既付与済み: ポイントは届いている。通知未送達チャネルがあれば再送するため
          // continue せずにそのまま通知ブロックへ進む。
          // ただし送達管理テーブルが未適用なら重複送信を招くため旧来どおりスキップ。
          if (!notificationsTableReady) { skipped++; continue; }
        } else {
          // DB エラー: 通知も安全に送れないためスキップ。
          console.error('[birthday-coupon] points insert error:', insertErr);
          skipped++;
          continue;
        }
      }

      // メール通知（未送達かつ送信可能な場合のみ）
      if (resend && profile.email && !profile.email_unsubscribed && !notifiedSet.has(`${profile.id}:email`)) {
        try {
          await resend.emails.send({
            from: FROM,
            to: profile.email,
            subject: '🎂 お誕生日おめでとうございます！CareLink より',
            html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;line-height:1.6;max-width:600px;margin:0 auto;padding:20px;">
              <div style="text-align:center;margin-bottom:24px;"><strong style="color:#0ea5e9;font-size:20px;">CareLink</strong></div>
              <div style="text-align:center;padding:32px;background:linear-gradient(135deg,#fef9c3,#fff);border-radius:16px;margin-bottom:24px;">
                <p style="font-size:32px;margin:0 0 8px;">🎂</p>
                <p style="font-size:24px;font-weight:bold;color:#0ea5e9;margin:0;">${name}様、お誕生日おめでとうございます！</p>
              </div>
              <p>本日のお誕生日を記念して、<strong>${BIRTHDAY_POINTS}ポイント</strong>をプレゼントしました🎁</p>
              <p>ポイントは次回の予約時にお使いいただけます。ぜひお気に入りの施設を予約してお楽しみください！</p>
              <p style="text-align:center;margin-top:24px;">
                <a href="${SITE_URL}/mypage/points" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">ポイントを確認する</a>
              </p>
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 16px;" />
              <p style="font-size:12px;color:#94a3b8;text-align:center;">このメールは <a href="${SITE_URL}" style="color:#0ea5e9;">CareLink</a> から自動送信されています。</p>
            </body></html>`,
          });
          // 送信成功: 送達記録を追加（失敗時は記録しないため翌 run で再送される）。
          // テーブル未適用時は記録できないため insert を呼ばない（初回付与時のみここに到達するため
          // 旧来動作と同じく1通だけ送信される＝重複なし）。
          if (notificationsTableReady) {
            await supabase.from('birthday_notifications').insert({
              user_id: profile.id,
              year: birthdayYear,
              channel: 'email',
            });
          }
          notifiedSet.add(`${profile.id}:email`);
        } catch (err) {
          deliveryFailures++;
          console.error('[birthday-coupon] email send failed', { userId: profile.id, err });
        }
      }

      // LINE通知（未送達かつ送信可能な場合のみ）
      if (process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK && !notifiedSet.has(`${profile.id}:line`)) {
        const { data: lineLink } = await supabase
          .from('line_user_links')
          .select('line_user_id')
          .eq('user_id', profile.id)
          .maybeSingle();

        if (lineLink?.line_user_id) {
          try {
            // sendLineText はリトライ上限到達時に throw せず false を返す。戻り値を見ずに送達記録すると
            // 全リトライ失敗でも「送達済み」となり翌 run の再送（v8.15）が LINE チャネルで成立しない。
            const lineOk = await sendLineText(
              lineLink.line_user_id,
              `🎂 ${name}様、お誕生日おめでとうございます！\n\n本日のお誕生日を記念して、${BIRTHDAY_POINTS}ポイントをプレゼントしました🎁\n\n次回の予約にぜひご利用ください！\n${SITE_URL}/mypage/points`
            );
            if (lineOk) {
              // 送信成功: 送達記録を追加（テーブル未適用時は記録できないため skip）
              if (notificationsTableReady) {
                await supabase.from('birthday_notifications').insert({
                  user_id: profile.id,
                  year: birthdayYear,
                  channel: 'line',
                });
              }
              notifiedSet.add(`${profile.id}:line`);
            } else {
              // 送達失敗は記録せず notifiedSet にも入れない＝翌 run で再送される。
              deliveryFailures++;
              console.error('[birthday-coupon] LINE send failed (retries exhausted)', { userId: profile.id });
            }
          } catch (err) {
            deliveryFailures++;
            console.error('[birthday-coupon] LINE send failed', { userId: profile.id, err });
          }
        }
      }

      if (!insertErr) {
        sent++;
      } else {
        // 23505: ポイントは既付与済み（今回は通知のみ再送を試みた）
        skipped++;
      }
    }

    alertDeliveryFailures('birthday-coupon', deliveryFailures, { sent, skipped });
    await logCronRun('birthday-coupon', 'success', startedAt, { processed: sent, skipped, meta: { deferred } });
    return NextResponse.json({ processed: sent, skipped, deferred, total: profiles.length });
  } catch (e) {
    console.error('[birthday-coupon] Error:', e);
    await logCronRun('birthday-coupon', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

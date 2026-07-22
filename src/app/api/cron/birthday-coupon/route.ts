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
import { resolveLineUserIdForUser } from '@/lib/line-link';
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

    // 【claim-first 設計・2026-07-17】
    // 旧実装（v8.15）は「run 開始時に birthday_notifications を一括 SELECT → notifiedSet 判定
    // → 送信を先に実行 → 送信後に INSERT」という send-then-flag 構成だった。cron は三重化
    // （GitHub Actions + pg_cron + Render）で毎日 23:00 JST 頃にほぼ同時発火するため、複数 run が
    // 同時に走ると各 run の notifiedSet は互いの結果を見られず両方とも空のまま送信してしまい、
    // 誕生日メール/LINE の二重送信が発生していた。INSERT の PK(user_id,year,channel) は片方が
    // 23505 になるが、それは両 run の送信が両方完了した後にしか効かず無意味だった。
    // review-request cron（review_request_sent_at への CAS UPDATE）と同型の「claim-first」に揃える。
    // 送信の直前に INSERT で「送信権」を claim し、PK 違反(23505)なら他 run が先取り済みとして
    // 送信をスキップする。送信が失敗したら claim を解放（DELETE）して翌 run に再送を委ねる。
    // クラッシュ等で解放自体が失敗した場合はその1件・当年のみ通知がロストし得る（稀・許容トレード
    // オフ）が、二重送信という実害の大きい失敗モードを避けることを優先する設計判断。
    // notificationsTableReady=false（migration 未適用/取得失敗）のフォールバック時は claim による
    // 相互排他ができないため、旧来どおり claim せず直接送信する（挙動は変更しない）。

    // claim（送信前 INSERT）ヘルパー。email/LINE 両チャネルで共有。
    // 戻り値: 'claimed'=送信して良い / 'already-claimed'=他run先取り済み（送信せず送達扱い）/
    // 'claim-error'=記録できないため fail-safe で送信自体をスキップ（送達扱いにはしない＝翌runで再試行）。
    const claimNotification = async (
      userId: string,
      channel: 'email' | 'line'
    ): Promise<'claimed' | 'already-claimed' | 'claim-error'> => {
      const { error: claimErr } = await supabase.from('birthday_notifications').insert({
        user_id: userId,
        year: birthdayYear,
        channel,
      });
      if (!claimErr) return 'claimed';
      if ((claimErr as { code?: string }).code === '23505') return 'already-claimed';
      console.error(`[birthday-coupon] ${channel} claim insert error (skip send, fail-safe)`, { userId, err: claimErr });
      return 'claim-error';
    };

    // claim 解放（送信失敗時に DELETE で claim を取り消し、翌 run の再送を可能にする）。
    const releaseNotificationClaim = async (userId: string, channel: 'email' | 'line') => {
      const { error: releaseErr } = await supabase
        .from('birthday_notifications')
        .delete()
        .eq('user_id', userId)
        .eq('year', birthdayYear)
        .eq('channel', channel);
      if (releaseErr) {
        // 解放にも失敗した場合、この1件は claim されたまま残り当年の当該チャネル通知は
        // 恒久的にロストし得る（クラッシュ等の稀なケース・許容トレードオフ）。可視化のみ行う。
        console.error(`[birthday-coupon] ${channel} claim release failed (notification lost for this year)`, { userId, err: releaseErr });
      }
    };

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

      const emailSubject = '🎂 お誕生日おめでとうございます！CareLink より';
      const emailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;line-height:1.6;max-width:600px;margin:0 auto;padding:20px;">
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
            </body></html>`;
      const lineMessage = `🎂 ${name}様、お誕生日おめでとうございます！\n\n本日のお誕生日を記念して、${BIRTHDAY_POINTS}ポイントをプレゼントしました🎁\n\n次回の予約にぜひご利用ください！\n${SITE_URL}/mypage/points`;

      // メール通知（未送達かつ送信可能な場合のみ）
      if (resend && profile.email && !profile.email_unsubscribed && !notifiedSet.has(`${profile.id}:email`)) {
        if (notificationsTableReady) {
          const claimResult = await claimNotification(profile.id, 'email');
          if (claimResult === 'already-claimed') {
            // 他 run が先に claim・送信済み（またはまさに送信中）。二重送信を避けて送らない。
            notifiedSet.add(`${profile.id}:email`);
          } else if (claimResult === 'claimed') {
            // claim 成功: このチャネルの送信権を獲得。実際に送信する。
            try {
              await resend.emails.send({ from: FROM, to: profile.email, subject: emailSubject, html: emailHtml });
              notifiedSet.add(`${profile.id}:email`);
            } catch (err) {
              deliveryFailures++;
              console.error('[birthday-coupon] email send failed', { userId: profile.id, err });
              // 送信失敗: claim を解放して翌 run の再送を可能にする。
              await releaseNotificationClaim(profile.id, 'email');
            }
          }
          // claim-error: 送信自体をスキップ（claimNotification 内で既にログ済み・notifiedSet にも入れない）
        } else {
          // 【notificationsTableReady=false フォールバック・現行挙動を維持】
          // claim による相互排他ができないため、旧来どおり claim せず直接送信し記録 insert はしない。
          // ここに到達するのは初回付与時のみ（23505 側は notificationsTableReady=false だと
          // 上流で skip される）なので1通だけ送信され重複は生じない。
          try {
            await resend.emails.send({ from: FROM, to: profile.email, subject: emailSubject, html: emailHtml });
            notifiedSet.add(`${profile.id}:email`);
          } catch (err) {
            deliveryFailures++;
            console.error('[birthday-coupon] email send failed', { userId: profile.id, err });
          }
        }
      }

      // LINE通知（未送達かつ送信可能な場合のみ）
      if (process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK && !notifiedSet.has(`${profile.id}:line`)) {
        // 【監査C2】連携の単一ソース profiles.line_user_id で解決（line_user_links.user_id は常にNULL）。
        const birthdayLineUserId = await resolveLineUserIdForUser(supabase, profile.id);

        if (birthdayLineUserId) {
          if (notificationsTableReady) {
            const claimResult = await claimNotification(profile.id, 'line');
            if (claimResult === 'already-claimed') {
              notifiedSet.add(`${profile.id}:line`);
            } else if (claimResult === 'claimed') {
              try {
                // sendLineText はリトライ上限到達時に throw せず false を返す。戻り値を見ずに
                // delivered 扱いすると、全リトライ失敗でも claim が残ったまま（翌 run の再送(v8.15)が
                // 成立しない）ため、戻り値を必ず見て失敗時は claim を解放する。
                const lineOk = await sendLineText(birthdayLineUserId, lineMessage);
                if (lineOk) {
                  notifiedSet.add(`${profile.id}:line`);
                } else {
                  deliveryFailures++;
                  console.error('[birthday-coupon] LINE send failed (retries exhausted)', { userId: profile.id });
                  await releaseNotificationClaim(profile.id, 'line');
                }
              } catch (err) {
                deliveryFailures++;
                console.error('[birthday-coupon] LINE send failed', { userId: profile.id, err });
                await releaseNotificationClaim(profile.id, 'line');
              }
            }
            // claim-error: 送信自体をスキップ
          } else {
            // 【notificationsTableReady=false フォールバック・現行挙動を維持】
            try {
              const lineOk = await sendLineText(birthdayLineUserId, lineMessage);
              if (lineOk) {
                notifiedSet.add(`${profile.id}:line`);
              } else {
                deliveryFailures++;
                console.error('[birthday-coupon] LINE send failed (retries exhausted)', { userId: profile.id });
              }
            } catch (err) {
              deliveryFailures++;
              console.error('[birthday-coupon] LINE send failed', { userId: profile.id, err });
            }
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

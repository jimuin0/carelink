/**
 * Threads 長期トークン更新 Cron
 * GET /api/cron/threads-token-refresh（週次）
 *
 * Threads の長期アクセストークンは【60日で失効し、失効すると手動再認可（Meta 側の再連携）
 * が必要】になる（docs/threads-auto-post-design.md §1・§3方針6）。更新自体は
 * 「24時間以上経過していれば」いつでも可能なので、この cron は refreshThreadsToken() を
 * 定期的に叩いて expires_at を延長し続ける。
 *
 * 【頻度を週次にした根拠】
 * 60日という有効期間に対し、週次(7日毎)なら1回の更新試行が失敗しても次の試行まで最長7日、
 * 失効までにまだ約8回分の再試行機会が残る計算になる。数週間連続で失敗し続けない限り
 * 手動再認可には至らない、十分な余裕がある頻度。
 * 日次にする案も検討したが、リフレッシュは24時間経過していないと no-op になりうる
 * （上記ドキュメント参照）ため、日次では「実質のクールダウン下限に張り付くだけ」で
 * 検知能力（後述の残り日数警報）は増えない一方、cron 実行回数だけが7倍に増える。
 * 得られる安全性が変わらないなら実行回数は少ない方がよい、という判断で週次を選んだ。
 *
 * 【残り日数の監視（🔴 本cronの本質部分）】
 * 「気づかないまま60日を過ぎて機能が永久に死ぬ」を防ぐため、更新に失敗した際は
 * 失敗前の expires_at から残り日数を計算し、CRITICAL_DAYS_REMAINING を切っていれば
 * 通常の cron エラー通知（cronError 経由・全 cron 共通の通報経路）に加えて、
 * 明示的に緊急度の高い Slack アラートを別途投げる（見落とし防止の二重化）。
 * 残り日数は refreshThreadsToken() の戻り値ではなく、この cron 自身が
 * threads_credentials.expires_at を直接読んで計算する（更新に失敗した場合、
 * 戻り値の expiresAt は更新後の値ではないため信頼できない／未定義の可能性がある）。
 */

import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun, cronError } from '@/lib/cron-logger';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { refreshThreadsToken } from '@/lib/threads';
import { alertError } from '@/lib/alert';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SELF = 'threads-token-refresh';

/**
 * 残り日数がこれを下回った状態で更新に失敗したら、緊急度の高いアラートを追加で出す。
 * 週次実行で約2回分の再試行猶予がある水準（14日 ÷ 7日 ≈ 2）を残し、
 * 手動再認可のための対応リードタイムを確保する。
 */
const CRITICAL_DAYS_REMAINING = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const startedAt = new Date();
  try {
    const supabase = createServiceRoleClient();

    // Threads 未設定（threads_credentials 行が無い）は正常系として skipped 扱いにする
    // （cron_logs の status='skipped' は「処理対象0件＝正常」という既存の慣行に従う。
    // error と混同しない）。設定有無を refreshThreadsToken() の reason 文字列に依存させず
    // この cron 自身が DB を見て判定するのは、契約先（src/lib/threads.ts）の reason の
    // 語彙が変わっても本判定が影響を受けないようにするため。
    const { data: creds, error: credsErr } = await supabase
      .from('threads_credentials')
      .select('expires_at')
      .maybeSingle();

    if (credsErr) {
      return cronError(SELF, startedAt, credsErr, { message: 'Internal Server Error' });
    }

    if (!creds) {
      await logCronRun(SELF, 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ status: 'skipped', reason: 'not_configured' });
    }

    const daysRemainingBeforeRefresh =
      (new Date(creds.expires_at).getTime() - Date.now()) / MS_PER_DAY;

    const result = await refreshThreadsToken();

    if (result.ok) {
      await logCronRun(SELF, 'success', startedAt, {
        processed: 1,
        skipped: 0,
        meta: { expiresAt: result.expiresAt ?? null },
      });
      return NextResponse.json({ status: 'ok', expiresAt: result.expiresAt ?? null });
    }

    // 更新失敗。残り日数が乏しいのに気づかれないまま失効すると手動再認可が必要な恒久停止になる。
    // 通常の cron エラー通知（cronError → logCronRun('error', ...) が内部で alertCaughtError を
    // 呼ぶ・全 cron 共通の通報チョークポイント）は失敗であれば毎回飛ぶが、それとは別に、
    // 残り日数が閾値未満のときだけ明示的に強い文言のアラートを追加で出す
    // （「確実に人が気づく」ことを機械的に担保するための二重化）。
    if (daysRemainingBeforeRefresh < CRITICAL_DAYS_REMAINING) {
      const daysLabel = Math.max(0, Math.floor(daysRemainingBeforeRefresh));
      alertError(
        `🔴 Threadsトークン失効まで残り${daysLabel}日なのに更新に失敗しました。` +
          `このまま失効すると手動再認可が必要になります: ${result.reason ?? 'unknown'}`,
        { route: `/api/cron/${SELF}` }
      );
    }

    return cronError(SELF, startedAt, new Error(result.reason ?? 'Threads token refresh failed'), {
      extraLog: { meta: { daysRemainingBeforeRefresh } },
    });
  } catch (e) {
    return cronError(SELF, startedAt, e);
  }
}

/**
 * Slack 構造化アラート（Phase 2 → Phase 7a で Bot 化）
 *
 * /api/profile 級の 500 が Sentry には記録されるが Slack 通知が無く
 * 数日放置された事象の再発防止。`instrumentation.ts` の onRequestError から
 * 呼び出し、本体応答に影響させない fire-and-forget で投稿する。
 *
 * Phase 7a: SLACK_WEBHOOK_URL → SLACK_BOT_TOKEN + chat.postMessage 経由に変更。
 */

import { postToSlackWithThreadGrouping } from './slack';
import { runAfterResponse } from './after-response';
import { summarizeDependencyError } from './err';

type AlertLevel = 'error' | 'warning' | 'info';

interface AlertPayload {
  level: AlertLevel;
  route?: string | null;
  status?: number | null;
  message: string;
  request_id?: string | null;
  commit_sha?: string | null;
  env?: string | null;
  extra?: Record<string, unknown>;
}

const LEVEL_EMOJI: Record<AlertLevel, string> = {
  error: '🔴',
  warning: '🟡',
  info: '🟢',
};

const SENSITIVE_ALERT_KEY = /token|secret|key|password|authorization|cookie|email|phone|target_id/i;
const MAX_ALERT_EXTRA_DEPTH = 3;
const MAX_ALERT_EXTRA_ITEMS = 20;

function redactAlertText(value: string): string {
  return summarizeDependencyError(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]')
    .replace(/(?<!\d)(?:\+?81[-\s]?)?0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}(?!\d)/g, '[phone redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\bxox(?:a|b|p|r|s)-[A-Za-z0-9-]+\b/gi, '[Slack token redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[JWT redacted]')
    .replace(
      /\b(?:api[_-]?key|apikey|token|secret|password|authorization|cookie|set-cookie)\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi,
      (match) => match.replace(/[:=].*/, '= [redacted]'),
    );
}

/** 捕捉例外は利用者入力や上流応答を含み得るため、本文をSlackへ転記しない。 */
function summarizeCaughtError(value: string): string {
  const summary = summarizeDependencyError(value);
  if (summary === 'Supabase 接続障害（Cloudflare 522）' || summary === '依存サービスが HTML エラーページを返しました') {
    return summary;
  }
  return '例外詳細は安全なログで確認';
}

/**
 * 外部エラー本文や個人情報を Slack に載せないための境界。
 *
 * alert は多くの経路から呼ばれるため、呼び出し元だけの sanitize に依存しない。
 * ネストした値も含めてここで扱い、Cloudflare の HTML エラーページは依存障害の定型文へ
 * 置き換える。診断に不要な深い値・大量配列も Slack payload に含めない。
 */
function sanitizeAlertExtra(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const summary = redactAlertText(value);
    return summary.length > 200 ? `${summary.slice(0, 200)}...` : summary;
  }
  if (typeof value === 'undefined') return null;
  if (depth >= MAX_ALERT_EXTRA_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ALERT_EXTRA_ITEMS).map((item) => sanitizeAlertExtra(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_ALERT_EXTRA_ITEMS)
        .map(([key, item]) => [
          key,
          SENSITIVE_ALERT_KEY.test(key) ? '****REDACTED****' : sanitizeAlertExtra(item, depth + 1),
        ]),
    );
  }
  return redactAlertText(String(value));
}

/**
 * Slack に構造化メッセージを fire-and-forget で投稿する。
 * SLACK_BOT_TOKEN / SLACK_DEFAULT_CHANNEL 未設定時はサイレントスキップ。
 * 本関数は throw しない（呼び出し側の本体処理を一切妨げない）。
 */
export function postAlert(payload: AlertPayload): void {
  // 環境変数の即時評価
  if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_DEFAULT_CHANNEL) {
    // 開発・テスト環境では正常系（無通知）
    return;
  }

  // 🔴 レスポンス送出後の実行を保証させる（src/lib/after-response.ts）。
  // 従来は浮いた Promise のままで、サーバーレスがレスポンス後にインスタンスを凍結すると
  // 投稿が失われうる。alertCaughtError は withRoute の catch、および withRoute が
  // ハンドラの戻り値 500 を検知した場合（2026年8月20日・docs/register-blocker-instructions.md
  // §3 P0-2 で追加。それまでは throw 由来の 500 のみがこの経路に載っており、ハンドラが
  // 例外を投げずに return した 500 は通知されずにいた）の両方から呼ばれる。
  // withRoute を使っているルートの 500 応答はこの経路に載るが、withRoute を使っていない
  // route.ts はこの経路の対象外（`src/__tests__/silent-500-guard.test.ts` が別途監視する）。
  // 応答は遅らせない（after は登録するだけ）。
  runAfterResponse(async () => {
    try {
      const safeMessage = redactAlertText(payload.message);
      const safeExtra = payload.extra ? sanitizeAlertExtra(payload.extra) as Record<string, unknown> : undefined;
      const safeRoute = payload.route ? redactAlertText(payload.route) : null;
      const safeCommit = payload.commit_sha ? redactAlertText(payload.commit_sha) : null;
      const safeEnv = payload.env ? redactAlertText(payload.env) : null;
      const safeRequestId = payload.request_id ? redactAlertText(payload.request_id) : null;
      const emoji = LEVEL_EMOJI[payload.level];
      const lines = [
        `${emoji} *${payload.level.toUpperCase()}* ${safeMessage}`,
        safeRoute ? `> *route:* \`${safeRoute}\`` : null,
        payload.status ? `> *status:* ${payload.status}` : null,
        safeCommit ? `> *commit:* \`${safeCommit}\`` : null,
        safeEnv ? `> *env:* ${safeEnv}` : null,
        safeRequestId ? `> *request_id:* \`${safeRequestId}\`` : null,
      ].filter(Boolean);

      if (safeExtra && Object.keys(safeExtra).length > 0) {
        lines.push('```\n' + JSON.stringify(safeExtra, null, 2).slice(0, 1500) + '\n```');
      }

      const text = lines.join('\n');

      // Phase 7c: 同 route + 同 commit + 同 level の連発を 1 スレッドに集約
      // route や commit が無い alert は thread_key も無く通常投稿になる
      const threadKey = [
        'alert',
        payload.level,
        safeRoute ? `route=${safeRoute}` : '',
        safeCommit ? `commit=${safeCommit}` : '',
      ]
        .filter(Boolean)
        .join(':');

      const result = await postToSlackWithThreadGrouping({
        thread_key: threadKey,
        text,
      });
      if (!result.ok) {
        console.error('[alert] Slack post failed:', result.error);
      }
    } catch (e) /* istanbul ignore next */ {
      // Slack 死亡時の最終フォールバック（postToSlackWithThreadGrouping は throw しないため到達不可）
      console.error('[alert] Slack post failed:', e instanceof Error ? e.message : String(e));
    }
  });
}

export function alertError(message: string, opts: Omit<AlertPayload, 'level' | 'message'> = {}): void {
  postAlert({ level: 'error', message, ...opts });
}

export function alertWarning(message: string, opts: Omit<AlertPayload, 'level' | 'message'> = {}): void {
  postAlert({ level: 'warning', message, ...opts });
}

/**
 * try-catch で捕捉した 500 級例外を Slack に通知する共通ヘルパー。
 *
 * 背景（恒久対策）: ハンドラ内で例外を catch して 500 を返すと、例外が
 * `instrumentation.ts` の onRequestError に伝播せず Slack 通知が漏れる
 * （/api/profile 級の 500 が数日放置された事象と同型の盲点）。
 * catch 経路（withRoute の catch 等）では本関数で必ず通知する。
 *
 * fire-and-forget で本体応答を一切妨げない（alertError は throw しない）。
 * commit_sha / env / stack を onRequestError と同等の粒度で付与する。
 */
export function alertCaughtError(tag: string, error: unknown, route?: string | null): void {
  const rawMessage = error instanceof Error ? error.message : String(error);
  // Error.message / stack は利用者入力・外部レスポンス・資格情報を含み得る。既知の依存障害以外は
  // 固定カテゴリへ落とし、Slackを安全な運用窓に保つ。詳細はアクセス制御されたVercelログで確認する。
  const message = summarizeCaughtError(rawMessage);
  alertError(`[${redactAlertText(tag)}] ${message}`, {
    route: route ?? null,
    status: 500,
    commit_sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
    extra: { stack: null },
  });
}

/**
 * cron run 単位で集約した「送達失敗」を Slack に1本だけ通知する。
 *
 * 背景（観測性の恒久対策）: メール/Push/LINE の送達失敗は各 send ラッパーで
 * console.error 止まりで、集計もアラートも無く「無音」だった。かといって
 * per-send で alertWarning を叩くと、alert.ts の thread-grouping は投稿を
 * スレッド集約するだけで chat.postMessage 自体は毎回叩くため、大量失敗時に
 * Slack API を洪水のように連打する。よって run 終了時に失敗総数を【1メッセージ】に
 * 集約して通知するのが唯一の副作用ゼロ設計。
 *
 * failures <= 0 の場合は何もしない（呼び出し側は無条件に呼んでよい＝route 側の分岐を増やさない）。
 * fire-and-forget で本体応答を一切妨げない（alertWarning は throw しない）。
 *
 * @param route  cron 名（例: 'onboarding-followup'）。route フィールドは `/api/cron/${route}` になる。
 * @param failures  この run での送達失敗総数。
 * @param extra  補足情報（sent / skipped 等）。route + level + commit で thread 集約される。
 * @param deadLettered  failures のうち再送上限（max_attempts）に到達し dead-letter
 *   （status='failed'・二度と自動再送されない）に倒れた件数。省略時 0。
 *   0 より大きい場合のみ文言を差し替える（他 cron の呼び出し元は 3 引数のまま＝挙動不変）。
 */
export function alertDeliveryFailures(
  route: string,
  failures: number,
  extra: Record<string, unknown> = {},
  deadLettered = 0,
): void {
  if (failures <= 0) return;
  const message =
    deadLettered > 0
      ? `[${route}] 送達失敗 ${failures}件（うち${deadLettered}件は再送上限到達=dead-letter・自動再送されない）`
      : `[${route}] 送達失敗 ${failures}件（run集約・翌runで再送）`;
  alertWarning(message, {
    route: `/api/cron/${route}`,
    commit_sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
    extra: { deliveryFailures: failures, ...extra },
  });
}

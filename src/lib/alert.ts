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

  // fire-and-forget で投稿（await しない、await されても本体は止めない）
  void (async () => {
    try {
      const emoji = LEVEL_EMOJI[payload.level];
      const lines = [
        `${emoji} *${payload.level.toUpperCase()}* ${payload.message}`,
        payload.route ? `> *route:* \`${payload.route}\`` : null,
        payload.status ? `> *status:* ${payload.status}` : null,
        payload.commit_sha ? `> *commit:* \`${payload.commit_sha}\`` : null,
        payload.env ? `> *env:* ${payload.env}` : null,
        payload.request_id ? `> *request_id:* \`${payload.request_id}\`` : null,
      ].filter(Boolean);

      if (payload.extra && Object.keys(payload.extra).length > 0) {
        // 機密 redact: 値が 30文字超 or token らしき key は伏せる
        const safeExtra: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(payload.extra)) {
          const keyLower = k.toLowerCase();
          if (/token|secret|key|password|authorization/.test(keyLower)) {
            safeExtra[k] = '****REDACTED****';
          } else if (typeof v === 'string' && v.length > 200) {
            safeExtra[k] = v.slice(0, 200) + '...';
          } else {
            safeExtra[k] = v;
          }
        }
        lines.push('```\n' + JSON.stringify(safeExtra, null, 2).slice(0, 1500) + '\n```');
      }

      const text = lines.join('\n');

      // Phase 7c: 同 route + 同 commit + 同 level の連発を 1 スレッドに集約
      // route や commit が無い alert は thread_key も無く通常投稿になる
      const threadKey = [
        'alert',
        payload.level,
        payload.route ? `route=${payload.route}` : '',
        payload.commit_sha ? `commit=${payload.commit_sha}` : '',
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
  })();
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
  const message = error instanceof Error ? error.message : String(error);
  const stack =
    error instanceof Error && error.stack
      ? error.stack.split('\n').slice(0, 8).join('\n')
      : null;
  alertError(`[${tag}] ${message}`, {
    route: route ?? null,
    status: 500,
    commit_sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
    extra: { stack },
  });
}

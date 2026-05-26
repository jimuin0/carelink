/**
 * Slack 投稿ヘルパー（Phase 7a: Bot Token 経由）
 *
 * 旧来は SLACK_WEBHOOK_URL に直接 fetch していたが、Phase 7 で Bot Token
 * (xoxb-...) + chat.postMessage 経由に切替。
 *
 * 利点:
 *  - 単一トークンで複数チャンネルに投稿可能（チャンネル分けが env だけで完結）
 *  - Block Kit（ボタン・section）対応（Phase 7b で活用）
 *  - thread_ts による会話まとめ対応（Phase 7c で活用）
 *  - 漏洩時のローテが Bot Token 1 つだけで済む
 *
 * env:
 *  - SLACK_BOT_TOKEN: xoxb- で始まる Bot User OAuth Token（必須）
 *  - SLACK_DEFAULT_CHANNEL: 既定の投稿先 channel ID（C01XXXXXXX 形式）または `#name`
 *  - 任意で種別ごとに SLACK_CHANNEL_* 環境変数を追加して channel パラメータで切替可能
 */

const SLACK_API_BASE = 'https://slack.com/api';

export interface SlackPostOptions {
  /** チャンネル ID（C01XXXXXXX）または `#name`。未指定時は SLACK_DEFAULT_CHANNEL */
  channel?: string;
  /** プレーンテキスト（blocks 未指定時の表示 / 通知バッジ） */
  text?: string;
  /** Block Kit（ボタン・section 等のリッチ表示）。指定時は text を補助テキストとして渡すこと */
  blocks?: unknown[];
  /** 親メッセージの ts（指定するとそのスレッドに返信） */
  thread_ts?: string;
  /** 親メッセージへの返信時、チャンネル本体にも broadcast するか */
  reply_broadcast?: boolean;
  /** Bot の表示名カスタム（chat:write.customize scope 要） */
  username?: string;
  /** Bot のアイコン絵文字カスタム（chat:write.customize scope 要） */
  icon_emoji?: string;
}

export interface SlackPostResult {
  ok: boolean;
  /** 投稿に成功した場合の message ts（thread_ts として後続呼び出しに使える） */
  ts?: string;
  channel?: string;
  /** Slack 側のエラーコード（ok=false 時のみ） */
  error?: string;
}

/**
 * Slack chat.postMessage を呼び出す。
 *
 * 失敗時は ok:false の SlackPostResult を返す（throw しない）。
 * 呼び出し側が fire-and-forget で投げる場合に本体応答を壊さないため。
 *
 * SLACK_BOT_TOKEN 未設定時も error: 'not_configured' を返すのみ。
 */
export async function postToSlack(opts: SlackPostOptions): Promise<SlackPostResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = opts.channel || process.env.SLACK_DEFAULT_CHANNEL;

  if (!token) return { ok: false, error: 'not_configured' };
  if (!channel) return { ok: false, error: 'no_channel' };
  if (!opts.text && !opts.blocks) return { ok: false, error: 'empty_payload' };

  const body: Record<string, unknown> = { channel };
  if (opts.text) body.text = opts.text;
  if (opts.blocks) body.blocks = opts.blocks;
  if (opts.thread_ts) body.thread_ts = opts.thread_ts;
  if (opts.reply_broadcast) body.reply_broadcast = true;
  if (opts.username) body.username = opts.username;
  if (opts.icon_emoji) body.icon_emoji = opts.icon_emoji;

  try {
    const res = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return { ok: false, error: `http_${res.status}` };
    }

    const json = (await res.json()) as { ok: boolean; ts?: string; channel?: string; error?: string };
    if (!json.ok) return { ok: false, error: json.error || 'unknown' };
    return { ok: true, ts: json.ts, channel: json.channel };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch_failed' };
  }
}

/**
 * 親メッセージ ts を指定して同スレッドに返信するショートカット
 */
export async function replyInThread(
  channel: string,
  thread_ts: string,
  text: string,
  options: Omit<SlackPostOptions, 'channel' | 'text' | 'thread_ts'> = {}
): Promise<SlackPostResult> {
  return postToSlack({ channel, thread_ts, text, ...options });
}

// ===== Block Kit ヘルパー（Phase 7b で活用） =====

/**
 * セクションブロック（テキスト or fields）
 */
export function sectionBlock(text: string, fields?: string[]): Record<string, unknown> {
  const block: Record<string, unknown> = {
    type: 'section',
    text: { type: 'mrkdwn', text },
  };
  if (fields && fields.length > 0) {
    block.fields = fields.map((f) => ({ type: 'mrkdwn', text: f }));
  }
  return block;
}

/**
 * 区切り線
 */
export function dividerBlock(): Record<string, unknown> {
  return { type: 'divider' };
}

/**
 * ボタンブロック（actions 内に入れる）
 * @param text ボタン表示テキスト
 * @param action_id Slack interactions endpoint で受け取る action 識別子
 * @param value 任意のメタデータ（受信側で取得可能）
 * @param style 'primary' | 'danger' | undefined
 */
export function buttonElement(
  text: string,
  action_id: string,
  value?: string,
  style?: 'primary' | 'danger'
): Record<string, unknown> {
  const btn: Record<string, unknown> = {
    type: 'button',
    text: { type: 'plain_text', text, emoji: true },
    action_id,
  };
  if (value !== undefined) btn.value = value;
  if (style) btn.style = style;
  return btn;
}

/**
 * リンクボタン（クリックで URL に飛ぶ、interactions 不要）
 */
export function linkButtonElement(text: string, url: string): Record<string, unknown> {
  return {
    type: 'button',
    text: { type: 'plain_text', text, emoji: true },
    url,
  };
}

/**
 * アクションブロック（ボタン群のコンテナ）
 */
export function actionsBlock(elements: Record<string, unknown>[]): Record<string, unknown> {
  return { type: 'actions', elements };
}

/**
 * ヘッダーブロック（太字大型タイトル）
 */
export function headerBlock(text: string): Record<string, unknown> {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } };
}

/**
 * コンテキスト（小さい補助テキスト）
 */
export function contextBlock(items: string[]): Record<string, unknown> {
  return {
    type: 'context',
    elements: items.map((t) => ({ type: 'mrkdwn', text: t })),
  };
}

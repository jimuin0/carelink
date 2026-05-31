/**
 * Slack interactivity エンドポイント（Phase 7b）
 *
 * Block Kit のボタン・select 等が押されると Slack がここに POST する。
 * Slack 公式の Interactivity & Shortcuts → Request URL に
 *   https://carelink-jp.com/api/slack/interactions
 * を設定する必要がある。
 *
 * 動作:
 *  1. SLACK_SIGNING_SECRET で署名検証（必須、5分以内の timestamp）
 *  2. body は application/x-www-form-urlencoded で `payload=<JSON>` 形式
 *  3. payload.actions[0].action_id でルーティング
 *  4. 各アクション handler を呼び出し
 *  5. 3 秒以内に 200 OK を返さないと Slack 側でエラー扱い → 即時 ack 推奨
 *
 * 新しいアクションを追加するには下記 ACTION_HANDLERS マップにエントリを追加。
 */

import { NextResponse } from 'next/server';
import { verifySlackRequest } from '@/lib/slack-verify';
import { safeCaptureException } from '@/lib/safe';

export const dynamic = 'force-dynamic';

interface SlackAction {
  type: string;
  action_id: string;
  value?: string;
  block_id?: string;
}

interface SlackInteractionPayload {
  type: string;
  user?: { id: string; name: string };
  team?: { id: string; domain: string };
  channel?: { id: string; name: string };
  message?: { ts: string; thread_ts?: string };
  actions?: SlackAction[];
  response_url?: string;
  trigger_id?: string;
}

type ActionHandler = (payload: SlackInteractionPayload, action: SlackAction) => Promise<void>;

// アクション ID → handler のマッピング
// 新しいボタンを追加する時は buttonElement(text, 'action_id_here', ...) と
// ここに 'action_id_here': async (payload, action) => {...} を追加するだけ
const ACTION_HANDLERS: Record<string, ActionHandler> = {
  // 例: 'mark_resolved': async (payload, action) => { ... },
  // 例: 'approve_salon': async (payload, action) => { ... },
};

export async function POST(request: Request) {
  try {
    // 1. 署名検証用に raw body を取得
    const rawBody = await request.text();
    const signature = request.headers.get('x-slack-signature');
    const timestamp = request.headers.get('x-slack-request-timestamp');

    const verifyResult = verifySlackRequest({ signature, timestamp, rawBody });
    if (!verifyResult.valid) {
      return NextResponse.json(
        { error: 'unauthorized', reason: verifyResult.reason },
        { status: 401 }
      );
    }

    // 2. urlencoded payload を parse
    const params = new URLSearchParams(rawBody);
    const payloadRaw = params.get('payload');
    if (!payloadRaw) {
      return NextResponse.json({ error: 'no_payload' }, { status: 400 });
    }

    let payload: SlackInteractionPayload;
    try {
      payload = JSON.parse(payloadRaw);
    } catch {
      return NextResponse.json({ error: 'invalid_payload_json' }, { status: 400 });
    }

    // 3. アクションごとに handler を起動（fire-and-forget で 3 秒制限内に ack）
    if (payload.actions && payload.actions.length > 0) {
      const action = payload.actions[0];
      const handler = ACTION_HANDLERS[action.action_id];
      /* istanbul ignore next -- ACTION_HANDLERS は現在空のため true 分岐は到達不能 */
      if (handler) {
        // 結果は気にせず即 ack 返却
        void (async () => {
          try {
            await handler(payload, action);
          } catch (e) {
            safeCaptureException(e, `slack-action:${action.action_id}`);
          }
        })();
      }
      // handler 未登録は無視（404 を返すと Slack 側にエラー表示されるため 200 ack）
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    safeCaptureException(e, 'slack-interactions');
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}

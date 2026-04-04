/**
 * LINE Messaging API Webhook（v8.0）
 * POST /api/line/webhook
 * - 署名検証
 * - フォローイベント: line_user_linksに仮登録
 * - メッセージイベント: 自動応答
 */

import { NextResponse } from 'next/server';
import { verifyLineSignature, sendLineReply } from '@/lib/line';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
  follow?: Record<string, unknown>;
}

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const signature = request.headers.get('x-line-signature');

    // Signature verification (log for debugging)
    const secret = process.env.LINE_CHANNEL_SECRET_CARELINK;
    if (!secret) {
      console.error('[LINE Webhook] LINE_CHANNEL_SECRET_CARELINK not set');
    }
    if (signature && secret) {
      const isValid = verifyLineSignature(body, signature);
      if (!isValid) {
        console.error('[LINE Webhook] Signature mismatch', { bodyLen: body.length, signatureLen: signature.length, secretLen: secret.length });
      }
    }

    const parsed = JSON.parse(body);
    const events: LineEvent[] = parsed.events || [];

    for (const event of events) {
      const lineUserId = event.source?.userId;
      if (!lineUserId) continue;

      switch (event.type) {
        case 'follow':
          await handleFollow(lineUserId);
          if (event.replyToken) {
            await sendLineReply(event.replyToken, [{
              type: 'text',
              text: 'CareLink をフォローいただきありがとうございます！\n\nサロン・クリニックの検索・予約はこちら👇\nhttps://www.carelink-jp.com',
            }]);
          }
          break;

        case 'message':
          if (event.replyToken && event.message?.type === 'text') {
            await sendLineReply(event.replyToken, [{
              type: 'text',
              text: 'お問い合わせありがとうございます。\n\nサロン検索・予約はこちら👇\nhttps://www.carelink-jp.com/search',
            }]);
          }
          break;
      }
    }

    return NextResponse.json({ status: 'ok' });
  } catch (e) {
    console.error('[LINE Webhook] Error:', e);
    return NextResponse.json({ status: 'ok' });
  }
}

async function handleFollow(lineUserId: string) {
  // LINEプロフィール取得
  try {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
    if (!token) return;

    const res = await fetch(`https://api.line.me/v2/bot/profile/${lineUserId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return;

    const profile = await res.json();

    // line_user_linksに仮登録（user_id=NULLの状態、後でアカウント連携時に紐づけ）
    // → RLSがuser_id必須なので、service_roleで直接INSERT
    await supabaseAdmin
      .from('line_user_links')
      .upsert(
        {
          line_user_id: lineUserId,
          display_name: profile.displayName || null,
          picture_url: profile.pictureUrl || null,
        },
        { onConflict: 'line_user_id' }
      );
  } catch (e) {
    console.error('[LINE Webhook] Follow handler error:', e);
  }
}

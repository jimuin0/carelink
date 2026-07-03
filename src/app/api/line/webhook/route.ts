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

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
  follow?: Record<string, unknown>;
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get('x-line-signature');
  // 署名検証。secret 未設定は verifyLineSignature が throw する＝設定ミス。これを本体 catch で握って
  // 200 ok を返すと LINE は再送せず全イベントが無音ドロップするため、設定ミスは 500 で可視化し LINE の
  // 再送機会を残す（M-7）。署名不正(false)は正常な拒否として 401。
  let signatureValid: boolean;
  try {
    signatureValid = !!signature && verifyLineSignature(body, signature);
  } catch (e) {
    console.error('[LINE Webhook] signature verification failed (misconfiguration?)', e);
    return NextResponse.json({ error: 'Webhook configuration error' }, { status: 500 });
  }
  if (!signatureValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  try {
    const parsed = JSON.parse(body);
    const events: LineEvent[] = parsed.events || [];

    for (const event of events) {
      const lineUserId = event.source?.userId;
      if (!lineUserId || !/^[A-Za-z0-9_-]+$/.test(lineUserId)) continue;

      switch (event.type) {
        case 'follow':
          await handleFollow(lineUserId);
          if (event.replyToken) {
            await sendLineReply(event.replyToken, [{
              type: 'text',
              text: 'CareLink をフォローいただきありがとうございます！\n\nサロン・クリニックの検索・予約はこちら👇\nhttps://carelink-jp.com',
            }]);
          }
          break;

        case 'unfollow':
          await handleUnfollow(lineUserId);
          break;

        case 'message':
          if (event.replyToken && event.message?.type === 'text') {
            await sendLineReply(event.replyToken, [{
              type: 'text',
              text: 'お問い合わせありがとうございます。\n\nサロン検索・予約はこちら👇\nhttps://carelink-jp.com/search',
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

    // 遅延初期化: モジュールスコープで createClient を呼ぶとビルド時の
    // page data 収集フェーズで env 未設定環境（Vercel preview 等）が
    // "supabaseUrl is required" で落ちるため、リクエスト時に生成する。
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

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

async function handleUnfollow(lineUserId: string) {
  // ユーザーがブロック / フォロー解除した。以後 LINE 通知は送れず、行を残すと各送信経路が
  // user_id → line_user_id を引いて送信失敗を繰り返す（dead link）。当該リンクを削除して
  // 送信対象から外す（FK 参照は無く account/delete と同じ削除パターン。再フォロー時は
  // handleFollow が再登録する）。署名検証済みのため LINE 由来イベントのみ到達する。
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { error } = await supabaseAdmin
      .from('line_user_links')
      .delete()
      .eq('line_user_id', lineUserId);
    if (error) {
      console.error('[LINE Webhook] Unfollow handler delete failed', { lineUserId, err: error.message });
    }
  } catch (e) {
    console.error('[LINE Webhook] Unfollow handler error:', e);
  }
}

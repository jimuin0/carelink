/**
 * LINE Messaging API Webhook（v8.0）
 * POST /api/line/webhook
 * - 署名検証
 * - フォローイベント: line_user_linksに仮登録（再フォローは unfollowed_at を消す）
 * - フォロー解除イベント: line_user_links.unfollowed_at を記録（行は消さない）
 * - メッセージイベント: 自動応答
 */

import { NextResponse } from 'next/server';
import { verifyLineSignature, sendLineReply } from '@/lib/line';
import { createClient } from '@supabase/supabase-js';
import { serverError } from '@/lib/with-route';

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
    return serverError('line-webhook-signature', e, '/api/line/webhook', 'Webhook configuration error');
  }
  if (!signatureValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  try {
    const parsed = JSON.parse(body);
    const events: LineEvent[] = parsed.events ?? [];
    if (!Array.isArray(events)) return NextResponse.json({ error: 'Invalid events' }, { status: 400 });

    // Finish all follow writes before any external reply. A DB failure can then
    // request webhook redelivery without claiming acceptance or resending an
    // already attempted reply because a later follow write failed.
    for (const event of events) {
      const lineUserId = event.source?.userId;
      if (!lineUserId || !/^[A-Za-z0-9_-]+$/.test(lineUserId)) continue;
      if (event.type === 'follow') await handleFollow(lineUserId);
      else if (event.type === 'unfollow') await handleUnfollow(lineUserId);
    }
    let attempted = false;
    let replyUnknown = false;
    const reply = async (token: string, text: string) => {
      attempted = true;
      try { if (await sendLineReply(token, [{ type: 'text', text }]) !== true) replyUnknown = true; }
      catch { replyUnknown = true; }
    };

    for (const event of events) {
      const lineUserId = event.source?.userId;
      if (!lineUserId || !/^[A-Za-z0-9_-]+$/.test(lineUserId)) continue;

      switch (event.type) {
        case 'follow':
          if (event.replyToken) {
            await reply(event.replyToken, 'CareLink をフォローいただきありがとうございます！\n\nサロン・クリニックの検索・予約はこちら👇\nhttps://carelink-jp.com');
          }
          break;

        case 'unfollow':
          break;

        case 'message':
          if (event.replyToken && event.message?.type === 'text') {
            await reply(event.replyToken, 'お問い合わせありがとうございます。\n\nサロン検索・予約はこちら👇\nhttps://carelink-jp.com/search');
          }
          break;
      }
    }

    // LINE redelivery retains the same one-use replyToken. We never replace it
    // with a push/retry token. A lost reply response remains unknown, not sent.
    return NextResponse.json({ status: 'ok', reply_delivery: replyUnknown ? 'unknown' : attempted ? 'sent' : 'not_attempted' });
  } catch (e) {
    if (e instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    return serverError('line-webhook-follow', new Error('Follow/unfollow acceptance unavailable'), '/api/line/webhook');
  }
}

async function handleFollow(lineUserId: string) {
  // LINEプロフィール取得
  try {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
    if (!token) throw new Error('LINE follow configuration unavailable');

    const res = await fetch(`https://api.line.me/v2/bot/profile/${lineUserId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error('LINE follow profile unavailable');

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
    const { error } = await supabaseAdmin
      .from('line_user_links')
      .upsert(
        {
          line_user_id: lineUserId,
          display_name: typeof profile.displayName === 'string' ? profile.displayName : null,
          picture_url: typeof profile.pictureUrl === 'string' ? profile.pictureUrl : null,
          // 再フォロー＝送信対象へ戻す（点検 B3-12）。連携（user_id・proof_version・verified_at）は
          // upsert の更新列に含めないので、ブロック前の本人確認済み連携がそのまま復活する。
          unfollowed_at: null,
        },
        { onConflict: 'line_user_id' }
      );
    if (error) throw new Error('LINE follow storage unavailable');
  } catch {
    // Preserve the failure for HTTP acceptance. Do not log a profile/token.
    throw new Error('LINE follow acceptance unavailable');
  }
}

async function handleUnfollow(lineUserId: string) {
  // ユーザーがブロック / フォロー解除した。以後 LINE 通知は送れないので送信対象から外す。
  // 🔴 行は削除しない（点検 B3-12・2026年11月13日）。以前は削除していたため、本人確認済みの連携
  // （user_id・proof_version・verified_at）まで消え、再フォローしても連携し直すまで通知が届かなかった。
  // unfollowed_at を記録し、送信側（src/lib/line-link.ts ほか）は unfollowed_at のある行を除外する。
  // 再フォロー時は handleFollow が unfollowed_at を NULL に戻す。署名検証済みのため LINE 由来イベントのみ到達する。
  // 失敗は握り潰さず throw し、follow と同じく 5xx で LINE に再送させる（握り潰すと 200 で再送されず、
  // ブロックしたユーザーが送信対象に残り続ける・低 A157）。LINE のユーザーIDはログに出さない。
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { error } = await supabaseAdmin
      .from('line_user_links')
      .update({ unfollowed_at: new Date().toISOString() })
      .eq('line_user_id', lineUserId);
    if (error) throw new Error('LINE unfollow storage unavailable');
  } catch {
    throw new Error('LINE unfollow acceptance unavailable');
  }
}

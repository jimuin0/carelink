/**
 * ユーザー向けAIチャットボット
 * POST /api/chat
 * CareLink全般・施設検索・予約サポートのAIアシスタント
 */

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { checkChatLimit, chatDailyLimit, chatUsageCount, CHAT_DAILY_WINDOW_MS } from '@/lib/chat-rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { withRoute } from '@/lib/with-route';
import { verifyRecaptcha } from '@/lib/recaptcha';

export const maxDuration = 30;

const SYSTEM_PROMPT = `あなたはCareLink（ケアリンク）の公式AIアシスタントです。
CareLinKは鍼灸・整体・マッサージなどの施術施設を検索・予約できる日本のプラットフォームです。

【対応範囲】
- 施設の検索方法・条件絞り込み（地域、症状、業種など）
- 予約の取り方・変更・キャンセル方法
- 会員登録・ログイン・マイページの使い方
- ポイント・クーポン・回数券・月額プランの説明
- 鍼灸・整体・マッサージなどの施術に関する一般的な情報
- 症状別におすすめの施術タイプの案内

【禁止事項】
- 医療診断・病名の確定・投薬指示は行わない
- 特定施設の優劣を評価・批判しない

【スタイル】
- 日本語で丁寧かつ簡潔に答える
- 緊急性のある症状（胸痛・麻痺など）は必ず医療機関への受診を勧める
- 3文以内に収める（詳細が必要な場合は箇条書きを使う）`;

export const POST = withRoute(async (request) => {
  const ip = getClientIp(request);
  const burst = await checkChatLimit(`chat:${ip}`, 5, 60000);
  if (burst === 'unavailable') return NextResponse.json({ error: 'AIの利用状況を確認できません。時間をおいて再試行してください。' }, { status: 503 });
  if (burst === 'limited') {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { messages, recaptcha_token } = body as { messages?: { role: string; content: string }[]; recaptcha_token?: unknown };
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }

  // Validate roles and take last 10 messages
  const validMessages = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length <= 2000)
    .slice(-10)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 2000) }));

  if (validMessages.length === 0) {
    return NextResponse.json({ error: 'No valid messages' }, { status: 400 });
  }

  const dailyLimit = chatDailyLimit(process.env.AI_CHAT_DAILY_REQUEST_LIMIT);
  if (dailyLimit === null || !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AIサービスは現在利用できません。' }, { status: 503 });
  }
  if (process.env.NODE_ENV === 'production' && (!process.env.RECAPTCHA_SECRET_KEY || !process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY)) {
    return NextResponse.json({ error: 'AIサービスは現在利用できません。' }, { status: 503 });
  }
  const botCheck = await verifyRecaptcha(typeof recaptcha_token === 'string' ? recaptcha_token : '', 'chat');
  // The shared helper's development allowances do not authorize a paid call
  // in production. A real v3 score is required there.
  if (!botCheck.success || (process.env.NODE_ENV === 'production'
    && (typeof botCheck.score !== 'number' || !Number.isFinite(botCheck.score)))) {
    return NextResponse.json({ error: '送信を確認できません。通信環境を確認して再試行してください。' }, { status: 403 });
  }
  const daily = await checkChatLimit('chat-daily:global', dailyLimit, CHAT_DAILY_WINDOW_MS);
  if (daily === 'unavailable') return NextResponse.json({ error: 'AIの利用状況を確認できません。時間をおいて再試行してください。' }, { status: 503 });
  if (daily === 'limited') return NextResponse.json({ code: 'CHAT_GLOBAL_QUOTA_LIMIT', error: 'AIの24時間の利用上限に達しました。時間をおいて再試行してください。' }, { status: 429 });

  let providerTimer: ReturnType<typeof setTimeout> | undefined;
  const providerDeadline = Date.now() + 10_000;
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 10_000, maxRetries: 0 });
    const controller = new AbortController();
    if (Date.now() >= providerDeadline) throw new Error('AI reply unconfirmed');
    // SDK timeout alone ends at headers. Bound the complete parsed reply too.
    const response = await Promise.race([anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: validMessages,
    }, { signal: controller.signal }), new Promise<never>((_, reject) => {
      providerTimer = setTimeout(() => { controller.abort(); reject(new Error('AI reply unconfirmed')); }, 10_000);
    })]);
    if (Date.now() >= providerDeadline) throw new Error('AI reply unconfirmed');
    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    if (typeof text !== 'string' || !text.trim()) throw new Error('unconfirmed AI reply');
    console.info('[chat] provider_call', { outcome: 'completed',
      inputTokens: chatUsageCount(response.usage?.input_tokens), outputTokens: chatUsageCount(response.usage?.output_tokens) });
    return NextResponse.json({ reply: text });
  } catch {
    // An unknown provider result consumes its reserved quota; never refund it
    // or auto-retry a potentially accepted paid request.
    console.info('[chat] provider_call', { outcome: 'unavailable' });
    return NextResponse.json({ error: 'AIサービスに接続できませんでした' }, { status: 503 });
  } finally {
    clearTimeout(providerTimer);
  }
}, {
  csrf: true,
  sentryTag: 'chat',
});

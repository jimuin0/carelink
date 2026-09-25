/**
 * ユーザー向けAIチャットボット
 * POST /api/chat
 * CareLink全般・施設検索・予約サポートのAIアシスタント
 */

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createHmac } from 'crypto';
import { z } from 'zod';
import { checkRateLimitStrict } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { withRoute } from '@/lib/with-route';
import { verifyRecaptcha } from '@/lib/recaptcha';

type ChatMessage = { role: string; content: string };
const DAILY_QUOTA_WINDOW_MS = 24 * 60 * 60_000;
const chatRequestSchema = z.object({
  messages: z.array(z.unknown()).min(1).max(50),
  recaptcha_token: z.string().trim().min(1).optional(),
});

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

function getDailyRequestLimit(): number | null {
  const raw = process.env.AI_CHAT_DAILY_REQUEST_LIMIT;
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed <= 2_147_483_647 ? parsed : null;
}

function getPrivacySafeRateLimitKey(ip: string): string | null {
  const hmacKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!hmacKey) return null;
  return createHmac('sha256', hmacKey)
    .update(`carelink:ai-chat-rate-limit:v1:${ip}`)
    .digest('hex');
}

function unavailable(message = 'AIサービスは一時的に利用できません'): NextResponse {
  return NextResponse.json({ error: message }, { status: 503 });
}

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
  const production = isProductionRuntime();
  const dailyLimit = getDailyRequestLimit();
  const recaptchaSecret = process.env.RECAPTCHA_SECRET_KEY;
  const recaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  // Paid provider access is disabled in production unless all required controls
  // are configured. Never interpret missing controls as an allow decision.
  if (
    !anthropicApiKey ||
    (production && (!dailyLimit || !recaptchaSecret || !recaptchaSiteKey)) ||
    (Boolean(recaptchaSecret) !== Boolean(recaptchaSiteKey))
  ) {
    console.error('[chat] required provider protection is not configured');
    return unavailable();
  }

  const ip = getClientIp(request);
  const quotaKey = getPrivacySafeRateLimitKey(ip);
  if (!quotaKey) {
    console.error('[chat] quota identity is unavailable');
    return unavailable();
  }

  try {
    if (await checkRateLimitStrict(null, quotaKey, 5, 60_000, 'chat-burst')) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }
  } catch {
    console.error('[chat] shared rate-limit service is unavailable');
    return unavailable();
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }

  // 公開のAI入口は従量課金を伴うため、secret設定時はtoken欠如もfail-closedにする。
  if (recaptchaSecret) {
    if (!parsed.data.recaptcha_token) {
      return NextResponse.json({ error: 'Bot検知: 時間をおいて再度お試しください' }, { status: 403 });
    }
    const captcha = await verifyRecaptcha(parsed.data.recaptcha_token, 'chat', 0.4);
    if (!captcha.success) {
      return NextResponse.json({ error: 'Bot検知: 時間をおいて再度お試しください' }, { status: 403 });
    }
  }

  // Validate roles and take last 10 messages
  const validMessages = parsed.data.messages
    .filter((m): m is ChatMessage => (
      typeof m === 'object' && m !== null &&
      'role' in m && 'content' in m &&
      typeof m.role === 'string' &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' && m.content.length <= 2000
    ))
    .slice(-10)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 2000) }));

  if (validMessages.length === 0) {
    return NextResponse.json({ error: 'No valid messages' }, { status: 400 });
  }
  if (validMessages.reduce((sum, message) => sum + message.content.length, 0) > 12_000) {
    return NextResponse.json({ error: 'Messages too large' }, { status: 413 });
  }

  // Development may omit the business-selected rolling 24-hour cap. Production
  // fails closed above; when configured, consume shared quota before provider I/O.
  if (dailyLimit !== null) {
    try {
      if (await checkRateLimitStrict(null, quotaKey, dailyLimit, DAILY_QUOTA_WINDOW_MS, 'chat-daily')) {
        return NextResponse.json({ error: '直近24時間の利用上限に達しました。時間をおいて再度お試しください。' }, { status: 429 });
      }
    } catch {
      console.error('[chat] daily quota service is unavailable');
      return unavailable();
    }
  }

  try {
    const anthropic = new Anthropic({ apiKey: anthropicApiKey });
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: validMessages,
    }, { signal: AbortSignal.timeout(15_000) });
    console.info('[chat] provider usage', {
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
    });
    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    return NextResponse.json({ reply: text });
  } catch (error) {
    console.error('[chat] provider request failed', {
      provider: 'anthropic',
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    return NextResponse.json({ error: 'AIサービスに接続できませんでした' }, { status: 503 });
  }
}, {
  csrf: true,
  sentryTag: 'chat',
});

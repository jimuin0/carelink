/**
 * ユーザー向けAIチャットボット
 * POST /api/chat
 * CareLink全般・施設検索・予約サポートのAIアシスタント
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (inMemoryRateLimit(ip, 5, 60000, 'chat')) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { messages } = body as { messages?: { role: string; content: string }[] };
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

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: validMessages,
    });
    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    return NextResponse.json({ reply: text });
  } catch {
    return NextResponse.json({ error: 'AIサービスに接続できませんでした' }, { status: 503 });
  }
}

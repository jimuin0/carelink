/**
 * 管理画面内AIサポート
 * POST /api/admin/ai-support
 * 管理者の操作質問に Claude が回答
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import Anthropic from '@anthropic-ai/sdk';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const schema = z.object({
  message: z.string().min(1).max(1000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(2000),
  })).max(10).optional(),
});

const SYSTEM_PROMPT = `あなたはCareLink（鍼灸・整体・マッサージサロン予約サービス）の管理画面サポートAIです。
施設オーナーや管理者からの質問に、簡潔・親切に日本語で回答してください。

対応可能な質問:
- 管理画面の操作方法（予約管理、スタッフ設定、メニュー追加など）
- 集客・口コミ改善のアドバイス
- 施術記録・治療計画の活用方法
- 回数券・月額プランの設定方法
- CareLink の各機能の説明

回答は簡潔に（最大300字程度）。操作手順は番号付きリストで。
専門的すぎる法律・医療アドバイスは「専門家にご相談ください」と伝えること。`;

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'ai-support')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 施設管理者のみ
  const { data: mem } = await supabase
    .from('facility_members')
    .select('role')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin'])
    .limit(1)
    .single();
  if (!mem) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...(parsed.data.history ?? []),
    { role: 'user', content: parsed.data.message },
  ];

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages,
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return NextResponse.json({ reply: text });
  } catch {
    return NextResponse.json({ error: 'AI処理に失敗しました' }, { status: 500 });
  }
}

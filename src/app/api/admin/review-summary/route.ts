/**
 * AIレビュー要約 API（v8.28）
 * GET /api/admin/review-summary?facility_id=xxx
 * Claude Haiku でレビューを要約して施設ページに表示する
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { UUID_REGEX } from '@/lib/constants';

export const dynamic = 'force-dynamic';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 5, 60_000, 'review-summary')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) {
    return NextResponse.json({ error: 'facility_id required' }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI機能は設定されていません' }, { status: 503 });
  }

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  // 施設メンバーまたはプラットフォーム管理者のみ許可
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') {
    const { data: mem } = await supabase
      .from('facility_members')
      .select('facility_id')
      .eq('user_id', user.id)
      .eq('facility_id', facilityId)
      .limit(1)
      .maybeSingle();
    if (!mem) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  // レビューを最新20件取得
  const { data: reviews } = await supabase
    .from('facility_reviews')
    .select('rating, comment, rating_skill, rating_service, rating_atmosphere')
    .eq('facility_id', facilityId)
    .eq('status', 'published')
    .not('comment', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!reviews || reviews.length < 3) {
    return NextResponse.json({ summary: null, reason: '口コミが少なすぎます（3件以上必要）' });
  }

  const reviewText = reviews
    .filter((r) => r.comment)
    .map((r, i) => `[${i + 1}] 総合${r.rating}点: ${r.comment}`)
    .join('\n');

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `以下は施設への口コミです。主な特徴・長所・注意点を日本語で3文以内に要約してください。「この施設は」で始めてください。

${reviewText}`,
      }],
    });

    const summary = (message.content[0] as { text: string }).text.trim();
    return NextResponse.json({ summary });
  } catch {
    return NextResponse.json({ error: '要約の生成に失敗しました' }, { status: 500 });
  }
}

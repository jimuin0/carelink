/**
 * お問い合わせ送信 API（v8.1）
 * POST /api/contact
 * Rate limiting + CSRF + reCAPTCHA（任意）でスパム防止
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const contactSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(254),
  phone: z.string().max(20).optional().nullable(),
  inquiry_type: z.string().min(1).max(100),
  message: z.string().min(1).max(5000),
});

export async function POST(request: Request) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (await checkRateLimit(mutationRateLimit, ip, 3, 60_000, 'contact')) {
    return NextResponse.json({ error: 'リクエストが多すぎます。時間をおいて再度お試しください。' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '入力内容が不正です' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error } = await supabase.from('contacts').insert({
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone || null,
    inquiry_type: parsed.data.inquiry_type,
    message: parsed.data.message,
  });

  if (error) {
    return NextResponse.json({ error: '送信に失敗しました。時間をおいて再度お試しください。' }, { status: 500 });
  }

  // Slack通知（fire-and-forget）
  fetch(new URL('/api/notify', request.url).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      type: 'contact',
      data: {
        name: parsed.data.name,
        inquiry_type: parsed.data.inquiry_type,
        email: parsed.data.email,
        message: parsed.data.message,
      },
    }),
  }).catch((err) => console.error('[contact] Slack notification failed', { err }));

  return NextResponse.json({ success: true });
}

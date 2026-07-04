/**
 * お問い合わせ送信 API（v8.1）
 * POST /api/contact
 * Rate limiting + CSRF + reCAPTCHA（任意）でスパム防止
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { mutationRateLimit } from '@/lib/rate-limit';
import { withRoute } from '@/lib/with-route';
import { sendNotify } from '@/lib/notify';
import { contactSchema } from '@/lib/validations-contact';
import { zodErrorResponse } from '@/lib/api-validation';

export const dynamic = 'force-dynamic';

export const POST = withRoute(async (request) => {
  const body = await request.json().catch(() => null);
  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    return zodErrorResponse(parsed.error);
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
  // server-to-server の HTTP fetch は Origin/Referer を持たず /api/notify の CSRF で 403 になり
  // 通知が無音欠落していたため、共有ロジック sendNotify を直接呼ぶ（HTTP 往復を排除）。
  sendNotify({
    type: 'contact',
    data: {
      name: parsed.data.name,
      inquiry_type: parsed.data.inquiry_type,
      email: parsed.data.email,
      message: parsed.data.message,
    },
  }).then((r) => {
    if (!r.ok) console.error('[contact] Slack notification failed', { error: r.error });
  }).catch((err) => console.error('[contact] Slack notification failed', { err }));

  return NextResponse.json({ success: true });
}, {
  csrf: true,
  rateLimit: { limiter: mutationRateLimit, limit: 3, windowMs: 60_000, prefix: 'contact' },
  sentryTag: 'contact',
});

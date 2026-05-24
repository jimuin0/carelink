import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import * as Sentry from '@sentry/nextjs';

export const dynamic = 'force-dynamic';

const profileSchema = z.object({
  display_name: z.string().min(1, 'お名前は必須です').max(50),
  phone: z.string().max(20).nullable().optional(),
  prefecture: z.string().max(20).nullable().optional(),
  city: z.string().max(50).nullable().optional(),
  birth_date: z.string().max(10).nullable().optional(),
  gender: z.enum(['male', 'female', 'other', 'unspecified']).nullable().optional(),
});

export async function PUT(request: Request) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (await checkRateLimit(mutationRateLimit, ip, 10, 60_000, 'profile')) {
      return NextResponse.json({ error: '短時間に多くのリクエストがありました。しばらくお待ちください。' }, { status: 429 });
    }

    const cookieStore = await cookies();
    console.error('[api/profile DEBUG] URL prefix:', (process.env.NEXT_PUBLIC_SUPABASE_URL || '').slice(0, 15), 'ANON_KEY len:', (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').length, 'cookies:', cookieStore.getAll().map(c => c.name).join(','));
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {}
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    }

    const d = parsed.data;
    const serviceClient = createServiceRoleClient();
    const { error } = await serviceClient
      .from('profiles')
      .update({
        display_name: d.display_name,
        phone: d.phone ?? null,
        prefecture: d.prefecture ?? null,
        city: d.city ?? null,
        birth_date: d.birth_date ?? null,
        gender: d.gender ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (error) {
      return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[api/profile PUT] caught error:', e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : String(e));
    Sentry.captureException(e, { tags: { feature: 'profile' } });
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

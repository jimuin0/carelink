import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import * as Sentry from '@sentry/nextjs';

export const dynamic = 'force-dynamic';

const profileSchema = z.object({
  display_name: z.string().min(1, 'お名前は必須です'),
  phone: z.string().nullable().optional(),
  prefecture: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  birth_date: z.string().nullable().optional(),
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

    const body = await request.json();
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const cookieStore = cookies();
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

    const { error } = await supabase
      .from('profiles')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    if (error) {
      return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'profile' } });
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

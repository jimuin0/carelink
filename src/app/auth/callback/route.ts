import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { safeRedirect } from '@/lib/safe-redirect';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // ⚠️ ここは旧ガード（先頭2文字だけを見る判定）でも実際には外部へ出ない: 下の
  // `${origin}${redirect}` という文字列連結は `/\evil.com` を渡されても
  // `https://carelink-jp.com//evil.com` に正規化されるだけで、他の2箇所
  // （middleware・login page の router.push）のように「解決してからナビゲート」する
  // 経路ではないため危険ではない。それでも safeRedirect に置き換えるのは、
  // 3箇所の判定を1本のロジックに揃え、次に判定方式が変わってもここだけ取り残されない
  // ようにするため（挙動は変わらない）。
  const redirect = safeRedirect(searchParams.get('redirect'), origin);

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
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

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${redirect}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=callback_failed`);
}

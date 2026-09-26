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
  const loginUrl = new URL('/auth/login', origin);
  loginUrl.searchParams.set('error', 'callback_failed');
  loginUrl.searchParams.set('redirect', redirect);

  // Provider の詳細をURLへ反射せず、失敗理由は同じ安全な案内に正規化する。
  if (searchParams.get('error') || !code) {
    return NextResponse.redirect(loginUrl);
  }

  try {
    const cookieStore = await cookies();
    let cookieSaveFailed = false;
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
            } catch {
              cookieSaveFailed = true;
            }
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && !cookieSaveFailed) {
      return NextResponse.redirect(new URL(redirect, origin));
    }
  } catch {
    // 認証コード・cookie・ネットワークの内部詳細を返さず、再ログインへ安全に誘導する。
  }

  return NextResponse.redirect(loginUrl);
}

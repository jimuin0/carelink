import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { loginDestination } from '@/lib/post-login-landing';

// A container request can have an internal origin (0.0.0.0:3000). A relative
// Location keeps the browser on the public origin without trusting Host or
// forwarded headers. Call only with a path sanitized by loginDestination.
function redirectWithinSite(path: string) {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // loginDestination validates the destination as a same-origin path. With no
  // explicit destination, /auth/landing selects the customer or owner screen.
  const rawRedirect = searchParams.get('redirect');
  const redirect = loginDestination(rawRedirect, origin);
  const loginUrl = new URL('/auth/login', origin);
  loginUrl.searchParams.set('error', 'callback_failed');
  // 失敗してもログイン後に同じ続き（店舗作成・申込の選び直しなど）へ進めるよう戻り先を引き継ぐ。
  if (rawRedirect) loginUrl.searchParams.set('redirect', redirect);
  const loginPath = `${loginUrl.pathname}${loginUrl.search}`;

  // Provider の詳細をURLへ反射せず、失敗理由は同じ安全な案内に正規化する。
  if (searchParams.get('error') || !code) {
    return redirectWithinSite(loginPath);
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
      return redirectWithinSite(redirect);
    }
  } catch {
    // 認証コード・cookie・ネットワークの内部詳細を返さず、再ログインへ安全に誘導する。
  }

  return redirectWithinSite(loginPath);
}

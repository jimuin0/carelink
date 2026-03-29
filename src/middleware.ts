import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED_PATHS = ['/mypage', '/admin'];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // トークンリフレッシュ（全リクエストで実行）
  const { data: { user } } = await supabase.auth.getUser();

  // 保護ルートへの未認証アクセスをリダイレクト
  const isProtected = PROTECTED_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  );
  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/login';
    url.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // /admin ルートへの権限チェック（facility_members owner/admin のみ）
  if (user && request.nextUrl.pathname.startsWith('/admin')) {
    const { data: membership } = await supabase
      .from('facility_members')
      .select('role')
      .eq('user_id', user.id)
      .limit(1)
      .single();
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      const url = request.nextUrl.clone();
      url.pathname = '/mypage';
      return NextResponse.redirect(url);
    }
  }

  // 認証済みユーザーがログイン/登録ページにアクセスした場合リダイレクト
  if (user && (request.nextUrl.pathname === '/auth/login' || request.nextUrl.pathname === '/auth/signup')) {
    const url = request.nextUrl.clone();
    url.pathname = '/mypage';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.svg|apple-touch-icon.png|og-image.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

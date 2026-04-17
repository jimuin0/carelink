import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED_PATHS = ['/mypage', '/admin'];

// 管理者メンバーシップのクッキーキャッシュ
// キー: _cm_mbr_{userId_first8chars}
// 値: "1" (有効) または "0" (無効)
// TTL: 5分（頻繁なDB問い合わせを防ぐ）
const MEMBERSHIP_CACHE_TTL_SECONDS = 300;

function getMembershipCacheKey(userId: string): string {
  return `_cm_mbr_${userId.slice(0, 8)}`;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 公開ページは認証チェックをスキップ（パフォーマンス最適化）
  const isProtected = PROTECTED_PATHS.some((path) => pathname.startsWith(path));
  const isAuthPage = pathname === '/auth/login' || pathname === '/auth/signup';
  if (!isProtected && !isAuthPage) {
    return NextResponse.next({ request });
  }

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

  // トークンリフレッシュ（保護ルート・認証ページのみ）
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Supabase障害時はリクエストを通す（保護ルートは後段でリダイレクト）
  }

  // 保護ルートへの未認証アクセスをリダイレクト
  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/login';
    url.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // /admin ルートへの権限チェック（facility_members owner/admin のみ）
  // /admin/onboarding は除外（施設作成前のオーナーがアクセスする）
  if (user && request.nextUrl.pathname.startsWith('/admin') && request.nextUrl.pathname !== '/admin/onboarding') {
    const cacheKey = getMembershipCacheKey(user.id);
    const cached = request.cookies.get(cacheKey)?.value;

    let hasAccess: boolean;

    if (cached !== undefined) {
      // キャッシュヒット: DB問い合わせをスキップ
      hasAccess = cached === '1';
    } else {
      // キャッシュミス: DBで確認してクッキーにキャッシュ
      const { data: membership } = await supabase
        .from('facility_members')
        .select('role')
        .eq('user_id', user.id)
        .limit(1)
        .single();
      hasAccess = !!(membership && ['owner', 'admin'].includes(membership.role));

      // キャッシュを設定（5分TTL、HttpOnly・SameSite=Strict）
      supabaseResponse.cookies.set(cacheKey, hasAccess ? '1' : '0', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: MEMBERSHIP_CACHE_TTL_SECONDS,
        path: '/admin',
      });
    }

    if (!hasAccess) {
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
    '/((?!_next/static|_next/image|api/|favicon\\.svg|favicon\\.ico|apple-touch-icon\\.png|og-image\\.png|manifest\\.json|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp)$).*)',
  ],
};

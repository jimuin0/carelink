import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED_PATHS = ['/mypage', '/admin'];

// 管理者メンバーシップのクッキーキャッシュ
// キー: _cm_mbr_{userId_first8chars}
// 値: "{0|1}.{HMAC-SHA256 hex}"  — userId+値をHMACで署名し改ざん防止
// TTL: 5分（頻繁なDB問い合わせを防ぐ）
const MEMBERSHIP_CACHE_TTL_SECONDS = 300;

async function signCacheValue(userId: string, val: '0' | '1'): Promise<string> {
  const secret = process.env.ADMIN_COOKIE_SECRET;
  if (!secret) return val;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${userId}:${val}`));
  const sigHex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${val}.${sigHex}`;
}

async function verifyCacheValue(userId: string, cookieVal: string): Promise<boolean | null> {
  const secret = process.env.ADMIN_COOKIE_SECRET;
  if (!secret) return null;
  const dot = cookieVal.indexOf('.');
  if (dot < 0) return null;
  const val = cookieVal.slice(0, dot);
  const sigHex = cookieVal.slice(dot + 1);
  if (val !== '0' && val !== '1') return null;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = Uint8Array.from((sigHex.match(/.{2}/g) ?? []).map(h => parseInt(h, 16)));
    if (sigBytes.length !== 32) return null;
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(`${userId}:${val}`));
    return valid ? val === '1' : null;
  } catch {
    return null;
  }
}

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

    // キャッシュヒット: HMAC署名を検証してから信頼（署名なし/不正な値はDB再確認）
    let hasAccess: boolean | null = cached !== undefined
      ? await verifyCacheValue(user.id, cached)
      : null;

    if (hasAccess === null) {
      // キャッシュミス or 署名検証失敗: DBで確認してクッキーにキャッシュ
      const { data: membership } = await supabase
        .from('facility_members')
        .select('role')
        .eq('user_id', user.id)
        .limit(1)
        .single();
      hasAccess = !!(membership && ['owner', 'admin'].includes(membership.role));

      // キャッシュを設定（5分TTL、HttpOnly + HMAC署名）
      const signedVal = await signCacheValue(user.id, hasAccess ? '1' : '0');
      supabaseResponse.cookies.set(cacheKey, signedVal, {
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

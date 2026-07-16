import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED_PATHS = ['/mypage', '/admin'];

// 管理者メンバーシップのクッキーキャッシュ
// キー: _cm_mbr_{userId_first8chars}
// 値: "{0|1}.{発行時刻epoch秒}.{HMAC-SHA256 hex}"  — userId+値+発行時刻をHMACで署名し改ざん防止
// TTL: 5分（頻繁なDB問い合わせを防ぐ）。Cookie の maxAge と、署名ペイロード内の発行時刻から
// 算出する経過時間の両方をこの定数で判定する（SSOT）。ブラウザの maxAge だけに頼ると、
// 盗まれた Cookie 値をそのまま再送する攻撃（maxAge はブラウザ側の自己申告で検証不可能）に対し
// 永久に有効なキャッシュとして扱ってしまうため、サーバー側でも発行時刻から独立して期限切れを判定する。
const MEMBERSHIP_CACHE_TTL_SECONDS = 300;

async function signCacheValue(
  userId: string,
  val: '0' | '1',
  issuedAtEpochSec: number = Math.floor(Date.now() / 1000)
): Promise<string | null> {
  const secret = process.env.ADMIN_COOKIE_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[middleware] ADMIN_COOKIE_SECRET is not set — /admin membership cache is disabled. Set this env var to enable caching.');
    }
    return null;
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${userId}:${val}:${issuedAtEpochSec}`));
  const sigHex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${val}.${issuedAtEpochSec}.${sigHex}`;
}

async function verifyCacheValue(
  userId: string,
  cookieVal: string,
  nowEpochSec: number = Math.floor(Date.now() / 1000)
): Promise<boolean | null> {
  const secret = process.env.ADMIN_COOKIE_SECRET;
  if (!secret) return null;
  // 新形式は "{val}.{issuedAt}.{sigHex}" の3パート。旧形式（"{val}.{sigHex}" の2パート）は
  // ここで自然に不一致となり null（キャッシュmiss扱い）→ DB再確認→新形式で再発行される
  // （無停止移行）。
  const parts = cookieVal.split('.');
  if (parts.length !== 3) return null;
  const [val, issuedAtRaw, sigHex] = parts;
  if (val !== '0' && val !== '1') return null;
  if (!/^\d+$/.test(issuedAtRaw)) return null;
  const issuedAtEpochSec = Number(issuedAtRaw);
  if (!Number.isSafeInteger(issuedAtEpochSec)) return null;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = Uint8Array.from((sigHex.match(/.{2}/g) ?? []).map(h => parseInt(h, 16)));
    if (sigBytes.length !== 32) return null;
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(`${userId}:${val}:${issuedAtEpochSec}`));
    if (!valid) return null;
    // 署名が正当でも、発行時刻から TTL を超過していれば期限切れ（=キャッシュmiss扱い）。
    // 未来方向（クロックスキュー等で issuedAt > now）も不正な値として扱い null を返す。
    const ageSec = nowEpochSec - issuedAtEpochSec;
    if (ageSec < 0 || ageSec > MEMBERSHIP_CACHE_TTL_SECONDS) return null;
    return val === '1';
  } catch {
    return null;
  }
}

function getMembershipCacheKey(userId: string): string {
  // ハイフン除去後の先頭16桁（64bit相当）をキーに含める。先頭8文字のみだと衝突率が
  // 高くなるため16桁まで広げている。なお別ユーザーのキャッシュ値を流用しても
  // HMAC署名（verifyCacheValue 内で userId をペイロードに含めて検証）で弾かれるため、
  // キー衝突が起きても誤った権限昇格にはつながらない。
  return `_cm_mbr_${userId.replace(/-/g, '').slice(0, 16)}`;
}

// per-request nonce ベースの CSP を構築する。
// 'strict-dynamic' + 'nonce-...' により、nonce 付き（=Next.js が出力する）スクリプトのみ信頼し、
// それらが動的 import する子スクリプト(GA/Clarity 等の next/script)も連鎖的に許可する。
// これにより 'unsafe-inline'（任意のインライン実行=XSS 経路）を script から排除できる。
// CSP connect-src に載せる Supabase オリジンを、ハードコードした本番 ref ではなく
// NEXT_PUBLIC_SUPABASE_URL から導出する。これにより本番（同一 URL を導出＝挙動不変）に加え、
// Vercel プレビュー・ローカル・CI（supabase start のローカル URL）でもブラウザの Supabase 通信
// （signInWithPassword 等）が CSP で遮断されない。ref 変更時の無音故障も防ぐ（発症前予防）。
// 末尾に realtime 用の wss/ws オリジンも許可する。env 欠落時は本番 ref にフォールバック。
function getSupabaseConnectSrc(): string {
  const fallback = 'https://xzafxiupbflvgbarrihe.supabase.co wss://xzafxiupbflvgbarrihe.supabase.co';
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    const wsScheme = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${u.origin} ${wsScheme}//${u.host}`;
  } catch {
    return fallback;
  }
}

function buildCspHeader(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://www.googletagmanager.com https://www.google-analytics.com https://www.clarity.ms https://va.vercel-scripts.com`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: https: blob:",
    `connect-src 'self' ${getSupabaseConnectSrc()} https://*.google-analytics.com https://www.clarity.ms https://va.vercel-scripts.com https://vitals.vercel-insights.com https://access.line.me https://api.line.me https://zipcloud.ibsnet.co.jp`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 全ページ応答に per-request nonce ベース CSP を付与する。
  // Next.js は request header の Content-Security-Policy から nonce を読み取り、自身の
  // <script> に nonce を適用する。layout は x-nonce を読んで inline JSON-LD に付与する。
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const cspHeader = buildCspHeader(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', cspHeader);
  // 現在のパスをサーバーコンポーネントに渡す（AdminLayout が /admin/onboarding を
  // メンバーシップ判定から除外するために使用。施設未作成オーナーの施設作成導線を確保）。
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  const setCsp = (res: NextResponse): NextResponse => {
    res.headers.set('Content-Security-Policy', cspHeader);
    return res;
  };

  // 公開ページは認証チェックをスキップ（パフォーマンス最適化）。CSP は全応答に付与する。
  const isProtected = PROTECTED_PATHS.some((path) => pathname.startsWith(path));
  const isAuthPage = pathname === '/auth/login' || pathname === '/auth/signup';
  if (!isProtected && !isAuthPage) {
    return setCsp(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

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
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // redirect レスポンスに、getUser() が更新した認証 Cookie（supabaseResponse に載る）を
  // 明示コピーしてから返す。NextResponse.redirect は新規レスポンスのため、コピーしないと
  // リフレッシュ済みセッション Cookie が脱落し、次リクエストで断続的に強制ログアウトされる
  // （Supabase SSR の既知の落とし穴）。CSP も併せて付与する。
  const withSessionCookies = (res: NextResponse): NextResponse => {
    for (const c of supabaseResponse.cookies.getAll()) res.cookies.set(c);
    return setCsp(res);
  };

  // トークンリフレッシュ（保護ルート・認証ページのみ）
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (err) {
    // Supabase障害時はリクエストを通す（保護ルートは後段でリダイレクト）
    console.error('[middleware] Supabase getUser failed — treating as unauthenticated:', err);
  }

  // 保護ルートへの未認証アクセスをリダイレクト
  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/login';
    url.searchParams.set('redirect', request.nextUrl.pathname);
    return withSessionCookies(NextResponse.redirect(url));
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
      // owner/admin ロールの行のみを対象に絞る（複数施設に所属し、別施設では
      // staff/viewer の場合に .limit(1) が任意の行を返して誤判定するのを防ぐ）
      const { data: membership, error: memErr } = await supabase
        .from('facility_members')
        .select('role')
        .eq('user_id', user.id)
        .in('role', ['owner', 'admin'])
        .limit(1)
        .maybeSingle();
      if (memErr) {
        // 一時的な DB エラーで data=null → hasAccess=false を 5 分キャッシュすると、正規の
        // 管理者が blip 中に /admin から締め出され、キャッシュ期限まで固定される。エラー時は
        // 否定結果をキャッシュせず、この request のみ fail-closed（/mypage へ）。次リクエストで
        // 再判定されるため sticky lockout を防ぐ（発症前の恒久根治）。
        const url = request.nextUrl.clone();
        url.pathname = '/mypage';
        return withSessionCookies(NextResponse.redirect(url));
      }
      hasAccess = !!membership;

      // キャッシュを設定（5分TTL、HttpOnly + HMAC署名）— ADMIN_COOKIE_SECRET 未設定時はキャッシュしない
      const signedVal = await signCacheValue(user.id, hasAccess ? '1' : '0');
      if (signedVal !== null) {
        supabaseResponse.cookies.set(cacheKey, signedVal, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: MEMBERSHIP_CACHE_TTL_SECONDS,
          path: '/admin',
        });
      }
    }

    if (!hasAccess) {
      const url = request.nextUrl.clone();
      url.pathname = '/mypage';
      return withSessionCookies(NextResponse.redirect(url));
    }
  }

  // 認証済みユーザーがログイン/登録ページにアクセスした場合リダイレクト
  if (user && (request.nextUrl.pathname === '/auth/login' || request.nextUrl.pathname === '/auth/signup')) {
    const url = request.nextUrl.clone();
    url.pathname = '/mypage';
    return withSessionCookies(NextResponse.redirect(url));
  }

  return setCsp(supabaseResponse);
}

// テスト用エクスポート（L6 認証バイパステスト）
export { signCacheValue, verifyCacheValue, getMembershipCacheKey };

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|api/|favicon\\.svg|favicon\\.ico|apple-touch-icon\\.png|og-image\\.png|manifest\\.json|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp)$).*)',
  ],
};

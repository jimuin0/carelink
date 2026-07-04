import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';

/**
 * 定数時間文字列比較。早期 return での文字単位リーク（タイミング攻撃）を防ぐ。
 * - CSRF state nonce と HMAC 署名の検証に使用する。特に HMAC 署名比較
 *   （サーバ計算値 vs 攻撃者制御値）は平文 !== だと署名をバイト単位で
 *   復元され得る古典的タイミング攻撃面のため constant-time が必須。
 * - 両引数とも非空文字列であることは呼び出し側で保証する（undefined 判定を
 *   ここに持ち込むと到達不能ブランチが生まれるため）。長さ不一致は即 false
 *   （state nonce/HMAC とも固定長で長さは秘匿対象でないため許容）。
 */
function timingSafeStrEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * LINE の email 非提供時に使う合成メールを、サーバ秘密（LINE_CHANNEL_SECRET）で
 * HMAC 導出して予測不能にする（監査A1・アカウント先回り乗っ取りの根治）。
 *
 * 旧実装は `line_${userId}@line.carelink.local` と userId 平文で予測可能だったため、
 * 攻撃者が被害者の LINE userId を知っていれば、その合成メールをパスワード付きで
 * 先回り登録でき、被害者の初回 LINE ログイン（この合成メール経路）を
 * verifyOtp で攻撃者アカウントに流し込めた。HMAC 化で第三者は合成メールを
 * 算出できず先回り登録が不能になる。
 *
 * - userId 起点の決定的導出なので冪等（リトライで同一メール＝createUser も冪等）。
 * - 既存 LINE ユーザーは line_user_links 経由（line_user_id 起点）で照合され、
 *   GoTrue に保存済みの実 email を使うため、この合成メール形式変更の影響を受けない
 *   （新形式が効くのは link 未作成の初回ログインのみ）。
 * - LINE_CHANNEL_SECRET は token 交換（上流）でも必須のため、ここに到達する時点で
 *   必ず設定済み。未設定なら LINE ログイン自体が先に失敗する。
 */
function syntheticLineEmail(userId: string): string {
  const secret = process.env.LINE_CHANNEL_SECRET || '';
  const digest = createHmac('sha256', secret).update(userId).digest('hex');
  return `line_${digest}@line.carelink.local`;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'line-callback')) {
    const { origin } = new URL(request.url);
    return NextResponse.redirect(`${origin}/auth/login?error=too_many_requests`);
  }
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const lineError = searchParams.get('error');

  const cookieStore = await cookies();
  const savedState = cookieStore.get('line_oauth_state')?.value;
  const redirect = cookieStore.get('line_oauth_redirect')?.value || '/mypage';
  const safeRedirect = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/mypage';

  // Clean up OAuth cookies
  cookieStore.delete('line_oauth_state');
  cookieStore.delete('line_oauth_redirect');

  if (lineError) {
    return NextResponse.redirect(`${origin}/auth/login?error=line_denied`);
  }

  if (!code || !state || !savedState || !timingSafeStrEqual(state, savedState)) {
    return NextResponse.redirect(`${origin}/auth/login?error=line_invalid_state`);
  }

  try {
    // Exchange code for tokens
    const callbackUrl = `${origin}/api/auth/line/callback`;
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: process.env.NEXT_PUBLIC_LINE_CHANNEL_ID!,
        client_secret: process.env.LINE_CHANNEL_SECRET!,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(`${origin}/auth/login?error=line_token_failed`);
    }

    let tokens: { access_token: string; id_token?: string };
    try {
      tokens = await tokenRes.json();
    } catch {
      return NextResponse.redirect(`${origin}/auth/login?error=line_token_failed`);
    }

    // Get user profile from LINE
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!profileRes.ok) {
      return NextResponse.redirect(`${origin}/auth/login?error=line_profile_failed`);
    }

    let lineProfile: { userId: string; displayName: string; pictureUrl?: string };
    try {
      lineProfile = await profileRes.json();
    } catch {
      return NextResponse.redirect(`${origin}/auth/login?error=line_profile_failed`);
    }

    // Extract email from id_token with HMAC-SHA256 signature verification (LINE OIDC HS256)
    let email: string | null = null;
    if (tokens.id_token) {
      try {
        const parts = tokens.id_token.split('.');
        if (parts.length === 3) {
          // Verify HS256 signature using LINE_CHANNEL_SECRET
          const secret = process.env.LINE_CHANNEL_SECRET!;
          const data = `${parts[0]}.${parts[1]}`;
          const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
          );
          const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
          const expected = Buffer.from(sig).toString('base64url');
          if (!timingSafeStrEqual(expected, parts[2])) {
            // Signature mismatch — reject the id_token entirely
            return NextResponse.redirect(`${origin}/auth/login?error=line_token_invalid`);
          }
          const payload = JSON.parse(
            Buffer.from(parts[1], 'base64url').toString()
          );
          email = payload.email || null;
        }
      } catch (e) {
        // ★ id_token 検証中に例外が出た場合は fallback email に流さず明確に拒否する。
        //   従来はここで握り潰して未検証のまま処理を続けていたため、署名検証を
        //   バイパスする経路になり得た（agent監査指摘）。fail-closed にする。
        console.error('[line-callback] id_token verification threw', e);
        return NextResponse.redirect(`${origin}/auth/login?error=line_token_invalid`);
      }
    }

    // Admin client (service role) for user management
    const adminSupabase = createServiceRoleClient();

    if (!email) {
      // line_user_links テーブルで既存ユーザーを直接検索（O(1)、listUsers全件取得を回避）
      // listUsers() はデフォルト50件しか返さないため50人超で重複アカウントが発生していた
      const { data: linkRow } = await adminSupabase
        .from('line_user_links')
        .select('user_id')
        .eq('line_user_id', lineProfile.userId)
        .maybeSingle();
      if (linkRow?.user_id) {
        const { data: { user: existingUser } } = await adminSupabase.auth.admin.getUserById(linkRow.user_id);
        email = existingUser?.email || syntheticLineEmail(lineProfile.userId);
      } else {
        email = syntheticLineEmail(lineProfile.userId);
      }
    }

    // Create user if not exists (ignore "already registered" error)
    const { error: createErr } = await adminSupabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        display_name: lineProfile.displayName,
        avatar_url: lineProfile.pictureUrl || '',
        line_user_id: lineProfile.userId,
      },
    });
    if (createErr && !createErr.message?.includes('already registered')) {
      // PII（LINE userId）を本番ログ/Slack に残さない。原因究明はエラーメッセージで足りる。
      console.error('[line-callback] createUser failed', { err: createErr.message });
    }

    // Generate magic link token (works for both new and existing users)
    const { data: linkData, error: linkError } =
      await adminSupabase.auth.admin.generateLink({ type: 'magiclink', email });

    if (linkError || !linkData?.properties?.hashed_token) {
      return NextResponse.redirect(`${origin}/auth/login?error=line_auth_failed`);
    }

    // Update LINE metadata for existing users
    if (linkData.user) {
      const meta = linkData.user.user_metadata || {};
      if (!meta.line_user_id) {
        await adminSupabase.auth.admin.updateUserById(linkData.user.id, {
          user_metadata: {
            ...meta,
            line_user_id: lineProfile.userId,
            avatar_url: lineProfile.pictureUrl || meta.avatar_url || '',
          },
        });
      }
    }

    // Cookie-aware client to establish session
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
              // Server Component context — ignore
            }
          },
        },
      }
    );

    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'magiclink',
    });

    if (verifyError) {
      return NextResponse.redirect(`${origin}/auth/login?error=line_session_failed`);
    }

    return NextResponse.redirect(`${origin}${safeRedirect}`);
  } catch (e) {
    safeCaptureException(e, 'line-auth');
    alertCaughtError('line-auth', e, '/api/auth/line/callback');
    return NextResponse.redirect(`${origin}/auth/login?error=line_unexpected`);
  }
}

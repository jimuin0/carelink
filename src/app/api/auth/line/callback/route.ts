import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { resolveVerifiedLineOwner } from '@/lib/verified-line-owner';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { verifyAuthUser } from '@/lib/auth-verification';

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

/** Stable secret-derived address for a new LINE-only account. It does not
 * authorize an existing account; only provider-verified binding or admin-issued
 * app_metadata can do that. */
function syntheticLineEmail(userId: string): string {
  // ここに到達する時点で LINE_CHANNEL_SECRET は必須（上流のトークン交換で使用済み）。
  const secret = process.env.LINE_CHANNEL_SECRET!;
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
  const linkActor = cookieStore.get('line_oauth_link_actor')?.value;
  const redirect = cookieStore.get('line_oauth_redirect')?.value || '/mypage';
  const safeRedirect = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/mypage';

  // Clean up OAuth cookies
  cookieStore.delete('line_oauth_state');
  cookieStore.delete('line_oauth_redirect');
  cookieStore.delete('line_oauth_link_actor');

  if (lineError) {
    return NextResponse.redirect(`${origin}/auth/login?error=line_denied`);
  }

  if (!code || !state || !savedState || !timingSafeStrEqual(state, savedState)) {
    return NextResponse.redirect(`${origin}/auth/login?error=line_invalid_state`);
  }

  try {
    if (linkActor) {
      const verification = await verifyAuthUser((await createServerSupabaseAuthClient()).auth);
      if (verification.state === 'unavailable') return NextResponse.redirect(`${origin}/auth/login?error=line_auth_unavailable`);
      if (verification.state !== 'verified' || verification.user.id !== linkActor) {
        return NextResponse.redirect(`${origin}/auth/login?error=line_link_required`);
      }
    }
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

    if (typeof tokens.access_token !== 'string' || !tokens.access_token || tokens.access_token.length > 512) {
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

    if (!lineProfile || typeof lineProfile.userId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(lineProfile.userId) || typeof lineProfile.displayName !== 'string') {
      return NextResponse.redirect(`${origin}/auth/login?error=line_profile_failed`);
    }

    // Extract email from id_token with HMAC-SHA256 signature verification (LINE OIDC HS256)
    let email: string | null = null;
    if (tokens.id_token) {
      try {
        const parts = tokens.id_token.split('.');
        if (parts.length !== 3 || JSON.parse(Buffer.from(parts[0], 'base64url').toString()).alg !== 'HS256') {
          return NextResponse.redirect(`${origin}/auth/login?error=line_token_invalid`);
        }
        {
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
          if (payload.iss !== 'https://access.line.me' || payload.sub !== lineProfile.userId ||
            payload.aud !== process.env.NEXT_PUBLIC_LINE_CHANNEL_ID || typeof payload.exp !== 'number' ||
            payload.exp <= Date.now() / 1000 || (payload.email !== undefined && (typeof payload.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)))) {
            return NextResponse.redirect(`${origin}/auth/login?error=line_token_invalid`);
          }
          email = payload.email ?? null;
        }
      } catch {
        // ★ id_token 検証中に例外が出た場合は fallback email に流さず明確に拒否する。
        //   従来はここで握り潰して未検証のまま処理を続けていたため、署名検証を
        //   バイパスする経路になり得た（agent監査指摘）。fail-closed にする。
        console.error('[line-callback] id_token verification unavailable');
        return NextResponse.redirect(`${origin}/auth/login?error=line_token_invalid`);
      }
    }

    // Admin client (service role) for user management
    const adminSupabase = createServiceRoleClient();

    if (linkActor) {
      const bound = await adminSupabase.rpc('bind_verified_liff_account_atomic', { p_actor_id: linkActor, p_line_user_id: lineProfile.userId });
      if (bound.error || (bound.data !== 'linked' && bound.data !== 'conflict')) return NextResponse.redirect(`${origin}/auth/login?error=line_auth_unavailable`);
      if (bound.data === 'conflict') return NextResponse.redirect(`${origin}/auth/login?error=line_link_required`);
      // Linking retains the existing Supabase account; no alternate magic-link
      // login or new account is generated in this explicit reconfirmation flow.
      return NextResponse.redirect(`${origin}${safeRedirect}`);
    }

    // Both profile and immutable provider-proof ownership are required for an
    // existing link. Never issue Auth from a public user_metadata/email match.
    let actorId = await resolveVerifiedLineOwner(adminSupabase, lineProfile.userId);
    if (!actorId) {
      const trusted = await adminSupabase.rpc('find_trusted_line_auth_user', { p_line_user_id: lineProfile.userId });
      if (trusted.error) return NextResponse.redirect(`${origin}/auth/login?error=line_auth_unavailable`);
      if (trusted.data !== null && (typeof trusted.data !== 'string' || !trusted.data)) {
        return NextResponse.redirect(`${origin}/auth/login?error=line_auth_unavailable`);
      }
      actorId = trusted.data;
    }
    if (!actorId) {
      const legacy = await adminSupabase.rpc('line_identity_requires_reconfirmation', { p_line_user_id: lineProfile.userId });
      if (legacy.error || typeof legacy.data !== 'boolean') return NextResponse.redirect(`${origin}/auth/login?error=line_auth_unavailable`);
      if (legacy.data) return NextResponse.redirect(`${origin}/auth/login?error=line_link_required`);
      email ??= syntheticLineEmail(lineProfile.userId);
      let created: Awaited<ReturnType<typeof adminSupabase.auth.admin.createUser>> | null = null;
      try {
        created = await adminSupabase.auth.admin.createUser({
          email, email_confirm: true,
          app_metadata: { carelink_line_identity_version: 1, carelink_line_user_id: lineProfile.userId },
          user_metadata: { display_name: lineProfile.displayName, avatar_url: lineProfile.pictureUrl || '' },
        });
      } catch { /* The trusted marker below is the only recovery evidence. */ }
      if (created && !created.error && created.data?.user?.id) actorId = created.data.user.id;
      else {
        // A lost create response is recovered only from the trusted admin marker.
        // Never generateLink after an unrelated already-existing email error.
        const recovered = await adminSupabase.rpc('find_trusted_line_auth_user', { p_line_user_id: lineProfile.userId });
        if (recovered.error) return NextResponse.redirect(`${origin}/auth/login?error=line_auth_unavailable`);
        if (typeof recovered.data !== 'string' || !recovered.data) {
          const existingEmail = created?.error?.code === 'email_exists' || created?.error?.code === 'user_already_exists';
          return NextResponse.redirect(`${origin}/auth/login?error=${existingEmail ? 'line_link_required' : 'line_auth_unavailable'}`);
        }
        actorId = recovered.data;
      }
      // Admin creation crosses an external transaction. A successful response
      // must also match the sole trusted database candidate; duplicate markers
      // or an unknown result never authorize binding or magic-link issuance.
      const confirmed = await adminSupabase.rpc('find_trusted_line_auth_user', { p_line_user_id: lineProfile.userId });
      if (confirmed.error || confirmed.data !== actorId) return NextResponse.redirect(`${origin}/auth/login?error=line_auth_unavailable`);
    }
    const bound = await adminSupabase.rpc('bind_verified_liff_account_atomic', { p_actor_id: actorId, p_line_user_id: lineProfile.userId });
    if (bound.error || bound.data !== 'linked') return NextResponse.redirect(`${origin}/auth/login?error=line_link_required`);
    const existing = await adminSupabase.auth.admin.getUserById(actorId);
    if (existing.error || existing.data?.user?.id !== actorId || !existing.data.user.email) {
      return NextResponse.redirect(`${origin}/auth/login?error=line_auth_unavailable`);
    }
    const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({ type: 'magiclink', email: existing.data.user.email });
    if (linkError || !linkData?.properties?.hashed_token || linkData.user?.id !== actorId) {
      return NextResponse.redirect(`${origin}/auth/login?error=line_auth_failed`);
    }

    // Do not publish SDK cookies before its authoritative result identifies the
    // intended actor. Late/error/wrong-user SDK updates remain buffered.
    const pendingCookies: { name: string; value: string; options?: CookieOptions }[] = [];
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            pendingCookies.push(...cookiesToSet);
          },
        },
      }
    );

    const { data: verifiedSession, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'magiclink',
    });

    if (verifyError || verifiedSession?.user?.id !== actorId) {
      return NextResponse.redirect(`${origin}/auth/login?error=line_session_failed`);
    }

    try { pendingCookies.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
    catch { return NextResponse.redirect(`${origin}/auth/login?error=line_session_failed`); }

    return NextResponse.redirect(`${origin}${safeRedirect}`);
  } catch {
    const unavailable = new Error('LINE authentication unavailable');
    safeCaptureException(unavailable, 'line-auth');
    alertCaughtError('line-auth', unavailable, '/api/auth/line/callback');
    return NextResponse.redirect(`${origin}/auth/login?error=line_unexpected`);
  }
}

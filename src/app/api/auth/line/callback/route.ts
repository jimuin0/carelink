import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { inMemoryRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 10, 60_000, 'line-callback')) {
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

  if (!code || !state || state !== savedState) {
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
          if (expected !== parts[2]) {
            // Signature mismatch — reject the id_token entirely
            return NextResponse.redirect(`${origin}/auth/login?error=line_token_invalid`);
          }
          const payload = JSON.parse(
            Buffer.from(parts[1], 'base64url').toString()
          );
          email = payload.email || null;
        }
      } catch {
        // id_token verification failed — use fallback email
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
        email = existingUser?.email || `line_${lineProfile.userId}@line.carelink.local`;
      } else {
        email = `line_${lineProfile.userId}@line.carelink.local`;
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
      console.error('[line-callback] createUser failed', { lineUserId: lineProfile.userId, err: createErr });
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
    Sentry.captureException(e, { tags: { feature: 'line-auth' } });
    return NextResponse.redirect(`${origin}/auth/login?error=line_unexpected`);
  }
}

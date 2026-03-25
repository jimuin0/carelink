import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const lineError = searchParams.get('error');

  const cookieStore = cookies();
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
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(`${origin}/auth/login?error=line_token_failed`);
    }

    const tokens = await tokenRes.json();

    // Get user profile from LINE
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileRes.ok) {
      return NextResponse.redirect(`${origin}/auth/login?error=line_profile_failed`);
    }

    const lineProfile: { userId: string; displayName: string; pictureUrl?: string } =
      await profileRes.json();

    // Extract email from id_token (base64 decode payload)
    let email: string | null = null;
    if (tokens.id_token) {
      try {
        const payload = JSON.parse(
          Buffer.from(tokens.id_token.split('.')[1], 'base64').toString()
        );
        email = payload.email || null;
      } catch {
        // id_token decode failed — use fallback email
      }
    }

    if (!email) {
      email = `line_${lineProfile.userId}@line.carelink.local`;
    }

    // Admin client (service role) for user management
    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Create user if not exists (ignore "already registered" error)
    await adminSupabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        display_name: lineProfile.displayName,
        avatar_url: lineProfile.pictureUrl || '',
        line_user_id: lineProfile.userId,
      },
    });

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
  } catch {
    return NextResponse.redirect(`${origin}/auth/login?error=line_unexpected`);
  }
}

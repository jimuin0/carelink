import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { safeCaptureException } from '@/lib/safe';
import { createServiceRoleClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

// SSRF 防止: 保存された endpoint は push.ts の webpush.sendNotification が後で任意の URL へ
// POST する原始的 SSRF プリミティブになり得る（https/長さ検証だけでは内部ネットワーク等へ
// 向けられる）。実在する Web Push サービスのホストのみ許可する allowlist を設ける。
function isAllowedPushEndpoint(raw: string): boolean {
  // 呼び出し側で https:// 始まりは検証済み。ここはホスト名の allowlist 判定に専念する。
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === 'fcm.googleapis.com' ||                 // Chrome / FCM
    host.endsWith('.push.apple.com') ||              // Safari / Apple(web.push.apple.com 含む)
    host.endsWith('.push.services.mozilla.com') ||   // Firefox autopush
    host.endsWith('.notify.windows.com')             // Edge(旧) / WNS
  );
}

export async function POST(request: NextRequest) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = getClientIp(request);
    const isLimited = await checkRateLimit(mutationRateLimit, ip, 10, 60_000, 'rl:push-sub');
    if (isLimited) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const cookieStore = await cookies();
    // 認証判定のみ anon SSR クライアント（cookie からセッション解決）。
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    );

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const { endpoint, keys } = body;

    if (!endpoint || typeof endpoint !== 'string' || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }
    if (!endpoint.startsWith('https://') || endpoint.length > 2048 || String(keys.p256dh).length > 200 || String(keys.auth).length > 100) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }
    // 既知のプッシュサービス以外の endpoint は拒否（SSRF 防止）。
    if (!isAllowedPushEndpoint(endpoint)) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }

    // DB 書き込みは service_role に集約（anon UPSERT ポリシー削除後も継続動作・RLS 依存排除）。
    const serviceClient = createServiceRoleClient();
    const { error } = await serviceClient
      .from('push_subscriptions')
      .upsert(
        {
          user_id: user.id,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    safeCaptureException(e, 'push-subscribe');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

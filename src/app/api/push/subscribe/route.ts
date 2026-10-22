import { verifyAuthUser } from '@/lib/auth-verification';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { serverError, authUnavailable, withRoute } from '@/lib/with-route';
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

    const verification = await verifyAuthUser(supabase.auth);
    if (verification.state === 'unavailable') return authUnavailable('push-subscribe', '/api/push/subscribe');
    const user = verification.state === 'verified' ? verification.user : null;

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
    // 同じブラウザ（endpoint）を前に別のアカウントが登録していた行を外す。
    // 一意制約は UNIQUE(user_id) だけなので、残すと 1 台の端末に 2 つのアカウント宛ての通知
    // （＝前に使っていた人の予約者名入りの通知）が届き続ける（共用端末でのアカウント切り替え）。
    const { error: releaseError } = await serviceClient
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .neq('user_id', user.id);
    if (releaseError) {
      return serverError('push-subscribe-release', releaseError, '/api/push/subscribe', 'Failed to save subscription');
    }
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
      return serverError('push-subscribe-upsert', error, '/api/push/subscribe', 'Failed to save subscription');
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError('push-subscribe', e, '/api/push/subscribe');
  }
}

/**
 * この端末のプッシュ通知を解除する（2026年10月22日 新設・管理画面の通知設定から呼ぶ）。
 *
 * 消すのは【呼び出した本人の行のうち、送られてきた endpoint と一致するもの】だけ。
 * push_subscriptions は UNIQUE(user_id) で 1 人 1 端末なので、endpoint まで照合しないと、
 * 画面を開いたまま別の端末で登録し直した後にこの端末で「解除」を押したとき、
 * 新しく登録した方の端末の購読を消してしまう。一致しなければ何も消さず removed=0 を返す。
 */
export const DELETE = withRoute(async (request, ctx) => {
  const body: unknown = await request.json().catch(() => null);
  const endpoint = body !== null && typeof body === 'object' ? (body as Record<string, unknown>).endpoint : undefined;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || endpoint.length > 2048) {
    return NextResponse.json({ error: '解除する端末を確認できませんでした' }, { status: 400 });
  }
  const { data, error } = await createServiceRoleClient()
    .from('push_subscriptions')
    .delete()
    .eq('user_id', ctx.user!.id)
    .eq('endpoint', endpoint)
    .select('id');
  if (error) return serverError('push-unsubscribe-delete', error, '/api/push/subscribe', '通知の解除に失敗しました');
  return NextResponse.json({ ok: true, removed: data?.length ?? 0 });
}, {
  csrf: true,
  requireAuth: true,
  rateLimit: { limiter: mutationRateLimit, limit: 10, windowMs: 60_000, prefix: 'rl:push-unsub' },
  sentryTag: 'push-unsubscribe',
});

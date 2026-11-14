import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute, serverError } from '@/lib/with-route';

export const dynamic = 'force-dynamic';
// 運営の申込一覧から隠す／戻すだけ。申込・店舗・公開状態・通知は変えない。
const input = z.object({ hidden: z.boolean() }).strict();
const output = z.object({ outcome: z.enum(['updated', 'unchanged', 'not_found', 'forbidden', 'invalid']), hidden: z.boolean().optional(), revision: z.number().int().positive().optional() }).strict();
const route = withRoute(async (request, ctx) => {
  try {
    const path = new URL(request.url).pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/visibility$/);
    const id = z.uuid().safeParse(path?.[1]);
    const body = input.safeParse(await request.json().catch(() => null));
    if (!id.success || !body.success) return NextResponse.json({ error: '入力を確認してください' }, { status: 400 });
    const result = await createServiceRoleClient().rpc('set_salon_registration_visibility', {
      p_actor: ctx.user!.id, p_salon: id.data, p_hidden: body.data.hidden,
    });
    const data = output.safeParse(result.data);
    if (result.error || !data.success) throw new Error('Visibility dependency failed');
    if (data.data.outcome === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (data.data.outcome !== 'updated' || data.data.hidden !== body.data.hidden || data.data.revision === undefined)
      return NextResponse.json({ error: '更新できません。一覧を再取得してください。' }, { status: 409 });
    return NextResponse.json({ success: true, hidden: data.data.hidden });
  } catch {
    return serverError('registration-visibility', new Error('Visibility dependency failed'), '/api/admin/registrations/[id]/visibility', '更新結果を確認できません。');
  }
}, { csrf: true, requireAuth: true, rateLimit: { limiter: null, limit: 10, windowMs: 60_000, prefix: 'registration-visibility' }, sentryTag: 'registration-visibility' });
export async function PATCH(request: Request) {
  const response = await route(request); response.headers.set('Cache-Control', 'no-store'); return response;
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute, serverError } from '@/lib/with-route';

export const dynamic = 'force-dynamic';
// 「書類は後から」（2026-11-03 本人決定）。付けた申込から作られた店舗は、書類の確認前でも公開できる。運営だけが付け外しできる。
const input = z.object({ deferred: z.boolean() }).strict();
const output = z.object({ outcome: z.enum(['updated', 'unchanged', 'not_found', 'forbidden', 'invalid']), deferred: z.boolean().optional(), revision: z.number().int().positive().optional() }).strict();
const route = withRoute(async (request, ctx) => {
  try {
    const path = new URL(request.url).pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/document-deferral$/);
    const id = z.uuid().safeParse(path?.[1]);
    const body = input.safeParse(await request.json().catch(() => null));
    if (!id.success || !body.success) return NextResponse.json({ error: '入力を確認してください' }, { status: 400 });
    const result = await createServiceRoleClient().rpc('set_listing_verification_deferral', {
      p_actor: ctx.user!.id, p_salon: id.data, p_deferred: body.data.deferred,
    });
    const data = output.safeParse(result.data);
    if (result.error || !data.success) throw new Error('Document deferral dependency failed');
    if (data.data.outcome === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (data.data.outcome !== 'updated' || data.data.deferred !== body.data.deferred || data.data.revision === undefined)
      return NextResponse.json({ error: '更新できません。一覧を再取得してください。' }, { status: 409 });
    return NextResponse.json({ success: true, deferred: data.data.deferred });
  } catch {
    return serverError('registration-document-deferral', new Error('Document deferral dependency failed'), '/api/admin/registrations/[id]/document-deferral', '更新結果を確認できません。');
  }
}, { csrf: true, requireAuth: true, rateLimit: { limiter: null, limit: 10, windowMs: 60_000, prefix: 'registration-document-deferral' }, sentryTag: 'registration-document-deferral' });
export async function PATCH(request: Request) {
  const response = await route(request); response.headers.set('Cache-Control', 'no-store'); return response;
}

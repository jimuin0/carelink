import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute, serverError } from '@/lib/with-route';

export const dynamic = 'force-dynamic';
const input = z.object({ classification: z.enum(['test', 'real', 'unknown']), expected_revision: z.number().int().min(0).max(2147483646) }).strict();
const output = z.object({ outcome: z.enum(['updated', 'conflict', 'not_found', 'forbidden', 'invalid']), classification: z.enum(['test', 'real', 'unknown']).optional(), revision: z.number().int().positive().optional() }).strict();
const route = withRoute(async (request, ctx) => {
  try {
    const path = new URL(request.url).pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/classification$/);
    const id = z.uuid().safeParse(path?.[1]);
    const body = input.safeParse(await request.json().catch(() => null));
    if (!id.success || !body.success) return NextResponse.json({ error: '入力を確認してください' }, { status: 400 });
    const result = await createServiceRoleClient().rpc('set_salon_registration_classification', {
      p_actor: ctx.user!.id, p_salon: id.data, p_value: body.data.classification, p_expected_revision: body.data.expected_revision,
    });
    const data = output.safeParse(result.data);
    if (result.error || !data.success) throw new Error('Classification dependency failed');
    if (data.data.outcome === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (data.data.outcome !== 'updated' || data.data.classification !== body.data.classification || data.data.revision !== body.data.expected_revision + 1)
      return NextResponse.json({ error: '更新できません。一覧を再取得してください。' }, { status: 409 });
    return NextResponse.json({ success: true, classification: data.data.classification, revision: data.data.revision });
  } catch {
    return serverError('registration-classification', new Error('Classification dependency failed'), '/api/admin/registrations/[id]/classification', '更新結果を確認できません。');
  }
}, { csrf: true, requireAuth: true, rateLimit: { limiter: null, limit: 10, windowMs: 60_000, prefix: 'registration-classification' }, sentryTag: 'registration-classification' });
export async function PATCH(request: Request) {
  const response = await route(request); response.headers.set('Cache-Control', 'no-store, no-transform'); return response;
}

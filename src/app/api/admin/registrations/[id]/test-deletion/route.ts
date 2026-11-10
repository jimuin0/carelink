import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute, serverError } from '@/lib/with-route';
import { safeCaptureMessage } from '@/lib/safe';

export const dynamic = 'force-dynamic';
// 「テスト・検証用」と記録した申込の削除（2026-11-06 本人決定）。消してよいかは DB の関数が確かめる。
const input = z.object({ expected_name: z.string().min(1).max(200) }).strict();
const output = z.object({
  outcome: z.enum(['deleted', 'invalid', 'forbidden', 'not_found', 'changed', 'not_test', 'facility_not_draft', 'has_activity', 'delivery_in_progress']),
  facility_id: z.uuid().nullable().optional(),
  upload_paths: z.array(z.string().min(1)).optional(),
}).strict();
const REFUSED: Partial<Record<z.infer<typeof output>['outcome'], string>> = {
  not_found: 'この申込はすでにありません。一覧を再取得してください。',
  changed: '店舗名が変わっています。一覧を再取得して確かめてください。',
  not_test: '「テスト・検証用」と記録した申込だけ削除できます。',
  facility_not_draft: '店舗が公開中または停止中なので削除できません。',
  has_activity: '予約・顧客・口コミ・確認書類などがあるため削除できません。',
  delivery_in_progress: '送信待ちのメールや通知があるため削除できません。少し待ってからやり直してください。',
};

type Db = ReturnType<typeof createServiceRoleClient>;
/** DB の削除が確定した後に、写真のファイルを消す。失敗しても申込は消えているので、残ったことだけを返す。 */
async function removeFiles(db: Db, facilityId: string | null | undefined, uploadPaths: string[]): Promise<boolean> {
  let complete = true;
  try {
    if (uploadPaths.length > 0) {
      const removed = await db.storage.from('carelink-uploads').remove(uploadPaths);
      if (removed.error) complete = false;
    }
    if (facilityId) {
      const prefix = `facilities/${facilityId}`;
      const listed = await db.storage.from('photos').list(prefix, { limit: 1000 });
      if (listed.error) complete = false;
      const paths = (listed.data ?? []).map(file => `${prefix}/${file.name}`);
      if (paths.length > 0) {
        const removed = await db.storage.from('photos').remove(paths);
        if (removed.error) complete = false;
      }
    }
  } catch {
    complete = false;
  }
  if (!complete) safeCaptureMessage('storage files remain after registration deletion', 'error', 'registration-test-deletion');
  return complete;
}

const route = withRoute(async (request, ctx) => {
  try {
    const path = new URL(request.url).pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/test-deletion$/);
    const id = z.uuid().safeParse(path?.[1]);
    const body = input.safeParse(await request.json().catch(() => null));
    if (!id.success || !body.success) return NextResponse.json({ error: '入力を確認してください' }, { status: 400 });
    const db = createServiceRoleClient();
    const result = await db.rpc('delete_test_registration', {
      p_actor: ctx.user!.id, p_salon: id.data, p_expected_name: body.data.expected_name,
    });
    const data = output.safeParse(result.data);
    if (result.error || !data.success) throw new Error('Registration deletion dependency failed');
    if (data.data.outcome === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (data.data.outcome === 'invalid') return NextResponse.json({ error: '入力を確認してください' }, { status: 400 });
    if (data.data.outcome !== 'deleted') return NextResponse.json({ error: REFUSED[data.data.outcome] }, { status: 409 });
    const filesRemoved = await removeFiles(db, data.data.facility_id, data.data.upload_paths ?? []);
    return NextResponse.json({ success: true, filesRemoved });
  } catch {
    return serverError('registration-test-deletion', new Error('Registration deletion dependency failed'), '/api/admin/registrations/[id]/test-deletion', '削除の結果を確認できません。一覧を再読み込みしてください。');
  }
}, { csrf: true, requireAuth: true, rateLimit: { limiter: null, limit: 30, windowMs: 60_000, prefix: 'registration-test-deletion' }, sentryTag: 'registration-test-deletion' });
export async function POST(request: Request) {
  const response = await route(request); response.headers.set('Cache-Control', 'no-store'); return response;
}

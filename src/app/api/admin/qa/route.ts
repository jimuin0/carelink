import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';

const answerSchema = z.object({
  qa_id: z.string().uuid(),
  answer: z.string().min(1).max(2000),
});

const publicToggleSchema = z.object({
  qa_id: z.string().uuid(),
  is_public: z.boolean(),
});

const deleteSchema = z.object({
  qa_id: z.string().uuid(),
});

async function getAdminFacilityId(request: NextRequest): Promise<{ facilityId: string; userId: string } | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) return null;

  const { data } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .single();

  return data ? { facilityId, userId: user.id } : null;
}

// POST: Submit an answer
export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-qa-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const result = await getAdminFacilityId(request);
  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const action = request.nextUrl.searchParams.get('action');

  if (action === 'toggle-public') {
    const parsed = publicToggleSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

    const admin = createServiceRoleClient();
    const { error } = await admin
      .from('facility_qa')
      .update({ is_public: parsed.data.is_public })
      .eq('id', parsed.data.qa_id)
      .eq('facility_id', result.facilityId);

    if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

    void writeAuditLog({
      userId: result.userId,
      facilityId: result.facilityId,
      action: 'update',
      tableName: 'facility_qa',
      recordId: parsed.data.qa_id,
      newValues: { is_public: parsed.data.is_public },
      ipAddress: ip,
    });

    return NextResponse.json({ ok: true });
  }

  if (action === 'delete') {
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

    const admin = createServiceRoleClient();
    // 【2026年7月10日 恒久根治】削除件数を検証せず常に成功を返していたため、他施設のqa_idを
    // 指定した0件削除（facility_id不一致）も「成功」と偽装していた（phantom success）。
    // .select() で削除された行を受け取り、0件なら404を返す。
    const { data, error } = await admin
      .from('facility_qa')
      .delete()
      .eq('id', parsed.data.qa_id)
      .eq('facility_id', result.facilityId)
      .select();

    if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    if (!data || data.length === 0) return NextResponse.json({ error: '質問が見つかりません' }, { status: 404 });

    void writeAuditLog({
      userId: result.userId,
      facilityId: result.facilityId,
      action: 'delete',
      tableName: 'facility_qa',
      recordId: parsed.data.qa_id,
      ipAddress: ip,
    });

    return NextResponse.json({ ok: true });
  }

  // Default: submit answer
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from('facility_qa')
    .update({
      answer: parsed.data.answer,
      answered_by: result.userId,
      answered_at: new Date().toISOString(),
      status: 'answered',
    })
    .eq('id', parsed.data.qa_id)
    .eq('facility_id', result.facilityId);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({
    userId: result.userId,
    facilityId: result.facilityId,
    action: 'update',
    tableName: 'facility_qa',
    recordId: parsed.data.qa_id,
    newValues: { answer: parsed.data.answer, status: 'answered' },
    ipAddress: ip,
  });

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';

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

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-qa-post')) {
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
    return NextResponse.json({ ok: true });
  }

  if (action === 'delete') {
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

    const admin = createServiceRoleClient();
    const { error } = await admin
      .from('facility_qa')
      .delete()
      .eq('id', parsed.data.qa_id)
      .eq('facility_id', result.facilityId);

    if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
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
  return NextResponse.json({ ok: true });
}

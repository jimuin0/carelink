import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';

const updateSchema = z.object({
  reply: z.string().max(2000).optional().nullable(),
  status: z.enum(['published', 'hidden']).optional(),
});

async function verifyReviewAdmin(reviewId: string, userId: string): Promise<string | null> {
  const admin = createServiceRoleClient();
  const { data: review } = await admin.from('facility_reviews').select('facility_id').eq('id', reviewId).single();
  if (!review) return null;
  const supabase = await createServerSupabaseAuthClient();
  const { data: mem } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', userId)
    .eq('facility_id', review.facility_id)
    .in('role', ['owner', 'admin'])
    .single();
  return mem ? review.facility_id : null;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'reviews-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await verifyReviewAdmin(params.id, user.id);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const upd: Record<string, unknown> = { ...parsed.data };
  if ('reply' in upd) upd.replied_at = upd.reply ? new Date().toISOString() : null;

  const admin = createServiceRoleClient();
  const { data, error } = await admin.from('facility_reviews').update(upd).eq('id', params.id).eq('facility_id', facilityId).select().single();
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: '口コミが見つかりません' }, { status: 404 });

  void writeAuditLog({ userId: user.id, facilityId, action: 'update', tableName: 'facility_reviews', recordId: params.id, newValues: { reply: parsed.data.reply ?? null }, ipAddress: ip });
  return NextResponse.json({ review: data });
}

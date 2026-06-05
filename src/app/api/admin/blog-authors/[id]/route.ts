import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';

async function verifyAdmin(authorId: string, userId: string): Promise<string | null> {
  const admin = createServiceRoleClient();
  const { data: a } = await admin.from('blog_authors').select('facility_id').eq('id', authorId).single();
  if (!a) return null;
  const supabase = await createServerSupabaseAuthClient();
  const { data: mem } = await supabase
    .from('facility_members').select('facility_id')
    .eq('user_id', userId).eq('facility_id', a.facility_id).in('role', ['owner', 'admin']).single();
  return mem ? a.facility_id : null;
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'blog-authors-delete')) return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const facilityId = await verifyAdmin(params.id, user.id);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { error } = await admin.from('blog_authors').delete().eq('id', params.id).eq('facility_id', facilityId);
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({ userId: user.id, facilityId, action: 'delete', tableName: 'blog_authors', recordId: params.id, ipAddress: ip });
  return NextResponse.json({ message: 'deleted' });
}

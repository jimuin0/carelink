/**
 * APIキー 無効化
 * DELETE /api/admin/api-keys/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  const { data: key } = await admin.from('api_keys').select('facility_id').eq('id', params.id).single();
  if (!key) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Verify ownership
  const { data: mem } = await supabase
    .from('facility_members').select('role')
    .eq('user_id', user.id).eq('facility_id', key.facility_id)
    .in('role', ['owner', 'admin']).single();
  if (!mem) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  await admin.from('api_keys').update({ is_active: false }).eq('id', params.id);
  return NextResponse.json({ success: true });
}

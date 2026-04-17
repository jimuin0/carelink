/**
 * APIキー 無効化
 * DELETE /api/admin/api-keys/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createClient } from '@supabase/supabase-js';

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

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

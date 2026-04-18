import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { UUID_REGEX } from '@/lib/constants';
import { inMemoryRateLimit } from '@/lib/rate-limit';

async function requireFacilityMember(userId: string) {
  const admin = createServiceRoleClient();
  const { data } = await admin
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', userId)
    .in('role', ['owner', 'admin'])
    .limit(1)
    .single();
  return !!data;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isMember = await requireFacilityMember(user.id);
  if (!isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createServiceRoleClient();

  const { data: replies, error } = await admin
    .from('community_replies')
    .select('*, profiles(display_name)')
    .eq('post_id', params.id)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ replies: replies || [] });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'community-replies')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isMember = await requireFacilityMember(user.id);
  if (!isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const raw = await req.json().catch(() => ({}));
  const body = typeof raw.body === 'string' ? raw.body : '';
  if (!body.trim()) return NextResponse.json({ error: 'body required' }, { status: 400 });

  const admin = createServiceRoleClient();

  // Verify post exists and is not locked
  const { data: post } = await admin
    .from('community_posts')
    .select('id, is_locked')
    .eq('id', params.id)
    .single();

  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  if (post.is_locked) return NextResponse.json({ error: 'Post is locked' }, { status: 403 });

  const { data: reply, error } = await admin
    .from('community_replies')
    .insert({
      post_id: params.id,
      author_id: user.id,
      body: body.slice(0, 2000),
    })
    .select('*, profiles(display_name)')
    .single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ reply }, { status: 201 });
}

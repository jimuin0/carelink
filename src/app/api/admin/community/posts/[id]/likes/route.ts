import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { UUID_REGEX } from '@/lib/constants';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

async function requireFacilityMember(userId: string): Promise<boolean> {
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

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 30, 60_000, 'community-likes')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isMember = await requireFacilityMember(user.id);
  if (!isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createServiceRoleClient();

  const { data: post } = await admin
    .from('community_posts')
    .select('id, is_locked')
    .eq('id', params.id)
    .single();
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  if (post.is_locked) return NextResponse.json({ error: 'Post is locked' }, { status: 403 });

  const { error } = await admin.from('community_likes').insert({
    post_id: params.id,
    user_id: user.id,
  });

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Already liked' }, { status: 409 });
    }
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }

  const { data: likeCount } = await admin
    .from('community_posts')
    .select('like_count')
    .eq('id', params.id)
    .single();

  return NextResponse.json({ like_count: (likeCount as { like_count?: number } | null)?.like_count ?? 0 }, { status: 201 });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 30, 60_000, 'community-likes-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isMember = await requireFacilityMember(user.id);
  if (!isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createServiceRoleClient();

  const { error: deleteErr } = await admin.from('community_likes')
    .delete()
    .eq('post_id', params.id)
    .eq('user_id', user.id);
  if (deleteErr) {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }

  const { data: post } = await admin
    .from('community_posts')
    .select('like_count')
    .eq('id', params.id)
    .single();

  return NextResponse.json({ like_count: post?.like_count ?? 0 });
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-service';

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

export async function GET() {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isMember = await requireFacilityMember(user.id);
  if (!isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createServiceRoleClient();
  const { data: posts } = await admin
    .from('community_posts')
    .select('*, profiles(display_name)')
    .order('is_pinned', { ascending: false })
    .order('last_reply_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(50);

  return NextResponse.json({ posts: posts || [] });
}

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isMember = await requireFacilityMember(user.id);
  if (!isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { category, title, body } = await req.json();

  if (!title || !body) return NextResponse.json({ error: 'title and body required' }, { status: 400 });

  const VALID_CATEGORIES = ['general', 'question', 'tips', 'showcase', 'announcement'];
  if (category && !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: post, error } = await admin
    .from('community_posts')
    .insert({
      author_id: user.id,
      category: category || 'general',
      title: title.slice(0, 200),
      body: body.slice(0, 5000),
    })
    .select('*, profiles(display_name)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ post }, { status: 201 });
}

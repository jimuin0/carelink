import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabase
    .from('gbp_posts')
    .select('*')
    .eq('facility_id', membership.facility_id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ posts: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { title, body: postBody, post_type, photo_url, cta_type, cta_url, scheduled_at } = body;

  if (!postBody?.trim()) return NextResponse.json({ error: 'body is required' }, { status: 400 });

  const { data, error } = await supabase
    .from('gbp_posts')
    .insert({
      facility_id: membership.facility_id,
      title: title || null,
      body: postBody,
      post_type: post_type || 'STANDARD',
      photo_url: photo_url || null,
      cta_type: cta_type || null,
      cta_url: cta_url || null,
      status: scheduled_at ? 'scheduled' : 'draft',
      scheduled_at: scheduled_at || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ post: data });
}

export async function PATCH(req: NextRequest) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase
    .from('gbp_posts')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('facility_id', membership.facility_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase
    .from('gbp_posts')
    .delete()
    .eq('id', id)
    .eq('facility_id', membership.facility_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

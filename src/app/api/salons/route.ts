import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    const { data, error } = await supabaseAdmin
      .from('salons')
      .select('*')
      .eq('id', id)
      .eq('is_public', true)
      .single();
    if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(data);
  }

  let query = supabaseAdmin
    .from('salons')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false });

  const businessType = searchParams.get('business_type');
  if (businessType) query = query.eq('business_type', businessType);

  const area = searchParams.get('area')?.trim().slice(0, 100);
  if (area) {
    const escaped = area.replace(/[%_\\]/g, '\\$&');
    query = query.ilike('address', `%${escaped}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { safeCaptureException } from '@/lib/safe';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'salons')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const supabase = createServerSupabaseClient();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    const { data, error } = await supabase
      .from('salons')
      .select('*')
      .eq('id', id)
      .eq('is_public', true)
      .single();
    if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(data);
  }

  let query = supabase
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

  query = query.limit(50);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'データの取得に失敗しました' }, { status: 500 });
  return NextResponse.json(data || []);
  } catch (e) {
    safeCaptureException(e, 'salons');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

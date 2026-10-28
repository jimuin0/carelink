import { NextResponse } from 'next/server';
import { withRoute } from '@/lib/with-route';
import { fetchCabinetHolidays } from '@/lib/cabinet-holidays';

export const dynamic = 'force-dynamic';
export const GET = withRoute(async () => {
  const calendar = await fetchCabinetHolidays();
  if (!calendar) return NextResponse.json({ error: '祝日を確認できません' }, { status: 503 });
  return NextResponse.json({ from: calendar.from, through: calendar.through, dates: [...calendar.dates] },
    { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=1800' } });
}, { csrf: false, rateLimit: { limiter: null, limit: 60, windowMs: 60_000, prefix: 'public-holidays' } });

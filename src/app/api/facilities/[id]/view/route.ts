import { NextResponse } from 'next/server';
import { withRoute, serverError } from '@/lib/with-route';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';

export const dynamic = 'force-dynamic';

// 施設ページの閲覧記録。以前はブラウザが anon で RPC を直接呼んでおり、回数制限も
// 公開状態の確認も無かったため、誰でも閲覧数とファネル集計を際限なく水増しできた。
// 同じ IP・同じ施設は 30 分に 1 回だけ数える（超過は 204 で黙って数えない）。
const PER_FACILITY_WINDOW_MS = 30 * 60_000;

export const POST = withRoute(async (request) => {
  const id = String(new URL(request.url).pathname.split('/').at(-2));
  if (!UUID_REGEX.test(id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 1, PER_FACILITY_WINDOW_MS, `facility-view:${id}`)) {
    return new NextResponse(null, { status: 204 });
  }

  const db = createServiceRoleClient();
  const { data: facility, error: readError } = await db.from('facility_profiles')
    .select('id').eq('id', id).eq('status', 'published').maybeSingle();
  if (readError) return serverError('facility-view-read', new Error('facility_read_failed'), '/api/facilities/[id]/view');
  if (!facility) return new NextResponse(null, { status: 204 });

  const { error } = await db.rpc('record_facility_page_view', { facility_uuid: id });
  if (error) return serverError('facility-view-record', new Error('page_view_record_failed'), '/api/facilities/[id]/view');
  return new NextResponse(null, { status: 204 });
}, {
  csrf: true,
  rateLimit: { limiter: null, limit: 60, windowMs: 60_000, prefix: 'facility-view' },
  sentryTag: 'facility-view',
});

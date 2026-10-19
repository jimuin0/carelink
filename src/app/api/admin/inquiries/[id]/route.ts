import { writePlatformControl, platformControlResponse } from '@/lib/platform-control-write';
import { NextRequest, NextResponse } from 'next/server';
import { verifyPlatformSupportUser } from '@/lib/platform-support-auth';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { authUnavailable } from '@/lib/with-route';

const VALID_STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

const ticketUpdateSchema = z.object({
  ticket_status: z.enum(VALID_STATUSES).optional(),
  priority: z.enum(VALID_PRIORITIES).optional(),
  ticket_notes: z.string().max(2000).optional().nullable(),
}).refine(value=>Object.keys(value).length>0);

// contacts はプラットフォーム宛の問い合わせで facility_id 列を持たない（一覧も施設横断で表示）。
// 旧実装は facility_members による施設スコープ認可＋contacts.facility_id 絞りだったが、
// (1) contacts に facility_id 列が無く UPDATE が常に失敗、(2) 呼び出し側が facility_id を
// 送らないため常に 401、と二重に壊れていた。プラットフォーム管理者認可（registrations 等と
// 同方式）に統一し、id のみで更新する。
async function handlePATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-inquiries-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const verification = await verifyPlatformSupportUser();
  if (verification.state === 'unavailable') return authUnavailable('admin-inquiries-patch', '/api/admin/inquiries/[id]');
  if (verification.state !== 'verified') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const adminUserId = verification.user.id;

  const body = await request.json().catch(() => null);
  const parsed = ticketUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const payload=parsed.data;
  const data=await writePlatformControl(adminUserId,params.id,'ticket:update',payload,'/api/admin/inquiries/[id]');
  if(data instanceof NextResponse) return data;

  void writeAuditLog({
    userId: adminUserId,
    action: 'update',
    tableName: 'contacts',
    recordId: params.id,
    newValues: payload,
    ipAddress: ip,
  });

  return NextResponse.json({ ok: true });
}

export async function PATCH(request:NextRequest,props:{params:Promise<{id:string}>}) {return platformControlResponse(()=>handlePATCH(request,props),'/api/admin/inquiries/[id]');}

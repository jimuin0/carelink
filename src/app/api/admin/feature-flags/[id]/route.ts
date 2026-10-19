import { writePlatformControl, platformControlResponse } from '@/lib/platform-control-write';
import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

const flagUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  rollout_pct: z.number().int().min(0).max(100).optional(),
}).refine(value=>Object.keys(value).length>0);

async function handlePATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-feature-flags-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const adminUser = await requirePlatformAdmin();
  if (adminUser instanceof NextResponse) return adminUser;
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = flagUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const data=await writePlatformControl(adminUser.id,params.id,'flag:update',parsed.data,'/api/admin/feature-flags/[id]');
  if(data instanceof NextResponse) return data;

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId: adminUser.id,
    action: 'update',
    tableName: 'feature_flags',
    recordId: params.id,
    newValues: parsed.data,
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true });
}

export async function PATCH(request:NextRequest,props:{params:Promise<{id:string}>}) {return platformControlResponse(()=>handlePATCH(request,props),'/api/admin/feature-flags/[id]');}

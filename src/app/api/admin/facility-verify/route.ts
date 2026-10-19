import { writePlatformControl, platformControlResponse } from '@/lib/platform-control-write';
/**
 * 施設認証バッジ管理 API（v8.32）
 * PATCH /api/admin/facility-verify
 * プラットフォーム管理者のみ: 施設の認証ステータスを付与・取り消し
 */

import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { checkCsrf } from '@/lib/csrf';
import { UUID_REGEX } from '@/lib/constants';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const verificationSchema=z.object({facility_id:z.string().regex(UUID_REGEX),is_verified:z.boolean(),verified_type:z.enum(['phone','identity','site_visit']).optional()});

async function handlePATCH(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'facility-verify')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const user = await requirePlatformAdmin();
  if (user instanceof NextResponse) return user;
  if (!user) return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });

  const userId = user.id;
  const parsed=verificationSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success) return NextResponse.json({error:'Invalid verification'},{status:400});
  const {facility_id,is_verified,verified_type}=parsed.data;
  const values={is_verified,...(is_verified?{verified_type:verified_type ?? 'phone'}:{})};
  const data=await writePlatformControl(userId,facility_id,'facility:verify',values,'/api/admin/facility-verify');
  if(data instanceof NextResponse) return data;

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId,
    facilityId: facility_id,
    action: is_verified ? 'verify' : 'update',
    tableName: 'facility_profiles',
    recordId: facility_id,
    newValues: { is_verified: Boolean(is_verified), verified_type: data.verified_type },
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({
    success: true,
    facility_id,
    is_verified: Boolean(is_verified),
    verified_type: data.verified_type,
  });
}

export async function PATCH(request:NextRequest) {return platformControlResponse(()=>handlePATCH(request),'/api/admin/facility-verify');}

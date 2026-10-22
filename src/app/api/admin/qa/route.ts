import { NextRequest, NextResponse } from 'next/server';
import { getAdminApiContext } from '@/lib/admin-api-context';
import { manageAdminContent } from '@/lib/admin-content-write';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { FACILITY_QA_ANSWER_MAX_LENGTH } from '@/lib/facility-qa-limits';

const answerSchema = z.object({
  qa_id: z.string().uuid(),
  answer: z.string().min(1).max(FACILITY_QA_ANSWER_MAX_LENGTH),
});

const publicToggleSchema = z.object({
  qa_id: z.string().uuid(),
  is_public: z.boolean(),
});

const deleteSchema = z.object({
  qa_id: z.string().uuid(),
});


// POST: Submit an answer
export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-qa-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const result = await getAdminApiContext(request);
  if (result instanceof NextResponse) return result;

  const body = await request.json().catch(() => null);
  const action = request.nextUrl.searchParams.get('action');

  if (action === 'toggle-public') {
    const parsed = publicToggleSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

    const data = await manageAdminContent({actorId:result.userId,facilityId:result.facilityId,recordId:parsed.data.qa_id,kind:'qa:toggle',values:{is_public:parsed.data.is_public}});
    if (data instanceof NextResponse) return data;

    void writeAuditLog({
      userId: result.userId,
      facilityId: result.facilityId,
      action: 'update',
      tableName: 'facility_qa',
      recordId: parsed.data.qa_id,
      newValues: { is_public: parsed.data.is_public },
      ipAddress: ip,
    });

    return NextResponse.json({ ok: true });
  }

  if (action === 'delete') {
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

    const data = await manageAdminContent({actorId:result.userId,facilityId:result.facilityId,recordId:parsed.data.qa_id,kind:'qa:delete',values:{}});
    if (data instanceof NextResponse) return data;

    void writeAuditLog({
      userId: result.userId,
      facilityId: result.facilityId,
      action: 'delete',
      tableName: 'facility_qa',
      recordId: parsed.data.qa_id,
      ipAddress: ip,
    });

    return NextResponse.json({ ok: true });
  }

  // Default: submit answer
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const data = await manageAdminContent({actorId:result.userId,facilityId:result.facilityId,recordId:parsed.data.qa_id,kind:'qa:answer',values:{answer:parsed.data.answer}});
  if (data instanceof NextResponse) return data;

  void writeAuditLog({
    userId: result.userId,
    facilityId: result.facilityId,
    action: 'update',
    tableName: 'facility_qa',
    recordId: parsed.data.qa_id,
    newValues: { answer: parsed.data.answer, status: 'answered' },
    ipAddress: ip,
  });

  return NextResponse.json({ ok: true });
}

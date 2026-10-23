import { writePlatformEditor } from '@/lib/platform-editor-write';
import { platformControlResponse } from '@/lib/platform-control-write';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { serverError } from '@/lib/with-route';
import { isCreatableNewsletterType, NEWSLETTER_TYPE_UNAVAILABLE_MESSAGE } from '@/lib/newsletter-types';

async function handleGET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'newsletter-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const user = await requirePlatformAdmin();
  if (user instanceof NextResponse) return user;
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createServiceRoleClient();
  const { data: campaigns, error } = await admin
    .from('newsletter_campaigns')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return serverError('admin-newsletter-list', error, '/api/admin/newsletter');
  if(!Array.isArray(campaigns))return serverError('admin-newsletter-list',new Error('NEWSLETTER_LIST_UNCONFIRMED'),'/api/admin/newsletter');
  return NextResponse.json({ campaigns });
}

async function handlePOST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 5, 60_000, 'newsletter-create')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  const user = await requirePlatformAdmin();
  if (user instanceof NextResponse) return user;
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if(body===null||typeof body!=='object'||Array.isArray(body))return NextResponse.json({error:'Invalid request'},{status:400});
  const { campaign_type, subject, html_content, text_content, scheduled_at } = body;
  if (scheduled_at != null && scheduled_at !== '') {
    return NextResponse.json({ code: 'NEWSLETTER_MANUAL_ONLY', error: 'ニュースレターは手動配信のみです。予約日時を指定せず下書きを作成してください。' }, { status: 400 });
  }

  if (!campaign_type || !subject || !html_content) {
    return NextResponse.json({ error: 'campaign_type, subject, html_content are required' }, { status: 400 });
  }
  if (typeof subject !== 'string' || subject.length > 200) {
    return NextResponse.json({ error: 'subject must be a string under 200 chars' }, { status: 400 });
  }
  if (typeof html_content !== 'string' || html_content.length > 100_000) {
    return NextResponse.json({ error: 'html_content must be under 100KB' }, { status: 400 });
  }

  if (text_content != null && (typeof text_content !== 'string' || text_content.length > 100_000)) return NextResponse.json({ error: 'text_content must be under 100KB' }, { status: 400 });

  // 宛先を作る経路があるのは施設オーナー向けだけ（src/lib/newsletter-types.ts）。旧種別は作らせない。
  if (!isCreatableNewsletterType(campaign_type)) {
    return NextResponse.json({ code: 'NEWSLETTER_TYPE_UNAVAILABLE', error: NEWSLETTER_TYPE_UNAVAILABLE_MESSAGE }, { status: 400 });
  }

  const campaign=await writePlatformEditor(user.id,null,'newsletter','create',{campaign_type,subject,html_content,text_content:text_content || null},'/api/admin/newsletter');
  if(campaign instanceof NextResponse)return campaign;

  const { ua } = getRequestContext(req);
  void writeAuditLog({
    userId: user.id,
    action: 'create',
    tableName: 'newsletter_campaigns',
    recordId: campaign.id,
    newValues: { campaign_type, subject },
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ campaign }, { status: 201 });
}

export async function GET(request:NextRequest){return platformControlResponse(()=>handleGET(request),'/api/admin/newsletter');}

export async function POST(request:NextRequest){return platformControlResponse(()=>handlePOST(request),'/api/admin/newsletter');}

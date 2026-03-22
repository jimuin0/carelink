import { NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// Note: In-memory rate limiting is per serverless instance.
// On Vercel, instances are short-lived so this provides limited protection.
// For production, consider Upstash Redis for distributed rate limiting.
const requestLog = new Map<string, number[]>();
const RATE_LIMIT = 5; // max requests
const RATE_WINDOW = 60_000; // per 60 seconds

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  if (timestamps.length >= RATE_LIMIT) return true;
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return false;
}

function escSlack(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type NotifyPayload =
  | { type: 'salon'; data: { facility_name: string; business_type: string; representative_name: string; phone: string; email: string } }
  | { type: 'recruit'; data: { facility_name: string; business_type: string; job_category: string; representative_name: string; phone: string; email: string } }
  | { type: 'job_seeker'; data: { full_name: string; job_type: string; phone: string; email: string } }
  | { type: 'contact'; data: { name: string; inquiry_type: string; email: string; message: string } }
  | { type: 'facility_inquiry'; data: { facility_name: string; name: string; email: string; phone: string; message: string } };

function buildSlackMessage(payload: NotifyPayload): string {
  switch (payload.type) {
    case 'salon':
      return [
        ':office: *施設掲載の新規登録*',
        `> *施設名:* ${escSlack(payload.data.facility_name)}`,
        `> *業種:* ${escSlack(payload.data.business_type)}`,
        `> *代表者:* ${escSlack(payload.data.representative_name)}`,
        `> *電話:* ${escSlack(payload.data.phone)}`,
        `> *メール:* ${escSlack(payload.data.email)}`,
      ].join('\n');
    case 'recruit':
      return [
        ':mega: *採用掲載の新規登録*',
        `> *施設名:* ${escSlack(payload.data.facility_name)}`,
        `> *業種:* ${escSlack(payload.data.business_type)}`,
        `> *募集職種:* ${escSlack(payload.data.job_category)}`,
        `> *代表者:* ${escSlack(payload.data.representative_name)}`,
        `> *電話:* ${escSlack(payload.data.phone)}`,
        `> *メール:* ${escSlack(payload.data.email)}`,
      ].join('\n');
    case 'job_seeker':
      return [
        ':bust_in_silhouette: *求職者の新規登録*',
        `> *氏名:* ${escSlack(payload.data.full_name)}`,
        `> *職種:* ${escSlack(payload.data.job_type)}`,
        `> *電話:* ${escSlack(payload.data.phone)}`,
        `> *メール:* ${escSlack(payload.data.email)}`,
      ].join('\n');
    case 'contact':
      return [
        ':envelope: *お問い合わせ*',
        `> *お名前:* ${escSlack(payload.data.name)}`,
        `> *種別:* ${escSlack(payload.data.inquiry_type)}`,
        `> *メール:* ${escSlack(payload.data.email)}`,
        `> *内容:* ${escSlack(payload.data.message)}`,
      ].join('\n');
    case 'facility_inquiry':
      return [
        ':hospital: *施設へのお問い合わせ*',
        `> *施設名:* ${escSlack(payload.data.facility_name)}`,
        `> *お名前:* ${escSlack(payload.data.name)}`,
        `> *メール:* ${escSlack(payload.data.email)}`,
        `> *電話:* ${escSlack(payload.data.phone)}`,
        `> *内容:* ${escSlack(payload.data.message)}`,
      ].join('\n');
  }
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json({ ok: false, error: 'Too many requests' }, { status: 429 });
  }

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({ ok: false, error: 'SLACK_WEBHOOK_URL not set' }, { status: 500 });
  }

  try {
    const body = await request.json();

    const payloadSchema = z.discriminatedUnion('type', [
      z.object({ type: z.literal('salon'), data: z.object({ facility_name: z.string(), business_type: z.string(), representative_name: z.string(), phone: z.string(), email: z.string() }) }),
      z.object({ type: z.literal('recruit'), data: z.object({ facility_name: z.string(), business_type: z.string(), job_category: z.string(), representative_name: z.string(), phone: z.string(), email: z.string() }) }),
      z.object({ type: z.literal('job_seeker'), data: z.object({ full_name: z.string(), job_type: z.string(), phone: z.string(), email: z.string() }) }),
      z.object({ type: z.literal('contact'), data: z.object({ name: z.string(), inquiry_type: z.string(), email: z.string(), message: z.string() }) }),
      z.object({ type: z.literal('facility_inquiry'), data: z.object({ facility_name: z.string(), name: z.string(), email: z.string(), phone: z.string(), message: z.string() }) }),
    ]);

    const result = payloadSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ ok: false, error: 'Invalid payload' }, { status: 400 });
    }

    const payload = result.data as NotifyPayload;
    const text = buildSlackMessage(payload);

    const slackRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!slackRes.ok) {
      return NextResponse.json({ ok: false, error: 'Slack通知の送信に失敗しました' }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

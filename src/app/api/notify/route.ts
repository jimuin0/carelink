import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Simple in-memory rate limiting (per serverless instance)
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
  | { type: 'job_seeker'; data: { full_name: string; job_type: string; phone: string; email: string } }
  | { type: 'contact'; data: { name: string; inquiry_type: string; email: string; message: string } };

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
    const payload: NotifyPayload = await request.json();
    const text = buildSlackMessage(payload);

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type NotifyPayload =
  | { type: 'salon'; data: { facility_name: string; business_type: string; representative_name: string; phone: string; email: string } }
  | { type: 'job_seeker'; data: { full_name: string; job_type: string; phone: string; email: string } }
  | { type: 'contact'; data: { name: string; inquiry_type: string; email: string; message: string } };

function buildSlackMessage(payload: NotifyPayload): string {
  switch (payload.type) {
    case 'salon':
      return [
        ':office: *施設掲載の新規登録*',
        `> *施設名:* ${payload.data.facility_name}`,
        `> *業種:* ${payload.data.business_type}`,
        `> *代表者:* ${payload.data.representative_name}`,
        `> *電話:* ${payload.data.phone}`,
        `> *メール:* ${payload.data.email}`,
      ].join('\n');
    case 'job_seeker':
      return [
        ':bust_in_silhouette: *求職者の新規登録*',
        `> *氏名:* ${payload.data.full_name}`,
        `> *職種:* ${payload.data.job_type}`,
        `> *電話:* ${payload.data.phone}`,
        `> *メール:* ${payload.data.email}`,
      ].join('\n');
    case 'contact':
      return [
        ':envelope: *お問い合わせ*',
        `> *お名前:* ${payload.data.name}`,
        `> *種別:* ${payload.data.inquiry_type}`,
        `> *メール:* ${payload.data.email}`,
        `> *内容:* ${payload.data.message}`,
      ].join('\n');
  }
}

export async function POST(request: Request) {
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

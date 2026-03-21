import { NextResponse } from 'next/server';
import { Resend } from 'resend';

export const dynamic = 'force-dynamic';

const NOTIFY_TO = 'tokuhal.jimuin0@gmail.com';

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

type NotifyPayload =
  | { type: 'salon'; data: { facility_name: string; business_type: string; representative_name: string; phone: string; email: string } }
  | { type: 'job_seeker'; data: { full_name: string; job_type: string; phone: string; email: string } }
  | { type: 'contact'; data: { name: string; inquiry_type: string; email: string; message: string } };

function buildEmail(payload: NotifyPayload): { subject: string; html: string } {
  switch (payload.type) {
    case 'salon':
      return {
        subject: `【CareLink】施設掲載の新規登録: ${payload.data.facility_name}`,
        html: `
          <h2>施設掲載の新規登録がありました</h2>
          <table style="border-collapse:collapse;width:100%;max-width:500px">
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">施設名</td><td style="padding:8px;border:1px solid #ddd">${esc(payload.data.facility_name)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">業種</td><td style="padding:8px;border:1px solid #ddd">${esc(payload.data.business_type)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">代表者名</td><td style="padding:8px;border:1px solid #ddd">${esc(payload.data.representative_name)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">電話番号</td><td style="padding:8px;border:1px solid #ddd">${esc(payload.data.phone)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">メール</td><td style="padding:8px;border:1px solid #ddd">${esc(payload.data.email)}</td></tr>
          </table>
        `,
      };
    case 'job_seeker':
      return {
        subject: `【CareLink】求職者の新規登録: ${payload.data.full_name}`,
        html: `
          <h2>求職者の新規登録がありました</h2>
          <table style="border-collapse:collapse;width:100%;max-width:500px">
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">氏名</td><td style="padding:8px;border:1px solid #ddd">${esc(payload.data.full_name)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">職種</td><td style="padding:8px;border:1px solid #ddd">${esc(payload.data.job_type)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">電話番号</td><td style="padding:8px;border:1px solid #ddd">${esc(payload.data.phone)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">メール</td><td style="padding:8px;border:1px solid #ddd">${esc(payload.data.email)}</td></tr>
          </table>
        `,
      };
    case 'contact':
      return {
        subject: `【CareLink】お問い合わせ: ${payload.data.inquiry_type}（${payload.data.name}様）`,
        html: `
          <h2>お問い合わせがありました</h2>
          <table style="border-collapse:collapse;width:100%;max-width:500px">
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">お名前</td><td style="padding:8px;border:1px solid #ddd">${esc(payload.data.name)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">種別</td><td style="padding:8px;border:1px solid #ddd">${esc(payload.data.inquiry_type)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">メール</td><td style="padding:8px;border:1px solid #ddd">${esc(payload.data.email)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">内容</td><td style="padding:8px;border:1px solid #ddd">${esc(payload.data.message)}</td></tr>
          </table>
        `,
      };
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function POST(request: Request) {
  try {
    const payload: NotifyPayload = await request.json();
    const { subject, html } = buildEmail(payload);

    await getResend().emails.send({
      from: 'CareLink <onboarding@resend.dev>',
      to: NOTIFY_TO,
      subject,
      html,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

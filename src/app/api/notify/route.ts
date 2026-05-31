import { NextResponse } from 'next/server';
import { z } from 'zod';
import { notifyRateLimit } from '@/lib/rate-limit';
import { withRoute } from '@/lib/with-route';
import {
  postToSlack,
  sectionBlock,
  actionsBlock,
  linkButtonElement,
  contextBlock,
} from '@/lib/slack';

export const dynamic = 'force-dynamic';

function escSlack(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type NotifyPayload =
  | { type: 'salon'; data: { facility_name: string; business_type: string; representative_name: string; phone: string; email: string; address?: string; desired_start_date?: string } }
  | { type: 'contact'; data: { name: string; inquiry_type: string; email: string; message: string } }
  | { type: 'facility_inquiry'; data: { facility_name: string; name: string; email: string; phone: string; message: string } }
  | { type: 'facility'; data: { facility_name: string; contact_name: string; email: string; phone: string; business_type: string } };

// Phase 7b: 通知種別に応じた管理画面 URL を返す（リンクボタン用）
function adminUrlFor(type: NotifyPayload['type']): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://carelink-jp.com';
  switch (type) {
    case 'contact':
      return `${base}/admin/inquiries`;
    case 'salon':
    case 'facility':
      return `${base}/admin/registrations`;
    case 'facility_inquiry':
      return `${base}/admin/inquiries`;
  }
}

function buildSlackBlocks(payload: NotifyPayload, text: string): unknown[] {
  const adminUrl = adminUrlFor(payload.type);
  return [
    sectionBlock(text),
    contextBlock([`type: \`${payload.type}\``, `${new Date().toISOString()}`]),
    actionsBlock([linkButtonElement('管理画面で開く', adminUrl)]),
  ];
}

function buildSlackMessage(payload: NotifyPayload): string {
  switch (payload.type) {
    case 'salon': {
      const lines = [
        ':office: *施設掲載の新規登録*',
        `> *施設名:* ${escSlack(payload.data.facility_name)}`,
        `> *業種:* ${escSlack(payload.data.business_type)}`,
        `> *代表者:* ${escSlack(payload.data.representative_name)}`,
        `> *電話:* ${escSlack(payload.data.phone)}`,
        `> *メール:* ${escSlack(payload.data.email)}`,
      ];
      if (payload.data.address) lines.push(`> *エリア:* ${escSlack(payload.data.address)}`);
      if (payload.data.desired_start_date) lines.push(`> *掲載希望:* ${escSlack(payload.data.desired_start_date)}`);
      return lines.join('\n');
    }
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
        `> *施設��:* ${escSlack(payload.data.facility_name)}`,
        `> *お名前:* ${escSlack(payload.data.name)}`,
        `> *メール:* ${escSlack(payload.data.email)}`,
        `> *電話:* ${escSlack(payload.data.phone)}`,
        `> *内容:* ${escSlack(payload.data.message)}`,
      ].join('\n');
    case 'facility':
      return [
        ':clipboard: *施設掲載の申し込み*',
        `> *施設名:* ${escSlack(payload.data.facility_name)}`,
        `> *業種:* ${escSlack(payload.data.business_type)}`,
        `> *担当者:* ${escSlack(payload.data.contact_name)}`,
        `> *電話:* ${escSlack(payload.data.phone)}`,
        `> *メール:* ${escSlack(payload.data.email)}`,
      ].join('\n');
  }
}

export const POST = withRoute(async (request) => {
  // Phase 7a: Bot Token + chat.postMessage 経由に変更
  // SLACK_BOT_TOKEN + SLACK_DEFAULT_CHANNEL 未設定時は 500 を返す
  if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_DEFAULT_CHANNEL) {
    return NextResponse.json({ error: '通知の送信に失敗しました' }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: '無効なリクエストです' }, { status: 400 });

  const payloadSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('salon'), data: z.object({ facility_name: z.string().max(200), business_type: z.string().max(100), representative_name: z.string().max(100), phone: z.string().max(30), email: z.string().max(254), address: z.string().max(300).optional(), desired_start_date: z.string().max(30).optional() }) }),
    z.object({ type: z.literal('contact'), data: z.object({ name: z.string().max(100), inquiry_type: z.string().max(100), email: z.string().max(254), message: z.string().max(2000) }) }),
    z.object({ type: z.literal('facility_inquiry'), data: z.object({ facility_name: z.string().max(200), name: z.string().max(100), email: z.string().max(254), phone: z.string().max(30), message: z.string().max(2000) }) }),
    z.object({ type: z.literal('facility'), data: z.object({ facility_name: z.string().max(200), contact_name: z.string().max(100), email: z.string().max(254), phone: z.string().max(30), business_type: z.string().max(100) }) }),
  ]);

  const result = payloadSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const payload = result.data as NotifyPayload;
  const text = buildSlackMessage(payload);

  // Phase 7b: 通知種別に応じて管理画面リンクボタンを追加（Block Kit）
  // 種別ごとのチャンネル振り分けは将来 env 追加で可能（Phase 7a は単一チャンネル）
  const blocks = buildSlackBlocks(payload, text);
  const slackResult = await postToSlack({ text, blocks });

  if (!slackResult.ok) {
    // 内部 Slack エラーコードはクライアントに返さずサーバーログにのみ記録する
    console.error('[notify] Slack post failed', { error: slackResult.error });
    return NextResponse.json({ error: 'Slack通知の送信に失敗しました' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, ts: slackResult.ts });
}, {
  csrf: true,
  rateLimit: { limiter: notifyRateLimit, limit: 5, windowMs: 60_000, prefix: 'notify' },
  sentryTag: 'notify',
});

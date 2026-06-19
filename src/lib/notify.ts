import { z } from 'zod';
import {
  postToSlack,
  sectionBlock,
  actionsBlock,
  linkButtonElement,
  contextBlock,
} from '@/lib/slack';

function escSlack(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type NotifyPayload =
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
        `> *施設名:* ${escSlack(payload.data.facility_name)}`,
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

export const notifyPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('salon'), data: z.object({ facility_name: z.string().max(200), business_type: z.string().max(100), representative_name: z.string().max(100), phone: z.string().max(30), email: z.string().max(254), address: z.string().max(300).optional(), desired_start_date: z.string().max(30).optional() }) }),
  z.object({ type: z.literal('contact'), data: z.object({ name: z.string().max(100), inquiry_type: z.string().max(100), email: z.string().max(254), message: z.string().max(2000) }) }),
  z.object({ type: z.literal('facility_inquiry'), data: z.object({ facility_name: z.string().max(200), name: z.string().max(100), email: z.string().max(254), phone: z.string().max(30), message: z.string().max(2000) }) }),
  z.object({ type: z.literal('facility'), data: z.object({ facility_name: z.string().max(200), contact_name: z.string().max(100), email: z.string().max(254), phone: z.string().max(30), business_type: z.string().max(100) }) }),
]);

/**
 * サーバー内部から直接 Slack 通知を送るための共有ロジック。
 *
 * 旧構成では contact など同一サーバーのルートが /api/notify へ HTTP fetch していたが、
 * notify が withRoute(csrf:true) 化された後、server-to-server fetch は Origin/Referer を
 * 持たないため CSRF で 403 になり通知が無音欠落していた（管理者がお問い合わせに気づけない）。
 * メッセージ整形ロジックを一箇所に保ちつつ HTTP 往復を排し、サーバー側からは本関数を直接呼ぶ。
 *
 * Next.js の route.ts は HTTP メソッド以外を export できない（next build の Route 型チェックで
 * 失敗する）ため、共有関数はこの lib に置き、route.ts と各呼び出し元はここから import する。
 *
 * @returns ok=true で送信成功。設定不備・検証失敗・Slack エラーは ok=false と error を返す（throw しない）。
 */
export async function sendNotify(
  input: unknown
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_DEFAULT_CHANNEL) {
    return { ok: false, error: 'not_configured' };
  }
  const result = notifyPayloadSchema.safeParse(input);
  if (!result.success) {
    return { ok: false, error: 'invalid_payload' };
  }
  const payload = result.data as NotifyPayload;
  const text = buildSlackMessage(payload);
  const blocks = buildSlackBlocks(payload, text);
  const slackResult = await postToSlack({ text, blocks });
  if (!slackResult.ok) {
    console.error('[notify] Slack post failed', { error: slackResult.error });
    return { ok: false, error: slackResult.error };
  }
  return { ok: true, ts: slackResult.ts };
}

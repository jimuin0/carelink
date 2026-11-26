import { z } from 'zod';
import { adminFacilityHref } from '@/lib/admin-facility-url';
import { UUID_REGEX } from '@/lib/constants';
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

/**
 * 運営 Slack への受付通知（2026年10月22日 改訂）。
 *
 * 🔴 Slack にはメールアドレス・電話番号を載せない。運営宛のお問い合わせ（contact）だけは、2026年11月27日の
 * 本人決定で「お名前・種類・本文の冒頭（100文字・メールと電話は伏せ字）」を載せる（プライバシーポリシー第5条に記載）。
 * それ以外の種別は「何の受付か」「施設名」「受付番号」「管理画面へのリンク」だけ。
 *
 * 【なぜ】以前は施設への問い合わせ（facility_inquiry）と運営へのお問い合わせ（contact）の
 * 氏名・メール・電話・本文（症状が書かれやすい）を全文そのまま Slack へ転記していたが、
 * 当時 Slack はプライバシーポリシー第5条の委託先に載っていなかった（2026年11月26日に、問い合わせの
 * 対応状況の通知に限りお名前・受付日・種類を載せる形で追記し、11月27日に受付通知の本文冒頭まで広げた）。
 * 転記された写しは退会時の削除や開示等の請求の対象からも外れる。施設掲載申込（src/lib/salon-outbox-delivery.ts）は既に
 * 「受付番号と管理画面 URL だけ」に作り直してあり、同じ方針にそろえた。
 *
 * 型から個人情報の欄を消してあるので、呼び出し側が氏名やメールを渡そうとすると tsc が止める。
 * 実行時も zod が未知の欄を落とすので、型をすり抜けた値も Slack へは届かない
 * （src/lib/__tests__/notify.test.ts の「個人情報が Slack に載らない」が固定する）。
 * 個人情報しか載せる中身が無かった 'salon' / 'facility' 種別は呼び出し元が 0 件だったため削除した。
 */
export type NotifyPayload =
  | {
      type: 'contact_reply_sent';
      data: { contact_id: string };
    }
  | {
      /** 問い合わせに紐づかない運営メール（/admin/mail の新規作成）の送信受付。platform_mail.id だけを渡す。 */
      type: 'platform_mail_sent';
      data: { mail_id: string; scheduled: boolean };
    }
  | {
      type: 'contact';
      data: {
        /** contacts.id（運営宛のお問い合わせの受付番号） */
        contact_id: string;
        /** お名前（2026年11月27日 本人決定で載せる。メール・電話は載せない） */
        name?: string;
        /** お問い合わせの種類 */
        inquiry_type?: string;
        /** 本文。冒頭 CONTACT_PREVIEW_MAX 文字だけを、メール・電話を伏せて載せる */
        message?: string;
      };
    }
  | {
      type: 'facility_inquiry';
      data: {
        /** facility_inquiries.id（店舗宛の問い合わせの受付番号） */
        inquiry_id: string;
        /** 問い合わせ先の店舗。管理画面のリンクに付ける（複数店舗のオーナーが別の店舗を開かないため）。 */
        facility_id?: string;
        facility_name: string;
      };
    };

// Phase 7b: 通知種別に応じた管理画面 URL を返す（リンクボタン用）
function adminUrlFor(payload: NotifyPayload): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://carelink-jp.com';

  switch (payload.type) {
    case 'contact':
      return `${base}/admin/inquiries`;

    case 'contact_reply_sent':
      return `${base}/admin/mail?contactId=${payload.data.contact_id}`;

    case 'platform_mail_sent':
      return `${base}/admin/mail`;

    case 'facility_inquiry':
      // 【2026年7月10日 恒久根治】/admin/inquiries は contacts テーブル（運営宛の全社横断
      // 問い合わせ・platformAdmin専用）を表示するページで、facility_inquiries とは別物。
      // 従来この「管理画面で開く」ボタンは常に facility_inquiries を一切表示しない誤った
      // リンク先を指しており、クリックしても該当の問い合わせに到達できなかった。
      // 店舗を URL で指定する（2026年10月22日）。指定しないと複数店舗のメンバーは
      // 店舗選択から始まり、どの店舗宛の問い合わせかを自分で探すことになる。
      return `${base}${adminFacilityHref('/admin/facility-inquiries', payload.data.facility_id ?? null)}`;
  }
}

function buildSlackBlocks(payload: NotifyPayload, text: string): unknown[] {
  const adminUrl = adminUrlFor(payload);

  return [
    sectionBlock(text),
    contextBlock([`type: \`${payload.type}\``, `${new Date().toISOString()}`]),
    actionsBlock([linkButtonElement('管理画面で開く', adminUrl)]),
  ];
}

function buildSlackMessage(payload: NotifyPayload): string {
  switch (payload.type) {
    case 'contact_reply_sent':
      return [
        ':outbox_tray: *お問い合わせへの返信を送信サービスが受理しました*',
        `> *受付番号:* ${payload.data.contact_id}`,
        '> 内容と送信状況は管理画面で確認してください。',
      ].join('\n');
    case 'platform_mail_sent':
      return [
        payload.data.scheduled
          ? ':outbox_tray: *運営メール（問い合わせ以外）の送信予約を送信サービスが受理しました*'
          : ':outbox_tray: *運営メール（問い合わせ以外）を送信サービスが受理しました*',
        `> *受付番号:* ${payload.data.mail_id.slice(0, 8)}`,
        '> 内容と送信状況は管理画面で確認してください。',
      ].join('\n');
    case 'contact': {
      const { name, inquiry_type, message } = payload.data;
      const lines = [':envelope: *お問い合わせ（運営宛）を受け付けました*'];
      if (name) lines.push(`> *お名前:* ${escSlack(sanitizeContactField(name))}`);
      if (inquiry_type) lines.push(`> *種類:* ${escSlack(sanitizeContactField(inquiry_type))}`);
      if (message) lines.push(`> *内容（冒頭）:* ${escSlack(contactPreview(message))}`);
      lines.push(`> *受付番号:* ${payload.data.contact_id}`);
      lines.push('> 全文と連絡先は管理画面で確認してください。');
      return lines.join('\n');
    }

    case 'facility_inquiry':
      return [
        ':hospital: *施設へのお問い合わせを受け付けました*',
        `> *施設名:* ${escSlack(payload.data.facility_name)}`,
        `> *受付番号:* ${payload.data.inquiry_id}`,
        '> 内容は管理画面で確認してください。',
      ].join('\n');
  }
}

const recordId = z.string().regex(UUID_REGEX);

/** 受信通知に載せる本文の最大文字数（2026年11月27日 本人決定「名前・種類・本文冒頭」） */
export const CONTACT_PREVIEW_MAX = 100;

/**
 * 受信通知の欄からメール・電話を伏せ、Slack の装飾記号を無効にする。
 * 全角数字・全角記号は NFKC で半角へ寄せてから判定し、括弧・空白・ハイフン・点で区切った
 * 数字が合計10桁以上続くもの（区切りは電話番号欄の normalizePhone と同じダッシュ類も含む）を電話番号とみなす（郵便番号の7桁は残る）。
 */
export function sanitizeContactField(value: string): string {
  return value
    .normalize('NFKC')
    // ゼロ幅スペースなど見えない書式文字で照合を途切れさせないよう、先に取り除く
    .replace(/[\p{Cf}\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu, '')
    // 前半は英数字記号に限る（空白の無い日本語の文を巻き込まないため）。ドメインは国際化ドメインも含め、
    // 直前のラベルが非英字のときに限り区切りに「。」も認める（ブラウザ・Node は「。」をドメイン区切りとして
    // 扱う。英字のドメインの後ろの「。」は文の句点なので、後続の文を巻き込まない）
    .replace(/[A-Z0-9._%+-]+@[\p{L}\p{M}\p{N}-]+(?:(?:\.|(?<=[^\x00-\x7F])。)[\p{L}\p{M}\p{N}-]+)+/giu, '[email redacted]')
    .replace(/\+?\(?\d[\d\s().\-‐-‒–—―ーｰ−]{7,}\d/g, (m) => (m.replace(/\D/g, '').length >= 10 ? '[phone redacted]' : m))
    .replace(/[*_~`]/g, (c) => ({ '*': '＊', _: '＿', '~': '～', '`': '｀' })[c] as string);
}

/** 本文の冒頭だけを、改行を詰め、メール・電話を伏せて返す */
export function contactPreview(message: string): string {
  const flat = sanitizeContactField(message).replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > CONTACT_PREVIEW_MAX ? `${chars.slice(0, CONTACT_PREVIEW_MAX).join('')}…` : flat;
}

export const notifyPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('contact_reply_sent'), data: z.object({ contact_id: recordId }) }),
  z.object({ type: z.literal('platform_mail_sent'), data: z.object({ mail_id: recordId, scheduled: z.boolean() }) }),
  z.object({
    type: z.literal('contact'),
    data: z.object({
      contact_id: recordId,
      // 内容の欄は不正でも通知全体を落とさない（値だけ捨てる）
      name: z.string().max(100).optional().catch(undefined),
      inquiry_type: z.string().max(100).optional().catch(undefined),
      message: z.string().optional().catch(undefined),
    }),
  }),

  z.object({
    type: z.literal('facility_inquiry'),
    data: z.object({
      inquiry_id: recordId,
      // リンクに店舗を付けるためだけの欄なので、不正な値でも通知全体を落とさない（値だけ捨てて
      // 店舗指定なしのリンクにする）。判定は adminFacilityHref と同じ UUID_REGEX。z.string().uuid() は
      // zod 4 で RFC のバージョン桁まで見るため、Postgres が受け付ける id でも弾き、問い合わせの
      // Slack 通知そのものを invalid_payload で失っていた。
      facility_id: z.string().regex(UUID_REGEX).optional().catch(undefined),
      facility_name: z.string().max(200),
    }),
  }),
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
  input: NotifyPayload
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  if (
    !process.env.SLACK_BOT_TOKEN ||
    !process.env.SLACK_DEFAULT_CHANNEL
  ) {
    return {
      ok: false,
      error: 'not_configured',
    };
  }

  // 型に無い欄（個人情報を含む）は zod が落とす。Slack へ渡すのは検証後の値だけ。
  const result = notifyPayloadSchema.safeParse(input);

  if (!result.success) {
    return {
      ok: false,
      error: 'invalid_payload',
    };
  }

  const payload: NotifyPayload = result.data;
  const text = buildSlackMessage(payload);
  const blocks = buildSlackBlocks(payload, text);

  const slackResult = await postToSlack({
    text,
    blocks,
  });

  if (!slackResult.ok) {
    console.error('[notify] Slack post failed', {
      error: slackResult.error,
    });

    return {
      ok: false,
      error: slackResult.error,
    };
  }

  return {
    ok: true,
    ts: slackResult.ts,
  };
}

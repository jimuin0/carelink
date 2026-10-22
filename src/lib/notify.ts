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
 * 🔴 Slack には【個人情報を一切載せない】。載せてよいのは「何の受付か」「施設名」「受付番号（レコードの id）」
 * 「管理画面へのリンク」だけ。お名前・メール・電話・本文は管理画面（ログイン必須）で見る。
 *
 * 【なぜ】以前は施設への問い合わせ（facility_inquiry）と運営へのお問い合わせ（contact）の
 * 氏名・メール・電話・本文（症状が書かれやすい）を全文そのまま Slack へ転記していたが、
 * Slack はプライバシーポリシー第5条の委託先に載っていない。転記された写しは退会時の削除や
 * 開示等の請求の対象からも外れる。施設掲載申込（src/lib/salon-outbox-delivery.ts）は既に
 * 「受付番号と管理画面 URL だけ」に作り直してあり、同じ方針にそろえた。
 *
 * 型から個人情報の欄を消してあるので、呼び出し側が氏名やメールを渡そうとすると tsc が止める。
 * 実行時も zod が未知の欄を落とすので、型をすり抜けた値も Slack へは届かない
 * （src/lib/__tests__/notify.test.ts の「個人情報が Slack に載らない」が固定する）。
 * 個人情報しか載せる中身が無かった 'salon' / 'facility' 種別は呼び出し元が 0 件だったため削除した。
 */
export type NotifyPayload =
  | {
      type: 'contact';
      data: {
        /** contacts.id（運営宛のお問い合わせの受付番号） */
        contact_id: string;
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
    case 'contact':
      return [
        ':envelope: *お問い合わせ（運営宛）を受け付けました*',
        `> *受付番号:* ${payload.data.contact_id}`,
        '> 内容は管理画面で確認してください。',
      ].join('\n');

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

export const notifyPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('contact'),
    data: z.object({ contact_id: recordId }),
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

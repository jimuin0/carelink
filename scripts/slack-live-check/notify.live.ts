/** @jest-environment node */
/**
 * ⚠️ 一時ファイル（2026-11-04）。掲載申込まわりの Slack 通知が、本番と同じコード経路で
 * テスト用チャンネルへ実際に届くかを確かめるための手動試験。PR にする前に削除する。
 *
 * - DB だけ架空の申込 1 件に差し替え、送信は実 Slack（postToSlack）を通す。
 * - 送り先は CARELINK_SLACK_TEST_CHANNEL に固定し、本番の通知先へは送らない。
 * - トークンは GitHub Actions の Secret から渡す（手元には置かない）。
 */
import type { createServiceRoleClient } from '../../src/lib/supabase-server';
import { prepareSalonOutboxDelivery } from '../../src/lib/salon-outbox-delivery';

const id = '71000000-0000-4000-8000-0000000000aa';
const row = { source: 'register', facility_name: '（試験）サンプル整体院' };
const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) } as unknown as ReturnType<typeof createServiceRoleClient>;
const base = { registration_id: id, target_id: id, template_version: 1, payload: {}, webhook_type: 'salon_registration_internal' };

test.each(['internal', 'approval_sent'])('テスト用チャンネルへの実送信 %s', async kind => {
  const token = process.env.CARELINK_SLACK_TEST_BOT_CREDENTIAL;
  const channel = process.env.CARELINK_SLACK_TEST_CHANNEL;
  expect(token && channel).toBeTruthy();
  process.env.SLACK_BOT_TOKEN = token;
  process.env.SLACK_DEFAULT_CHANNEL = channel;
  delete process.env.VERCEL_ENV;
  const outcome = await (await prepareSalonOutboxDelivery(db, { ...base, notification_kind: kind }, null))();
  console.log(`${kind} => ${outcome}`);
  expect(outcome).toBe('delivered');
}, 20000);

/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import type { Resend } from 'resend';
import type { createServiceRoleClient } from '../supabase-server';
import { prepareSalonOutboxDelivery } from '../salon-outbox-delivery';
import { postToSlack } from '../slack';
import { SALON_ONBOARDING_PATH, salonRecoveryAuthPath } from '../salon-browser-context';
import { SITE_URL } from '../constants';

jest.mock('../slack', () => ({ postToSlack: jest.fn() }));
const id = '71000000-0000-4000-8000-000000000001';
const job = { registration_id: id, target_id: id, template_version: 1, payload: {},
  webhook_type: 'salon_registration_email', notification_kind: 'receipt' };
const internal = { ...job, webhook_type: 'salon_registration_internal', notification_kind: 'internal' };
const row = { source: 'register', email: 'fixture@example.invalid', facility_name: '<script>synthetic</script>' };
const send = jest.fn();
const resend = { emails: { send } } as unknown as Resend;
const query = jest.fn();
const eq = jest.fn(() => ({ maybeSingle: query }));
const select = jest.fn(() => ({ eq }));
const insert = jest.fn();
const deferralQuery = jest.fn();
const deferralEq = jest.fn(() => ({ maybeSingle: deferralQuery }));
const from = jest.fn((table: string) => table === 'listing_verification_deferrals'
  ? { select: jest.fn(() => ({ eq: deferralEq })) } : { select, insert });
const db = { from } as unknown as ReturnType<typeof createServiceRoleClient>;
const originalToken = process.env.SLACK_BOT_TOKEN;
const originalChannel = process.env.SLACK_DEFAULT_CHANNEL;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SLACK_BOT_TOKEN = 'synthetic-only';
  process.env.SLACK_DEFAULT_CHANNEL = 'synthetic-only';
  query.mockResolvedValue({ data: row, error: null });
  send.mockResolvedValue({ data: { id: 'synthetic-message' }, error: null });
  (postToSlack as jest.Mock).mockResolvedValue({ ok: true, ts: 'synthetic-ts' });
  insert.mockResolvedValue({ data: null, error: null });
  deferralQuery.mockResolvedValue({ data: null, error: null });
});
afterAll(() => {
  if (originalToken === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = originalToken;
  if (originalChannel === undefined) delete process.env.SLACK_DEFAULT_CHANNEL;
  else process.env.SLACK_DEFAULT_CHANNEL = originalChannel;
});

test.each([null, {}, { ...job, registration_id: 'invalid' }, { ...job, target_id: 'different' },
  { ...job, template_version: 2 }, { ...job, payload: { email: 'untrusted@example.invalid' } },
  { ...job, notification_kind: 'internal' }, { ...internal, notification_kind: 'receipt' },
  { ...job, notification_kind: 'approval_sent' }, { ...internal, notification_kind: 'approval' },
  { ...job, notification_kind: 'other' },
])('invalid references are rejected before any read or send %#', async value => {
  await expect(prepareSalonOutboxDelivery(db, value, resend)).rejects.toThrow('Invalid registration outbox reference');
  expect(from).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(postToSlack).not.toHaveBeenCalled();
});

test.each(['SLACK_BOT_TOKEN', 'SLACK_DEFAULT_CHANNEL'])('missing %s prevents internal send preparation', async key => {
  delete process.env[key];
  await expect(prepareSalonOutboxDelivery(db, internal, resend)).rejects.toThrow('not configured');
  expect(from).not.toHaveBeenCalled();
});
test('missing email configuration prevents read and send', async () => {
  await expect(prepareSalonOutboxDelivery(db, job, null)).rejects.toThrow('not configured');
  expect(from).not.toHaveBeenCalled();
});
test.each([
  { data: null, error: null }, { data: { source: 'other' }, error: null },
  { data: row, error: { message: 'synthetic private provider details' } },
])('internal lookup failures use fixed errors %#', async result => {
  query.mockResolvedValue(result);
  await expect(prepareSalonOutboxDelivery(db, internal, resend)).rejects.toThrow('Registration internal reference unavailable');
  expect(postToSlack).not.toHaveBeenCalled();
});
test.each([
  { data: null, error: null }, { data: { ...row, source: 'recruit' }, error: null },
  { data: { ...row, email: 'invalid' }, error: null },
  { data: row, error: { message: 'synthetic private provider details' } },
])('email lookup failures use fixed errors %#', async result => {
  query.mockResolvedValue(result);
  await expect(prepareSalonOutboxDelivery(db, job, resend)).rejects.toThrow('Registration email reference unavailable');
  expect(send).not.toHaveBeenCalled();
});
test.each([
  [{ ok: true, ts: 'synthetic-ts' }, 'delivered'], [{ ok: false, error: 'http_500' }, 'uncertain'],
  [{ ok: true }, 'uncertain'], [{ ok: true, ts: 123 }, 'uncertain'], [{ ok: true, ts: '' }, 'uncertain'],
])('internal provider result is classified conservatively %#', async (result, outcome) => {
  query.mockResolvedValue({ data: { source: 'recruit', facility_name: row.facility_name }, error: null });
  const deliver = await prepareSalonOutboxDelivery(db, internal, resend);
  expect(postToSlack).not.toHaveBeenCalled();
  expect(select).toHaveBeenCalledWith('source,facility_name');
  expect(eq).toHaveBeenCalledWith('id', id);
  (postToSlack as jest.Mock).mockResolvedValue(result);
  await expect(deliver()).resolves.toBe(outcome);
  expect(postToSlack).toHaveBeenCalledTimes(1);
  const payload = JSON.stringify((postToSlack as jest.Mock).mock.calls[0]);
  expect(payload).not.toContain(id);
  expect(payload).toContain('/admin/registrations');
  expect(payload).not.toContain(row.email);
  expect(payload).toContain('&lt;script&gt;synthetic&lt;/script&gt;');
  expect(postToSlack).toHaveBeenCalledWith(expect.objectContaining({ unfurl_links: false, unfurl_media: false }));
});
test.each([
  [{ data: { id: 'synthetic-message' }, error: null }, 'delivered'],
  [{ data: null, error: { statusCode: 422 } }, 'rejected'],
  [{ data: null, error: { statusCode: 503 } }, 'uncertain'],
])('email sends exactly once, classified by existing reconciliation contract %#', async (result, outcome) => {
  const deliver = await prepareSalonOutboxDelivery(db, job, resend);
  expect(send).not.toHaveBeenCalled();
  send.mockResolvedValue(result);
  await expect(deliver()).resolves.toBe(outcome);
  expect(send).toHaveBeenCalledTimes(1);
  const [email, options] = send.mock.calls[0];
  expect(email.to).toBe(row.email);
  expect(email.text).toContain(id);
  expect(email.text).toContain('一般公開は');
  // スマホのメールアプリからは申込時のタブに戻れない。タブに依存しない復旧導線（申込を選び直せる登録画面）を案内し、
  // 「申込時のタブに戻って」という実行不能な指示と、タブ依存の引き継ぎ URL を載せない。
  expect(email.text).toContain(`${SITE_URL}${salonRecoveryAuthPath('signup')}\n`);
  expect(email.text).toContain(`${SITE_URL}${salonRecoveryAuthPath('login')}\n`);
  expect(email.text).not.toContain(`${SITE_URL}${SALON_ONBOARDING_PATH}`);
  expect(email.text).not.toContain('タブに戻');
  expect(email.text).toMatch(/このメールを受け取ったメールアドレス（[^）]+）で店舗アカウントを作成/);
  expect(email.html).toBeUndefined();
  expect(email.subject).not.toContain(row.facility_name);
  // 用語は受付画面と同じ（registration-glossary.ts）：掲載申込・店舗名・店舗アカウント。
  expect(email.subject).toBe('【CareLink】掲載申込を受け付けました');
  expect(email.text).toContain(`店舗名：${row.facility_name}\n`);
  for (const old of ['施設名', '掲載申し込み']) expect(email.text).not.toContain(old);
  expect(options.idempotencyKey).toBe(`salon-receipt-v1-${id}`);
});

// 2026-11-03 本人決定：承認したら申込者へお知らせメールを送り、送信できたら運営の Slack へ知らせる。
const approval = { ...job, notification_kind: 'approval' };
const approvalSent = { ...internal, notification_kind: 'approval_sent' };
test('approval email tells the applicant it is not published yet and how to continue', async () => {
  const deliver = await prepareSalonOutboxDelivery(db, approval, resend);
  expect(send).not.toHaveBeenCalled();
  await expect(deliver()).resolves.toBe('delivered');
  expect(send).toHaveBeenCalledTimes(1);
  const [email, options] = send.mock.calls[0];
  expect(email.to).toBe(row.email);
  expect(email.subject).toBe('【CareLink】掲載申込を確認しました');
  expect(email.subject).not.toContain(row.facility_name);
  expect(email.html).toBeUndefined();
  expect(email.text).toContain(`店舗名：${row.facility_name}\n受付番号：${id}`);
  expect(email.text).toContain('まだ一般公開されていません');
  expect(email.text).toContain(`${SITE_URL}${salonRecoveryAuthPath('login')}`);
  expect(email.text).toContain(`${SITE_URL}${salonRecoveryAuthPath('signup')}`);
  expect(email.text).toContain('確認書類を提出');
  expect(email.text).not.toContain(`${SITE_URL}${SALON_ONBOARDING_PATH}`);
  expect(options.idempotencyKey).toBe(`salon-approval-v1-${id}`);
  // 送信できた後にだけ、Slack の「送信しました」ジョブを 1 件積む（ここでは Slack へ直接送らない）。
  expect(from).toHaveBeenCalledWith('webhook_retry_queue');
  expect(insert).toHaveBeenCalledWith({ webhook_type: 'salon_registration_internal', target_id: id, payload: {},
    registration_id: id, notification_kind: 'approval_sent', template_version: 1 });
  expect(postToSlack).not.toHaveBeenCalled();
});
test.each([
  [{ data: null, error: { statusCode: 422 } }, 'rejected'],
  [{ data: null, error: { statusCode: 503 } }, 'uncertain'],
])('unconfirmed approval email never reports to Slack %#', async (result, outcome) => {
  send.mockResolvedValue(result);
  const deliver = await prepareSalonOutboxDelivery(db, approval, resend);
  await expect(deliver()).resolves.toBe(outcome);
  expect(insert).not.toHaveBeenCalled();
  expect(postToSlack).not.toHaveBeenCalled();
});
test('an already queued Slack report is not duplicated', async () => {
  insert.mockResolvedValue({ data: null, error: { code: '23505' } });
  const deliver = await prepareSalonOutboxDelivery(db, approval, resend);
  await expect(deliver()).resolves.toBe('delivered');
  expect(postToSlack).not.toHaveBeenCalled();
});
test.each([
  [{ ok: true, ts: 'synthetic-ts' }], [Promise.reject(new Error('slack down'))],
])('if the Slack report cannot be queued, the sent email is still delivered and Slack is told directly %#', async slack => {
  insert.mockResolvedValue({ data: null, error: { code: 'PGRST000' } });
  if (slack instanceof Promise) { slack.catch(() => undefined); (postToSlack as jest.Mock).mockReturnValue(slack); }
  else (postToSlack as jest.Mock).mockResolvedValue(slack);
  const deliver = await prepareSalonOutboxDelivery(db, approval, resend);
  await expect(deliver()).resolves.toBe('delivered');
  expect(postToSlack).toHaveBeenCalledTimes(1);
  const [message] = (postToSlack as jest.Mock).mock.calls[0];
  expect(message.text).toContain('承認メールを申込者へ送信しました');
  expect(message.text).not.toContain(row.email);
  expect(message).toMatchObject({ unfurl_links: false, unfurl_media: false });
});
test('approval_sent posts the sent report with the escaped shop name', async () => {
  const deliver = await prepareSalonOutboxDelivery(db, approvalSent, resend);
  await expect(deliver()).resolves.toBe('delivered');
  const [message] = (postToSlack as jest.Mock).mock.calls[0];
  expect(message.text).toBe(`CareLink 掲載申込の承認メールを申込者へ送信しました\n店舗名：&lt;script&gt;synthetic&lt;/script&gt;\n確認先：${SITE_URL}/admin/registrations`);
  expect(message.text).not.toContain(row.email);
  expect(send).not.toHaveBeenCalled();
});

// 2026-11-03 本人決定：通常は「書類 → 運営の確認 → 揃っていれば自動で公開」、
// 「書類は後から」が付いた申込は「先に公開・書類は公開後に提出」と案内する。
test('approval email for a normal registration says documents come first and publication follows the review', async () => {
  const deliver = await prepareSalonOutboxDelivery(db, approval, resend);
  await deliver();
  const [email] = send.mock.calls[0];
  expect(deferralEq).toHaveBeenCalledWith('salon_id', id);
  expect(email.text).toContain('【2】確認書類を提出する');
  expect(email.text).toContain('運営が書類を確認すると、所在地・曜日ごとの営業時間（定休日を含む）などの設定が済んでいれば、そのまま公開されます');
  expect(email.text).not.toContain('公開後に提出');
});
test.each([{ deferred: true }])('approval email for a deferred registration lets the shop publish first %#', async data => {
  deferralQuery.mockResolvedValue({ data, error: null });
  const deliver = await prepareSalonOutboxDelivery(db, approval, resend);
  await deliver();
  const [email] = send.mock.calls[0];
  expect(email.text).toContain('【2】店舗情報を整えて公開する');
  expect(email.text).toContain('【3】確認書類を公開後に提出する');
  expect(email.text).not.toContain('運営が書類を確認すると');
});
test('a deferral explicitly turned off is treated as a normal registration', async () => {
  deferralQuery.mockResolvedValue({ data: { deferred: false }, error: null });
  const deliver = await prepareSalonOutboxDelivery(db, approval, resend);
  await deliver();
  expect(send.mock.calls[0][0].text).toContain('【2】確認書類を提出する');
});
test.each([
  { data: null, error: { message: 'private' } }, { data: { deferred: 'yes' }, error: null },
])('an unreadable deferral stops before sending, so the wrong steps are never mailed %#', async result => {
  deferralQuery.mockResolvedValue(result);
  await expect(prepareSalonOutboxDelivery(db, approval, resend)).rejects.toThrow('Registration document deferral unavailable');
  expect(send).not.toHaveBeenCalled();
});

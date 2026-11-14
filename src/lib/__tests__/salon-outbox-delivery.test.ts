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
// 承認メールは送る直前に、申込の状態（status・claimed_facility_id）を別に読む。
const stateQuery = jest.fn();
const select = jest.fn((columns: string) => ({ eq: columns === 'status,claimed_facility_id' ? jest.fn(() => ({ maybeSingle: stateQuery })) : eq }));
const insert = jest.fn();
const deferralQuery = jest.fn();
const deferralEq = jest.fn(() => ({ maybeSingle: deferralQuery }));
const facilityQuery = jest.fn();
const facilityEq = jest.fn(() => ({ maybeSingle: facilityQuery }));
// Slack 用ジョブを積めなかったとき、直接送る前に積めていたかを読み直す。
const queuedLookup = jest.fn();
const queuedChain: Record<string, jest.Mock> = {};
queuedChain.eq = jest.fn(() => queuedChain);
queuedChain.maybeSingle = queuedLookup;
const from = jest.fn((table: string) => table === 'listing_verification_deferrals'
  ? { select: jest.fn(() => ({ eq: deferralEq })) }
  : table === 'facility_profiles' ? { select: jest.fn(() => ({ eq: facilityEq })) }
    : table === 'webhook_retry_queue' ? { insert, select: jest.fn(() => queuedChain) } : { select, insert });
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
  stateQuery.mockResolvedValue({ data: { status: 'approved', claimed_facility_id: null }, error: null });
  facilityQuery.mockResolvedValue({ data: { status: 'draft' }, error: null });
  queuedLookup.mockResolvedValue({ data: null, error: null });
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
  expect(email.text).toContain('■ 一般公開までの4ステップ\n【1】申し込む（済）\n【2】アカウント作成　← 次はここ\n');
  // スマホのメールアプリからは申込時のタブに戻れない。タブに依存しない復旧導線（申込を選び直せる登録画面）を案内し、
  // 「申込時のタブに戻って」という実行不能な指示と、タブ依存の引き継ぎ URL を載せない。
  expect(email.text).toContain(`${SITE_URL}${salonRecoveryAuthPath('signup')}\n`);
  expect(email.text).toContain(`${SITE_URL}${salonRecoveryAuthPath('login')}\n`);
  expect(email.text).not.toContain(`${SITE_URL}${SALON_ONBOARDING_PATH}`);
  expect(email.text).not.toContain('タブに戻');
  expect(email.text).toMatch(/このメールアドレス（[^）]+）で店舗アカウントを作成/);
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
  expect(queuedChain.eq).toHaveBeenCalledWith('registration_id', id);
  expect(queuedChain.eq).toHaveBeenCalledWith('notification_kind', 'approval_sent');
  expect(queuedChain.eq).toHaveBeenCalledWith('template_version', 1);
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
  expect(email.text).toContain('【3】書類の提出\n');
  expect(email.text).toContain('運営が書類を確認し、所在地・曜日ごとの営業時間（定休日を含む）の設定が済んでいれば公開されます');
  expect(email.text).not.toContain('公開後で構いません');
});
test.each([{ deferred: true }])('approval email for a deferred registration lets the shop publish first %#', async data => {
  deferralQuery.mockResolvedValue({ data, error: null });
  const deliver = await prepareSalonOutboxDelivery(db, approval, resend);
  await deliver();
  const [email] = send.mock.calls[0];
  expect(email.text).toContain('【3】書類の提出（公開後で構いません）');
  expect(email.text).toContain('【4】公開\n所在地・曜日ごとの営業時間（定休日を含む）などを設定すると、管理画面から公開できます');
  expect(email.text).not.toContain('運営が書類を確認すると');
});
test('a deferral explicitly turned off is treated as a normal registration', async () => {
  deferralQuery.mockResolvedValue({ data: { deferred: false }, error: null });
  const deliver = await prepareSalonOutboxDelivery(db, approval, resend);
  await deliver();
  expect(send.mock.calls[0][0].text).toContain('【3】書類の提出\n');
});
test.each([
  { data: null, error: { message: 'private' } }, { data: { deferred: 'yes' }, error: null },
])('an unreadable deferral stops before sending, so the wrong steps are never mailed %#', async result => {
  deferralQuery.mockResolvedValue(result);
  await expect(prepareSalonOutboxDelivery(db, approval, resend)).rejects.toThrow('Registration document deferral unavailable');
  expect(send).not.toHaveBeenCalled();
});

// 独立レビュー（2026-11-03）：文面は送る時点の申込と店舗の状態で決める。
test.each(['pending', 'rejected', null])('approval revoked before sending (%s) stops the email', async status => {
  stateQuery.mockResolvedValue({ data: { status, claimed_facility_id: null }, error: null });
  await expect(prepareSalonOutboxDelivery(db, approval, resend)).rejects.toThrow('Registration is no longer approved');
  expect(send).not.toHaveBeenCalled();
});
test.each([
  { data: null, error: null }, { data: { status: 'approved', claimed_facility_id: 'invalid' }, error: null },
  { data: { status: 'approved', claimed_facility_id: null }, error: { message: 'private' } },
])('an unreadable approval state stops before sending %#', async result => {
  stateQuery.mockResolvedValue(result);
  await expect(prepareSalonOutboxDelivery(db, approval, resend)).rejects.toThrow('Registration approval state unavailable');
  expect(send).not.toHaveBeenCalled();
});
const facilityId = '71000000-0000-4000-8000-0000000000f1';
test.each([
  [true, true], [false, false],
])('a shop that is already published is told so, not to create a shop (deferred=%s)', async (deferred, asksForDocuments) => {
  stateQuery.mockResolvedValue({ data: { status: 'approved', claimed_facility_id: facilityId }, error: null });
  facilityQuery.mockResolvedValue({ data: { status: 'published' }, error: null });
  deferralQuery.mockResolvedValue({ data: { deferred }, error: null });
  const deliver = await prepareSalonOutboxDelivery(db, approval, resend);
  await deliver();
  const text = send.mock.calls[0][0].text as string;
  expect(facilityEq).toHaveBeenCalledWith('id', facilityId);
  expect(text).toContain('店舗はすでに CareLink に公開されています');
  expect(text).not.toContain('まだ一般公開されていません');
  expect(text).not.toContain('店舗を作成する');
  expect(text.includes('確認書類がまだの場合は')).toBe(asksForDocuments);
});
test('a created but unpublished shop still gets the steps', async () => {
  stateQuery.mockResolvedValue({ data: { status: 'approved', claimed_facility_id: facilityId }, error: null });
  const deliver = await prepareSalonOutboxDelivery(db, approval, resend);
  await deliver();
  expect(send.mock.calls[0][0].text).toContain('まだ一般公開されていません');
});
test.each([
  { data: null, error: { message: 'private' } }, { data: { status: 7 }, error: null },
])('an unreadable shop state stops before sending %#', async result => {
  stateQuery.mockResolvedValue({ data: { status: 'approved', claimed_facility_id: facilityId }, error: null });
  facilityQuery.mockResolvedValue(result);
  await expect(prepareSalonOutboxDelivery(db, approval, resend)).rejects.toThrow('Registration facility state unavailable');
  expect(send).not.toHaveBeenCalled();
});
test('when queuing the Slack report fails but it was actually queued, Slack is not told twice', async () => {
  insert.mockResolvedValue({ data: null, error: { code: 'PGRST000' } });
  queuedLookup.mockResolvedValue({ data: { id: 'queued' }, error: null });
  const deliver = await prepareSalonOutboxDelivery(db, approval, resend);
  await expect(deliver()).resolves.toBe('delivered');
  expect(postToSlack).not.toHaveBeenCalled();
});
// 積めたか確かめられないときは直接送る（重複の 1 通より、「送信しました」が届かない方が困る）。
test.each([
  [{ data: null, error: { message: 'x' } }], [Promise.reject(new Error('down'))],
])('when it cannot be confirmed whether the Slack report was queued, Slack is told directly %#', async lookup => {
  insert.mockResolvedValue({ data: null, error: { code: 'PGRST000' } });
  if (lookup instanceof Promise) { lookup.catch(() => undefined); queuedLookup.mockReturnValue(lookup); }
  else queuedLookup.mockResolvedValue(lookup);
  const deliver = await prepareSalonOutboxDelivery(db, approval, resend);
  await expect(deliver()).resolves.toBe('delivered');
  expect(postToSlack).toHaveBeenCalledTimes(1);
});

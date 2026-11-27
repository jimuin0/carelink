/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
jest.mock('../slack', () => ({ ...jest.requireActual('../slack'), postToSlack: jest.fn() }));
jest.mock('../audit-logger', () => ({ writeAuditLog: jest.fn() }));
import { postToSlack } from '../slack';
import { writeAuditLog } from '../audit-logger';
import { buildInquiryResolveBlocks, postInquiryResolveButtons, resolveInquiryFromSlack, INQUIRY_RESOLVE_ACTION_ID, MAX_BUTTON_ITEMS } from '../inquiry-slack-actions';

const ID = '00000000-0000-4000-8000-000000000001';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const RESPONSE_URL = 'https://hooks.slack.com/actions/T/1/abc';
const URL_ADMIN = 'https://carelink-jp.com/admin/inquiries';

type Result = { data: unknown; error: unknown };
function fakeDb(lookup: Result, rpc: Result = { data: { resolved_at: '2026-11-27T00:00:00Z' }, error: null }) {
  const calls: { eq: unknown[][]; rpc: unknown[] } = { eq: [], rpc: [] };
  const builder = {
    select: () => builder,
    eq: (...args: unknown[]) => { calls.eq.push(args); return builder; },
    limit: () => Promise.resolve(lookup),
  };
  const db = {
    from: jest.fn(() => builder),
    rpc: jest.fn((...args: unknown[]) => { calls.rpc = args; return Promise.resolve(rpc); }),
  };
  return { db: db as never, calls, raw: db };
}

const fetchMock = jest.fn();
function slackUser(user: unknown, ok = true) {
  fetchMock.mockImplementation((url: string) => Promise.resolve({ json: () => Promise.resolve(url.includes('users.info') ? { ok, user } : { ok: true }) }));
}
const respondedText = () => {
  const call = fetchMock.mock.calls.find(([url]) => url === RESPONSE_URL);
  return call ? JSON.parse(call[1].body).text as string : null;
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as never;
  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
});

describe('buildInquiryResolveBlocks', () => {
  test('1件ごとに本文とボタン（値＝問い合わせ id）を並べ、最後に管理画面へのリンクを置く', () => {
    const blocks = buildInquiryResolveBlocks([{ id: ID, label: '山田様・9/19受付' }], URL_ADMIN);
    expect(blocks).toHaveLength(4);
    expect(JSON.stringify(blocks[1])).toContain('山田様・9/19受付');
    expect(blocks[2]).toEqual({ type: 'actions', elements: [expect.objectContaining({ action_id: INQUIRY_RESOLVE_ACTION_ID, value: ID, style: 'primary' })] });
    expect(JSON.stringify(blocks[3])).toContain(URL_ADMIN);
    expect(JSON.stringify(blocks[0])).not.toContain('1/1');
  });

  test('1通は上限件数まで（Slack の 50 ブロック上限内）で、複数通のときは見出しに通し番号を付ける', () => {
    const lines = Array.from({ length: MAX_BUTTON_ITEMS + 3 }, (_, i) => ({ id: ID, label: `件${i}` }));
    const blocks = buildInquiryResolveBlocks(lines, URL_ADMIN, { index: 2, total: 3 });
    expect(blocks.length).toBeLessThanOrEqual(50);
    expect(blocks).toHaveLength(MAX_BUTTON_ITEMS * 2 + 2);
    expect(JSON.stringify(blocks[0])).toContain('2/3');
  });
});

describe('postInquiryResolveButtons', () => {
  test('0件なら送らない', async () => {
    await expect(postInquiryResolveButtons([], URL_ADMIN)).resolves.toBe(false);
    expect(postToSlack).not.toHaveBeenCalled();
  });
  test('送信結果を返し、失敗・例外でも throw しない', async () => {
    (postToSlack as jest.Mock).mockResolvedValueOnce({ ok: true });
    await expect(postInquiryResolveButtons([{ id: ID, label: 'a' }], URL_ADMIN)).resolves.toBe(true);
    expect((postToSlack as jest.Mock).mock.calls[0][0].blocks).toHaveLength(4);
    (postToSlack as jest.Mock).mockResolvedValueOnce({ ok: false, error: 'x' });
    await expect(postInquiryResolveButtons([{ id: ID, label: 'a' }], URL_ADMIN)).resolves.toBe(false);
    (postToSlack as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    await expect(postInquiryResolveButtons([{ id: ID, label: 'a' }], URL_ADMIN)).resolves.toBe(false);
  });

  test('上限を超えたら分けて送り、全件にボタンが付く（Codex 指摘 PR996-03）', async () => {
    (postToSlack as jest.Mock).mockResolvedValue({ ok: true });
    const lines = Array.from({ length: MAX_BUTTON_ITEMS * 2 + 1 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, label: `件${i}` }));
    await expect(postInquiryResolveButtons(lines, URL_ADMIN)).resolves.toBe(true);
    expect(postToSlack).toHaveBeenCalledTimes(3);
    const values = (postToSlack as jest.Mock).mock.calls.flatMap(([opts]) => (opts.blocks as { elements?: { value?: string; action_id?: string }[] }[]).flatMap((b) => b.elements ?? []).filter((e) => e.action_id === INQUIRY_RESOLVE_ACTION_ID).map((e) => e.value));
    expect(values).toEqual(lines.map((l) => l.id));
    (postToSlack as jest.Mock).mockReset();
  });
});

describe('resolveInquiryFromSlack', () => {
  const payload = { user: { id: 'U1' }, response_url: RESPONSE_URL };

  test('Slack のメールが運営管理者1人に一致すれば、管理画面と同じ RPC で解決済みにし、監査ログを残す', async () => {
    slackUser({ profile: { email: ' Admin@Example.invalid ' } });
    const { db, calls } = fakeDb({ data: [{ id: ACTOR }], error: null });
    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe('resolved');
    expect(calls.eq).toEqual([['email_canonical', 'admin@example.invalid'], ['is_platform_admin', true]]);
    expect(calls.rpc).toEqual(['manage_platform_control_atomic', { p_actor_id: ACTOR, p_record_id: ID, p_kind: 'ticket:update', p_values: { ticket_status: 'resolved' } }]);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ userId: ACTOR, tableName: 'contacts', recordId: ID, newValues: expect.objectContaining({ ticket_status: 'resolved', via: 'slack', resolved_at: '2026-11-27T00:00:00Z' }) }));
    expect(respondedText()).toContain('解決済みにしました');
    const usersInfo = fetchMock.mock.calls.find(([url]) => String(url).includes('users.info'));
    expect(usersInfo[1].headers.Authorization).toBe('Bearer xoxb-test');
  });

  test('Gmail のドット・+タグは DB の email_canonical と同じ規則で揃えて照合する（Codex 指摘 PR996-02）', async () => {
    slackUser({ profile: { email: 'Admin.Example+tag@gmail.com' } });
    const { db, calls } = fakeDb({ data: [{ id: ACTOR }], error: null });
    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe('resolved');
    expect(calls.eq[0]).toEqual(['email_canonical', 'adminexample@gmail.com']);
  });

  test('RPC が resolved_at を返さなくても解決扱いにする', async () => {
    slackUser({ profile: { email: 'a@example.invalid' } });
    const { db } = fakeDb({ data: [{ id: ACTOR }], error: null }, { data: null, error: null });
    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe('resolved');
    expect((writeAuditLog as jest.Mock).mock.calls[0][0].newValues.resolved_at).toBeNull();
  });

  test.each([
    ['id が無い', payload, undefined],
    ['id が UUID でない', payload, 'not-a-uuid'],
    ['押した人が分からない', { response_url: RESPONSE_URL }, ID],
  ])('%s → invalid（DB を触らない）', async (_l, p, id) => {
    const { db, raw } = fakeDb({ data: [], error: null });
    await expect(resolveInquiryFromSlack(db, p, id)).resolves.toBe('invalid');
    expect(raw.from).not.toHaveBeenCalled();
    expect(raw.rpc).not.toHaveBeenCalled();
  });

  test.each([
    ['users.info が失敗', () => slackUser(undefined, false)],
    ['退会済み', () => slackUser({ deleted: true, profile: { email: 'a@example.invalid' } })],
    ['bot', () => slackUser({ is_bot: true, profile: { email: 'a@example.invalid' } })],
    ['メールが空', () => slackUser({ profile: { email: '  ' } })],
    ['メール欄が無い', () => slackUser({})],
    ['通信例外', () => fetchMock.mockImplementation((url: string) => url.includes('users.info') ? Promise.reject(new Error('x')) : Promise.resolve({}))],
  ])('%s → no_email（何も変えない）', async (_l, setup) => {
    setup();
    const { db, raw } = fakeDb({ data: [{ id: ACTOR }], error: null });
    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe('no_email');
    expect(raw.rpc).not.toHaveBeenCalled();
  });

  test('SLACK_BOT_TOKEN が無ければ no_email', async () => {
    delete process.env.SLACK_BOT_TOKEN;
    const { db, raw } = fakeDb({ data: [{ id: ACTOR }], error: null });
    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe('no_email');
    expect(raw.rpc).not.toHaveBeenCalled();
  });

  test.each([
    ['一致なし', { data: [], error: null }, 'not_admin'],
    ['null', { data: null, error: null }, 'not_admin'],
    ['複数一致', { data: [{ id: ACTOR }, { id: ID }], error: null }, 'not_admin'],
    ['検索失敗', { data: null, error: { message: 'x' } }, 'failed'],
  ])('管理者の検索が%s → %s（RPC を呼ばない）', async (_l, lookup, expected) => {
    slackUser({ profile: { email: 'a@example.invalid' } });
    const { db, raw } = fakeDb(lookup);
    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe(expected);
    expect(raw.rpc).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(respondedText()).toBeTruthy();
  });

  test.each([
    ['P0002', 'not_found'],
    ['42501', 'not_admin'],
    ['XX000', 'failed'],
    [undefined, 'failed'],
  ])('RPC が %s → %s（監査ログを残さない）', async (code, expected) => {
    slackUser({ profile: { email: 'a@example.invalid' } });
    const { db } = fakeDb({ data: [{ id: ACTOR }], error: null }, { data: null, error: { code } });
    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe(expected);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  test('response_url が Slack 以外・無しなら返事を送らない／送信失敗でも throw しない', async () => {
    slackUser({ profile: { email: 'a@example.invalid' } });
    const { db } = fakeDb({ data: [], error: null });
    await resolveInquiryFromSlack(db, { user: { id: 'U1' }, response_url: 'https://evil.example/x' }, ID);
    await resolveInquiryFromSlack(db, { user: { id: 'U1' } }, ID);
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes('users.info'))).toBe(true);
    fetchMock.mockImplementation((url: string) => url.includes('users.info') ? Promise.resolve({ json: () => Promise.resolve({ ok: true, user: { profile: { email: 'a@example.invalid' } } }) }) : Promise.reject(new Error('down')));
    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe('not_admin');
  });

  test('公開閲覧専用の Preview では Slack を引かず、返事も送らない', async () => {
    jest.resetModules();
    jest.doMock('../preview-capabilities', () => ({ isPublicReadOnlyPreview: () => true }));
    const slack = await import('../slack');
    slackUser({ profile: { email: 'a@example.invalid' } });
    await expect(slack.getSlackUserEmail('U1')).resolves.toBeNull();
    await slack.respondToSlackAction(RESPONSE_URL, 'x');
    expect(fetchMock).not.toHaveBeenCalled();
    jest.dontMock('../preview-capabilities');
  });
});

/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 施設 Q&A の新着質問を店舗（owner / admin）へメールで知らせる（2026年10月22日）。
 * 以前は質問が保存されるだけで店舗に何も届かず、来院者は「回答をお待ちください」のまま放置された。
 * 応答後に走る処理なので例外を投げず、失敗は無音にしない（Sentry ＋ Slack）。
 */
const mockSend = jest.fn();
jest.mock('../email', () => ({ sendNewQuestionNotification: (...args: unknown[]) => mockSend(...args) }));
const mockAlert = jest.fn();
const mockCapture = jest.fn();
jest.mock('../alert', () => ({ alertCaughtError: (...args: unknown[]) => mockAlert(...args) }));
jest.mock('../safe', () => ({ safeCaptureException: (...args: unknown[]) => mockCapture(...args) }));

type Result = { data: unknown; error: unknown };
let membersResult: Result;
let profilesResult: Result;
const mockIn = jest.fn();
const mockEq = jest.fn();
const mockFrom = jest.fn((table: string) => {
  if (table === 'facility_members') {
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => { mockEq(column, value); return chain; },
      in: (column: string, values: unknown) => { mockIn(table, column, values); return Promise.resolve(membersResult); },
    };
    return chain;
  }
  return {
    select: () => ({ in: (column: string, values: unknown) => { mockIn(table, column, values); return Promise.resolve(profilesResult); } }),
  };
});
let throwOnClient = false;
jest.mock('../supabase-server', () => ({
  createServiceRoleClient: () => {
    if (throwOnClient) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
    return { from: mockFrom };
  },
}));

import { notifyFacilityOfNewQuestion } from '../facility-question-notification';

const FACILITY = '75000000-0000-4000-8000-000000000001';
const OWNER = '75000000-0000-4000-8000-000000000002';
const ADMIN = '75000000-0000-4000-8000-000000000003';
const input = { facilityId: FACILITY, facilityName: '合成鍼灸院', question: '駐車場はありますか？' };

beforeEach(() => {
  jest.clearAllMocks();
  throwOnClient = false;
  membersResult = { data: [{ user_id: OWNER }, { user_id: ADMIN }, { user_id: OWNER }], error: null };
  profilesResult = { data: [{ email: 'owner@example.invalid' }, { email: 'admin@example.invalid' }, { email: null }, { email: 'owner@example.invalid' }], error: null };
  mockSend.mockResolvedValue(true);
});

test('その店舗の owner / admin 全員へ、重複なく、店舗を指定したリンクつきで送る', async () => {
  await notifyFacilityOfNewQuestion(input);
  expect(mockEq).toHaveBeenCalledWith('facility_id', FACILITY);
  expect(mockIn).toHaveBeenCalledWith('facility_members', 'role', ['owner', 'admin']);
  expect(mockIn).toHaveBeenCalledWith('profiles', 'id', [OWNER, ADMIN]);
  expect(mockSend).toHaveBeenCalledTimes(2);
  expect(mockSend).toHaveBeenCalledWith({ facilityEmail: 'owner@example.invalid', facilityName: '合成鍼灸院', question: '駐車場はありますか？', facilityId: FACILITY });
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ facilityEmail: 'admin@example.invalid' }));
  expect(mockAlert).not.toHaveBeenCalled();
});

test('送信の失敗（false）と例外は宛先ごとに通知し、他の宛先には送り続ける', async () => {
  mockSend.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('resend down'));
  await expect(notifyFacilityOfNewQuestion(input)).resolves.toBeUndefined();
  expect(mockSend).toHaveBeenCalledTimes(2);
  expect(mockAlert).toHaveBeenCalledWith('facility-qa-notify-email', new Error('question notification email send failed'), '/api/facility/qa');
  expect(mockAlert).toHaveBeenCalledWith('facility-qa-notify-email', new Error('resend down'), '/api/facility/qa');
  expect(mockCapture).toHaveBeenCalledTimes(2);
});

test.each([
  ['メンバーの取得失敗', () => { membersResult = { data: null, error: { code: '08006', message: 'x' } }; }, 'facility-qa-notify-members', new Error('DATABASE_FAILURE:08006')],
  ['メンバーが null', () => { membersResult = { data: null, error: null }; }, 'facility-qa-notify-members', new Error('facility_members returned no rows')],
  ['メールの取得失敗', () => { profilesResult = { data: null, error: { code: '57014', message: 'x' } }; }, 'facility-qa-notify-profiles', new Error('DATABASE_FAILURE:57014')],
  ['メールが null', () => { profilesResult = { data: null, error: null }; }, 'facility-qa-notify-profiles', new Error('profiles returned no rows')],
  ['owner / admin がいない', () => { membersResult = { data: [], error: null }; }, 'facility-qa-notify-no-recipient', new Error('FACILITY_QA_NO_RECIPIENT')],
  ['メールアドレスが 1 件も無い', () => { profilesResult = { data: [{ email: null }], error: null }; }, 'facility-qa-notify-no-recipient', new Error('FACILITY_QA_NO_RECIPIENT')],
])('%s は送らずに通知する（誰も回答できない質問を無音で残さない）', async (_label, arrange, tag, cause) => {
  arrange();
  await expect(notifyFacilityOfNewQuestion(input)).resolves.toBeUndefined();
  expect(mockSend).not.toHaveBeenCalled();
  expect(mockAlert).toHaveBeenCalledWith(tag, cause, '/api/facility/qa');
  expect(mockCapture).toHaveBeenCalledWith(cause, tag);
});

test('owner / admin がいなければメールの宛先を引きに行かない', async () => {
  membersResult = { data: [], error: null };
  await notifyFacilityOfNewQuestion(input);
  expect(mockIn).not.toHaveBeenCalledWith('profiles', expect.anything(), expect.anything());
});

test('想定外の例外も投げずに通知する（応答後の処理は失敗を報告できないため）', async () => {
  throwOnClient = true;
  await expect(notifyFacilityOfNewQuestion(input)).resolves.toBeUndefined();
  expect(mockAlert).toHaveBeenCalledWith('facility-qa-notify', new Error('SUPABASE_SERVICE_ROLE_KEY missing'), '/api/facility/qa');
});

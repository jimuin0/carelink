jest.mock('../alert', () => ({ alertWarning: jest.fn() }));
import { alertWarning } from '../alert';
import { alertSalonCommitRefusal, ALERTED_COMMIT_REFUSALS } from '../salon-commit-refusal-alert';

beforeEach(() => jest.clearAllMocks());

test.each([
  ['invalid', 400], ['consent_required', 400], ['unverified', 403], ['expired', 410], ['conflict', 409], ['photo_unverified', 409],
])('申込者側で断った %s は理由と HTTP 状態つきで知らせる', (state, status) => {
  alertSalonCommitRefusal(state);
  expect(alertWarning).toHaveBeenCalledWith(expect.stringContaining(`（${state}）`), expect.objectContaining({
    category: '完了未確認', route: '/api/salons/commit', status, extra: { state, fields: 'なし' },
  }));
});

test('欄名は並べ替えて名前だけを出し、値は出さない', () => {
  alertSalonCommitRefusal('invalid', { phone: '090-0000-0000 は不正', email: 'synthetic@example.invalid' });
  const extra = (alertWarning as jest.Mock).mock.calls[0][1].extra;
  expect(extra).toEqual({ state: 'invalid', fields: 'email,phone' });
  expect(JSON.stringify((alertWarning as jest.Mock).mock.calls)).not.toMatch(/example\.invalid|090-0000/);
});

test('欄の誤りが空なら「なし」', () => {
  alertSalonCommitRefusal('invalid', {});
  expect((alertWarning as jest.Mock).mock.calls[0][1].extra.fields).toBe('なし');
});

test.each(['committed', 'replay', 'unknown', 'unavailable'])('成功・結果不明・5xx（別経路で通知）の %s は知らせない', state => {
  alertSalonCommitRefusal(state);
  expect(alertWarning).not.toHaveBeenCalled();
});

test('知らせる状態の一覧は固定（増減したらこのテストで気づく）', () => {
  expect([...ALERTED_COMMIT_REFUSALS]).toEqual(['invalid', 'consent_required', 'unverified', 'expired', 'conflict', 'photo_unverified']);
});

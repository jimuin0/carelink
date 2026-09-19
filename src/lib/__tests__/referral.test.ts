/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * awardReferralPointsOnCompletion（被紹介者の初回予約完了時の紹介ボーナス付与）の全分岐テスト。
 */
import { awardReferralPointsOnCompletion } from '../referral';

const mockCapture = jest.fn();
jest.mock('../safe', () => ({ safeCaptureException: (...a: unknown[]) => mockCapture(...a) }));

type Result = { data?: unknown; error?: unknown };

function makeAdmin(claim: Result, pointResults: Result[] = []) {
  const maybeSingle = jest.fn(() => Promise.resolve(claim));
  const readEq2 = jest.fn(() => ({ maybeSingle }));
  const readEq1 = jest.fn(() => ({ eq: readEq2 }));
  const select = jest.fn(() => ({ eq: readEq1 }));
  const markEq2 = jest.fn(() => Promise.resolve({ error: null }));
  const markEq1 = jest.fn(() => ({ eq: markEq2 }));
  const update = jest.fn(() => ({ eq: markEq1 }));
  let insertCall = 0;
  const insert = jest.fn(() => Promise.resolve(pointResults[insertCall++] ?? { error: null }));
  const from = jest.fn((table: string) => {
    if (table === 'referral_uses') return { select, update };
    if (table === 'user_points') return { insert };
    throw new Error(`unexpected table ${table}`);
  });
  return { admin: { from } as unknown as Parameters<typeof awardReferralPointsOnCompletion>[0], update, insert };
}

beforeEach(() => jest.clearAllMocks());

test('未紹介(0行) → 付与しない（早期 return）', async () => {
  const { admin, insert } = makeAdmin({ data: null, error: null });
  await awardReferralPointsOnCompletion(admin, 'u1');
  expect(insert).not.toHaveBeenCalled();
  expect(mockCapture).not.toHaveBeenCalled();
});

test('claimed が null → 付与しない', async () => {
  const { admin, insert } = makeAdmin({ data: null, error: null });
  await awardReferralPointsOnCompletion(admin, 'u1');
  expect(insert).not.toHaveBeenCalled();
});

test('紹介情報の読み取りエラー → capture + throw', async () => {
  const { admin, insert } = makeAdmin({ data: null, error: { message: 'db error' } });
  await expect(awardReferralPointsOnCompletion(admin, 'u1')).rejects.toThrow('referral_uses read failed');
  expect(mockCapture).toHaveBeenCalledWith(expect.anything(), 'referral-award-claim');
  expect(insert).not.toHaveBeenCalled();
});

test('紹介あり → 紹介者500pt・被紹介者300ptを付与', async () => {
  const { admin, insert } = makeAdmin({ data: { referrer_user_id: 'ref-user' }, error: null });
  await awardReferralPointsOnCompletion(admin, 'u1');
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'ref-user', points: 500, reason: '紹介ボーナス' }));
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', points: 300, reason: '紹介コード利用ボーナス' }));
  expect(mockCapture).not.toHaveBeenCalled();
});

test('紹介者付与が失敗 → capture + throw', async () => {
  const { admin } = makeAdmin(
    { data: { referrer_user_id: 'ref-user' }, error: null },
    [{ error: { message: 'ref insert failed' } }, { error: null }],
  );
  await expect(awardReferralPointsOnCompletion(admin, 'u1')).rejects.toThrow('referral points insert failed');
  expect(mockCapture).toHaveBeenCalledWith(expect.anything(), 'referral-award-points');
});

test('紹介者付与は成功・被紹介者付与が失敗 → capture + throw', async () => {
  const { admin } = makeAdmin(
    { data: { referrer_user_id: 'ref-user' }, error: null },
    [{ error: null }, { error: { message: 'self insert failed' } }],
  );
  await expect(awardReferralPointsOnCompletion(admin, 'u1')).rejects.toThrow('referral points insert failed');
  expect(mockCapture).toHaveBeenCalledWith(expect.anything(), 'referral-award-points');
});

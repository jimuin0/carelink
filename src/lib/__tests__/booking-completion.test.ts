/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { applyCompletionSideEffects, type CompletableBooking } from '../booking-completion';
import { awardReferralPointsOnCompletion } from '../referral';
import { safeCaptureException } from '../safe';
import { alertCaughtError } from '../alert';
jest.mock('../safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('../alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('../referral', () => ({ awardReferralPointsOnCompletion: jest.fn().mockResolvedValue(undefined) }));
const base: CompletableBooking = { id: 'b1', facility_id: 'f1', user_id: 'u1',
 customer_name: 'Synthetic', email: null, booking_date: '2030-01-07', total_price: 5000, menu_id: null, staff_id: null };
const insert = jest.fn();
const from = jest.fn((table: string) => {
 if (table !== 'user_points') throw new Error('visit persistence must be DB atomic, not an application side effect');
 return { insert };
});
const admin = { from } as unknown as Parameters<typeof applyCompletionSideEffects>[0];
beforeEach(() => { jest.clearAllMocks(); insert.mockResolvedValue({ error: null }); });
test('来店ポイントと紹介処理を維持し、来店履歴は二重書込みしない', async () => {
 expect(await applyCompletionSideEffects(admin, base)).toBe(50);
 expect(insert).toHaveBeenCalledWith({ user_id: 'u1', points: 50, reason: '来店ポイント', booking_id: 'b1' });
 expect(awardReferralPointsOnCompletion).toHaveBeenCalledWith(admin, 'u1');
 expect(from).not.toHaveBeenCalledWith('customer_visits');
});
test.each([null,0,-100,50,99])('金額 %s は来店ポイントを付与しない', async total_price => {
 expect(await applyCompletionSideEffects(admin, { ...base, total_price })).toBe(0);
 expect(insert).not.toHaveBeenCalled();
 expect(awardReferralPointsOnCompletion).toHaveBeenCalledWith(admin,'u1');
});
test.each([[100,1],[5099,50]])('金額境界 %s は %s ポイント', async (total_price, expected) => {
 expect(await applyCompletionSideEffects(admin,{ ...base,total_price })).toBe(expected);
 expect(insert).toHaveBeenCalledWith(expect.objectContaining({ points: expected }));
});
test('未ログインの手動予約はポイント・紹介へ触らず履歴はDBに任せる', async () => {
 expect(await applyCompletionSideEffects(admin,{ ...base,user_id:null })).toBe(0);
 expect(from).not.toHaveBeenCalled();
 expect(awardReferralPointsOnCompletion).not.toHaveBeenCalled();
});
test('ポイント保存失敗を監視する既存動作を維持', async () => {
 const error={ message:'synthetic points failure' };
 insert.mockResolvedValue({ error });
 expect(await applyCompletionSideEffects(admin,base)).toBe(50);
 expect(safeCaptureException).toHaveBeenCalledWith(error,'booking-completion');
 expect(alertCaughtError).toHaveBeenCalledWith('booking-completion:points',error,'booking:b1');
});

import { reverseCompletionSideEffects } from '../booking-completion-reversal';

function mkAdmin(visitErr: unknown = null, pointErr: unknown = null) {
  return {
    from: jest.fn((t: string) => ({
      delete: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: t === 'customer_visits' ? visitErr : pointErr })),
      })),
    })),
  };
}

describe('reverseCompletionSideEffects', () => {
  test('customer_visits と user_points を booking_id で削除', async () => {
    const admin = mkAdmin();
    await reverseCompletionSideEffects(admin as any, 'bk-1');
    expect(admin.from).toHaveBeenCalledWith('customer_visits');
    expect(admin.from).toHaveBeenCalledWith('user_points');
  });

  test('customer_visits 削除エラー → 例外を返してポイント削除を続行しない', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const admin = mkAdmin({ message: 'visit fail' });
    await expect(reverseCompletionSideEffects(admin as any, 'bk-1')).rejects.toThrow('customer_visits delete failed');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  test('user_points 削除エラー → 例外を返す', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const admin = mkAdmin(null, { message: 'point fail' });
    await expect(reverseCompletionSideEffects(admin as any, 'bk-1')).rejects.toThrow('user_points delete failed');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

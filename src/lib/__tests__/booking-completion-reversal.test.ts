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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await reverseCompletionSideEffects(admin as any, 'bk-1');
    expect(admin.from).toHaveBeenCalledWith('customer_visits');
    expect(admin.from).toHaveBeenCalledWith('user_points');
  });

  test('customer_visits 削除エラー → console.error（致命にしない）', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const admin = mkAdmin({ message: 'visit fail' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await reverseCompletionSideEffects(admin as any, 'bk-1');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  test('user_points 削除エラー → console.error（致命にしない）', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const admin = mkAdmin(null, { message: 'point fail' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await reverseCompletionSideEffects(admin as any, 'bk-1');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

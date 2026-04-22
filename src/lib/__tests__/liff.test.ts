/**
 * Tests for lib/liff.ts
 * Covers: initLiff, getLiffId
 */

const mockInit = jest.fn().mockResolvedValue(undefined);
const mockLiff = { init: mockInit };

jest.mock('@line/liff', () => ({
  __esModule: true,
  default: mockLiff,
}));

// Reset module registry between tests so singleton state is cleared
let liffModule: typeof import('../liff');

beforeEach(async () => {
  jest.clearAllMocks();
  jest.resetModules();
  // Re-import after reset so singleton is cleared
  liffModule = await import('../liff');
});

describe('getLiffId', () => {
  test('returns env var value when set', () => {
    process.env.NEXT_PUBLIC_LIFF_ID = 'my-liff-123';
    expect(liffModule.getLiffId()).toBe('my-liff-123');
    delete process.env.NEXT_PUBLIC_LIFF_ID;
  });

  test('returns empty string when env var not set', () => {
    delete process.env.NEXT_PUBLIC_LIFF_ID;
    expect(liffModule.getLiffId()).toBe('');
  });
});

describe('initLiff', () => {
  test('getLiffId returns correct value regardless of initLiff', () => {
    process.env.NEXT_PUBLIC_LIFF_ID = 'test-id';
    expect(liffModule.getLiffId()).toBe('test-id');
    delete process.env.NEXT_PUBLIC_LIFF_ID;
  });

  test('初回呼び出し → liff.init を呼びインスタンスを返す', async () => {
    const result = await liffModule.initLiff('liff-id-123');
    expect(mockInit).toHaveBeenCalledWith({ liffId: 'liff-id-123' });
    expect(result).toBe(mockLiff);
  });

  test('2回目の呼び出し → キャッシュを返す（liff.init は呼ばない）', async () => {
    await liffModule.initLiff('liff-id-123');
    mockInit.mockClear();
    const result = await liffModule.initLiff('liff-id-456');
    expect(mockInit).not.toHaveBeenCalled();
    expect(result).toBe(mockLiff);
  });
});

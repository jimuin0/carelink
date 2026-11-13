/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */

const mockFrom = jest.fn(function (this: unknown) { return this; });
const mockCreateClient = jest.fn().mockImplementation(() => ({ from: mockFrom, storageKey: 'k' }));

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const origEnv = process.env;

beforeEach(() => {
  mockCreateClient.mockClear();
  mockFrom.mockClear();
  process.env = {
    ...origEnv,
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-test',
  };
});

afterAll(() => {
  process.env = origEnv;
});

describe('supabase client (lib/supabase.ts)', () => {
  it('creates the anon client on first use and reuses it', () => {
    jest.isolateModules(() => {
      const { supabase } = require('../supabase');
      expect(mockCreateClient).not.toHaveBeenCalled();
      supabase.from('symptoms');
      supabase.from('facility_reviews');
      expect(mockCreateClient).toHaveBeenCalledTimes(1);
      expect(mockCreateClient).toHaveBeenCalledWith('https://test.supabase.co', 'anon-key-test');
      // メソッドは本物のクライアントに束縛して呼ぶ
      expect(mockFrom.mock.contexts[0]).toBe(mockCreateClient.mock.results[0].value);
      // 関数以外のプロパティはそのまま返す
      expect(supabase.storageKey).toBe('k');
    });
  });

  // 中 A47：読み込みでは throw せず、使ったときにだけ失敗する（import した画面全体を壊さない）。
  it.each(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])('%s が無くても import は失敗せず、使用時に throw する', (key) => {
    delete process.env[key];
    jest.isolateModules(() => {
      let mod: { supabase: { from: (t: string) => unknown } } | undefined;
      expect(() => { mod = require('../supabase'); }).not.toThrow();
      expect(() => mod!.supabase.from('symptoms')).toThrow('NEXT_PUBLIC_SUPABASE_URL');
      expect(mockCreateClient).not.toHaveBeenCalled();
    });
  });
});

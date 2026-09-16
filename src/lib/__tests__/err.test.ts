import {
  errorMessage,
  isTransientSupabaseError,
  retryTransientSupabaseRead,
  summarizeDependencyError,
} from '../err';

describe('errorMessage', () => {
  test('Error インスタンスは .message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  test('message を持つ素オブジェクト（PostgrestError 風）は .message', () => {
    expect(errorMessage({ message: 'db down', code: '500' })).toBe('db down');
  });

  test('message が string でないオブジェクトは String() フォールバック', () => {
    expect(errorMessage({ message: 123 })).toBe('[object Object]');
  });

  test('message を持たないオブジェクトは String() フォールバック', () => {
    expect(errorMessage({ code: 'x' })).toBe('[object Object]');
  });

  test('文字列はそのまま String()', () => {
    expect(errorMessage('plain')).toBe('plain');
  });

  test('null は "null"', () => {
    expect(errorMessage(null)).toBe('null');
  });
});

describe('Supabase 到達障害の正規化と読取再試行', () => {
  const cloudflare522 = '<!DOCTYPE html><title>supabase.co | 522: Connection timed out</title><p>Cloudflare diagnostic</p>';

  test('522 のHTML本文を依存障害として認識し、診断本文を通知用文面から除外する', () => {
    expect(isTransientSupabaseError({ message: cloudflare522 })).toBe(true);
    expect(summarizeDependencyError({ message: cloudflare522 })).toBe('Supabase 接続障害（Cloudflare 522）');
  });

  test('522以外のHTMLエラーも生本文を通知しない', () => {
    expect(summarizeDependencyError('<html><body>upstream failed</body></html>')).toBe(
      '依存サービスが HTML エラーページを返しました',
    );
  });

  test('通常の短いエラーは保持し、長い非HTMLエラーだけを上限で切る', () => {
    expect(summarizeDependencyError('db down')).toBe('db down');
    expect(summarizeDependencyError('x'.repeat(241))).toBe(`${'x'.repeat(239)}…`);
  });

  test('522 の読取は一度だけ再試行して回復時は成功結果を返す', async () => {
    const read = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: cloudflare522 } })
      .mockResolvedValueOnce({ data: ['recovered'], error: null });

    await expect(retryTransientSupabaseRead(read)).resolves.toEqual({ data: ['recovered'], error: null });
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('522以外のエラーは再試行せず、元の結果を返す', async () => {
    const result = { data: null, error: { message: 'permission denied' } };
    const read = jest.fn().mockResolvedValue(result);

    await expect(retryTransientSupabaseRead(read)).resolves.toBe(result);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

import { formatApiErrorMessage } from '../api-error-message';

describe('formatApiErrorMessage（400 details の画面表示整形）', () => {
  test('details.fieldErrors の具体メッセージを「、」連結で返す（zod flatten 形式）', () => {
    const err = {
      error: 'リクエストが不正です',
      details: {
        formErrors: [],
        fieldErrors: {
          discount_value: ['定額割引は1円〜100,000円の範囲で入力してください'],
          name: ['クーポン名は必須です'],
        },
      },
    };
    expect(formatApiErrorMessage(err, 'fallback')).toBe(
      '定額割引は1円〜100,000円の範囲で入力してください、クーポン名は必須です'
    );
  });

  test('fieldErrors が空オブジェクト → error 文字列にフォールバック', () => {
    expect(formatApiErrorMessage({ error: 'リクエストが不正です', details: { fieldErrors: {} } }, 'fb')).toBe('リクエストが不正です');
  });

  test('fieldErrors の値が配列でない/文字列でない要素は無視する', () => {
    const err = { details: { fieldErrors: { a: 'not-array', b: [123, '', '有効なメッセージ'] } } };
    expect(formatApiErrorMessage(err, 'fb')).toBe('有効なメッセージ');
  });

  test('details なし・error 文字列あり → error を返す', () => {
    expect(formatApiErrorMessage({ error: 'サーバーエラーが発生しました' }, 'fb')).toBe('サーバーエラーが発生しました');
  });

  test('error が空文字列 → fallback', () => {
    expect(formatApiErrorMessage({ error: '' }, 'fb')).toBe('fb');
  });

  test('error が文字列でない → fallback', () => {
    expect(formatApiErrorMessage({ error: 42 }, 'fb')).toBe('fb');
  });

  test('err が null/undefined/文字列 → fallback', () => {
    expect(formatApiErrorMessage(null, 'fb')).toBe('fb');
    expect(formatApiErrorMessage(undefined, 'fb')).toBe('fb');
    expect(formatApiErrorMessage('oops', 'fb')).toBe('fb');
  });

  test('空オブジェクト（fetch res.json() の catch フォールバック {}）→ fallback', () => {
    expect(formatApiErrorMessage({}, '作成に失敗しました')).toBe('作成に失敗しました');
  });

  test('details.fieldErrors が非オブジェクト（null）→ error にフォールバック', () => {
    expect(formatApiErrorMessage({ error: 'x', details: { fieldErrors: undefined } }, 'fb')).toBe('x');
  });
});

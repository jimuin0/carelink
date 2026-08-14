import { describeResendError, throwIfResendError } from '../resend-result';

/**
 * Resend SDK は API エラーを throw せず `{ data, error }` の error に載せて resolve する。
 * この検査を通さないと「1 通も送れていないのに成功」になるため、両向き（error あり／なし）と
 * 応答の形が想定外だった場合を固定する。
 */
describe('describeResendError', () => {
  it('statusCode / name / message を人が読める 1 行にまとめる', () => {
    expect(
      describeResendError({ statusCode: 422, name: 'validation_error', message: 'Invalid `from`' }),
    ).toBe('422 validation_error Invalid `from`');
  });

  it('statusCode が null（ネットワーク断）でも残りを落とさない', () => {
    // SDK はネットワーク断で statusCode: null を返す。ここで空文字を挟むと読みにくいので除く。
    expect(
      describeResendError({ statusCode: null, name: 'application_error', message: 'Unable to fetch data.' }),
    ).toBe('application_error Unable to fetch data.');
  });

  it('statusCode が未定義でも残りを落とさない', () => {
    expect(describeResendError({ name: 'application_error' })).toBe('application_error');
  });

  it('message だけでも成立する', () => {
    expect(describeResendError({ message: 'boom' })).toBe('boom');
  });

  it('既知の形に当てはまらない応答は原文を JSON で残す（握り潰さない）', () => {
    expect(describeResendError({ unexpected: true })).toBe('{"unexpected":true}');
  });

  it('null を渡しても落ちず、原文を残す', () => {
    expect(describeResendError(null)).toBe('null');
  });
});

describe('throwIfResendError', () => {
  it('error が無ければ何もしない（成功パス）', () => {
    expect(() => throwIfResendError({ data: { id: 'x' }, error: null }, 'ctx')).not.toThrow();
  });

  it('result が undefined でも落とさない', () => {
    expect(() => throwIfResendError(undefined, 'ctx')).not.toThrow();
  });

  it('result が null でも落とさない', () => {
    expect(() => throwIfResendError(null, 'ctx')).not.toThrow();
  });

  it('error が載っていれば context つきで throw する', () => {
    expect(() =>
      throwIfResendError({ data: null, error: { statusCode: 401, name: 'missing_api_key', message: 'no key' } }, 'cron/x'),
    ).toThrow('resend send failed [cron/x]: 401 missing_api_key no key');
  });

  it('🔴 SDK が実際に返す形（!response.ok）で必ず throw する', () => {
    // node_modules/resend の fetchRequest は !response.ok でこの形を resolve する。
    // ここが throw しないと呼び出し側の catch に入らず「送信失敗が成功に化ける」。
    const actualSdkShape = {
      data: null,
      error: { name: 'validation_error', statusCode: 422, message: 'The `from` address is not verified.' },
    };
    expect(() => throwIfResendError(actualSdkShape, 'admin/newsletter batch')).toThrow(/422/);
  });
});

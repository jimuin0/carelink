import { errorMessage } from '../err';

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

import { firstSearchParams } from '../search-params';

test('配列で届いたクエリは先頭の値だけにし、文字列以外は捨てる', () => {
  expect(firstSearchParams({ a: ['x', 'y'], b: 'z', c: undefined, d: [] as string[], e: [1] as unknown as string[] })).toEqual({ a: 'x', b: 'z' });
});

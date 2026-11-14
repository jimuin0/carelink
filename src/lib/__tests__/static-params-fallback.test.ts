import { NO_STATIC_PARAM_SLUG, withStaticParamFallback } from '@/lib/static-params-fallback';

test('0 件なら存在しない slug を 1 件だけ返す（事前生成を必ず 1 度行わせる）', () => {
  expect(withStaticParamFallback([])).toEqual([{ slug: NO_STATIC_PARAM_SLUG }]);
});

test('1 件以上ならそのまま返す', () => {
  const list = [{ slug: 'a' }, { slug: 'b' }];
  expect(withStaticParamFallback(list)).toBe(list);
});

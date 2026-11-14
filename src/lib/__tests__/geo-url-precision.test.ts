import { readFileSync } from 'fs';
import { join } from 'path';
import { GEO_URL_DECIMALS, geoSearchPath, roundCoordForUrl } from '../geo-url-precision';

describe('roundCoordForUrl', () => {
  test('小数点以下2桁（約1km）に丸める', () => {
    expect(GEO_URL_DECIMALS).toBe(2);
    expect(roundCoordForUrl(35.681236)).toBe('35.68');
    expect(roundCoordForUrl(139.767125)).toBe('139.77');
    expect(roundCoordForUrl(-33.86785)).toBe('-33.87');
  });
  test('-0 は "0" にそろえる', () => {
    expect(roundCoordForUrl(-0.001)).toBe('0');
  });
  test('NaN・Infinity は null', () => {
    expect(roundCoordForUrl(Number.NaN)).toBeNull();
    expect(roundCoordForUrl(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('geoSearchPath', () => {
  test('丸めた座標だけを URL に載せる', () => {
    expect(geoSearchPath(35.6812362, 139.7671248)).toBe('/search?lat=35.68&lng=139.77');
  });
  test('どちらかが不正なら null', () => {
    expect(geoSearchPath(Number.NaN, 139.7)).toBeNull();
    expect(geoSearchPath(35.6, Number.NaN)).toBeNull();
  });
});

test('「現在地から探す」は生の座標を URL に載せず geoSearchPath を通す', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/search/HomeSearchForm.tsx'), 'utf8');
  expect(src).toContain('geoSearchPath(');
  expect(src).not.toMatch(/lat=\$\{pos\.coords/);
});

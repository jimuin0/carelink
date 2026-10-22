import { ECRU_SHOP_PATHS, isEcruShopPath } from '../shop-theme';

describe('店舗向け（くすみ系）ページの判定', () => {
  it.each(['/register', '/register/complete'])('%s は店舗向け', (path) => {
    expect(isEcruShopPath(path)).toBe(true);
  });

  it.each([
    ['/register/recover', '本文がまだ既定の配色'],
    ['/', '来院者向け'],
    ['/salon', '旧 LP（/register へ転送済み）'],
    ['/registers', '前方一致で拾わない'],
  ])('%s は対象外（%s）', (path) => {
    expect(isEcruShopPath(path)).toBe(false);
  });

  it('pathname が取れないときは対象外', () => {
    expect(isEcruShopPath(null)).toBe(false);
    expect(isEcruShopPath(undefined)).toBe(false);
  });

  it('対象は 2 ページだけ', () => {
    expect(ECRU_SHOP_PATHS).toEqual(['/register', '/register/complete']);
  });
});

/**
 * @jest-environment node
 *
 * 公開中の特集が 0 件のとき、一覧 `/feature` をインデックスさせない（2026年8月12日 新設）。
 *
 * 【背景】本番の特集 24 件のうち 21 件はフィルタ未設定で、どれも同じ 3 施設を返す
 * 重複コンテンツだった（本番実測）。これらを一括で非公開にすると一覧が空になる。
 * ページ自体は「特集記事を準備中です」の空状態を持っていて壊れないが、
 * 中身の無いページを検索結果に出す意味は無い。
 *
 * 詳細ページ（feature/[slug]）へ入れた「施設0件なら noindex」と同じ規則を一覧へも適用し、
 * sitemap 側（src/app/sitemap.ts）も載せる詳細が 1 本も無ければ `/feature` を出さない。
 * 片方だけだと「sitemap には無いが index はされる」状態が残る。
 */
const mockGetPublishedFeatures = jest.fn();

// factory 内は遅延参照にする（jest.mock の巻き上げで TDZ に当たるため）
jest.mock('@/lib/features', () => ({
  getPublishedFeatures: () => mockGetPublishedFeatures(),
}));

import { generateMetadata } from '../page';

beforeEach(() => {
  jest.clearAllMocks();
});

test('公開中の特集が0件 → robots noindex（follow は残す）', async () => {
  mockGetPublishedFeatures.mockResolvedValue([]);
  const meta = await generateMetadata();
  expect(meta.robots).toEqual({ index: false, follow: true });
});

test('公開中の特集が1件以上 → robots 指定なし（既定どおり index される）', async () => {
  mockGetPublishedFeatures.mockResolvedValue([{ id: 'f1', slug: 'a', title: 'A' }]);
  const meta = await generateMetadata();
  expect(meta.robots).toBeUndefined();
});

test('canonical と title は件数に関わらず維持する', async () => {
  mockGetPublishedFeatures.mockResolvedValue([]);
  const meta = await generateMetadata();
  expect(meta.title).toBe('特集一覧');
  expect(meta.alternates?.canonical).toBe('/feature');
});

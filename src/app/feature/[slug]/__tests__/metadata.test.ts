/**
 * @jest-environment node
 *
 * 施設が0件の特集ページを検索エンジンに載せない（2026年8月12日 新設）。
 *
 * 【背景】本番実測（2026年8月12日）で、公開中24件の特集のうち3件が施設0件だった。
 * うち2件は filter_type が「ヘアサロン」「リラクサロン」＝実在する business_type に無い値
 * （現存施設は「ネイル・まつげサロン」2件と「鍼灸院・整骨院」1件のみ）。
 * 残り1件は filter_keyword が誰にも当たらないケース。
 *
 * sitemap 側（src/app/sitemap.ts）は type / prefecture でしか除外できないため、
 * keyword 由来の0件はこの noindex でしか塞げない。両方そろって初めて漏れが無くなる。
 *
 * 手動フラグにしない理由は、条件を直したときの戻し忘れを構造的に避けるため
 * （line-availability.ts と同じ方針＝実データに従属させる）。
 */
const mockGetFeatureBySlug = jest.fn();
const mockSearchFacilities = jest.fn();

// factory 内では遅延参照にする。`getFeatureBySlug: mockGetFeatureBySlug` と直接書くと
// jest.mock の巻き上げで factory が const 初期化より先に評価され TDZ エラーになる。
jest.mock('@/lib/features', () => ({
  getFeatureBySlug: (slug: string) => mockGetFeatureBySlug(slug),
}));
jest.mock('@/lib/facilities', () => ({
  searchFacilities: (params: unknown) => mockSearchFacilities(params),
}));

import { generateMetadata } from '../page';

function feature(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'eyelash-special',
    title: '理想の目元をつくる まつ毛特集',
    description: null,
    banner_image_url: null,
    filter_type: 'ネイル・まつげサロン',
    filter_keyword: null,
    filter_prefecture: null,
    ...overrides,
  };
}

const props = (slug = 'eyelash-special') => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  jest.clearAllMocks();
});

test('施設0件 → robots noindex（follow は残す）', async () => {
  mockGetFeatureBySlug.mockResolvedValue(feature());
  mockSearchFacilities.mockResolvedValue({ facilities: [] });
  const meta = await generateMetadata(props());
  expect(meta.robots).toEqual({ index: false, follow: true });
});

test('施設が1件以上 → robots 指定なし（既定どおり index される）', async () => {
  mockGetFeatureBySlug.mockResolvedValue(feature());
  mockSearchFacilities.mockResolvedValue({ facilities: [{ id: 'f1' }] });
  const meta = await generateMetadata(props());
  expect(meta.robots).toBeUndefined();
});

test('keyword 由来の0件も noindex になる（sitemap 側では検出できない経路）', async () => {
  mockGetFeatureBySlug.mockResolvedValue(
    feature({ filter_type: null, filter_keyword: 'まつ毛 パーマ エクステ' })
  );
  mockSearchFacilities.mockResolvedValue({ facilities: [] });
  const meta = await generateMetadata(props());
  expect(meta.robots).toEqual({ index: false, follow: true });
});

test('noindex 判定はページ本体と同じ絞り込み条件で行う', async () => {
  mockGetFeatureBySlug.mockResolvedValue(
    feature({ filter_type: 'ヘアサロン', filter_keyword: 'カット', filter_prefecture: '大阪府' })
  );
  mockSearchFacilities.mockResolvedValue({ facilities: [] });
  await generateMetadata(props());
  expect(mockSearchFacilities).toHaveBeenCalledWith({
    type: 'ヘアサロン',
    keyword: 'カット',
    prefecture: '大阪府',
    sort: 'rating',
  });
});

test('空文字のフィルタは未設定として渡す（sitemap 側と同じ意味論）', async () => {
  mockGetFeatureBySlug.mockResolvedValue(
    feature({ filter_type: '', filter_keyword: '', filter_prefecture: '' })
  );
  mockSearchFacilities.mockResolvedValue({ facilities: [{ id: 'f1' }] });
  await generateMetadata(props());
  expect(mockSearchFacilities).toHaveBeenCalledWith({
    type: undefined,
    keyword: undefined,
    prefecture: undefined,
    sort: 'rating',
  });
});

test('特集が存在しない → 空メタデータ（施設検索も走らせない）', async () => {
  mockGetFeatureBySlug.mockResolvedValue(null);
  const meta = await generateMetadata(props('no-such-feature'));
  expect(meta).toEqual({});
  expect(mockSearchFacilities).not.toHaveBeenCalled();
});

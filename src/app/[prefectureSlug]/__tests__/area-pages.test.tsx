/** @jest-environment node */
/**
 * エリア・業種の一覧ページ（2026年10月22日 是正）。
 *
 * - DB の一時障害で、/osaka・/osaka/toyonaka・/osaka/<業種>・/type/<業種> が
 *   「0件の施設が見つかりました／現在掲載されていません」を 200・index 可のまま返していた
 *   （検索の error を読んでおらず、件数の null も「件数不明＝index 可」と扱っていた）。
 *   /search と同じく、読めなかったときは例外にして error.tsx の一時障害表示にする。
 * - 結果より後ろのページ（本番の /osaka/toyonaka?page=2）が「0件」を 200 で返していた → 1 ページ目へ戻す。
 * - 業種トップ /type/<業種> だけ、掲載 0 件でも noindex が付いていなかった。
 * - metadata の件数は本文と同じ検索の読み取りから取る。Next 16 の metadata は本文と別に描画されるため、
 *   metadata だけ別の問い合わせにすると、それだけが落ちたとき本文が 200 で返り title・robots が欠ける。
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PrefecturePage, { generateMetadata as prefectureMetadata } from '../page';
import SecondSlugPage, { generateMetadata as secondMetadata } from '../[secondSlug]/page';
import CityTypePage, { generateMetadata as cityTypeMetadata } from '../[secondSlug]/[typeSlug]/page';
import BusinessTypePage, { generateMetadata as typeMetadata } from '../../type/[typeSlug]/page';
import { notFound, redirect } from 'next/navigation';
import { searchFacilities } from '@/lib/facilities';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => { throw new Error('TEST_NOT_FOUND'); }),
  redirect: jest.fn((url: string) => { throw new Error(`TEST_REDIRECT:${url}`); }),
}));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/facilities', () => ({ searchFacilities: jest.fn() }));
jest.mock('@/lib/area-seo', () => ({
  ...jest.requireActual('@/lib/area-seo'),
  getAreaSeoContent: jest.fn(async () => null),
}));
// metadata が DB を別に数えに行かないこと（本文と同じ検索だけを使うこと）を確かめるため、直接の問い合わせは失敗させる。
const mockFrom = jest.fn(() => { throw new Error('metadata must not run its own count query'); });
jest.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: () => ({ from: mockFrom }) }));
function mockStub(name: string) { return { __esModule: true, default: () => <i data-stub={name} /> }; }
jest.mock('@/components/Breadcrumb', () => mockStub('Breadcrumb'));
jest.mock('@/components/search/FacilityCard', () => ({ __esModule: true, default: ({ facility }: { facility: { name: string } }) => <p>{facility.name}</p> }));
jest.mock('@/components/search/Pagination', () => mockStub('Pagination'));
jest.mock('@/components/seo/RelatedLinks', () => mockStub('RelatedLinks'));
jest.mock('@/components/seo/SafeHtmlContent', () => mockStub('SafeHtmlContent'));

const facility = { id: 'f1', slug: 'hal', name: 'テスト施設', business_type: 'ネイル・まつげサロン', prefecture: '大阪府', city: '豊中市' };
const ok = (total: number, facilities = total > 0 ? [facility] : []) => ({ facilities, total, perPage: 20, error: null });
const failure = { code: 'PGRST003', message: 'Timed out acquiring connection from connection pool.' };

/** /[都道府県]/[業種|市区町村] は中身を別の async コンポーネントに渡すので、そこまで解決する。 */
async function resolve(element: Promise<React.ReactElement>): Promise<React.ReactElement> {
  const el = await element;
  const type = el.type as unknown;
  return typeof type === 'function' && type.constructor.name === 'AsyncFunction'
    ? resolve((type as (p: unknown) => Promise<React.ReactElement>)(el.props))
    : el;
}

const pages = {
  prefecture: { render: () => PrefecturePage({ params: Promise.resolve({ prefectureSlug: 'osaka' }) }), base: '/osaka' },
  prefType: { render: (page?: string) => resolve(SecondSlugPage({ params: Promise.resolve({ prefectureSlug: 'osaka', secondSlug: 'nail-eyelash' }), searchParams: Promise.resolve({ page }) })), base: '/osaka/nail-eyelash' },
  city: { render: (page?: string) => resolve(SecondSlugPage({ params: Promise.resolve({ prefectureSlug: 'osaka', secondSlug: 'toyonaka' }), searchParams: Promise.resolve({ page }) })), base: '/osaka/toyonaka' },
  cityType: { render: (page?: string) => CityTypePage({ params: Promise.resolve({ prefectureSlug: 'osaka', secondSlug: 'toyonaka', typeSlug: 'nail-eyelash' }), searchParams: Promise.resolve({ page }) }), base: '/osaka/toyonaka/nail-eyelash' },
  type: { render: () => BusinessTypePage({ params: Promise.resolve({ typeSlug: 'nail-eyelash' }) }), base: '/type/nail-eyelash' },
};

const metadata = {
  prefecture: () => prefectureMetadata({ params: Promise.resolve({ prefectureSlug: 'osaka' }) }),
  prefType: () => secondMetadata({ params: Promise.resolve({ prefectureSlug: 'osaka', secondSlug: 'nail-eyelash' }), searchParams: Promise.resolve({}) }),
  city: () => secondMetadata({ params: Promise.resolve({ prefectureSlug: 'osaka', secondSlug: 'toyonaka' }), searchParams: Promise.resolve({}) }),
  cityType: () => cityTypeMetadata({ params: Promise.resolve({ prefectureSlug: 'osaka', secondSlug: 'toyonaka', typeSlug: 'nail-eyelash' }), searchParams: Promise.resolve({}) }),
  type: () => typeMetadata({ params: Promise.resolve({ typeSlug: 'nail-eyelash' }) }),
};

beforeEach(() => {
  jest.clearAllMocks();
  (searchFacilities as jest.Mock).mockResolvedValue(ok(3));
});

describe.each(Object.keys(pages) as (keyof typeof pages)[])('%s', (key) => {
  test('検索の読み取りに失敗したら「0件・掲載なし」を出さず例外にする', async () => {
    (searchFacilities as jest.Mock).mockResolvedValue({ facilities: [], total: 0, perPage: 20, error: failure });
    await expect(pages[key].render()).rejects.toThrow('AREA_RESULTS_UNAVAILABLE');
    expect(notFound).not.toHaveBeenCalled();
  });

  test('本当に 0 件なら空の一覧を出す（1 ページ目は戻さない）', async () => {
    (searchFacilities as jest.Mock).mockResolvedValue(ok(0));
    const html = renderToStaticMarkup(await pages[key].render());
    expect(html).toMatch(/>0件の施設/);
    expect(redirect).not.toHaveBeenCalled();
  });

  test('施設があれば一覧に出す', async () => {
    const html = renderToStaticMarkup(await pages[key].render());
    expect(html).toContain('テスト施設');
  });

  test('件数を数えられなかったら index の可否を決めず例外にする（null を index 可と扱わない）', async () => {
    (searchFacilities as jest.Mock).mockResolvedValue({ facilities: [], total: 0, perPage: 20, error: failure });
    await expect(metadata[key]()).rejects.toThrow('AREA_RESULTS_UNAVAILABLE');
  });

  test('掲載 0 件なら noindex, follow', async () => {
    (searchFacilities as jest.Mock).mockResolvedValue(ok(0));
    await expect(metadata[key]()).resolves.toMatchObject({ robots: { index: false, follow: true } });
  });

  test('metadata の件数は本文（1 ページ目）と同じ検索から取り、別の問い合わせで数えない', async () => {
    await metadata[key]();
    const metadataCalls = (searchFacilities as jest.Mock).mock.calls;
    expect(metadataCalls).toHaveLength(1);
    (searchFacilities as jest.Mock).mockClear();
    await pages[key].render();
    // 本文も同じ引数で読む＝同じリクエスト内では cache で 1 回の読み取りになる
    expect((searchFacilities as jest.Mock).mock.calls).toContainEqual(metadataCalls[0]);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe.each(['prefecture', 'city', 'type'] as const)('%s（品質判定の無い階層）', (key) => {
  test('掲載があれば robots を出さない（index に戻る）', async () => {
    const result = await metadata[key]();
    expect(result).not.toHaveProperty('robots');
  });
});

describe.each(['prefType', 'city', 'cityType'] as const)('%s のページ送り', (key) => {
  test('結果より後ろのページはページ番号なしの URL へ戻す（本番の /osaka/toyonaka?page=2）', async () => {
    (searchFacilities as jest.Mock).mockResolvedValue(ok(0));
    await expect(pages[key].render('2')).rejects.toThrow(`TEST_REDIRECT:${pages[key].base}`);
  });

  test('範囲内のページはそのまま出す', async () => {
    (searchFacilities as jest.Mock).mockResolvedValue(ok(21));
    await expect(pages[key].render('2')).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  /**
   * metadata は 1 ページ目の件数で noindex を判定する。2 ページ目の本文がその読み取りを待たないと、
   * 1 ページ目の読み取りだけが落ちたとき、本文は 200 で返り title・robots が欠ける。
   */
  test('2 ページ目でも、metadata が使う 1 ページ目の読み取りに失敗したら本文も例外にする', async () => {
    (searchFacilities as jest.Mock).mockImplementation(async ({ page }: { page: number }) => (
      page === 1 ? { facilities: [], total: 0, perPage: 20, error: failure } : ok(21)
    ));
    await expect(pages[key].render('2')).rejects.toThrow('AREA_RESULTS_UNAVAILABLE');
    expect(redirect).not.toHaveBeenCalled();
  });
});

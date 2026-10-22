/** @jest-environment node */
/**
 * 施設ページ（2026年10月22日）。
 * - 店舗ブログの公開記事へ、施設ページから辿れる導線が 1 本も無かった（記事があるときだけ出す）。
 * - DB の一時障害で、公開中の施設が「存在しないか、公開が終了した」404＋noindex になっていた。
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Page, { generateMetadata } from '../page';
import { notFound } from 'next/navigation';
import { safeCaptureException } from '@/lib/safe';
import { getFacilityBySlug } from '@/lib/facilities';
import { getBlogSummariesByFacility } from '@/lib/blog';

jest.mock('next/navigation', () => ({ notFound: jest.fn(() => { throw new Error('TEST_NOT_FOUND'); }) }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/facilities', () => ({
  getFacilityBySlug: jest.fn(),
  getFacilityMenus: jest.fn(async () => ({ menus: [] })),
  getFacilityPhotos: jest.fn(async () => ({ photos: [] })),
  getFacilityReviews: jest.fn(async () => ({ reviews: [] })),
}));
jest.mock('@/lib/staff', () => ({ getStaffByFacility: jest.fn(async () => []) }));
jest.mock('@/lib/coupons', () => ({ getActiveCouponsByFacility: jest.fn(async () => []), getCouponMenuMap: jest.fn(async () => ({})) }));
jest.mock('@/lib/catalogs', () => ({ getCatalogsByFacility: jest.fn(async () => []) }));
jest.mock('@/lib/blog', () => ({ getBlogSummariesByFacility: jest.fn() }));
jest.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: () => ({}), createServiceRoleClient: () => ({}) }));
jest.mock('@/lib/facility-publish-gate', () => ({ checkBookingReadiness: jest.fn(async () => ({ readiness: { ready: false }, error: null })) }));

// 表示部品は中身を問わないので置き換える。タブは全タブの見出しと中身を並べて出す（どのタブがあるかを見るため）。
function mockStub(name: string) { return { __esModule: true, default: () => <i data-stub={name} /> }; }
jest.mock('@/components/facility/TabNavigation', () => ({
  __esModule: true,
  default: ({ tabs }: { tabs: { key: string; label: string; content: React.ReactNode }[] }) => (
    <div>{tabs.map((t) => <section key={t.key} data-tab={t.key}><h3>{t.label}</h3>{t.content}</section>)}</div>
  ),
}));
jest.mock('@/components/facility/PhotoGallery', () => mockStub('PhotoGallery'));
jest.mock('@/components/facility/FacilityHeader', () => mockStub('FacilityHeader'));
jest.mock('@/components/facility/MenuList', () => mockStub('MenuList'));
jest.mock('@/components/facility/AccessInfo', () => mockStub('AccessInfo'));
jest.mock('@/components/facility/ReviewTab', () => mockStub('ReviewTab'));
jest.mock('@/components/facility/InquiryForm', () => mockStub('InquiryForm'));
jest.mock('@/components/facility/StickyBookingBar', () => mockStub('StickyBookingBar'));
jest.mock('@/components/facility/FavoriteButton', () => mockStub('FavoriteButton'));
jest.mock('@/components/facility/ShareButtons', () => mockStub('ShareButtons'));
jest.mock('@/components/facility/SymptomList', () => mockStub('SymptomList'));
jest.mock('@/components/facility/CertificationList', () => mockStub('CertificationList'));
jest.mock('@/components/facility/ViewCount', () => mockStub('ViewCount'));
jest.mock('@/components/facility/StaffList', () => mockStub('StaffList'));
jest.mock('@/components/facility/CouponList', () => mockStub('CouponList'));
jest.mock('@/components/facility/CatalogList', () => mockStub('CatalogList'));
jest.mock('@/components/facility/QASection', () => mockStub('QASection'));
jest.mock('@/components/facility/BusinessStatusBadge', () => mockStub('BusinessStatusBadge'));
jest.mock('@/components/facility/SimilarFacilities', () => mockStub('SimilarFacilities'));
jest.mock('@/components/facility/NearbyFacilities', () => mockStub('NearbyFacilities'));

const facility = {
  id: 'facility-id', slug: 'hal', name: 'テスト施設', business_type: 'ネイル・まつげサロン',
  prefecture: '大阪府', city: '豊中市', address: '1-1', postal_code: null, phone: null, features: [],
  rating_avg: null, rating_count: 0, catch_copy: null, description: null, business_hours: null,
  regular_holiday: null, access_info: null, main_photo_url: null, gbp_place_id: null, website_url: null,
  credit_card: false, latitude: null, longitude: null, seat_count: null, updated_at: null,
};
const props = () => ({ params: Promise.resolve({ slug: 'hal' }) });
const posts = [
  { id: 'p2', slug: 'second', title: '秋の新メニュー', published_at: '2026-10-01T16:00:00Z' },
  { id: 'p1', slug: 'first', title: '開店のお知らせ', published_at: '2026-10-01T00:00:00Z' },
];

beforeEach(() => {
  jest.clearAllMocks();
  (getFacilityBySlug as jest.Mock).mockResolvedValue({ facility });
  (getBlogSummariesByFacility as jest.Mock).mockResolvedValue({ posts, total: 2 });
});

describe('店舗ブログへの導線', () => {
  test('公開記事があれば「ブログ(n)」タブと、最初に開くタブの「新着ブログ」から記事と一覧へ辿れる', async () => {
    const html = renderToStaticMarkup(await Page(props()));
    expect(html).toContain('ブログ(2)');
    expect(html).toContain('新着ブログ');
    expect(html).toContain('href="/facility/hal/blog/second"');
    expect(html).toContain('href="/facility/hal/blog/first"');
    expect(html).toContain('href="/facility/hal/blog"');
    expect(html).toContain('ブログ記事をすべて見る（2件）');
    // 公開日は日本時間で出す（UTC では 10/1 16:00 ＝日本時間 10/2 01:00）
    expect(html).toContain('2026/10/2');
    // 「新着ブログ」は最初に開くタブ（トップ）の中にある＝ページを開いた時点のHTMLに出る
    const top = html.slice(html.indexOf('data-tab="top"'), html.indexOf('data-tab="menu"'));
    expect(top).toContain('新着ブログ');
    expect(getBlogSummariesByFacility).toHaveBeenCalledWith('facility-id', 5);
  });

  test('公開記事が無ければタブも「新着ブログ」も出さない', async () => {
    (getBlogSummariesByFacility as jest.Mock).mockResolvedValue({ posts: [], total: 0 });
    const html = renderToStaticMarkup(await Page(props()));
    expect(html).not.toContain('data-tab="blog"');
    expect(html).not.toContain('新着ブログ');
    expect(html).not.toContain('/facility/hal/blog');
  });

  test('記事の読み取りに失敗したら導線は出さず、通知したうえで施設ページは表示する', async () => {
    const failure = new Error('Blog list unavailable');
    (getBlogSummariesByFacility as jest.Mock).mockRejectedValue(failure);
    const html = renderToStaticMarkup(await Page(props()));
    expect(html).toContain('テスト施設');
    expect(html).not.toContain('data-tab="blog"');
    expect(safeCaptureException).toHaveBeenCalledWith(failure, 'facility-detail:blog');
  });
});

describe('施設の読み取り失敗は 404 にしない', () => {
  test('読み取りに失敗したら notFound() に流さず例外のまま返す（error.tsx の一時障害表示になる）', async () => {
    (getFacilityBySlug as jest.Mock).mockRejectedValue(new Error('PAGE_DATA_UNAVAILABLE'));
    await expect(Page(props())).rejects.toThrow('PAGE_DATA_UNAVAILABLE');
    await expect(generateMetadata(props())).rejects.toThrow('PAGE_DATA_UNAVAILABLE');
    expect(notFound).not.toHaveBeenCalled();
  });

  test('本当に存在しない（非公開・削除済み）施設は 404 のまま', async () => {
    (getFacilityBySlug as jest.Mock).mockResolvedValue({ facility: null });
    await expect(Page(props())).rejects.toThrow('TEST_NOT_FOUND');
    await expect(generateMetadata(props())).resolves.toEqual({ title: 'ページが見つかりません' });
  });
});

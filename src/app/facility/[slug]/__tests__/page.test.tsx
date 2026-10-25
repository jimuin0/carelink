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
import { hasPublicQa } from '@/lib/facility-qa-visibility';
import { checkBookingReadiness } from '@/lib/facility-publish-gate';

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
jest.mock('@/lib/facility-qa-visibility', () => ({ hasPublicQa: jest.fn() }));
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
jest.mock('@/components/facility/QASection', () => ({
  __esModule: true,
  QA_ASK_ANCHOR: 'qa-ask',
  default: ({ askOnly, loginHref }: { askOnly?: boolean; loginHref?: string }) => (
    <i data-stub="QASection" data-ask-only={askOnly ? 'true' : 'false'} data-login-href={loginHref} />
  ),
}));
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
  (hasPublicQa as jest.Mock).mockResolvedValue(true);
});

test.each([false, true])('contact guidance reflects whether online booking is available (%s)', async ready => {
  (checkBookingReadiness as jest.Mock).mockResolvedValueOnce({ readiness: { ready }, error: null });
  const html = renderToStaticMarkup(await Page(props()));
  expect(html).toContain(ready ? 'ご予約・ご質問は、お電話またはフォームからお気軽にどうぞ。' : 'お問い合わせは、お電話またはフォームからどうぞ。');
  if (!ready) expect(html).not.toContain('ご予約・ご質問は');
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

// 2026年10月23日（神原さん判断）: 公開中の Q&A が 0 件の施設では Q&A タブを出さない。
// 質問を送る機能は残す（タブの中にあった投稿欄を、お問い合わせ欄の下に小さく置く）。
describe('Q&A タブ', () => {
  const contact = (html: string) => html.slice(html.indexOf('id="contact-section"'));

  test('公開中の Q&A が 0 件ならタブを出さず、お問い合わせ欄に質問の入口だけを置く', async () => {
    (hasPublicQa as jest.Mock).mockResolvedValue(false);
    const html = renderToStaticMarkup(await Page(props()));
    expect(hasPublicQa).toHaveBeenCalledWith('facility-id');
    expect(html).not.toContain('data-tab="qa"');
    expect(html).not.toContain('>Q&amp;A</h3>');
    expect(html.match(/data-stub="QASection"/g)).toHaveLength(1);
    expect(contact(html)).toContain('data-ask-only="true"');
    // 未ログインの人はログインして質問欄（#qa-ask）へ戻る
    expect(contact(html)).toContain(`data-login-href="/auth/login?redirect=${encodeURIComponent('/facility/hal#qa-ask')}"`);
  });

  test('公開中の Q&A が 1 件以上ならタブを出し、お問い合わせ欄に入口は重ねない', async () => {
    (hasPublicQa as jest.Mock).mockResolvedValue(true);
    const html = renderToStaticMarkup(await Page(props()));
    expect(html).toContain('data-tab="qa"');
    expect(html.match(/data-stub="QASection"/g)).toHaveLength(1);
    expect(html).toContain('data-ask-only="false"');
    expect(contact(html)).not.toContain('data-stub="QASection"');
  });

  test('有無を読めなかったら通知したうえでタブを出す（あるかもしれない内容を隠さない）', async () => {
    const failure = new Error('QA lookup unavailable');
    (hasPublicQa as jest.Mock).mockRejectedValue(failure);
    const html = renderToStaticMarkup(await Page(props()));
    expect(html).toContain('data-tab="qa"');
    expect(contact(html)).not.toContain('data-stub="QASection"');
    expect(safeCaptureException).toHaveBeenCalledWith(failure, 'facility-detail:qa');
  });
});

// 2026年10月23日: スマホで共有ボタン 4 つとお気に入りを見出しの横に並べると、店名などが 2〜3 行に折れていた。
describe('見出しまわりの並び', () => {
  const classOf = (html: string, testId: string) => html.match(new RegExp(`class="([^"]*)" data-testid="${testId}"`))?.[1].split(' ') ?? [];

  test('スマホ: 見出しの横はお気に入りだけ（右上）、共有は見出しの下に 1 行で並ぶ', async () => {
    const html = renderToStaticMarkup(await Page(props()));
    const area = classOf(html, 'facility-title-area');
    const share = classOf(html, 'facility-share-slot');
    const favorite = classOf(html, 'facility-favorite-slot');
    expect(area).toEqual(expect.arrayContaining(['grid', 'grid-cols-[minmax(0,1fr)_auto]']));
    expect(share).toEqual(expect.arrayContaining(['col-span-2', 'row-start-2']));
    expect(favorite).toEqual(expect.arrayContaining(['col-start-2', 'row-start-1']));
  });

  test('PC: 共有とお気に入りは従来どおり見出しの横に並ぶ', async () => {
    const html = renderToStaticMarkup(await Page(props()));
    expect(classOf(html, 'facility-title-area')).toContain('sm:grid-cols-[minmax(0,1fr)_auto_auto]');
    expect(classOf(html, 'facility-share-slot')).toEqual(expect.arrayContaining(['sm:col-start-2', 'sm:row-start-1', 'sm:col-span-1']));
    expect(classOf(html, 'facility-favorite-slot')).toContain('sm:col-start-3');
  });

  test('共有ボタンは 1 組だけ描画する（スマホ用と PC 用を 2 組置いてラベルを重複させない）', async () => {
    const html = renderToStaticMarkup(await Page(props()));
    expect(html.match(/data-stub="ShareButtons"/g)).toHaveLength(1);
    expect(html.match(/data-stub="FavoriteButton"/g)).toHaveLength(1);
  });
});

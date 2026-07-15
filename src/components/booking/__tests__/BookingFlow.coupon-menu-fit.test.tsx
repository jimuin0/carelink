/**
 * @jest-environment jsdom
 *
 * 【2026年7月15日 恒久予防】クーポン×メニュー適合制約(coupon_menus)のUI回帰テスト。
 * サーバー(src/app/api/booking/route.ts)の意味論＝「coupon_menusに行があるクーポンは対象メニュー
 * 限定・行が無い(0行)クーポンは全メニュー適用」と同一の判定を、UIでも disabled・警告として反映する。
 * couponMenuMap は page.tsx（サーバーコンポーネント）が getCouponMenus 経由で渡す想定のprop。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import BookingFlow from '../BookingFlow';
import type { FacilityMenu, Coupon } from '@/types';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [] }) }) }),
  }),
}));

const FACILITY = { id: 'fac-1', slug: 'test-salon', name: 'テストサロン' };

function menu(id: string, name: string): FacilityMenu {
  return {
    id, facility_id: 'fac-1', category: 'カテゴリ', name, description: null,
    price: 5000, price_note: null, duration_minutes: 60, photo_url: null, is_featured: false, sort_order: 0,
  } as FacilityMenu;
}

function coupon(id: string, name: string): Coupon {
  return {
    id, facility_id: 'fac-1', name, description: null, coupon_type: 'all',
    discount_type: 'fixed', discount_value: 1000, special_price: null,
    valid_from: null, valid_until: null, is_active: true, sort_order: 0, created_at: '2026-01-01T00:00:00Z',
  } as Coupon;
}

const MENU_A = menu('menu-a', 'カット');
const MENU_B = menu('menu-b', 'カラー');
const RESTRICTED_COUPON = coupon('coupon-1', 'カット限定クーポン');
const UNRESTRICTED_COUPON = coupon('coupon-2', '全メニュークーポン');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('クーポン×メニュー適合制約(coupon_menus)のUI', () => {
  test('couponMenuMap にキーが無いクーポン(0行)は対象メニュー表記が無く、常に選択できる', async () => {
    render(
      <BookingFlow
        facility={FACILITY}
        staff={[]}
        menus={[MENU_A, MENU_B]}
        coupons={[UNRESTRICTED_COUPON]}
        couponMenuMap={{}}
      />
    );
    await screen.findByText('全メニュークーポン');
    expect(screen.queryByText(/対象メニュー：/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('メニューから選ぶ'));
    fireEvent.click(await screen.findByText('カラー'));
    fireEvent.click(screen.getByText('クーポン'));

    const couponButton = (await screen.findByText('全メニュークーポン')).closest('button')!;
    expect(couponButton).not.toBeDisabled();
    fireEvent.click(couponButton);
    expect(screen.getByText('✓ 選択中')).toBeInTheDocument();
  });

  test('対象メニュー限定クーポンに対象メニュー名が表示される', async () => {
    render(
      <BookingFlow
        facility={FACILITY}
        staff={[]}
        menus={[MENU_A, MENU_B]}
        coupons={[RESTRICTED_COUPON]}
        couponMenuMap={{ 'coupon-1': ['menu-a'] }}
      />
    );
    await screen.findByText('カット限定クーポン');
    expect(screen.getByText(/対象メニュー：カット/)).toBeInTheDocument();
  });

  test('対象メニュー限定クーポン＋適合するメニュー選択中 → 選択可能', async () => {
    render(
      <BookingFlow
        facility={FACILITY}
        staff={[]}
        menus={[MENU_A, MENU_B]}
        coupons={[RESTRICTED_COUPON]}
        couponMenuMap={{ 'coupon-1': ['menu-a'] }}
      />
    );
    // 対象メニュー(カット)を先に選択
    fireEvent.click(screen.getByText('メニューから選ぶ'));
    fireEvent.click(await screen.findByText('カット'));
    fireEvent.click(screen.getByText('クーポン'));

    const couponButton = (await screen.findByText('カット限定クーポン')).closest('button')!;
    expect(couponButton).not.toBeDisabled();
    fireEvent.click(couponButton);
    expect(screen.getByText('✓ 選択中')).toBeInTheDocument();
  });

  test('対象メニュー限定クーポン＋非適合メニュー選択中 → 選択不可(disabled)かつ警告文言表示', async () => {
    render(
      <BookingFlow
        facility={FACILITY}
        staff={[]}
        menus={[MENU_A, MENU_B]}
        coupons={[RESTRICTED_COUPON]}
        couponMenuMap={{ 'coupon-1': ['menu-a'] }}
      />
    );
    // 対象外メニュー(カラー)を先に選択
    fireEvent.click(screen.getByText('メニューから選ぶ'));
    fireEvent.click(await screen.findByText('カラー'));
    fireEvent.click(screen.getByText('クーポン'));

    const couponButton = (await screen.findByText('カット限定クーポン')).closest('button')!;
    expect(couponButton).toBeDisabled();
    expect(screen.getByText(/選択中のメニューでは利用できません/)).toBeInTheDocument();

    // disabled のためクリックしても選択状態にならない
    fireEvent.click(couponButton);
    expect(screen.queryByText('✓ 選択中')).not.toBeInTheDocument();
  });

  test('クーポン選択後にメニューを対象外に変更すると自動解除され警告トーストが出る', async () => {
    render(
      <BookingFlow
        facility={FACILITY}
        staff={[]}
        menus={[MENU_A, MENU_B]}
        coupons={[RESTRICTED_COUPON]}
        couponMenuMap={{ 'coupon-1': ['menu-a'] }}
      />
    );
    // まず対象メニュー(カット)を選んでクーポンを選択
    fireEvent.click(screen.getByText('メニューから選ぶ'));
    fireEvent.click(await screen.findByText('カット'));
    fireEvent.click(screen.getByText('クーポン'));
    const couponButton = (await screen.findByText('カット限定クーポン')).closest('button')!;
    fireEvent.click(couponButton);
    expect(screen.getByText('✓ 選択中')).toBeInTheDocument();

    // メニューをカット→カラーへ変更（対象外化）
    fireEvent.click(screen.getByText('メニューから選ぶ'));
    fireEvent.click(screen.getByText('カット')); // 選択解除
    fireEvent.click(screen.getByText('カラー')); // 対象外メニューを選択

    // クーポン選択が自動解除され警告トーストが表示される
    expect(await screen.findByText(/クーポンの選択を解除しました/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('クーポン'));
    expect(screen.queryByText('✓ 選択中')).not.toBeInTheDocument();
  });
});

// ─── 【2026年7月15日 HPB準拠仕様】クーポン選択→対象メニュー自動選択 ─────────────
describe('クーポン選択で対象メニューが自動選択される（HPBの「クーポン=施術が決まる」体験）', () => {
  test('対象メニュー限定クーポンを選ぶと対象メニューが自動選択され、トーストと「自動選択済み」表示が出る', async () => {
    render(
      <BookingFlow
        facility={FACILITY}
        staff={[]}
        menus={[MENU_A, MENU_B]}
        coupons={[RESTRICTED_COUPON]}
        couponMenuMap={{ 'coupon-1': ['menu-a'] }}
      />
    );
    // メニュー未選択のままクーポンを選択
    const couponButton = (await screen.findByText('カット限定クーポン')).closest('button')!;
    fireEvent.click(couponButton);

    // 自動選択の通知トースト
    expect(await screen.findByText(/対象メニュー（カット）を自動選択しました/)).toBeInTheDocument();
    // クーポンカードに自動選択済みの明示
    expect(screen.getByText(/自動選択済み/)).toBeInTheDocument();
    // サマリに1件選択中（対象メニューが selectedMenus に入った）＋合計は対象メニュー定価
    expect(screen.getByText('1件選択中')).toBeInTheDocument();
    expect(screen.getByText('合計 ¥5,000')).toBeInTheDocument();
  });

  test('自動選択された対象メニューにはメニュー一覧で「クーポン対象」バッジが付く', async () => {
    render(
      <BookingFlow
        facility={FACILITY}
        staff={[]}
        menus={[MENU_A, MENU_B]}
        coupons={[RESTRICTED_COUPON]}
        couponMenuMap={{ 'coupon-1': ['menu-a'] }}
      />
    );
    const couponButton = (await screen.findByText('カット限定クーポン')).closest('button')!;
    fireEvent.click(couponButton);
    await screen.findByText(/自動選択しました/);

    // メニュータブへ切替（対象メニューにのみバッジ）
    fireEvent.click(screen.getByText('メニューから選ぶ'));
    expect(await screen.findByText('クーポン対象')).toBeInTheDocument();
    expect(screen.getByText('1件選択中')).toBeInTheDocument();
  });

  test('既に別メニューを選択済みでクーポンを選ぶと既存選択は維持される（マージ・対象+対象外混在を妨げない）', async () => {
    render(
      <BookingFlow
        facility={FACILITY}
        staff={[]}
        menus={[MENU_A, MENU_B]}
        coupons={[RESTRICTED_COUPON]}
        couponMenuMap={{ 'coupon-1': ['menu-a'] }}
      />
    );
    // 対象外メニュー(カラー)と対象メニュー(カット)を両方選択してからクーポンへ
    fireEvent.click(screen.getByText('メニューから選ぶ'));
    fireEvent.click(await screen.findByText('カラー'));
    fireEvent.click(screen.getByText('カット'));
    fireEvent.click(screen.getByText('クーポン'));

    const couponButton = (await screen.findByText('カット限定クーポン')).closest('button')!;
    fireEvent.click(couponButton);

    // 既存2件が維持される（対象メニューは既に選択済みなので追加0件）
    expect(screen.getByText('2件選択中')).toBeInTheDocument();
    expect(screen.getByText('合計 ¥10,000')).toBeInTheDocument();
  });

  test('対象未設定クーポン（couponMenuMapにキーなし）を選んでもメニューは自動選択されない（従来どおり手動選択）', async () => {
    render(
      <BookingFlow
        facility={FACILITY}
        staff={[]}
        menus={[MENU_A, MENU_B]}
        coupons={[UNRESTRICTED_COUPON]}
        couponMenuMap={{}}
      />
    );
    const couponButton = (await screen.findByText('全メニュークーポン')).closest('button')!;
    fireEvent.click(couponButton);
    expect(screen.getByText('✓ 選択中')).toBeInTheDocument();
    // 自動選択は発生しない
    expect(screen.queryByText(/自動選択しました/)).not.toBeInTheDocument();
    expect(screen.getByText('メニューを1つ以上選択してください')).toBeInTheDocument();
  });

  test('対象メニューIDが menus に存在しない（削除済み等）場合は自動選択せずクラッシュもしない', async () => {
    render(
      <BookingFlow
        facility={FACILITY}
        staff={[]}
        menus={[MENU_A, MENU_B]}
        coupons={[RESTRICTED_COUPON]}
        couponMenuMap={{ 'coupon-1': ['menu-deleted'] }}
      />
    );
    const couponButton = (await screen.findByText('カット限定クーポン')).closest('button')!;
    fireEvent.click(couponButton);
    expect(screen.getByText('✓ 選択中')).toBeInTheDocument();
    expect(screen.queryByText(/自動選択しました/)).not.toBeInTheDocument();
    expect(screen.getByText('メニューを1つ以上選択してください')).toBeInTheDocument();
  });

  test('選択済みクーポンをもう一度クリックすると選択解除される（自動選択済みメニューは残す）', async () => {
    render(
      <BookingFlow
        facility={FACILITY}
        staff={[]}
        menus={[MENU_A, MENU_B]}
        coupons={[RESTRICTED_COUPON]}
        couponMenuMap={{ 'coupon-1': ['menu-a'] }}
      />
    );
    const couponButton = (await screen.findByText('カット限定クーポン')).closest('button')!;
    fireEvent.click(couponButton);
    await screen.findByText(/自動選択しました/);
    expect(screen.getByText('✓ 選択中')).toBeInTheDocument();

    fireEvent.click(couponButton);
    expect(screen.queryByText('✓ 選択中')).not.toBeInTheDocument();
    // メニュー選択は残る（ユーザーが選び直す手間を発生させない）
    expect(screen.getByText('1件選択中')).toBeInTheDocument();
  });
});

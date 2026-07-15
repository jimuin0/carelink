/**
 * @jest-environment jsdom
 *
 * 【2026年7月15日 HPB準拠仕様】メニュー担当スタッフ制(menu_staff)の予約画面UI回帰テスト。
 * サーバー(src/app/api/booking/route.ts)の意味論＝「menu_staffに行があるメニューは担当スタッフ限定・
 * 行が無い(0行)メニューは全スタッフ対応」と同一の判定を、UIでも指名セレクトの disabled・指名の
 * 自動解除・おまかせ集計対象の絞込として反映する。menuStaffMap は page.tsx が getMenuStaffByMenuIds
 * 経由で渡す想定のprop。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BookingFlow from '../BookingFlow';
import type { FacilityMenu, StaffProfile } from '@/types';

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

function staffProfile(id: string, name: string): StaffProfile {
  return { id, facility_id: 'fac-1', name, position: 'スタイリスト', nomination_fee: 0 } as StaffProfile;
}

const MENU_A = menu('menu-a', 'カット'); // 担当制メニュー
const MENU_B = menu('menu-b', 'カラー'); // 無制限メニュー
const STAFF_1 = staffProfile('staff-1', '山田'); // menu-a の担当
const STAFF_2 = staffProfile('staff-2', '佐藤'); // menu-a の担当外

beforeEach(() => {
  jest.clearAllMocks();
  // 空き状況 effect が走っても落ちないよう空スロットを返す（本テストは指名セレクトの検証が主）。
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ slots: [] }) })
  ) as unknown as typeof fetch;
});

async function goToDatetime(menuName: string) {
  fireEvent.click(screen.getByText('メニューから選ぶ'));
  fireEvent.click(await screen.findByText(menuName));
  fireEvent.click(screen.getByText('次へ（日時を選ぶ）'));
  await screen.findByText('日時を選択');
}

describe('指名セレクトの担当スタッフ絞込(menu_staff)', () => {
  test('担当制メニュー選択中 → 担当外スタッフは disabled かつ「(選択中メニュー対象外)」表示', async () => {
    render(
      <BookingFlow
        facility={FACILITY}
        staff={[STAFF_1, STAFF_2]}
        menus={[MENU_A, MENU_B]}
        coupons={[]}
        menuStaffMap={{ 'menu-a': ['staff-1'] }}
      />
    );
    await goToDatetime('カット');

    const opt1 = screen.getByRole('option', { name: /山田/ }) as HTMLOptionElement;
    const opt2 = screen.getByRole('option', { name: /佐藤/ }) as HTMLOptionElement;
    expect(opt1.disabled).toBe(false);
    expect(opt2.disabled).toBe(true);
    expect(opt2.textContent).toContain('選択中メニュー対象外');
  });

  test('無制限メニュー(menu_staff行なし)のみ選択 → 全スタッフが選択可能', async () => {
    render(
      <BookingFlow
        facility={FACILITY}
        staff={[STAFF_1, STAFF_2]}
        menus={[MENU_A, MENU_B]}
        coupons={[]}
        menuStaffMap={{ 'menu-a': ['staff-1'] }}
      />
    );
    await goToDatetime('カラー'); // menu-b は menuStaffMap にキー無し＝無制限

    const opt1 = screen.getByRole('option', { name: /山田/ }) as HTMLOptionElement;
    const opt2 = screen.getByRole('option', { name: /佐藤/ }) as HTMLOptionElement;
    expect(opt1.disabled).toBe(false);
    expect(opt2.disabled).toBe(false);
  });

  test('menuStaffMap 未指定(空)なら従来どおり全スタッフ選択可能（後方互換）', async () => {
    render(
      <BookingFlow
        facility={FACILITY}
        staff={[STAFF_1, STAFF_2]}
        menus={[MENU_A, MENU_B]}
        coupons={[]}
      />
    );
    await goToDatetime('カット');

    const opt2 = screen.getByRole('option', { name: /佐藤/ }) as HTMLOptionElement;
    expect(opt2.disabled).toBe(false);
  });
});

describe('指名中スタッフの自動解除(menu_staff)', () => {
  test('指名中スタッフが引き続き全選択メニューを担当できる変更では自動解除しない（誤爆防止）', async () => {
    // menu-a・menu-b とも staff-1 が担当。メニューを増減しても staff-1 は適合し続ける。
    render(
      <BookingFlow
        facility={FACILITY}
        staff={[STAFF_1, STAFF_2]}
        menus={[MENU_A, MENU_B]}
        coupons={[]}
        menuStaffMap={{ 'menu-a': ['staff-1'], 'menu-b': ['staff-1'] }}
      />
    );
    await goToDatetime('カラー'); // menu-b（staff-1 担当）

    const select = screen.getByLabelText('スタッフ指名') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'staff-1' } });
    expect(select.value).toBe('staff-1');

    // カット(menu-a=staff-1 も担当)を追加。staff-1 は両方担当 → 自動解除は起きない。
    fireEvent.click(screen.getByText('戻る'));
    fireEvent.click(screen.getByText('メニューから選ぶ'));
    fireEvent.click(screen.getByText('カット'));
    fireEvent.click(screen.getByText('次へ（日時を選ぶ）'));
    await screen.findByText('日時を選択');

    expect(screen.queryByText(/指名を解除しました/)).not.toBeInTheDocument();
    const select2 = screen.getByLabelText('スタッフ指名') as HTMLSelectElement;
    expect(select2.value).toBe('staff-1');
  });

  test('担当スタッフ指名後に、その人が担当しない別の担当制メニューへ変更 → 指名を自動解除', async () => {
    // menu-a は staff-2 のみ担当・menu-b は staff-1 のみ担当。
    render(
      <BookingFlow
        facility={FACILITY}
        staff={[STAFF_1, STAFF_2]}
        menus={[MENU_A, MENU_B]}
        coupons={[]}
        menuStaffMap={{ 'menu-a': ['staff-2'], 'menu-b': ['staff-1'] }}
      />
    );
    await goToDatetime('カラー'); // menu-b（staff-1 担当）

    const select = screen.getByLabelText('スタッフ指名') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'staff-1' } });
    expect(select.value).toBe('staff-1');

    // メニューをカラー(menu-b)→カット(menu-a=staff-2 のみ)へ切替。staff-1 は menu-a 担当外 → 自動解除。
    fireEvent.click(screen.getByText('戻る'));
    fireEvent.click(screen.getByText('メニューから選ぶ'));
    fireEvent.click(screen.getByText('カラー')); // menu-b 解除
    fireEvent.click(screen.getByText('カット')); // menu-a 選択（staff-1 は担当外）

    expect(await screen.findByText(/指名を解除しました/)).toBeInTheDocument();
  });
});

describe('おまかせ集計の担当スタッフ絞込(menu_staff)', () => {
  test('おまかせ時、担当制メニューの担当スタッフのみ /api/slots を叩く（担当外スタッフの空きを集計しない）', async () => {
    const fetchMock = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ slots: [] }) })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <BookingFlow
        facility={FACILITY}
        staff={[STAFF_1, STAFF_2]}
        menus={[MENU_A, MENU_B]}
        coupons={[]}
        menuStaffMap={{ 'menu-a': ['staff-1'] }} // menu-a は staff-1 のみ担当
      />
    );
    await goToDatetime('カット'); // 担当制メニュー・指名なし（おまかせ）

    // 表示中の7日 × 担当スタッフ(staff-1 のみ)＝ staff-1 の URL のみ叩かれ、staff-2 は叩かれない。
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('staffId=staff-1'))).toBe(true);
    expect(urls.some((u) => u.includes('staffId=staff-2'))).toBe(false);
  });

  test('無制限メニューのおまかせ時は全スタッフの /api/slots を叩く（後方互換）', async () => {
    const fetchMock = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ slots: [] }) })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <BookingFlow
        facility={FACILITY}
        staff={[STAFF_1, STAFF_2]}
        menus={[MENU_A, MENU_B]}
        coupons={[]}
        menuStaffMap={{ 'menu-a': ['staff-1'] }}
      />
    );
    await goToDatetime('カラー'); // menu-b は無制限

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('staffId=staff-1'))).toBe(true);
    expect(urls.some((u) => u.includes('staffId=staff-2'))).toBe(true);
  });
});

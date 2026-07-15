/**
 * @jest-environment jsdom
 *
 * 【2026年7月15日 回帰】
 * defect2: 当日がカレンダーの先頭列に表示され「本日」ラベルが付くこと（旧実装は翌日始まりで
 *   当日がUIから到達不能だった）。
 * defect5: Step2（日時選択）上部に選択中メニュー・スタッフ・所要時間・合計金額の常時サマリが
 *   表示されること（旧実装はゼロ）。
 * defect7: 空き状況マトリクスのセル（ボタン）のタップターゲットが44px以上であること（旧40px）。
 * defect4: 確認ステップにキャンセルポリシーが表示される（未設定施設ではグレースフルに非表示）こと。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import BookingFlow from '../BookingFlow';
import type { FacilityMenu, StaffProfile, Coupon } from '@/types';
import type { CancelPolicy } from '@/lib/cancel-fee';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [] }) }) }),
  }),
}));

const FACILITY = { id: 'fac-1', slug: 'test-salon', name: 'テストサロン' };
const MENUS: FacilityMenu[] = [
  {
    id: 'menu-1', facility_id: 'fac-1', category: 'カット', name: 'カット', description: null,
    price: 5000, price_note: null, duration_minutes: 60, photo_url: null, is_featured: false, sort_order: 0,
  } as FacilityMenu,
];
const COUPONS: Coupon[] = [];

async function goToDatetimeStep() {
  fireEvent.click(await screen.findByText('カット'));
  fireEvent.click(screen.getByText('次へ（日時を選ぶ）'));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('defect2: 当日予約がカレンダー先頭から到達可能', () => {
  test('週マトリクスの先頭列（1列目）が「翌日」ではなく当日（現在のJST日付）になり「本日」ラベルが付く', async () => {
    // 2026-07-15 12:00 JST（= 2026-07-15T03:00:00Z）に固定。2026-07-15は水曜日。
    // 旧実装（i + 1）だとここで先頭列は 7/16（木）になってしまう＝この回帰を検知する核心の assertion。
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 15, 3, 0, 0));
    try {
      // スタッフ0件＝空き状況effectは早期returnしfetchしないが、日付ヘッダ自体は
      // dateOptions（当日始まり）から常に描画されるため、ヘッダの検証だけならfetchモック不要。
      const { container } = render(<BookingFlow facility={FACILITY} staff={[]} menus={MENUS} coupons={COUPONS} />);
      await goToDatetimeStep();
      await screen.findByText('日時を選択');

      // thead 内の th は [0]=左上の空きスペーサー, [1]=先頭の日付列。
      const headerCells = container.querySelectorAll('thead th');
      const firstDateHeader = headerCells[1];
      expect(firstDateHeader.textContent).toContain('本日');
      expect(firstDateHeader.textContent).toContain('7/15');
      expect(firstDateHeader.textContent).toContain('水');
      // 翌日始まりの旧実装への回帰でないことも明示的に確認する。
      expect(firstDateHeader.textContent).not.toContain('7/16');
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe('defect5: Step2上部の選択中サマリ', () => {
  test('選択中のメニュー名・所要時間・合計金額・指名状態が日時ステップ上部に常時表示される', async () => {
    render(<BookingFlow facility={FACILITY} staff={[]} menus={MENUS} coupons={COUPONS} />);
    await goToDatetimeStep();
    await screen.findByText('選択中の内容');
    expect(screen.getByText('カット')).toBeInTheDocument();
    expect(screen.getByText('60分')).toBeInTheDocument();
    expect(screen.getByText('合計 ¥5,000')).toBeInTheDocument();
    expect(screen.getByText('指名なし（おまかせ）')).toBeInTheDocument();
  });
});

describe('defect7: マトリクスセルのタップターゲットが44px以上', () => {
  test('空き状況セルのボタンに min-h-[44px] クラスが付与される', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ slots: [{ slot_start: '10:00:00', slot_end: '11:00:00', staff_id: 'staff-1' }] }) })
    ) as unknown as typeof fetch;
    const STAFF: StaffProfile[] = [
      { id: 'staff-1', facility_id: 'fac-1', name: '山田', position: null, nomination_fee: 0 } as StaffProfile,
    ];

    render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
    await goToDatetimeStep();

    const cell = (await screen.findAllByText('△'))[0];
    expect(cell.closest('button')).toHaveClass('min-h-[44px]');
  });
});

describe('defect4: キャンセルポリシー表示（確認ステップ）', () => {
  const STAFF: StaffProfile[] = [
    { id: 'staff-1', facility_id: 'fac-1', name: '山田', position: null, nomination_fee: 0 } as StaffProfile,
  ];

  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ slots: [{ slot_start: '10:00:00', slot_end: '11:00:00', staff_id: 'staff-1' }] }) })
    ) as unknown as typeof fetch;
  });

  async function goToConfirmStep(cancelPolicy?: CancelPolicy | null) {
    render(
      <BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} cancelPolicy={cancelPolicy} />
    );
    await goToDatetimeStep();
    const cell = (await screen.findAllByText('△'))[0];
    fireEvent.click(cell);
    fireEvent.click(screen.getByText('次へ（確認・予約）'));
    await screen.findByText('予約内容の確認・お客様情報');
  }

  test('cancelPolicy が未設定（undefined）の施設では表示されない', async () => {
    await goToConfirmStep(undefined);
    expect(screen.queryByText('キャンセルポリシー')).not.toBeInTheDocument();
  });

  test('cancelPolicy が null（未設定施設）では表示されない', async () => {
    await goToConfirmStep(null);
    expect(screen.queryByText('キャンセルポリシー')).not.toBeInTheDocument();
  });

  test('cancelPolicy 設定済みの施設では数値ベースの説明文＋補足テキストが表示される', async () => {
    await goToConfirmStep({
      free_cancel_hours: 24,
      late_cancel_rate: 50,
      no_show_rate: 100,
      policy_text: '当日キャンセルはご遠慮ください。',
    });
    expect(screen.getByText('キャンセルポリシー')).toBeInTheDocument();
    expect(
      screen.getByText('予約日時の24時間前まで無料でキャンセルできます。それ以降のキャンセルは施術料金の50%をキャンセル料として承ります。')
    ).toBeInTheDocument();
    expect(screen.getByText('当日キャンセルはご遠慮ください。')).toBeInTheDocument();
  });

  test('policy_text が null でも数値ベースの説明文だけは表示される（補足文は非表示）', async () => {
    await goToConfirmStep({
      free_cancel_hours: 0,
      late_cancel_rate: 100,
      no_show_rate: 100,
      policy_text: null,
    });
    expect(screen.getByText('キャンセルの場合、施術料金の100%をキャンセル料として承ります。')).toBeInTheDocument();
  });
});

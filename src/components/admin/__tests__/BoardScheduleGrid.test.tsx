/**
 * @jest-environment jsdom
 *
 * BoardScheduleGrid の挙動テスト（クライアント）。
 * - 空き帯クリックでモーダルが開く
 * - 終了が営業終了を超える場合は確定ボタン無効＋警告＋ fetch を呼ばない（API 400 予防）
 * - 正常時は /api/admin/bookings へ正しいペイロードで POST する
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BoardScheduleGrid, { type BoardRow, type BoardMenu } from '@/components/admin/BoardScheduleGrid';

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

const rows: BoardRow[] = [{ key: 's1', name: '佐藤', position: null, chips: [] }];
const menuShort: BoardMenu[] = [{ id: 'm1', name: 'カット', price: 5000, duration_minutes: 30 }];

function setup(menus: BoardMenu[] = menuShort) {
  return render(
    <BoardScheduleGrid facilityId="f1" date="2026-07-01" openHour={8} closeHour={22} rows={rows} menus={menus} />,
  );
}

function setupRows(boardRows: BoardRow[]) {
  return render(
    <BoardScheduleGrid facilityId="f1" date="2026-07-01" openHour={8} closeHour={22} rows={boardRows} menus={menuShort} />,
  );
}

beforeEach(() => {
  // jsdom はレイアウトを持たず getBoundingClientRect が 0 を返すため width を与える
  Element.prototype.getBoundingClientRect = jest.fn(
    () => ({ left: 0, width: 840, top: 0, right: 840, bottom: 56, height: 56, x: 0, y: 0, toJSON: () => {} }) as DOMRect,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('空き帯クリックでモーダルが開く（クリック位置→開始時刻）', async () => {
  setup();
  // 左端クリック → 08:00 開始
  fireEvent.click(screen.getByTitle('クリックで新規予約'), { clientX: 0 });
  expect(await screen.findByText('新規予約（佐藤）')).toBeInTheDocument();
  expect(screen.getByText(/08:00〜/)).toBeInTheDocument();
});

test('終了が営業終了(22:00)を超えると確定不可・警告表示・fetch を呼ばない', async () => {
  const user = userEvent.setup();
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  setup();
  // 右端クリック → 22:00 開始
  fireEvent.click(screen.getByTitle('クリックで新規予約'), { clientX: 840 });
  await screen.findByText('新規予約（佐藤）');
  // 30分メニュー選択 → 終了 22:30 > 22:00
  await user.click(screen.getByRole('checkbox'));
  expect(screen.getByText(/営業終了/)).toBeInTheDocument();
  const confirm = screen.getByRole('button', { name: '予約を確定' });
  expect(confirm).toBeDisabled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('正常作成で /api/admin/bookings へ正しいペイロードで POST する', async () => {
  const user = userEvent.setup();
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, id: 'b1' }) });
  global.fetch = fetchMock as unknown as typeof fetch;
  setup();
  fireEvent.click(screen.getByTitle('クリックで新規予約'), { clientX: 0 }); // 08:00
  await screen.findByText('新規予約（佐藤）');
  await user.click(screen.getByRole('checkbox')); // カット(30分)
  await user.type(screen.getAllByRole('textbox')[0], '山田花子'); // お客様名
  await user.click(screen.getByRole('button', { name: '予約を確定' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const opts = fetchMock.mock.calls[0][1] as { body: string };
  expect(JSON.parse(opts.body)).toMatchObject({
    facility_id: 'f1',
    staff_id: 's1',
    menu_ids: ['m1'],
    booking_date: '2026-07-01',
    start_time: '08:00',
    end_time: '08:30',
    customer_name: '山田花子',
  });
});

test('時間重複する2予約が両方表示される（レーン分割で隠れない・R2）', () => {
  setupRows([{ key: 's1', name: '佐藤', position: null, chips: [
    { id: 'b1', customer_name: '田中', start_time: '10:00', end_time: '11:00', status: 'confirmed', menuName: 'カット' },
    { id: 'b2', customer_name: '鈴木', start_time: '10:30', end_time: '11:30', status: 'pending', menuName: 'カラー' },
  ] }]);
  expect(screen.getByText('田中 様')).toBeInTheDocument();
  expect(screen.getByText('鈴木 様')).toBeInTheDocument();
});

test('営業時間外の予約は「営業時間外 N件」バッジで可視化される（R3）', () => {
  setupRows([{ key: 's1', name: '佐藤', position: null, chips: [
    { id: 'b3', customer_name: '早朝', start_time: '07:00', end_time: '07:30', status: 'confirmed', menuName: null },
  ] }]);
  expect(screen.getByText('営業時間外 1件')).toBeInTheDocument();
  // 枠外チップ本体はトラックに帯表示されない（バッジで存在を示す）
  expect(screen.queryByText('早朝 様')).not.toBeInTheDocument();
});

test('お客様名が空だと送信されない', async () => {
  const user = userEvent.setup();
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  setup();
  fireEvent.click(screen.getByTitle('クリックで新規予約'), { clientX: 0 });
  await screen.findByText('新規予約（佐藤）');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: '予約を確定' }));
  expect(screen.getByText('お客様名を入力してください')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

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

const rows: BoardRow[] = [{ key: 's1', name: '佐藤', position: null, nominationFee: 0, chips: [] }];
const menuShort: BoardMenu[] = [{ id: 'm1', name: 'カット', price: 5000, duration_minutes: 30 }];

function setup(menus: BoardMenu[] = menuShort, slotMinutes = 60) {
  return render(
    <BoardScheduleGrid facilityId="f1" date="2026-07-01" openHour={8} closeHour={22} rows={rows} menus={menus} slotMinutes={slotMinutes} />,
  );
}

function setupRows(boardRows: BoardRow[]) {
  return render(
    <BoardScheduleGrid facilityId="f1" date="2026-07-01" openHour={8} closeHour={22} rows={boardRows} menus={menuShort} slotMinutes={60} />,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => '66666666-6666-4666-8666-666666666666' });
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
  fireEvent.click(screen.getByRole('button', { name: /新規予約を追加/ }), { clientX: 0 });
  expect(await screen.findByText('新規予約（佐藤）')).toBeInTheDocument();
  expect(screen.getByText(/08:00〜/)).toBeInTheDocument();
});

test('slotMinutes=60 では 08:40 相当クリックが 08:00 にスナップ（1時間刻み）', async () => {
  // width=840, totalMin=840 → clientX=40 が開店+40分(08:40)。slot=60 で floor→08:00。
  setup(menuShort, 60);
  fireEvent.click(screen.getByRole('button', { name: /新規予約を追加/ }), { clientX: 40 });
  expect(await screen.findByText('新規予約（佐藤）')).toBeInTheDocument();
  expect(screen.getByText(/08:00〜/)).toBeInTheDocument();
});

test('slotMinutes=30 では 08:40 相当クリックが 08:30 にスナップ（店舗設定の刻みが反映）', async () => {
  setup(menuShort, 30);
  fireEvent.click(screen.getByRole('button', { name: /新規予約を追加/ }), { clientX: 40 });
  expect(await screen.findByText('新規予約（佐藤）')).toBeInTheDocument();
  expect(screen.getByText(/08:30〜/)).toBeInTheDocument();
});

test('スクロール/ドラッグ（pointer 移動量>しきい値）はタップ扱いせずモーダルを開かない（T10）', () => {
  setup();
  const track = screen.getByRole('button', { name: /新規予約を追加/ });
  // down→大きく移動して click（スクロール相当）。jsdom で確実に座標が伝わる mouseDown で検証。
  fireEvent.mouseDown(track, { clientX: 0, clientY: 0 });
  fireEvent.click(track, { clientX: 60, clientY: 60 });
  expect(screen.queryByText('新規予約（佐藤）')).not.toBeInTheDocument();
});

test('クリーンなタップ（pointerdown と同位置で click）はモーダルを開く（T10 回帰防止）', async () => {
  setup();
  const track = screen.getByRole('button', { name: /新規予約を追加/ });
  fireEvent.mouseDown(track, { clientX: 0, clientY: 0 });
  fireEvent.click(track, { clientX: 0, clientY: 0 });
  expect(await screen.findByText('新規予約（佐藤）')).toBeInTheDocument();
});

test('終了が営業終了(22:00)を超えると確定不可・警告表示・fetch を呼ばない', async () => {
  const user = userEvent.setup();
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  setup();
  // 右端クリック → 22:00 開始
  fireEvent.click(screen.getByRole('button', { name: /新規予約を追加/ }), { clientX: 840 });
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
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, id: '77777777-7777-4777-8777-777777777777' }) });
  global.fetch = fetchMock as unknown as typeof fetch;
  setup();
  fireEvent.click(screen.getByRole('button', { name: /新規予約を追加/ }), { clientX: 0 }); // 08:00
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
  setupRows([{ key: 's1', name: '佐藤', position: null, nominationFee: 0, chips: [
    { id: 'b1', customer_name: '田中', start_time: '10:00', end_time: '11:00', status: 'confirmed', menuName: 'カット' },
    { id: 'b2', customer_name: '鈴木', start_time: '10:30', end_time: '11:30', status: 'pending', menuName: 'カラー' },
  ] }]);
  expect(screen.getByText('田中 様')).toBeInTheDocument();
  expect(screen.getByText('鈴木 様')).toBeInTheDocument();
});

test('営業時間外の予約は「営業時間外 N件」バッジで可視化される（R3）', () => {
  setupRows([{ key: 's1', name: '佐藤', position: null, nominationFee: 0, chips: [
    { id: 'b3', customer_name: '早朝', start_time: '07:00', end_time: '07:30', status: 'confirmed', menuName: null },
  ] }]);
  expect(screen.getByText('営業時間外 1件')).toBeInTheDocument();
  // 枠外チップ本体はトラックに帯表示されない（バッジで存在を示す）
  expect(screen.queryByText('早朝 様')).not.toBeInTheDocument();
});

test('空き帯は role=button でキーボード(Enter)から予約モーダルを開ける（R5）', async () => {
  const user = userEvent.setup();
  setup();
  const track = screen.getByRole('button', { name: /新規予約を追加/ });
  track.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByText('新規予約（佐藤）')).toBeInTheDocument();
});

test('モーダルは role=dialog/aria-modal を持ち、開いた時にお客様名へ初期フォーカス（R6）', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: /新規予約を追加/ }), { clientX: 0 });
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByLabelText(/お客様名/)).toHaveFocus();
});

test('ESC でモーダルが閉じる（未入力時・R6）', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: /新規予約を追加/ }), { clientX: 0 });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('入力途中の閉じは破棄確認（ConfirmDialog）し、「編集を続ける」で閉じない（R7/T14）', async () => {
  const user = userEvent.setup();
  setup();
  fireEvent.click(screen.getByRole('button', { name: /新規予約を追加/ }), { clientX: 0 });
  await user.type(screen.getByLabelText(/お客様名/), '田中');
  fireEvent.keyDown(document, { key: 'Escape' });
  // window.confirm でなく共通 ConfirmDialog が出る
  expect(screen.getByText('入力内容を破棄して閉じますか？')).toBeInTheDocument();
  // 「編集を続ける」で破棄確認を閉じ、予約モーダルは残る
  await user.click(screen.getByRole('button', { name: '編集を続ける' }));
  expect(screen.queryByText('入力内容を破棄して閉じますか？')).not.toBeInTheDocument();
  expect(screen.getByText('新規予約（佐藤）')).toBeInTheDocument();
});

test('破棄確認で「破棄して閉じる」を押すとモーダルが閉じる（T14）', async () => {
  const user = userEvent.setup();
  setup();
  fireEvent.click(screen.getByRole('button', { name: /新規予約を追加/ }), { clientX: 0 });
  await user.type(screen.getByLabelText(/お客様名/), '田中');
  fireEvent.keyDown(document, { key: 'Escape' });
  await user.click(screen.getByRole('button', { name: '破棄して閉じる' }));
  expect(screen.queryByText('新規予約（佐藤）')).not.toBeInTheDocument();
});

const twoStaff: BoardRow[] = [
  { key: 's1', name: '佐藤', position: null, nominationFee: 0, chips: [] },
  { key: 's2', name: '田村', position: null, nominationFee: 1000, chips: [] },
];

test('指名料が合計に反映される（M1）', async () => {
  const user = userEvent.setup();
  setupRows(twoStaff);
  // 田村（指名料1000）の行を開く
  fireEvent.click(screen.getAllByRole('button', { name: /新規予約を追加/ })[1], { clientX: 0 });
  await screen.findByText('新規予約（田村）');
  await user.click(screen.getByRole('checkbox')); // カット ¥5,000
  expect(screen.getByText('¥6,000')).toBeInTheDocument(); // 5000 + 指名料1000
  expect(screen.getByText('うち指名料')).toBeInTheDocument();
});

test('担当をモーダル内で変更でき payload に反映される（M3）', async () => {
  const user = userEvent.setup();
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, id: '77777777-7777-4777-8777-777777777777' }) });
  global.fetch = fetchMock as unknown as typeof fetch;
  setupRows(twoStaff);
  fireEvent.click(screen.getAllByRole('button', { name: /新規予約を追加/ })[0], { clientX: 0 }); // 佐藤で開く
  await screen.findByText('新規予約（佐藤）');
  await user.selectOptions(screen.getByLabelText('担当'), 's2'); // 田村へ変更
  await user.click(screen.getByRole('checkbox'));
  await user.type(screen.getByLabelText(/お客様名/), '山田');
  await user.click(screen.getByRole('button', { name: '予約を確定' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body).staff_id).toBe('s2');
});

test('メール形式が不正だと送信されない（M4）', async () => {
  const user = userEvent.setup();
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  setup();
  fireEvent.click(screen.getByRole('button', { name: /新規予約を追加/ }), { clientX: 0 });
  await user.type(screen.getByLabelText(/お客様名/), '山田');
  await user.click(screen.getByRole('checkbox'));
  await user.type(screen.getByLabelText(/メール/), 'bad-email');
  await user.click(screen.getByRole('button', { name: '予約を確定' }));
  expect(screen.getByText(/メールアドレスの形式/)).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('お客様名が空だと送信されない', async () => {
  const user = userEvent.setup();
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  setup();
  fireEvent.click(screen.getByRole('button', { name: /新規予約を追加/ }), { clientX: 0 });
  await screen.findByText('新規予約（佐藤）');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: '予約を確定' }));
  expect(screen.getByText('お客様名を入力してください')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('成否不明の再送は同一ID・同一本文。入力を凍結し連打・閉じるを拒否', async () => {
  const user = userEvent.setup();
  let settle!: (value: unknown) => void;
  const fetchMock = jest.fn().mockRejectedValueOnce(new Error('response lost'))
    .mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  global.fetch = fetchMock as unknown as typeof fetch;
  setup();
  fireEvent.click(screen.getByRole('button', { name: /新規予約を追加/ }), { clientX: 0 });
  await user.type(screen.getByLabelText(/お客様名/), '合成テスト');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: '予約を確定' }));
  await screen.findByRole('button', { name: '同じ操作で再確認' });
  expect(screen.getByLabelText(/お客様名/)).toBeDisabled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  const retry = screen.getByRole('button', { name: '同じ操作で再確認' });
  fireEvent.click(retry); fireEvent.click(retry);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
  expect(sessionStorage.getItem('carelink-manual-booking:f1')).toBe('66666666-6666-4666-8666-666666666666');
  expect(sessionStorage.getItem('carelink-manual-booking:f1')).not.toContain('合成');
  settle({ ok: true, json: async () => ({ success: true, id: '77777777-7777-4777-8777-777777777777' }) });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(sessionStorage.getItem('carelink-manual-booking:f1')).toBeNull();
});

test('再読込で元の入力を失っても保存済み原操作をGET照合し、新規POSTしない', async () => {
  sessionStorage.setItem('carelink-manual-booking:f1', '66666666-6666-4666-8666-666666666666');
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ state: 'saved', booking_id: '77777777-7777-4777-8777-777777777777' }) });
  global.fetch = fetchMock as unknown as typeof fetch;
  setup();
  fireEvent.click(screen.getByRole('button', { name: /新規予約を追加/ }), { clientX: 0 });
  fireEvent.click(screen.getByRole('button', { name: '予約を確定' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toContain('operation_id=66666666');
  expect(fetchMock.mock.calls[0][1]).toEqual({ cache: 'no-store' });
});

test('照合失敗は不在とみなさずPOSTしない。保存不能も送信前に止める', async () => {
  const fetchMock = jest.fn().mockRejectedValue(new Error('unavailable'));
  global.fetch = fetchMock as unknown as typeof fetch;
  sessionStorage.setItem('carelink-manual-booking:f1', '66666666-6666-4666-8666-666666666666');
  const view = setup();
  fireEvent.click(screen.getByRole('button', { name: /新規予約を追加/ }), { clientX: 0 });
  fireEvent.click(screen.getByRole('button', { name: '予約を確定' }));
  await screen.findByText(/原操作の結果を確認できません/);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText(/お客様名/)).toBeDisabled();
  view.unmount(); sessionStorage.clear(); fetchMock.mockClear();
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage disabled'); });
  setup();
  fireEvent.click(screen.getByRole('button', { name: /新規予約を追加/ }), { clientX: 0 });
  fireEvent.click(screen.getByRole('button', { name: '予約を確定' }));
  await screen.findByText(/安全に保存できないため送信しません/);
  expect(fetchMock).not.toHaveBeenCalled();
});
test('原操作競合後は本文を再POSTせずGETで保存済み結果を確認する', async () => {
  const user = userEvent.setup();
  const fetchMock = jest.fn().mockResolvedValueOnce({ ok:false,status:409,json:async () => ({ code:'MANUAL_OPERATION_RECOVERY' }) })
    .mockResolvedValueOnce({ ok:true,json:async () => ({ state:'saved',booking_id:'77777777-7777-4777-8777-777777777777' }) });
  global.fetch = fetchMock as unknown as typeof fetch;
  setup(); fireEvent.click(screen.getByRole('button',{ name:/新規予約を追加/ }),{ clientX:0 });
  await user.type(screen.getByLabelText(/お客様名/),'合成テスト'); await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button',{ name:'予約を確定' }));
  await screen.findByText(/原操作を照合します/);
  await user.click(screen.getByRole('button',{ name:'同じ操作で再確認' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1]).toEqual({ cache:'no-store' });
});
test('操作IDのsetItem失敗は送信前に止まり、入力を結果不明として凍結しない', async () => {
  const user = userEvent.setup(); const fetchMock = jest.fn(); global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(Storage.prototype,'setItem').mockImplementation(() => { throw new Error('storage full'); });
  setup(); fireEvent.click(screen.getByRole('button',{ name:/新規予約を追加/ }),{ clientX:0 });
  await user.type(screen.getByLabelText(/お客様名/),'合成テスト'); await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button',{ name:'予約を確定' }));
  await screen.findByText(/安全に保存できないため送信しません/);
  expect(fetchMock).not.toHaveBeenCalled(); expect(screen.getByLabelText(/お客様名/)).not.toBeDisabled();
});

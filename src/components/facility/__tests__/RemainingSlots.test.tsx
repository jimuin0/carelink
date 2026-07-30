/**
 * @jest-environment jsdom
 *
 * 施設ページ「本日の空き状況」バッジの表示契約。
 *
 * 【2026年7月30日 是正・本番実測で発覚した2つの虚偽表示】
 * 旧実装は /api/availability の `slots`（status 判定用に 3 で丸めた内部値）を
 * そのまま「本日残り{n}枠」と表示していた。
 *   - ハル 豊中本店／イマイビル店：実際 45 枠空いていたのに「本日残り3枠」を赤字点滅で表示
 *   - 訪問専門 神原鍼灸院（木曜が定休）：0 枠が full 扱いで「本日満枠」と表示
 * 数値を出す限り丸め方の変更で再発するため、表示根拠を status のみに変えた。
 * 本テストは「丸めた数値を客に見せない」ことと「休業を満席と言わない」ことを固定する。
 *
 * 監査F13: 本日空きなし時に「キャンセル待ち登録（近日公開）」表示を出す（登録UI自体は未実装）。
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import RemainingSlots from '@/components/facility/RemainingSlots';

/** status（と、表示に使われてはいけない slots）を返す /api/availability のモック。 */
function mockFetchWithStatus(status: string | undefined, slots = 0) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      return { dates: { [today]: { slots, status } } };
    },
  }) as unknown as typeof fetch;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('closed（定休日）→ 「本日休業」。満席とは言わない', async () => {
  mockFetchWithStatus('closed');
  render(<RemainingSlots facilityId="f1" />);
  await waitFor(() => expect(screen.getByText('本日休業')).toBeInTheDocument());
  expect(screen.queryByText(/満枠|満席|空きなし/)).not.toBeInTheDocument();
  // 休業日にキャンセル待ちを示唆しない
  expect(screen.queryByText(/キャンセル待ち登録/)).not.toBeInTheDocument();
});

test('full（営業日で空きゼロ）→ 「本日空きなし」＋キャンセル待ち近日公開', async () => {
  mockFetchWithStatus('full');
  render(<RemainingSlots facilityId="f1" />);
  await waitFor(() => expect(screen.getByText(/本日空きなし/)).toBeInTheDocument());
  expect(screen.getByText(/キャンセル待ち登録：近日公開/)).toBeInTheDocument();
});

test('few → 「本日残りわずか」。具体的な枠数は出さない', async () => {
  mockFetchWithStatus('few', 2);
  render(<RemainingSlots facilityId="f1" />);
  await waitFor(() => expect(screen.getByText('本日残りわずか')).toBeInTheDocument());
  expect(screen.queryByText(/残り\d+枠/)).not.toBeInTheDocument();
});

test('available → 何も表示しない（煽らない）', async () => {
  mockFetchWithStatus('available', 3);
  const { container } = render(<RemainingSlots facilityId="f1" />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test('past（過去日）→ 何も表示しない', async () => {
  mockFetchWithStatus('past');
  const { container } = render(<RemainingSlots facilityId="f1" />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

// 【回帰防止の本丸】slots は丸めた内部値。これが表示に混ざると誤った希少性の演出が復活する。
test('slots が大きくても数値は一切表示しない（丸め値の literal 表示を禁じる）', async () => {
  mockFetchWithStatus('few', 45);
  const { container } = render(<RemainingSlots facilityId="f1" />);
  await waitFor(() => expect(screen.getByText('本日残りわずか')).toBeInTheDocument());
  expect(container.textContent).not.toMatch(/\d/);
});

test('status が無い応答 → 何も表示しない（旧形式にフォールバックして嘘をつかない）', async () => {
  mockFetchWithStatus(undefined, 3);
  const { container } = render(<RemainingSlots facilityId="f1" />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test('fetch失敗 → 何も表示しない', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;
  const { container } = render(<RemainingSlots facilityId="f1" />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test('応答が ok でない → 何も表示しない', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;
  const { container } = render(<RemainingSlots facilityId="f1" />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

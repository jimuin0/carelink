/**
 * @jest-environment jsdom
 *
 * CancelPolicySettings の保存エラー挙動テスト。
 * - upsert 成功 → 「保存しました」表示
 * - upsert 失敗 → エラー表示し、成功表示は出さない（返金率ポリシーの成功偽装を防ぐ・回帰防止）
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CancelPolicySettings from '@/components/admin/CancelPolicySettings';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));

const LOAD_DATA = { free_cancel_hours: 24, late_cancel_rate: 50, no_show_rate: 100, policy_text: '' };

function mockClient(upsertError: unknown, loadData: unknown = LOAD_DATA) {
  const upsert = jest.fn((_row: Record<string, unknown>, _options?: unknown) => Promise.resolve({ error: upsertError }));
  const maybeSingle = jest.fn(() => Promise.resolve({ data: loadData, error: null }));
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle })) })),
      upsert,
    })),
  });
  return { upsert };
}

afterEach(() => jest.clearAllMocks());

test('upsert 成功 → 「保存しました」を表示', async () => {
  mockClient(null);
  render(<CancelPolicySettings facilityId="f1" />);
  const saveBtn = await screen.findByText('ポリシーを保存');
  fireEvent.click(saveBtn);
  expect(await screen.findByText('保存しました')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('upsert 失敗 → エラー表示・「保存しました」は出さない（成功偽装防止・回帰防止）', async () => {
  mockClient({ message: 'RLS denied' });
  render(<CancelPolicySettings facilityId="f1" />);
  const saveBtn = await screen.findByText('ポリシーを保存');
  fireEvent.click(saveBtn);
  expect(await screen.findByRole('alert')).toHaveTextContent('保存に失敗しました');
  await waitFor(() => expect(screen.queryByText('保存しました')).not.toBeInTheDocument());
});

// ── キャンセルの受け付け方（2026年10月23日・神原さん判断「店舗側の設定に任せる」） ──
// 以前の「キャンセル不可」（free_cancel_hours=0）は、予約画面では「常にキャンセル料」、計算では「いつでも無料」と
// 別の意味に読まれていた。選択肢を分け、選んだとおりに動く値（cancel_rule）を保存する。
async function savedRow(upsert: jest.Mock) {
  fireEvent.click(await screen.findByText('ポリシーを保存'));
  await screen.findByText('保存しました');
  return upsert.mock.calls[0][0] as Record<string, unknown>;
}

test('選択肢は「N時間前まで無料」4つと「期限なし」「ネットでのキャンセル不可」で、曖昧な「キャンセル不可」は無い', async () => {
  mockClient(null);
  render(<CancelPolicySettings facilityId="f1" />);
  const select = await screen.findByLabelText('キャンセルの受け付けと無料期限');
  const labels = Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);
  expect(labels).toEqual([
    '予約日時の12時間前まで無料', '予約日時の24時間前まで無料', '予約日時の48時間前まで無料', '予約日時の72時間前まで無料',
    '期限なし（キャンセル時は常にキャンセル料）', 'ネットでのキャンセル不可（店舗へ直接ご連絡）',
  ]);
  expect(labels).not.toContain('キャンセル不可');
});

test('「ネットでのキャンセル不可」を選ぶと料率は使わない旨を示し、cancel_rule=no_online を保存する', async () => {
  const { upsert } = mockClient(null);
  render(<CancelPolicySettings facilityId="f1" />);
  fireEvent.change(await screen.findByLabelText('キャンセルの受け付けと無料期限'), { target: { value: 'no_online' } });
  expect(screen.getByLabelText('キャンセル料（施術料金の%）')).toBeDisabled();
  expect(screen.getByText(/この料率はお客様に表示されません/)).toBeInTheDocument();
  expect(screen.getByText(/店舗へ直接ご連絡いただくよう案内されます/)).toBeInTheDocument();
  expect(await savedRow(upsert)).toMatchObject({ facility_id: 'f1', cancel_rule: 'no_online', free_cancel_hours: 24 });
});

test('「期限なし」を選ぶと cancel_rule=always_fee を保存する（料率は選べる）', async () => {
  const { upsert } = mockClient(null);
  render(<CancelPolicySettings facilityId="f1" />);
  fireEvent.change(await screen.findByLabelText('キャンセルの受け付けと無料期限'), { target: { value: 'always_fee' } });
  expect(screen.getByLabelText('キャンセル料（施術料金の%）')).not.toBeDisabled();
  expect(await savedRow(upsert)).toMatchObject({ cancel_rule: 'always_fee', late_cancel_rate: 50 });
});

test('時間を選ぶと cancel_rule=free_window とその時間を保存する', async () => {
  const { upsert } = mockClient(null, { ...LOAD_DATA, cancel_rule: 'no_online' });
  render(<CancelPolicySettings facilityId="f1" />);
  const select = await screen.findByLabelText('キャンセルの受け付けと無料期限');
  expect(select).toHaveValue('no_online');
  fireEvent.change(select, { target: { value: '48' } });
  expect(await savedRow(upsert)).toMatchObject({ cancel_rule: 'free_window', free_cancel_hours: 48 });
});

test('cancel_rule の無い旧「キャンセル不可」の行は「期限なし」と表示し、保存時に明示の値で書き直す', async () => {
  const { upsert } = mockClient(null, { ...LOAD_DATA, free_cancel_hours: 0, cancel_rule: null });
  render(<CancelPolicySettings facilityId="f1" />);
  expect(await screen.findByLabelText('キャンセルの受け付けと無料期限')).toHaveValue('always_fee');
  expect(await savedRow(upsert)).toMatchObject({ cancel_rule: 'always_fee', free_cancel_hours: 0 });
});

// 回帰（レビュー指摘）: 料率 NULL の行を DB の DEFAULT（50%）で表示していたため、お客様には「キャンセル料は
// かかりません」と案内している店舗に 50% と見え、そのまま保存すると黙って料金が発生していた。
test('列が NULL の行・未知のルールは、予約画面・計算と同じ読み方（24時間前まで無料・キャンセル料 0%）で表示・保存する', async () => {
  const { upsert } = mockClient(null, { free_cancel_hours: null, late_cancel_rate: null, no_show_rate: null, policy_text: null, cancel_rule: 'unknown' });
  render(<CancelPolicySettings facilityId="f1" />);
  expect(await screen.findByLabelText('キャンセルの受け付けと無料期限')).toHaveValue('24');
  expect(screen.getByLabelText('キャンセル料（施術料金の%）')).toHaveValue('0');
  expect(await savedRow(upsert)).toMatchObject({ cancel_rule: 'free_window', free_cancel_hours: 24, late_cancel_rate: 0, no_show_rate: 100 });
});

test('ポリシーをまだ保存していない店舗は DB の既定値（24時間前まで無料・50%）を初期表示する', async () => {
  const { upsert } = mockClient(null, null);
  render(<CancelPolicySettings facilityId="f1" />);
  expect(await screen.findByLabelText('キャンセルの受け付けと無料期限')).toHaveValue('24');
  expect(screen.getByLabelText('キャンセル料（施術料金の%）')).toHaveValue('50');
  expect(await savedRow(upsert)).toMatchObject({ cancel_rule: 'free_window', free_cancel_hours: 24, late_cancel_rate: 50, no_show_rate: 100 });
});

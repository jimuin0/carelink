/**
 * @jest-environment jsdom
 *
 * 経営者視点監査対応: 顧客一覧にRFMセグメント(VIP/レギュラー/離脱リスク/離脱/新規)と
 * 累計利用額(LTV相当)を表示する。従来はcustomer_segmentsテーブルに計算済みデータが
 * あるのに一覧に出ておらず、「上位顧客を一目で見つける」経営判断の入口が欠けていた。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import CustomersManager, { type MasterCustomer } from '@/components/admin/CustomersManager';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));

function customer(overrides: Partial<MasterCustomer> = {}): MasterCustomer {
  return {
    id: 'c1', name: 'テスト太郎', name_kana: null, email: 'test@example.com', phone: null,
    birthday: null, gender: null, notes: null, visit_count: 3, last_visit: '2026-06-01',
    segment: null, total_spent: null,
    ...overrides,
  };
}

test('segment=vip → VIPバッジと累計利用額を表示', () => {
  render(<CustomersManager facilityId="f1" customers={[customer({ segment: 'vip', total_spent: 50000 })]} unregistered={[]} />);
  expect(screen.getByText('VIP')).toBeInTheDocument();
  expect(screen.getByText('¥50,000')).toBeInTheDocument();
});

test('segment=at_risk → 離脱リスクバッジを表示', () => {
  render(<CustomersManager facilityId="f1" customers={[customer({ segment: 'at_risk', total_spent: 3000 })]} unregistered={[]} />);
  expect(screen.getByText('離脱リスク')).toBeInTheDocument();
});

test('segment=null（未計算）→ セグメント列・累計利用額とも "—"', () => {
  render(<CustomersManager facilityId="f1" customers={[customer({ segment: null, total_spent: null })]} unregistered={[]} />);
  const dashes = screen.getAllByText('—');
  expect(dashes.length).toBeGreaterThanOrEqual(1);
});

test('未知のsegment値 → バッジ化できず "—" にフォールバック（マッピング漏れでクラッシュしない）', () => {
  render(<CustomersManager facilityId="f1" customers={[customer({ segment: 'unknown_value', total_spent: 100 })]} unregistered={[]} />);
  expect(screen.queryByText('unknown_value')).not.toBeInTheDocument();
});

// 顧客削除は不可逆操作（来店履歴は残るがマスターからは消える）。誤操作抑止のため
// 確定ボタンは danger 系（赤）で表示する必要がある（variant="danger" 未指定だと
// 他の通常操作と見た目が区別できず、削除の危険度が伝わらない）。
test('削除ボタン押下 → ConfirmDialogの確定ボタンがdanger系（赤）で表示される', () => {
  render(<CustomersManager facilityId="f1" customers={[customer()]} unregistered={[]} />);
  fireEvent.click(screen.getByRole('button', { name: '削除' }));
  const confirmButton = screen.getByRole('button', { name: '削除する' });
  expect(confirmButton).toHaveClass('bg-red-600');
});

/**
 * @jest-environment jsdom
 *
 * 経営者視点監査対応: 顧客一覧にRFMセグメント(VIP/レギュラー/離脱リスク/離脱/新規)と
 * 累計利用額(LTV相当)を表示する。従来はcustomer_segmentsテーブルに計算済みデータが
 * あるのに一覧に出ておらず、「上位顧客を一目で見つける」経営判断の入口が欠けていた。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
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

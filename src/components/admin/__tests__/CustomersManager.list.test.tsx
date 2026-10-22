/**
 * @jest-environment jsdom
 *
 * 顧客管理の「来店履歴から未登録のお客様」まわり（2026年10月23日）。
 *  - 検索条件（来店回数・最終来店日・電話番号など）を台帳と同じ規則で未登録のお客様にも当てる
 *  - CSV は画面に出ている行（台帳＋未登録）を出す。台帳が 0 件でも出せる
 *  - メールの無い電話・来店受付のお客様は電話番号を表示し、「＋ 登録」で電話番号を引き継ぐ
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, within } from '@testing-library/react';
import CustomersManager, { type MasterCustomer, type UnregisteredCustomer } from '@/components/admin/CustomersManager';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));

const FAC = [{ id: 'f1', name: '施設A' }];
const FAC2 = [{ id: 'f1', name: '施設A' }, { id: 'f2', name: '施設B' }];

function unreg(over: Partial<UnregisteredCustomer>): UnregisteredCustomer {
  return { key: 'k', name: '来店者', email: null, phone: null, visit_count: 1, last_visit: '2026-04-10', facility_id: 'f1', facility_name: '施設A', phone_in_ledger: false, ...over };
}
function master(over: Partial<MasterCustomer> = {}): MasterCustomer {
  return {
    id: 'c1', name: '台帳 太郎', name_kana: null, email: 'ledger@example.com', phone: null, birthday: null, gender: null, notes: null,
    visit_count: 6, last_visit: '2026-10-15', segment: null, total_spent: null, facility_id: 'f1', facility_name: '施設A', ...over,
  };
}
const A = unreg({ key: 'a@example.com', name: 'Aさん', email: 'a@example.com', visit_count: 1, last_visit: '2026-04-10' });
const B = unreg({ key: 'tel:09011112222', name: 'Bさん', phone: '090-1111-2222', visit_count: 6, last_visit: '2026-10-15' });

const csvLink = () => screen.queryByRole('link', { name: /CSV/ });
const csvText = () => decodeURIComponent((csvLink() as HTMLAnchorElement).getAttribute('href')!.replace('data:text/csv;charset=utf-8,', ''));
const search = () => fireEvent.click(screen.getByRole('button', { name: '検索する' }));
const unregisteredSection = () => screen.getByText('来店履歴から未登録のお客様').parentElement as HTMLElement;

test('来店回数・最終来店日の条件が「来店履歴から未登録のお客様」にも効く（回帰）', () => {
  render(<CustomersManager facilities={FAC} customers={[]} unregistered={[A, B]} />);
  expect(screen.getByText('Aさん')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('来店回数（最小）'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('最終来店日（開始）'), { target: { value: '2026-10-01' } });
  search();
  expect(screen.queryByText('Aさん')).not.toBeInTheDocument();
  expect(screen.getByText('Bさん')).toBeInTheDocument();
  // 条件をクリアすると両方とも戻る
  fireEvent.click(screen.getByRole('button', { name: '条件をクリア' }));
  expect(screen.getByText('Aさん')).toBeInTheDocument();
  expect(screen.getByText('Bさん')).toBeInTheDocument();
});

test('電話番号の条件も未登録のお客様に効く', () => {
  render(<CustomersManager facilities={FAC} customers={[]} unregistered={[A, B]} />);
  fireEvent.change(screen.getByLabelText('電話番号'), { target: { value: '1111' } });
  search();
  expect(screen.queryByText('Aさん')).not.toBeInTheDocument();
  expect(screen.getByText('Bさん')).toBeInTheDocument();
});

test('フリガナ等で絞り込むと未登録のお客様は出ず、その理由を表示する', () => {
  render(<CustomersManager facilities={FAC} customers={[master({ name_kana: 'ダイチョウ タロウ' })]} unregistered={[A, B]} />);
  expect(screen.queryByText(/フリガナ・性別・誕生日の条件では/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('フリガナ'), { target: { value: 'ダイチョウ' } });
  search();
  expect(screen.getByText('台帳 太郎')).toBeInTheDocument();
  expect(screen.queryByText('Aさん')).not.toBeInTheDocument();
  expect(screen.queryByText('Bさん')).not.toBeInTheDocument();
  expect(screen.getByText(/フリガナ・性別・誕生日の条件では、来店履歴から未登録のお客様は表示されません/)).toBeInTheDocument();
});

test('台帳が 0 件でも CSV を出せ、未登録のお客様が入る（回帰）', () => {
  render(<CustomersManager facilities={FAC} customers={[]} unregistered={[A, B]} />);
  expect(csvLink()).toHaveTextContent('表示中の顧客をCSV');
  const lines = csvText().replace(/^\uFEFF/, '').split('\n');
  expect(lines[0]).toBe('お客様名,フリガナ,メール,電話,来店回数,最終来店,セグメント,累計利用額,区分');
  expect(lines.slice(1)).toEqual([
    'Aさん,,a@example.com,,1,2026-04-10,,,未登録',
    'Bさん,,,090-1111-2222,6,2026-10-15,,,未登録',
  ]);
});

test('CSV は画面と同じく絞り込み後の行だけ（台帳＋未登録）', () => {
  render(<CustomersManager facilities={FAC} customers={[master(), master({ id: 'c2', name: '少ない 客', email: 'few@example.com', visit_count: 1, last_visit: '2026-01-01' })]} unregistered={[A, B]} />);
  fireEvent.change(screen.getByLabelText('来店回数（最小）'), { target: { value: '5' } });
  search();
  const names = csvText().split('\n').slice(1).map((line) => line.split(',')[0]);
  expect(names).toEqual(['台帳 太郎', 'Bさん']);
});

test('表示する顧客がいなければ CSV ボタンは出さない', () => {
  const { unmount } = render(<CustomersManager facilities={FAC} customers={[]} unregistered={[]} />);
  expect(csvLink()).not.toBeInTheDocument();
  unmount();
  render(<CustomersManager facilities={FAC} customers={[]} unregistered={[A]} />);
  fireEvent.change(screen.getByLabelText('氏名'), { target: { value: '該当なし' } });
  search();
  expect(csvLink()).not.toBeInTheDocument();
});

test('電話番号だけのお客様は電話番号を表示し、「＋ 登録」で氏名と電話番号を引き継ぐ', () => {
  render(<CustomersManager facilities={FAC} customers={[]} unregistered={[B]} />);
  const section = unregisteredSection();
  expect(within(section).getByText('090-1111-2222')).toBeInTheDocument();
  fireEvent.click(within(section).getByRole('button', { name: '＋ 登録' }));
  expect(screen.getByLabelText(/お名前/)).toHaveValue('Bさん');
  expect(screen.getByLabelText('電話番号', { selector: '#cust-phone' })).toHaveValue('090-1111-2222');
  expect(screen.getByLabelText('メールアドレス', { selector: '#cust-email' })).toHaveValue('');
});

test('台帳に同じ電話番号のお客様が複数いて寄せられなかった来店には、その旨を添える（重複登録の防止）', () => {
  const NOTE = '台帳に同じ電話番号のお客様が複数いるため、自動ではまとめていません';
  const { unmount } = render(<CustomersManager facilities={FAC} customers={[]} unregistered={[{ ...B, phone_in_ledger: true }]} />);
  expect(within(unregisteredSection()).getByText(NOTE)).toBeInTheDocument();
  unmount();
  render(<CustomersManager facilities={FAC} customers={[]} unregistered={[B]} />);
  expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
});

test('複数施設なら未登録のお客様にも施設名を出す。同じキーが別施設にあっても別の行', () => {
  render(<CustomersManager facilities={FAC2} customers={[]} unregistered={[A, { ...A, facility_id: 'f2', facility_name: '施設B' }]} />);
  const section = unregisteredSection();
  expect(within(section).getByText('施設')).toBeInTheDocument();
  expect(within(section).getByText('施設A')).toBeInTheDocument();
  expect(within(section).getByText('施設B')).toBeInTheDocument();
  expect(within(section).getAllByText('Aさん')).toHaveLength(2);
});

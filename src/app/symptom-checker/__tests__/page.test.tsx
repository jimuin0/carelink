/**
 * 症状チェッカーの結果（2026年10月22日 是正）。
 * - 件数は公開中の施設だけを数える（症状ページに実際に並ぶ施設と同じ条件）。
 * - 件数の取得失敗を「0件」と表示しない。
 * - どの症状にも対応店舗が無いときは、0件の行だけで終わらせず業種の一覧へ案内する。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SymptomCheckerPage from '../page';

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { from: (...args: unknown[]) => mockFrom(...args) } }));

const countCalls: { select: unknown[]; eq: unknown[][] }[] = [];
function setup(countResult: { count: number | null; error: unknown }) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'symptoms') {
      return { select: () => ({ in: async () => ({ data: [{ id: 's1', name: '腰痛', slug: 'low-back-pain', category: '筋骨格系' }], error: null }) }) };
    }
    const call = { select: [] as unknown[], eq: [] as unknown[][] };
    countCalls.push(call);
    const chain = {
      select: (...args: unknown[]) => { call.select = args; return chain; },
      eq: (...args: unknown[]) => { call.eq.push(args); return chain; },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(countResult).then(resolve),
    };
    return chain;
  });
}

async function searchLowBackPain() {
  render(<SymptomCheckerPage />);
  fireEvent.click(screen.getByRole('button', { name: '腰痛' }));
  fireEvent.click(screen.getByRole('button', { name: '1件の症状で店舗を探す' }));
  await waitFor(() => expect(screen.getByText('対応可能な症状')).toBeInTheDocument());
}

beforeEach(() => { mockFrom.mockReset(); countCalls.length = 0; });

test('件数は公開中の施設だけを数える', async () => {
  setup({ count: 2, error: null });
  await searchLowBackPain();
  expect(countCalls[0].select).toEqual(['id, facility_profiles!inner(status)', { count: 'exact', head: true }]);
  expect(countCalls[0].eq).toEqual([['symptom_id', 's1'], ['facility_profiles.status', 'published']]);
  expect(screen.getByText('2件')).toBeInTheDocument();
  expect(screen.queryByText('選んだ症状に対応する店舗は、まだ登録されていません。')).not.toBeInTheDocument();
});

test('どの症状にも対応店舗が無ければ、業種の一覧へ案内する', async () => {
  setup({ count: 0, error: null });
  await searchLowBackPain();
  expect(screen.getByText('選んだ症状に対応する店舗は、まだ登録されていません。')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '鍼灸院・整骨院・整体を探す →' })).toHaveAttribute('href', '/type/acupuncture');
});

test('件数の取得に失敗したら「0件」と出さず、検索失敗として再試行を促す', async () => {
  setup({ count: null, error: { code: 'PGRST003' } });
  await searchLowBackPain();
  expect(screen.getByRole('alert')).toHaveTextContent('検索に失敗しました');
  expect(screen.queryByText('0件')).not.toBeInTheDocument();
});

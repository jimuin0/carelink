/**
 * @jest-environment jsdom
 *
 * 症状チェッカー結果の「近くの施設を探す」リンクが、/search が実際に受理する
 * クエリパラメータ（keyword/area）を使っているかの回帰テスト。
 *
 * 【2026年7月8日 実データで確定した根治の再発防止】旧実装は /search?q=...&pref=... という
 * 存在しないパラメータ名を生成しており、/search 側の型定義（keyword/area のみ）に
 * 該当せず絞り込みが無視され全件表示になっていた（実データ確認: q/pref付きは無指定と
 * 同じ件数を返していた）。このテストは、リンク生成が再び keyword/area 以外の
 * パラメータ名に戻ってしまうことを機械的に検知する。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SymptomsPage from '../page';

// このページは分析リクエスト前に getRecaptchaToken を呼ぶ（#450 で追加）。
// テスト環境（jest.setup.js）は NEXT_PUBLIC_RECAPTCHA_SITE_KEY を設定するため、
// モックしないと本物の loadRecaptchaScript が <script> の onload を待って jsdom で
// 永久にハングする。検索リンクのパラメータ生成という検証対象を reCAPTCHA の
// スクリプトローダーから隔離するため、モジュール契約通り null（トークン無し）を返す。
jest.mock('@/lib/recaptcha-client', () => ({
  getRecaptchaToken: jest.fn().mockResolvedValue(null),
}));

global.fetch = jest.fn();

function mockSuggestResponse() {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      result: {
        summary: 'テスト概要',
        recommended_treatments: [{ name: '鍼灸', description: 'テスト説明', icon: '💉' }],
        search_keywords: ['肩こり', '整体'],
        caution: null,
        tips: [],
      },
    }),
  });
}

// AI の有効判定は ANTHROPIC_API_KEY の有無（isAiEnabled）。jest.setup.js の値に暗黙に依存せず、
// 各テストで明示的に設定・削除し、終わったら元へ戻す。
const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
afterAll(() => {
  if (ORIGINAL_ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY;
});

describe('SymptomsPage - 鍵未設定時（準備中）', () => {
  test('ANTHROPIC_API_KEY 未設定 → 入力欄を出さず、症状別ページ・検索へ案内する', () => {
    delete process.env.ANTHROPIC_API_KEY;
    render(<SymptomsPage />);
    expect(screen.getByRole('heading', { name: 'AI症状チェッカーは準備中です' })).toBeInTheDocument();
    expect(screen.queryByLabelText('症状・お悩みを入力')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '症状を分析する' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '症状から探す' })).toHaveAttribute('href', '/symptom-checker');
    expect(screen.getByRole('link', { name: 'サロン・クリニックを検索' })).toHaveAttribute('href', '/search');
  });
});

describe('SymptomsPage - 検索リンクのパラメータ整合性', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-dummy';
  });

  test('都道府県未入力 → keyword のみで area は付与されない', async () => {
    mockSuggestResponse();
    render(<SymptomsPage />);

    fireEvent.change(screen.getByLabelText('症状・お悩みを入力'), { target: { value: '肩こりがつらい' } });
    fireEvent.click(screen.getByRole('button', { name: '症状を分析する' }));

    await waitFor(() => expect(screen.getByText('肩こり')).toBeInTheDocument());
    const link = screen.getByText('肩こり').closest('a');
    expect(link).toHaveAttribute('href', '/search?keyword=%E8%82%A9%E3%81%93%E3%82%8A');
  });

  test('都道府県入力あり → keyword と area の両方が正しいパラメータ名で付与される', async () => {
    mockSuggestResponse();
    render(<SymptomsPage />);

    fireEvent.change(screen.getByLabelText('症状・お悩みを入力'), { target: { value: '肩こりがつらい' } });
    fireEvent.change(screen.getByLabelText('都道府県（任意）'), { target: { value: '大阪府' } });
    fireEvent.click(screen.getByRole('button', { name: '症状を分析する' }));

    await waitFor(() => expect(screen.getByText('肩こり')).toBeInTheDocument());
    const link = screen.getByText('肩こり').closest('a');
    const href = link!.getAttribute('href')!;
    expect(href).toContain('keyword=');
    expect(href).toContain('area=');
    expect(href).not.toContain('q=');
    expect(href).not.toContain('pref=');
  });
});

// 監査 A347/A348: AI 未設定時の「症状から探す」は症状チェッカーへ送り、metadata は layout だけが持つ。
describe('SymptomsPage - AI 未設定時の案内', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  afterEach(() => { process.env.ANTHROPIC_API_KEY = original; });
  test('「症状から探す」は /symptom-checker を指す', () => {
    delete process.env.ANTHROPIC_API_KEY;
    render(<SymptomsPage />);
    expect(screen.getByRole('link', { name: '症状から探す' })).toHaveAttribute('href', '/symptom-checker');
  });
  test('page は metadata を export しない（layout が単一の定義元）', () => {
    expect(require('../page').metadata).toBeUndefined();
    expect(require('../layout').metadata.alternates.canonical).toBe('/symptoms');
  });
});

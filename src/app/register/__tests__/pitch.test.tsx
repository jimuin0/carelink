/**
 * @jest-environment jsdom
 *
 * /register の訴求部分が実在することを固定する。
 *
 * 🔴 なぜ検査するか
 * 旧実装は、見出しと 1 行の説明の下がいきなり 20 項目超の入力欄だった。スマホで開くと
 * 【文字だけが延々と続く画面】で、なぜ登録するのかが一切伝わらない。実機のスクリーンショットで
 * 確認したうえで作り直したが、訴求部分は「無くても動く」ため、次のリファクタで静かに
 * 消えても誰も気づかない。フォームだけに戻っていないことを機械で見る。
 *
 * ⚠️ 見た目の良し悪しはここでは測れない。測っているのは「要素が在るか」だけ。
 * デザインの確認は実機（Vercel プレビュー）で行うこと。
 */
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import RegisterPage from '@/app/register/page';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/recaptcha-client', () => ({ getRecaptchaToken: jest.fn().mockResolvedValue(null) }));

describe('/register の訴求部分', () => {
  beforeEach(() => {
    render(<RegisterPage />);
  });

  it('見出しと、フォームへ送る導線がある', () => {
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: '無料ではじめる' });
    expect(cta).toHaveAttribute('href', '#register-form');
  });

  it('比較表が行と列の対応を持つ表として描かれている（読み上げで辿れる）', () => {
    const table = screen.getByRole('table');
    // 行見出しが th scope="row" になっていること。div の格子に戻すとここで落ちる。
    expect(within(table).getByRole('rowheader', { name: '予約の受付' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'CareLink' })).toBeInTheDocument();
  });

  it('掲載までの流れが 3 段で出ている', () => {
    for (const step of ['無料登録', 'アカウント作成', '掲載開始']) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it('フォームは同じページ内に残っている（訴求だけの別ページにしない）', () => {
    expect(screen.getByLabelText(/^施設名/)).toBeInTheDocument();
  });
});

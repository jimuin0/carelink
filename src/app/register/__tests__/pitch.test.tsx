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
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen, within } from '@testing-library/react';
import RegisterPage, { PAID_PLAN_NOTICE, REGISTER_CTA_LABEL } from '@/components/register/RegisterLanding';
import RegisterRoute from '@/app/register/page';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/recaptcha-client', () => ({ getRecaptchaToken: jest.fn().mockResolvedValue(null) }));

describe('/register の訴求部分', () => {
  beforeEach(() => {
    render(<RegisterPage />);
  });

  it('見出しと、フォームへ送る導線がある', () => {
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(REGISTER_CTA_LABEL).toBe('無料で掲載を申し込む');
    const ctas = screen.getAllByRole('link', { name: REGISTER_CTA_LABEL });
    expect(ctas).toHaveLength(2);
    for (const cta of ctas) expect(cta).toHaveAttribute('href', '#register-form');
  });

  it('スマホの最初の画面に入るよう、主 CTA はヒーローの中・見出しの後にある', () => {
    const hero = screen.getByRole('heading', { level: 1 }).closest('section')!;
    const cta = within(hero).getByRole('link', { name: REGISTER_CTA_LABEL });
    // 見出しより後ろ（DOM 順）に置く。
    expect(screen.getByRole('heading', { level: 1 }).compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 16px 太字・高さ 52px
    expect(cta.className).toMatch(/\bh-\[52px\]/);
    expect(cta.className).toMatch(/\btext-base\b/);
    expect(cta.className).toMatch(/\bfont-bold\b/);
    // ヒーローの高さは svh（アドレスバー込みの見える高さ）で取る。
    expect(hero.innerHTML).toMatch(/h-\[\d+svh\]/);
    expect(hero.innerHTML).not.toMatch(/h-\[\d+vh\]/);
  });

  it('「掲載までの流れ」の後にも同じ CTA がある', () => {
    const flow = screen.getByRole('heading', { name: '掲載までの流れ' }).closest('section')!;
    expect(within(flow).getByRole('link', { name: REGISTER_CTA_LABEL })).toHaveAttribute('href', '#register-form');
  });

  it('料金の行は 14px 以上で、有料プランを設ける場合の事前通知（利用規約 第10条）を添える', () => {
    const price = screen.getByText('掲載料・予約手数料 0円');
    expect(price.className).toMatch(/\btext-sm\b/);
    expect(screen.getAllByText(new RegExp(PAID_PLAN_NOTICE)).length).toBeGreaterThan(0);
    // 規約に書いてある約束だけを書く（規約に無い約束を足さない）。
    const terms = readFileSync(join(process.cwd(), 'src/app/terms/page.tsx'), 'utf8');
    expect(terms).toContain('将来有料プランを設定する場合は事前に通知します');
  });

  it('掲載エリアは渡されたときだけ出す（DB の実在値・ハードコードしない）', () => {
    expect(screen.queryByText(/現在の主な掲載エリア/)).not.toBeInTheDocument();
  });

  it('ネット予約を無条件の「24時間」「24h 予約受付」と約束しない', () => {
    expect(screen.queryByText('予約受付')).not.toBeInTheDocument();
    expect(screen.queryByText('深夜でも予約が入る')).not.toBeInTheDocument();
    expect(screen.getByText('ネット予約（設定後）')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('cell', { name: '設定後は24時間' })).toBeInTheDocument();
  });

  it('比較表が行と列の対応を持つ表として描かれている（読み上げで辿れる）', () => {
    const table = screen.getByRole('table');
    // 行見出しが th scope="row" になっていること。div の格子に戻すとここで落ちる。
    expect(within(table).getByRole('rowheader', { name: '予約の受付' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'CareLink' })).toBeInTheDocument();
  });

  it('掲載までの流れが 3 段で出ている', () => {
    for (const step of ['基本情報を入力', 'アカウントを作成', '掲載を準備']) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it('フォームは同じページ内に残っている（訴求だけの別ページにしない）', () => {
    expect(screen.getByLabelText(/^店舗名/)).toBeInTheDocument();
  });

  it('無料掲載、受付と公開の違い、現行の複数店の制約と安全な再送を説明する', () => {
    expect(screen.getByText(/この掲載申込で有料プランや決済契約を申し込むことはありません/)).toBeInTheDocument();
    expect(screen.getByText(/受付完了と一般公開は別の手続き/)).toBeInTheDocument();
    expect(screen.getByText(/運営が店舗情報と申請者の管理権限を確認した後/)).toBeInTheDocument();
    expect(screen.getByText(/同じ確認済みメールアドレスのアカウントで各申込を引き継ぎ/)).toBeInTheDocument();
    expect(screen.getByText(/重複を避けるため連続送信せず/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '施設掲載について運営に問い合わせる' })).toHaveAttribute('href', '/contact');
  });
});

describe('/register の表示ルール（ソース）', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/register/RegisterLanding.tsx'), 'utf8');

  it('12px 未満の文字を使わない（px 直書きの小さい字・text-micro / text-tiny を禁止）', () => {
    const tiny = source.match(/text-\[(?:[0-9]|1[01])px\]|text-(?:micro|tiny)\b/g) ?? [];
    expect(tiny).toEqual([]);
    // 任意値の大きさは rem で書く（px 直書きを戻さない）。
    expect(source.match(/text-\[\d+px\]/g) ?? []).toEqual([]);
  });

  it('見出し・FAQ は文節で折り返すクラスの内側にある', () => {
    expect(source).toContain('className="jp-wrap"');
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(css).toMatch(/\.theme-ecru \.jp-wrap :is\(h1, h2, h3, dt\) \{\s*word-break: auto-phrase;\s*text-wrap: balance;/);
    expect(css).toMatch(/\.theme-ecru \.jp-wrap :is\(p, dd, li, td, th\) \{\s*word-break: auto-phrase;\s*text-wrap: pretty;/);
  });

  it('写真の上の白文字は、覆いを 75% 以上かけた範囲にだけ置く', () => {
    const scrim = source.match(/bg-linear-to-t from-\(--ecru-scrim\)\/(\d+) via-\(--ecru-scrim\)\/(\d+) via-(\d+)%/);
    expect(scrim).not.toBeNull();
    const [, from, via, viaAt] = scrim!.map(Number);
    expect(from).toBeGreaterThanOrEqual(75);
    expect(via).toBeGreaterThanOrEqual(75);
    // 文字ブロックはヒーロー下側 3/4 に収まる前提（via の位置まで 75% 以上を保つ）。
    expect(viaAt).toBeGreaterThanOrEqual(70);
    // 薄い白文字（text-white/70 など）を写真の上に置かない。
    expect(source).not.toMatch(/text-white\/\d+/);
  });
});

describe('/register ページ', () => {
  it('掲載エリアを表示せず、申込導線を表示する', () => {
    render(RegisterRoute());
    expect(screen.queryByText(/現在の主な掲載エリア/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: REGISTER_CTA_LABEL })).toHaveLength(2);
  });
});

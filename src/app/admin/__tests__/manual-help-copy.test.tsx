/**
 * 操作マニュアル（/admin/manual）とヘルプ（/admin/help）が実際の画面と食い違っていた（2026年10月23日）。
 *
 * - 写真「5枚以上」（実際のネット予約の条件は1枚）
 * - 存在しない「設定 → 公開設定 → 公開中」（実際は「設定」画面上部の「公開する」）
 * - スタッフ追加で「担当メニュー・シフト」を設定（追加画面には無い）
 * - 「確定」「却下」ボタン（実際は「承認する」「お断りする」）、ステータス名「no_show」
 * - 「ボード」「サロンボード」（他社の製品名。ナビの表記は「予約表」）
 *
 * 初期設定の手順はチェックリストの単一ソース（facility-setup-steps）から作るので、ここでは
 * 「チェックリストの全項目が同じ順で出ていること」と、マニュアル・ヘルプが「」で示すボタン名・欄名が
 * 管理画面のソースに実在することを確かめる（ボタン名を変えたらここが落ちる）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import ManualPage from '../manual/page';
import AdminHelpPage from '../help/page';
import { setupGuideSteps, SETUP_GROUP_LABELS, SETUP_STEP_HOWTO } from '@/lib/facility-setup-steps';

jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const ROOT = process.cwd();
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '__tests__') return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [readFileSync(path, 'utf8')] : [];
  });
}
// 「」で示した語が実在するかを調べる範囲：管理画面のページ・部品と、禁止表現の例（medical-ad-guard）。
// マニュアル・ヘルプ自身は除く（自分の文章の中にあるだけでは「画面にある」証拠にならない）。
const MANUAL_SOURCES = ['src/app/admin/manual/page.tsx', 'src/app/admin/help/page.tsx'].map((p) => readFileSync(join(ROOT, p), 'utf8'));
const UI_CORPUS = [
  ...sources(join(ROOT, 'src/app/admin')).filter((text) => !MANUAL_SOURCES.includes(text)),
  ...sources(join(ROOT, 'src/components/admin')),
  readFileSync(join(ROOT, 'src/lib/medical-ad-guard.ts'), 'utf8'),
  readFileSync(join(ROOT, 'src/lib/booking-status.ts'), 'utf8'),
].join('\n');
const quoted = (text: string) => [...text.matchAll(/「([^」]+)」/g)].map((m) => m[1]);

const STALE = [/5枚以上/, /公開設定/, /施術メモ/, /公開中」に変更/, /サロンボード/, /「ボード」/, /no_show/, /「却下」/, /「確定」or/, /担当メニュー・シフト/, /LINE通知設定/];

test('マニュアルの初期設定は、チェックリストの全項目を同じ順・同じ見出しで手順つきで出す', () => {
  const { container } = render(<ManualPage />);
  const guide = setupGuideSteps();
  guide.forEach((step, index) => {
    expect(screen.getByRole('heading', { name: `ステップ${index + 1}: ${step.label}` })).toBeTruthy();
    expect(screen.getByText(step.howto)).toBeTruthy();
  });
  for (const label of Object.values(SETUP_GROUP_LABELS)) expect(screen.getByRole('heading', { name: label })).toBeTruthy();
  // 目次から初期設定へ飛べる
  expect(container.querySelector('a[href="#setup"]')?.textContent).toBe('2. 初期設定');
  expect(container.querySelector('#setup')).not.toBeNull();
});

test.each([
  ['マニュアル', () => render(<ManualPage />)],
  ['ヘルプ', () => render(<AdminHelpPage />)],
])('%s に、実際の画面と食い違う古い記述が残っていない', (_label, renderPage) => {
  const { container } = renderPage();
  const text = container.textContent ?? '';
  for (const pattern of STALE) expect({ pattern: String(pattern), found: pattern.test(text) }).toEqual({ pattern: String(pattern), found: false });
});

test('マニュアル・ヘルプが「」で示すボタン名・欄名は、管理画面に実在する', () => {
  const manual = render(<ManualPage />).container.textContent ?? '';
  const help = render(<AdminHelpPage />).container.textContent ?? '';
  const terms = [...new Set([...quoted(manual), ...quoted(help), ...Object.values(SETUP_STEP_HOWTO).flatMap(quoted)])];
  expect(terms.length).toBeGreaterThan(20);
  const missing = terms.filter((term) => !UI_CORPUS.includes(term));
  expect(missing).toEqual([]);
});

test('実在しない語は検出される（負の対照：以前のマニュアルが示していた欄名「施術メモ」）', () => {
  expect(UI_CORPUS.includes('施術メモ')).toBe(false);
  expect(UI_CORPUS.includes('写真を選択（複数可）')).toBe(true);
});

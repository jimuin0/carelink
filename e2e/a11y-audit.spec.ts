import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * アクセシビリティ客観測定（axe-core）。T27（コントラスト）・T19（タップ領域 target-size）の
 * 「推測でなく実測」を担うレポート用 spec。違反があっても fail させず（非ゲート）、
 * 全違反を test-results/a11y-audit.json と標準出力に集約する。
 *
 * 目的: どのページのどの要素が WCAG コントラスト比/最小ターゲットサイズを満たさないかを
 * 事実として可視化し、修正対象を神原さんが判断できるようにする。
 *
 * 実行: ローカルは `npm run start`（:3000）起動後に
 *   npx playwright test e2e/a11y-audit.spec.ts --project=chromium
 * （webServer は CI のみ自動起動のため、ローカルは事前にサーバを起動しておく）
 */

// 認証不要で主要 UI を網羅する公開ページ。
const PAGES = [
  '/',
  '/search',
  '/salon',
  '/jobs',
  '/auth/login',
  '/contact',
  '/privacy',
  '/terms',
];

type Finding = {
  page: string;
  rule: string;
  impact: string | null | undefined;
  nodes: number;
  targets: string[];
  description: string;
};

const allFindings: Finding[] = [];

test.describe('a11y 客観測定（非ゲート・レポート）', () => {
  for (const path of PAGES) {
    test(`axe: ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' });

      const results = await new AxeBuilder({ page })
        // WCAG 2.0/2.1/2.2 の A〜AA を対象（color-contrast=AA, target-size=2.2 AA を含む）
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();

      for (const v of results.violations) {
        allFindings.push({
          page: path,
          rule: v.id,
          impact: v.impact,
          nodes: v.nodes.length,
          targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
          description: v.help,
        });
      }

      // コントラスト/タップ領域の件数を per-page で出力（実測の中心指標）
      const contrast = results.violations.find((v) => v.id === 'color-contrast');
      const targetSize = results.violations.find((v) => v.id === 'target-size');
      // eslint-disable-next-line no-console
      console.log(
        `[a11y] ${path} : violations=${results.violations.length} ` +
          `color-contrast=${contrast?.nodes.length ?? 0} target-size=${targetSize?.nodes.length ?? 0}`
      );

      // 非ゲート: 違反があっても落とさない（測定が目的）。spec 自体の健全性のみ確認。
      expect(Array.isArray(results.violations)).toBe(true);
    });
  }

  test.afterAll(() => {
    const dir = join(process.cwd(), 'test-results');
    mkdirSync(dir, { recursive: true });
    const byRule: Record<string, number> = {};
    for (const f of allFindings) byRule[f.rule] = (byRule[f.rule] ?? 0) + f.nodes;
    const report = {
      generatedFor: 'T27(contrast)/T19(target-size) objective measurement',
      pages: PAGES,
      totalFindings: allFindings.length,
      nodeCountByRule: byRule,
      findings: allFindings,
    };
    writeFileSync(join(dir, 'a11y-audit.json'), JSON.stringify(report, null, 2));
    // eslint-disable-next-line no-console
    console.log('[a11y] summary nodeCountByRule:', JSON.stringify(byRule));
  });
});

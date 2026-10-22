/** @jest-environment node */
/**
 * 回帰（2026年10月23日・レビュー指摘）: 管理画面のホワイトラベル設定は「運営による設定待ち」と直したのに、
 * 料金プランのページは「カスタムドメイン対応」「ホワイトラベル（施設独自ドメイン）」をエンタープライズの
 * 機能として載せたまま（比較表も enterprise: true）で、独自ドメインで予約ページを出す処理が無いのに
 * 提供済みのように見せていた。文言は src/lib/white-label-status.ts の 1 か所から両方の画面へ出す。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WHITE_LABEL_COMPARISON_LABEL, WHITE_LABEL_COMPARISON_VALUE, WHITE_LABEL_PLAN_FEATURE, WHITE_LABEL_SETUP_REQUIRED_NOTE,
} from '@/lib/white-label-status';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');
const PREMIUM = 'src/app/salon/premium/page.tsx';
const ADMIN = 'src/app/admin/white-label/page.tsx';

describe('white-label copy says it is not available yet, from one place', () => {
  test('the plan page no longer sells a custom domain or white label as a delivered feature', () => {
    const source = read(PREMIUM);
    expect(source).not.toContain('カスタムドメイン');
    expect(source).not.toContain("'ホワイトラベル（施設独自ドメイン）'");
    expect(source).not.toMatch(/label: 'ホワイトラベル'[^}]*enterprise: true/);
  });

  test('the plan page lists and compares it through the shared wording', () => {
    const source = read(PREMIUM);
    expect(source).toContain('WHITE_LABEL_PLAN_FEATURE,');
    expect(source).toContain('{ label: WHITE_LABEL_COMPARISON_LABEL, free: false, standard: false, enterprise: WHITE_LABEL_COMPARISON_VALUE }');
  });

  test('the admin screen states the same prerequisite through the shared wording', () => {
    const source = read(ADMIN);
    expect(source).toContain('${WHITE_LABEL_SETUP_REQUIRED_NOTE}');
    expect(source).not.toContain(WHITE_LABEL_SETUP_REQUIRED_NOTE);
  });

  test('the wording tells a reader it is not ready and needs the operator', () => {
    expect(WHITE_LABEL_PLAN_FEATURE).toContain('準備中');
    expect(WHITE_LABEL_PLAN_FEATURE).toContain('運営による設定が必要');
    expect(WHITE_LABEL_SETUP_REQUIRED_NOTE).toContain('運営による設定が必要');
    expect(WHITE_LABEL_COMPARISON_VALUE).toBe('準備中');
    expect(WHITE_LABEL_COMPARISON_LABEL).toContain('独自ドメイン');
  });
});

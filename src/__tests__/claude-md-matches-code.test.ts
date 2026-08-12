/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * CLAUDE.md がコードから乖離していないことを機械で固定する（2026年8月11日 新設）。
 *
 * 【なぜ必要か＝実際に起きていた乖離】
 * 恒久ガードを実装しても CLAUDE.md に書かれず、次セッションが SSOT の存在を知らないまま
 * 規約違反のコードを書き、CI で初めて落ちる状態が発生していた。実測で見つかった乖離は
 * 「送信元 SSOT の記載ゼロ」「cron 表から cron-heartbeat 欠落」「DROP 済みテーブルの掲載」
 * 「環境変数4件の未記載」「腐った件数（145本 / 4870テスト / 104テーブル）」。
 *
 * 文書は人が書くので、人の注意力に頼る限り必ずまた腐る。腐り方が機械で検出できるものは
 * ここで検出する。検出できないもの（設計意図の説明文など）は対象外。
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const MD = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');

/** 見出しで囲まれた1セクションを切り出す。 */
function section(startHeading: string, endHeading: string): string {
  const s = MD.indexOf(startHeading);
  const e = MD.indexOf(endHeading, s + 1);
  expect(s).toBeGreaterThan(-1);
  expect(e).toBeGreaterThan(s);
  return MD.slice(s, e);
}

describe('CLAUDE.md はコードと一致している', () => {
  it('cron スケジュール表が SSOT(cron-jobs.data.json) と完全一致する', () => {
    const raw = JSON.parse(readFileSync(join(ROOT, 'src/lib/cron-jobs.data.json'), 'utf8'));
    const jobs: Array<Record<string, string>> = Array.isArray(raw) ? raw : raw.jobs;
    const sec = section('## cron スケジュール', '### 🔴 cron の現状');
    const table = new Map<string, string>();
    for (const m of sec.matchAll(/^\| ([a-z0-9-]+) \| `([^`]+)` \|/gm)) table.set(m[1], m[2]);

    for (const j of jobs) {
      const name = (j.path ?? j.name ?? '').replace('/api/cron/', '');
      expect(table.get(name)).toBe(j.schedule ?? j.cron);
    }
    expect(table.size).toBe(jobs.length);
  });

  it('API ルート一覧に実在ディレクトリが漏れなく載っている', () => {
    const sec = section('## API ルート一覧', '## cron スケジュール');
    const dirs = readdirSync(join(ROOT, 'src/app/api'))
      .filter((d) => statSync(join(ROOT, 'src/app/api', d)).isDirectory() && !d.startsWith('['));
    // バッククォート表記か `api/<name>/` 表記のどちらかで言及されていればよい。
    const missing = dirs.filter((d) => !sec.includes(`\`${d}\``) && !sec.includes(`api/${d}/`));
    expect(missing).toEqual([]);
  });

  it('コードが読む環境変数が環境変数表に漏れなく載っている', () => {
    const sec = section('## 環境変数', '## テスト・CI');
    const out = execFileSync('grep', ['-rho', 'process\\.env\\.[A-Z0-9_]*', 'src'], {
      cwd: ROOT, encoding: 'utf8',
    });
    const used = new Set(
      out.split(/\s+/).filter(Boolean).map((x) => x.split('.').pop() as string)
    );
    // 実行環境が与える変数は設定対象ではないため除外する。
    for (const skip of ['NODE_ENV', 'TZ']) used.delete(skip);
    const missing = [...used].filter((k) => !k.startsWith('VERCEL') && !sec.includes(k)).sort();
    expect(missing).toEqual([]);
  });

  it('DB スキーマ節に本番から DROP 済みのテーブルが残っていない', () => {
    const sec = section('## DB スキーマ', '## 環境変数');
    // PR#579 で本番から DROP 済み。期待スキーマからも除去済み（schema-snapshot.json）。
    for (const dropped of ['facilities', 'recruits', 'booking_menus']) {
      expect(sec).not.toContain(`\`${dropped}\``);
    }
  });

  it('本セッションで新設した SSOT が文書化されている', () => {
    // 記載が無いと、次に書く人が SSOT の存在を知らずに直読み・重複実装を行う。
    for (const sym of [
      'email-from',
      'fromEnv',
      'newsletterFromEnv',
      'productionResolvedFrom',
      'RESEND_VERIFIED_DOMAINS',
      'isLineEnabled',
      'isLineLoginEnabled',
      'integration-availability',
      'NEWSLETTER_EMAIL_FROM',
      'stock-image-guard',
      'isStockImageUrl',
      'isNewStockImage',
      'STOCK_IMAGE_DOMAINS',
      'isAllowedStorageUrl',
      'diagnose-treatment-tables.sql',
      'diagnostic-sql-columns.test.ts',
      '@check',
      'partial-update-clobber-guard.test.ts',
      'updatePayload',
      'gen-stub-schema.mjs',
      'schema-fingerprint.expected.json',
    ]) {
      expect(MD).toContain(sym);
    }
  });

  /**
   * 増減で必ず腐る数値は、値でなく取得方法を書く（グローバル規約
   * 「腐る事実は書かない。確かめ方を書く」）。過去に実際へ腐っていた表現を名指しで禁じる。
   */
  it('腐った件数表現が復活していない', () => {
    for (const rotten of ['145 本', '4870 テスト', '223 スイート', '5733/5733', '全 104 テーブル']) {
      expect(MD).not.toContain(rotten);
    }
  });
});

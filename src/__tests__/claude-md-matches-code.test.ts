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

  /**
   * 上の検査は「コード → 文書」の一方向しか見ておらず、**廃止された環境変数が表に残り続ける**
   * 逆方向の腐りを素通しする。実際に `SUPER_ADMIN_USER_IDS`（監査A6b で
   * `profiles.is_platform_admin` の DB カラム方式へ一本化され、コードから消えた）が
   * 表に残ったままだった。次に読む人は「設定すべき環境変数」と誤解し、設定しても効かない。
   *
   * 判定は `process.env.<名前>` の実参照（src / scripts）か、インフラ定義（render.yaml /
   * .github）での言及を要求する。**コメント中の言及だけでは通さない**のが要点で、
   * SUPER_ADMIN_USER_IDS は platform-admin.ts のコメントに「廃止した」と書かれて残っている
   * ため、素の全文 grep だと検出できない。
   */
  it('環境変数表にコードから消えた変数が残っていない', () => {
    const sec = section('## 環境変数', '## テスト・CI');
    const listed = new Set<string>();
    for (const line of sec.split('\n')) {
      if (!line.startsWith('| ')) continue;
      for (const n of line.split('|')[1].split('/')) {
        const name = n.trim();
        if (/^[A-Z][A-Z0-9_]+$/.test(name)) listed.add(name);
      }
    }
    expect(listed.size).toBeGreaterThan(20);

    const grep = (args: string[]) =>
      execFileSync('grep', args, { cwd: ROOT, encoding: 'utf8' }).split(/\s+/).filter(Boolean);
    const referenced = new Set([
      ...grep(['-rhoE', 'process\\.env\\.[A-Z0-9_]+', 'src', 'scripts']).map((x) => x.split('.').pop() as string),
      ...grep(['-rhoE', '[A-Z][A-Z0-9_]+', 'render.yaml', '.github']),
    ]);
    const obsolete = [...listed].filter((k) => !referenced.has(k)).sort();
    expect(obsolete).toEqual([]);
  });

  /**
   * ワークフローは「ファイルが在る＝動いている」ではない（GitHub 側で無効化できる）。
   * せめて全ファイルが文書に登場することは機械で固定し、追加したのに CLAUDE.md に
   * 書かれず存在を知られないワークフローを無くす。実際 `migration-apply-reminder.yml` が
   * どこにも記載されていなかった。
   */
  it('.github/workflows の全ファイルが CLAUDE.md に登場する', () => {
    const files = readdirSync(join(ROOT, '.github/workflows')).filter((f) => f.endsWith('.yml'));
    expect(files.length).toBeGreaterThan(5);
    expect(files.filter((f) => !MD.includes(f))).toEqual([]);
  });

  /**
   * CLAUDE.md はツールの書き込みで生成されるため、失敗した呼び出しの残骸
   * （`</content>` `</invoke>` 等）が本文に混入したまま気づかれない事故が実際に起きた。
   * 混入すると以降のセクションが見出し構造から切り離され、section() ベースの検査も
   * 人の読解も静かに壊れる。
   */
  it('ツール呼び出しの残骸が本文に混入していない', () => {
    for (const residue of ['</content>', '</invoke>', '</function_calls>', '<parameter name=']) {
      expect(MD).not.toContain(residue);
    }
  });

  it('DB スキーマ節に本番から DROP 済みのテーブルが残っていない', () => {
    const sec = section('## DB スキーマ', '## 環境変数');
    // PR#579 で本番から DROP 済み。期待スキーマからも除去済み（schema-snapshot.json）。
    for (const dropped of ['facilities', 'recruits', 'booking_menus']) {
      expect(sec).not.toContain(`\`${dropped}\``);
    }
  });

  /**
   * 上の検査は「名指しした3本」しか見ない。CLAUDE.md の既知の罠の筆頭は
   * 【存在しないテーブル名を参照して無音停止】であり、文書側が実在しない名前を載せていると
   * それ自体が事故の発生源になる。実際に `subscription`（正しくは subscription_plans /
   * user_subscriptions 等）と `webhook`系（正しくは stripe_webhook_logs /
   * webhook_retry_queue）という実在しない名前が載っていた。
   *
   * 箇条書き行（`- ` 始まり）のバッククォート名だけを対象にする。地の文には
   * PostgREST の `definitions` のようにテーブルでない識別子が出るため。
   */
  it('DB スキーマ節のテーブル名が全て schema-snapshot.json に実在する', () => {
    const sec = section('## DB スキーマ', '## 環境変数');
    const snapshot = JSON.parse(
      readFileSync(join(ROOT, 'src/lib/schema-snapshot.json'), 'utf8')
    ) as Record<string, unknown>;
    const named = new Set<string>();
    for (const line of sec.split('\n')) {
      if (!line.startsWith('- ')) continue;
      for (const m of line.matchAll(/`([a-z][a-z0-9_]+)`/g)) named.add(m[1]);
    }
    expect(named.size).toBeGreaterThan(50);
    expect([...named].filter((t) => !(t in snapshot)).sort()).toEqual([]);
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
      'card-view-columns.test.ts',
      'facility_card_view',
      // PR#587/#588 で新設。`void doSomething()` の代わりに通す唯一の登録口なので、
      // 記載が無いと次に書く人がまた浮いた Promise を書き、応答後に静かに失われる。
      'after-response',
      'runAfterResponse',
      'post-response-notify-guard.test.ts',
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
    // '| 2028 |'（fingerprint 実測項目数）と '131 本'（RLS ポリシー数）は migration を足すたび
    // ずれる。実測では既に 2428 / 132 になっており、書いた時点で腐っていた。
    for (const rotten of ['145 本', '4870 テスト', '223 スイート', '5733/5733', '全 104 テーブル', '| 2028 |', '131 本']) {
      expect(MD).not.toContain(rotten);
    }
  });
});

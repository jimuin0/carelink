import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workflow = readFileSync(
  join(process.cwd(), '.github/workflows/migration-apply-reminder.yml'),
  'utf8',
);
const runbook = readFileSync(join(process.cwd(), 'docs/runbooks/database-incident.md'), 'utf8');
const adr = readFileSync(join(process.cwd(), 'docs/adr/adr-0005-no-out-of-band-migrations.md'), 'utf8');

describe('migration apply reminder safety contract', () => {
  it('detects only; it never instructs direct SQL Editor DDL or an unsafe bulk push', () => {
    expect(workflow).toContain('この workflow は検出通知のみを行い');
    expect(workflow).toContain('ADR-0005');
    expect(workflow).toContain('context.payload.pull_request.head.sha');
    expect(workflow).toContain('全pending migrationをtimestamp順に適用');
    expect(workflow).toContain('対象batchと順序の安全確認なしに一括実行しない');
    expect(workflow).toContain('docs/carelink-resumption-readiness-20260926.md');
    expect(workflow).not.toMatch(/SQL editor で\*\*手動適用\*\*/i);
    expect(workflow).not.toMatch(/SQL editor で.{0,30}適用してください/i);
    expect(runbook).toContain('Dashboard SQL EditorでDDLを実行しない');
    expect(runbook).toContain('適用済みmigration fileは書き換えない');
    expect(runbook).not.toContain('過去 migration ファイル**本体も**正しい定義に修正する');
    expect(adr).toContain('一度でも共有環境へ適用した migration file は不変');
  });
});

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sourceScript = readFileSync(join(process.cwd(), 'scripts/vercel-should-build.sh'), 'utf8');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commit(cwd: string, message: string): string {
  git(cwd, 'add', '-A');
  git(cwd, '-c', 'user.name=CareLink Test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

describe('Vercel の配信スキップ判定', () => {
  let cwd: string;
  let remoteCwd: string;
  let initialSha: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'carelink-vercel-build-skip-'));
    remoteCwd = mkdtempSync(join(tmpdir(), 'carelink-vercel-build-remote-'));
    git(cwd, 'init', '-q');
    mkdirSync(join(cwd, 'scripts'));
    mkdirSync(join(cwd, 'src', 'app'), { recursive: true });
    writeFileSync(join(cwd, 'scripts', 'vercel-should-build.sh'), sourceScript);
    writeFileSync(join(cwd, 'src', 'app', 'page.tsx'), 'export default function Page() { return null; }\n');
    initialSha = commit(cwd, 'initial deployed application');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(remoteCwd, { recursive: true, force: true });
  });

  function decision(previousSha = initialSha): number | null {
    const result = spawnSync('bash', ['scripts/vercel-should-build.sh'], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, VERCEL_ENV: 'production', VERCEL_GIT_PREVIOUS_SHA: previousSha },
    });
    if (result.error) throw result.error;
    return result.status;
  }

  function previewDecision(version = initialSha.slice(0, 7), previousSha = ''): number | null {
    mkdirSync(join(cwd, 'bin'));
    const curl = join(cwd, 'bin', 'curl');
    writeFileSync(curl, '#!/bin/sh\nprintf \'{"version":"%s"}\\n\' "$MOCK_LIVE_VERSION"\n');
    chmodSync(curl, 0o755);
    const result = spawnSync('bash', ['scripts/vercel-should-build.sh'], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(cwd, 'bin')}:${process.env.PATH}`,
        MOCK_LIVE_VERSION: version,
        VERCEL_ENV: 'preview',
        VERCEL_GIT_PREVIOUS_SHA: previousSha,
      },
    });
    if (result.error) throw result.error;
    return result.status;
  }

  function previewBase(): void {
    git(remoteCwd, 'init', '--bare', '-q');
    git(cwd, 'branch', '-M', 'main');
    git(cwd, 'remote', 'add', 'origin', remoteCwd);
    git(cwd, 'push', '-q', 'origin', 'main');
  }

  test('本番でも前回成功配信から文書だけの変更ならスキップする', () => {
    mkdirSync(join(cwd, 'docs'));
    writeFileSync(join(cwd, 'docs', 'handoff.md'), 'handoff\n');
    commit(cwd, 'docs only');
    expect(decision()).toBe(0);
  });

  test('途中でアプリ変更の配信が失敗したら後続の文書変更で隠さない', () => {
    writeFileSync(join(cwd, 'src', 'app', 'page.tsx'), 'export default function Page() { return <p>updated</p>; }\n');
    commit(cwd, 'application change that did not deploy');
    mkdirSync(join(cwd, 'docs'));
    writeFileSync(join(cwd, 'docs', 'handoff.md'), 'handoff\n');
    commit(cwd, 'docs after failed deploy');
    expect(decision()).toBe(1);
  });

  test('初回プレビューでも公開済みコミットから文書だけならビルドを省略する', () => {
    previewBase();
    git(cwd, 'switch', '-q', '-c', 'preview');
    mkdirSync(join(cwd, 'docs'));
    writeFileSync(join(cwd, 'docs', 'handoff.md'), 'handoff\n');
    commit(cwd, 'docs only');
    git(cwd, 'push', '-q', 'origin', 'preview');
    expect(previewDecision()).toBe(0);
  });

  test('リベース前の前回プレビューSHAを取得できなくても公開版から文書だけなら省略する', () => {
    previewBase();
    git(cwd, 'switch', '-q', '-c', 'preview');
    mkdirSync(join(cwd, 'docs'));
    writeFileSync(join(cwd, 'docs', 'handoff.md'), 'handoff\n');
    commit(cwd, 'docs only');
    git(cwd, 'push', '-q', 'origin', 'preview');
    expect(previewDecision(initialSha.slice(0, 7), '0'.repeat(40))).toBe(0);
  });

  test('初回プレビューでも未配信のアプリ変更があればビルドする', () => {
    previewBase();
    writeFileSync(join(cwd, 'src', 'app', 'page.tsx'), 'export default function Page() { return <p>updated</p>; }\n');
    commit(cwd, 'application change not yet deployed');
    git(cwd, 'push', '-q', 'origin', 'main');
    git(cwd, 'switch', '-q', '-c', 'preview');
    mkdirSync(join(cwd, 'docs'));
    writeFileSync(join(cwd, 'docs', 'handoff.md'), 'handoff\n');
    commit(cwd, 'docs after application change');
    git(cwd, 'push', '-q', 'origin', 'preview');
    expect(previewDecision()).toBe(1);
  });

  test('公開版を特定できない初回プレビューはビルドする', () => {
    previewBase();
    git(cwd, 'switch', '-q', '-c', 'preview');
    mkdirSync(join(cwd, 'docs'));
    writeFileSync(join(cwd, 'docs', 'handoff.md'), 'handoff\n');
    commit(cwd, 'docs only');
    git(cwd, 'push', '-q', 'origin', 'preview');
    expect(previewDecision('0000000')).toBe(1);
  });

  test('前回成功SHAが不明・取得不能・現在HEADと同じ場合はビルドする', () => {
    expect(decision('')).toBe(1);
    expect(decision('0'.repeat(40))).toBe(1);
    expect(decision(initialSha)).toBe(1);
  });

  test('ビルドに使うスクリプトの変更はビルドする', () => {
    writeFileSync(join(cwd, 'scripts', 'ensure-eslint-plugin-link.mjs'), 'console.log("changed")\n');
    commit(cwd, 'build helper');
    expect(decision()).toBe(1);
  });

  test('CI 専用の PostgREST 検査スクリプトとそのテストだけならスキップする', () => {
    writeFileSync(join(cwd, 'scripts', 'check-local-postgrest-head.py'), 'print("check")\n');
    writeFileSync(join(cwd, 'scripts', 'check-local-postgrest-head.test.py'), 'print("test")\n');
    commit(cwd, 'CI-only checker');
    expect(decision()).toBe(0);
  });

  test('ソースから文書へのリネームも元のソース変更としてビルドする', () => {
    mkdirSync(join(cwd, 'docs'));
    git(cwd, 'mv', 'src/app/page.tsx', 'docs/old-page.md');
    commit(cwd, 'rename source into docs');
    expect(decision()).toBe(1);
  });

  test('既存のVercel設定が判定スクリプトを呼び出す', () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'));
    expect(config.ignoreCommand).toBe('bash scripts/vercel-should-build.sh');
  });
});

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// Answers like GitHub's compare API, computed from the test repository.
const COMPARE_MOCK = `
const { execFileSync } = require('node:child_process');
const repo = process.argv[3];
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const match = process.argv[2].match(/\\/compare\\/([0-9a-f]+)\\.\\.\\.([0-9a-f]+)$/);
if (!match) process.exit(22);
let base;
let head;
try {
  base = git('rev-parse', '--verify', '--quiet', match[1] + '^{commit}');
  head = git('rev-parse', '--verify', '--quiet', match[2] + '^{commit}');
} catch {
  process.exit(22);
}
if (head !== match[2]) process.exit(22);
const mergeBase = git('merge-base', base, head);
const status = base === head ? 'identical' : mergeBase === base ? 'ahead' : 'diverged';
const commits = git('rev-list', '--reverse', base + '..' + head).split('\\n').filter(Boolean).map((sha) => ({ sha }));
const files = git('diff', '--name-status', '-M', base, head).split('\\n').filter(Boolean).map((line) => {
  const [kind, first, second] = line.split('\\t');
  return kind.startsWith('R') ? { filename: second, previous_filename: first, status: 'renamed' } : { filename: first, status: kind };
});
process.stdout.write(JSON.stringify({ status, base_commit: { sha: base }, merge_base_commit: { sha: mergeBase },
  total_commits: commits.length, commits, files }));
`;

describe('Vercel の配信スキップ判定', () => {
  let repo: string;
  let work: string;
  let initialSha: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'carelink-vercel-build-repo-'));
    // Vercel runs the step in a checkout without .git (.vercelignore removes it).
    work = mkdtempSync(join(tmpdir(), 'carelink-vercel-build-work-'));
    git(repo, 'init', '-q');
    git(repo, 'branch', '-M', 'main');
    mkdirSync(join(repo, 'scripts'));
    mkdirSync(join(repo, 'src', 'app'), { recursive: true });
    writeFileSync(join(repo, 'src', 'app', 'page.tsx'), 'export default function Page() { return null; }\n');
    initialSha = commit(repo, 'initial deployed application');
    mkdirSync(join(work, 'scripts'));
    mkdirSync(join(work, 'bin'));
    writeFileSync(join(work, 'scripts', 'vercel-should-build.sh'), sourceScript);
    writeFileSync(join(work, 'bin', 'compare.js'), COMPARE_MOCK);
    writeFileSync(join(work, 'bin', 'curl'), [
      '#!/bin/sh',
      'for arg; do url="$arg"; done',
      'case "$url" in',
      '  https://api.github.com/repos/jimuin0/carelink/compare/*)',
      '    printf \'%s\\n\' "$url" >> "$MOCK_CURL_LOG"',
      '    [ -z "${MOCK_COMPARE_FAIL:-}" ] || exit 22',
      '    if [ -n "${MOCK_COMPARE_FILE:-}" ]; then cat "$MOCK_COMPARE_FILE"; exit 0; fi',
      '    exec node "$MOCK_BIN/compare.js" "$url" "$MOCK_REPO" ;;',
      '  https://carelink-jp.com/api/health)',
      '    printf \'%s\\n\' "$url" >> "$MOCK_CURL_LOG"',
      '    [ -z "${MOCK_HEALTH_FAIL:-}" ] || exit 22',
      '    printf \'{"version":"%s"}\\n\' "$MOCK_LIVE_VERSION" ;;',
      '  *) exit 22 ;;',
      'esac',
      '',
    ].join('\n'));
    chmodSync(join(work, 'bin', 'curl'), 0o755);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });

  type Options = {
    env?: 'production' | 'preview';
    previous?: string;
    head?: string;
    live?: string;
    compareFail?: boolean;
    healthFail?: boolean;
    compare?: unknown;
  };

  function run(options: Options = {}) {
    const compareFile = join(work, 'bin', 'override.json');
    rmSync(compareFile, { force: true });
    if (options.compare !== undefined) writeFileSync(compareFile, typeof options.compare === 'string' ? options.compare : JSON.stringify(options.compare));
    rmSync(join(work, 'bin', 'curl.log'), { force: true });
    const result = spawnSync('bash', ['scripts/vercel-should-build.sh'], {
      cwd: work,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(work, 'bin')}:${process.env.PATH}`,
        GIT_CEILING_DIRECTORIES: tmpdir(),
        MOCK_BIN: join(work, 'bin'),
        MOCK_REPO: repo,
        MOCK_CURL_LOG: join(work, 'bin', 'curl.log'),
        MOCK_LIVE_VERSION: options.live ?? initialSha.slice(0, 7),
        MOCK_COMPARE_FAIL: options.compareFail ? '1' : '',
        MOCK_HEALTH_FAIL: options.healthFail ? '1' : '',
        MOCK_COMPARE_FILE: options.compare === undefined ? '' : compareFile,
        VERCEL_ENV: options.env ?? 'production',
        VERCEL_GIT_PREVIOUS_SHA: options.previous ?? '',
        VERCEL_GIT_COMMIT_SHA: options.head ?? git(repo, 'rev-parse', 'HEAD'),
      },
    });
    if (result.error) throw result.error;
    return result;
  }

  function curlLog(): string {
    const log = join(work, 'bin', 'curl.log');
    return existsSync(log) ? readFileSync(log, 'utf8') : '';
  }

  function docsOnly(message = 'docs only'): string {
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'docs', 'handoff.md'), `${message}\n`);
    return commit(repo, message);
  }

  test('判定は git を使わない（Vercel では .git が取り除かれる）', () => {
    const vercelIgnore = readFileSync(join(process.cwd(), '.vercelignore'), 'utf8').split('\n');
    expect(vercelIgnore).toContain('.git');
    const commands = sourceScript.split('\n').filter((line) => !/^\s*(#|\/\/)/.test(line));
    expect(commands.filter((line) => /(^|[\s;|&(])git\s/.test(line))).toEqual([]);
  });

  test('本番でも前回成功配信から文書だけの変更ならスキップする', () => {
    const head = docsOnly();
    const result = run({ previous: initialSha });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('GitHub照合=yes');
    // The comparison is anchored on the last successful deployment and this exact commit.
    expect(curlLog()).toContain(`/compare/${initialSha}...${head}`);
    // Production never substitutes the live revision for the previous deployment.
    expect(curlLog()).not.toContain(`/compare/${initialSha.slice(0, 7)}...`);
    // A skip is a green check on GitHub, so the log must allow auditing it.
    expect(result.stdout).toContain(`対象=${head}`);
    expect(result.stdout).toContain(`前回成功=${initialSha}`);
    expect(result.stdout).toContain(`比較元=${initialSha}`);
    expect(result.stdout).toContain('省略対象の変更: docs/handoff.md');
  });

  test('本番で前回成功した配信が稼働中の版でなければビルドする', () => {
    // e.g. another deployment was promoted, or a successful build never reached production.
    const promoted = docsOnly('promoted elsewhere');
    git(repo, 'switch', '-q', '-c', 'later');
    docsOnly('docs after promotion');
    const result = run({ previous: initialSha, live: promoted.slice(0, 7) });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('本番で稼働中の版と一致しない');
    expect(curlLog()).not.toContain('/compare/');
  });

  test('本番で稼働中の版を確認できなければビルドする', () => {
    docsOnly();
    expect(run({ previous: initialSha, healthFail: true }).status).toBe(1);
    expect(curlLog()).not.toContain('/compare/');
    expect(run({ previous: initialSha, live: 'not-a-sha' }).status).toBe(1);
  });

  test('配信に関わるファイルの変更は文書と一緒でも必ずビルドする', () => {
    // Widening the safe list must turn at least one of these red.
    const deployInputs = [
      'Dockerfile.vercel', '.vercelignore', 'vercel.json', 'package.json', 'package-lock.json',
      'next.config.mjs', 'tsconfig.json', '.env.example', 'public/robots-extra.txt', 'src/lib/helper.ts',
      'src/middleware.ts', 'src/app/api/health/route.ts', 'scripts/build-runtime-config-base.mjs',
      'supabase/config.toml', 'eslint-plugin-carelink-safety/index.js', 'llms.txt',
    ];
    for (const path of deployInputs) {
      git(repo, 'switch', '-q', '-C', 'case', initialSha);
      mkdirSync(join(repo, path, '..'), { recursive: true });
      writeFileSync(join(repo, path), `changed ${path}\n`);
      docsOnly(`docs with ${path}`);
      const result = run({ previous: initialSha });
      expect({ path, status: result.status }).toEqual({ path, status: 1 });
      expect(result.stdout).toContain(`配信物に影響する変更: ${path}`);
    }
    // Spawns git, bash and node for each path; keep headroom on a loaded CI runner.
  }, 60_000);

  test('途中でアプリ変更の配信が失敗したら後続の文書変更で隠さない', () => {
    writeFileSync(join(repo, 'src', 'app', 'page.tsx'), 'export default function Page() { return <p>updated</p>; }\n');
    commit(repo, 'application change that did not deploy');
    docsOnly('docs after failed deploy');
    expect(run({ previous: initialSha }).status).toBe(1);
  });

  test('本番で前回成功SHAが無い・不明・現在と同じならビルドする', () => {
    docsOnly();
    expect(run({ previous: '' }).status).toBe(1);
    expect(curlLog()).not.toContain('/compare/');
    expect(run({ previous: '0'.repeat(40) }).status).toBe(1);
    const head = git(repo, 'rev-parse', 'HEAD');
    expect(run({ previous: head }).status).toBe(1);
  });

  test('ビルド対象のコミットが分からなければビルドする', () => {
    docsOnly();
    expect(run({ previous: initialSha, head: '' }).status).toBe(1);
    expect(run({ previous: initialSha, head: 'abc' }).status).toBe(1);
    expect(curlLog()).not.toContain('/compare/');
  });

  test('ビルドに使うスクリプトの変更はビルドする', () => {
    writeFileSync(join(repo, 'scripts', 'ensure-eslint-plugin-link.mjs'), 'console.log("changed")\n');
    commit(repo, 'build helper');
    expect(run({ previous: initialSha }).status).toBe(1);
  });

  test('CI 専用の PostgREST 検査スクリプトとそのテストだけならスキップする', () => {
    writeFileSync(join(repo, 'scripts', 'check-local-postgrest-head.py'), 'print("check")\n');
    writeFileSync(join(repo, 'scripts', 'check-local-postgrest-head.test.py'), 'print("test")\n');
    commit(repo, 'CI-only checker');
    expect(run({ previous: initialSha }).status).toBe(0);
  });

  test('ソースから文書へのリネームも元のソース変更としてビルドする', () => {
    mkdirSync(join(repo, 'docs'));
    git(repo, 'mv', 'src/app/page.tsx', 'docs/old-page.md');
    commit(repo, 'rename source into docs');
    expect(run({ previous: initialSha }).status).toBe(1);
  });

  test('初回プレビューでも公開済みコミットから文書だけならビルドを省略する', () => {
    git(repo, 'switch', '-q', '-c', 'preview');
    const head = docsOnly();
    expect(run({ env: 'preview' }).status).toBe(0);
    expect(curlLog()).toContain(`/compare/${initialSha.slice(0, 7)}...${head}`);
  });

  test('リベース前の前回プレビューSHAで比較できなくても公開版から文書だけなら省略する', () => {
    git(repo, 'switch', '-q', '-c', 'preview');
    docsOnly();
    expect(run({ env: 'preview', previous: '0'.repeat(40) }).status).toBe(0);
    expect(curlLog()).toContain(`/compare/${'0'.repeat(40)}...`);
  });

  test('初回プレビューでも未配信のアプリ変更があればビルドする', () => {
    writeFileSync(join(repo, 'src', 'app', 'page.tsx'), 'export default function Page() { return <p>updated</p>; }\n');
    commit(repo, 'application change not yet deployed');
    git(repo, 'switch', '-q', '-c', 'preview');
    docsOnly('docs after application change');
    expect(run({ env: 'preview' }).status).toBe(1);
  });

  test('公開版を特定できない初回プレビューはビルドする', () => {
    git(repo, 'switch', '-q', '-c', 'preview');
    docsOnly();
    expect(run({ env: 'preview', live: '0000000' }).status).toBe(1);
    expect(run({ env: 'preview', live: 'not-a-sha' }).status).toBe(1);
  });

  test('GitHub の比較を取得できなければビルドする', () => {
    git(repo, 'switch', '-q', '-c', 'preview');
    docsOnly();
    const result = run({ env: 'preview', compareFail: true });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('GitHub照合=no');
  });

  test('GitHub の比較が不完全・別系統・別コミットならビルドする', () => {
    git(repo, 'switch', '-q', '-c', 'preview');
    const head = docsOnly();
    const docs = [{ filename: 'docs/handoff.md' }];
    const other = '1'.repeat(40);
    const comparison = (overrides: Record<string, unknown> = {}, files: unknown[] = docs) => ({
      status: 'ahead',
      base_commit: { sha: initialSha },
      merge_base_commit: { sha: initialSha },
      total_commits: 1,
      commits: [{ sha: head }],
      files,
      ...overrides,
    });
    // The well-formed answer itself skips, so each case below fails only for its own reason.
    expect(run({ env: 'preview', compare: comparison() }).status).toBe(0);
    const cases: unknown[] = [
      'not json',
      comparison({ status: 'diverged' }),
      comparison({ status: 'identical' }),
      comparison({ base_commit: { sha: other }, merge_base_commit: { sha: other } }),
      comparison({ merge_base_commit: { sha: other } }),
      comparison({ commits: [{ sha: other }] }),
      comparison({ total_commits: 2 }),
      comparison({}, Array.from({ length: 300 }, (_, i) => ({ filename: `docs/${i}.md` }))),
      comparison({}, []),
      comparison({}, [{ filename: '' }]),
      comparison({}, [{ filename: 'docs/handoff.md', previous_filename: 7 }]),
      comparison({}, [{ filename: 'docs/handoff.md', previous_filename: 'src/app/page.tsx' }]),
    ];
    for (const compare of cases) {
      expect({ compare, status: run({ env: 'preview', compare }).status }).toEqual({ compare, status: 1 });
    }
  }, 60_000);

  test('既存のVercel設定が判定スクリプトを呼び出す', () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'));
    expect(config.ignoreCommand).toBe('bash scripts/vercel-should-build.sh');
  });
});

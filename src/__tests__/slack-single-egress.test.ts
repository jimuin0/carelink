/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Slack への送信は src/lib/slack.ts の postToSlack だけを通す（2026-11-03）。
 *
 * 公開閲覧専用の Preview には本番の Slack トークンが入っており、middleware の対象外の
 * API（withRoute を使わないもの）は Preview でも処理まで届く。postToSlack は Preview で
 * 送らないので、ほかの場所が Slack の API を直接呼べば、その止め方を素通りする。
 * 個々の呼び出し元を列挙して守るのではなく、出口が 1 つであることを固定する。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const SRC = path.join(__dirname, '..');
const EGRESS = path.join(SRC, 'lib', 'slack.ts');
// Slack の Web API・Incoming Webhook・response_url の送り先。
const SLACK_ENDPOINT = /slack\.com\/api|hooks\.slack\.com|slack\.com\/(?:services|actions)/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return /\.(?:ts|tsx|mjs|js)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

function filesCallingSlackDirectly(files: string[]): string[] {
  return files.filter((file) => file !== EGRESS && SLACK_ENDPOINT.test(fs.readFileSync(file, 'utf8')));
}

test('Slack の送り先を持つのは src/lib/slack.ts だけ', () => {
  const files = sourceFiles(SRC);
  // 空振り防止：走査が実際にソースを読んでいること、出口自体は検出されること。
  expect(files.length).toBeGreaterThan(200);
  expect(files).toContain(EGRESS);
  expect(SLACK_ENDPOINT.test(fs.readFileSync(EGRESS, 'utf8'))).toBe(true);
  expect(filesCallingSlackDirectly(files).map((f) => path.relative(SRC, f))).toEqual([]);
});

test('負の対照：ほかのファイルが Slack の API を書けば検出する', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-egress-'));
  try {
    const planted = path.join(dir, 'direct.ts');
    fs.writeFileSync(planted, "await fetch('https://hooks.slack.com/services/T/B/x');");
    expect(filesCallingSlackDirectly([planted])).toEqual([planted]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('postToSlack は送信の前に公開閲覧専用の Preview を止める', () => {
  const source = fs.readFileSync(EGRESS, 'utf8');
  const body = source.slice(source.indexOf('export async function postToSlack'));
  const guard = body.indexOf('if (isPublicReadOnlyPreview())');
  const send = body.indexOf('fetch(');
  expect(guard).toBeGreaterThan(-1);
  expect(send).toBeGreaterThan(guard);
});

/**
 * B10-14: 並行性検査スクリプトに特定の利用者のホームディレクトリ（/Users/<名前>）を固定しない。
 * 別の人・別の端末では必ず「専用ソケットではない」と誤って止まり、検査が実行できなくなるため。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { readdirSync } from 'fs';

const scripts = readdirSync(join(process.cwd(), 'scripts')).filter((f) => /^check-.*-concurrency\.(mjs|py)$/.test(f));

test('並行性検査スクリプトが見つかる（空振り防止）', () => {
  expect(scripts.length).toBeGreaterThan(20);
});

test.each(scripts)('scripts/%s は個人環境のパスを直書きしない', (file) => {
  const text = readFileSync(join(process.cwd(), 'scripts', file), 'utf8');
  expect(text).not.toMatch(/\/Users\/[A-Za-z0-9_-]+\//);
  expect(text).not.toMatch(/carelink-vm-\d+/);
});

// A432: 専用ソケットは CARELINK_LOCAL_DOCKER_HOST で明示させ、共通の確認関数を通す。
test.each([
  'check-moderation-photo-concurrency.mjs',
  'check-newsletter-delivery-concurrency.mjs',
  'check-review-atomic-concurrency.mjs',
  'check-salon-intent-concurrency.mjs',
])('scripts/%s はローカル Docker 経路で requireDedicatedDockerHost を通す', (file) => {
  const text = readFileSync(join(process.cwd(), 'scripts', file), 'utf8');
  expect(text).toContain("from './local-docker-host.mjs'");
  expect(text).toContain('requireDedicatedDockerHost()');
});

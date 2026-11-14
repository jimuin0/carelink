/**
 * scripts/check-env-example.mjs が Resend のキーを、区切りにアンダースコアを含む形
 * （re_xxxxxxxx_yyyy… のように最初の区切りまでが 20 文字未満）でも検出することを固定する。
 * 以前の正規表現 /\bre_[A-Za-z0-9]{20,}/ はアンダースコアで途切れ、この形を素通りさせていた。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts', 'check-env-example.mjs');

function run(content: string) {
  const dir = mkdtempSync(join(tmpdir(), 'env-example-'));
  try {
    writeFileSync(join(dir, '.env.example'), content);
    return spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('check-env-example: Resend API key', () => {
  it('アンダースコア区切りのキーを検出して失敗する', () => {
    // 実在しない合成値（区切り前は 8 文字）
    const result = run(`RESEND_API_KEY=re_Ab12Cd34_${'Zz9'.repeat(8)}\n`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Resend API key');
  });

  it('プレースホルダは通す（負の対照）', () => {
    const result = run('RESEND_API_KEY=your_resend_api_key_here\n');
    expect(result.status).toBe(0);
  });
});

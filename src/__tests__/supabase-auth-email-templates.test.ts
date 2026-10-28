/** @jest-environment node */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Supabase Auth の確認メール・パスワード再設定メールの文面は、以前はリポジトリに無く
 * （本番ダッシュボードにだけ在り、ローカル・CI は Supabase 既定の英語文面）、何が送られているかを
 * 誰も確認できなかった。日本語の文面を supabase/templates/ に置き、config.toml から参照する。
 *
 * 🔴 content_path はリポジトリ直下からの相対で書く。Supabase CLI（v2.104.0 の pkg/config/config.go）は
 * auth.email.template だけを「supabase/ の親ディレクトリ」基準で解決し、読めないと `supabase start` が
 * 失敗する（＝CI の E2E が全滅する）。ここで同じ基準で実在を確かめる。
 */
const ROOT = process.cwd();
const config = readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8');

function section(name: string): Record<string, string> {
  const match = config.match(new RegExp(`^\\[${name.replace(/\./g, '\\.')}\\]\\n([\\s\\S]*?)(?=^\\[|^#|(?![\\s\\S]))`, 'm'));
  if (!match) return {};
  return Object.fromEntries([...match[1].matchAll(/^(\w+)\s*=\s*"([^"]*)"\s*$/gm)].map(m => [m[1], m[2]]));
}

const TEMPLATES = [
  {
    kind: 'confirmation',
    subject: '【CareLink】メールアドレスの確認をお願いします',
    heading: 'メールアドレスの確認',
    button: 'メールアドレスを確認する',
    required: ['ありがとうございます', '掲載申込', '店舗アカウント', '心当たりがない場合'],
  },
  {
    kind: 'recovery',
    subject: '【CareLink】パスワードの再設定',
    heading: 'パスワードの再設定',
    button: 'パスワードを再設定する',
    required: ['同じブラウザで開いてください', '心当たりがない場合'],
  },
] as const;

describe.each(TEMPLATES)('auth email template: $kind', ({ kind, subject, heading, button, required }) => {
  const entry = section(`auth.email.template.${kind}`);

  test('config.toml references it with a Japanese subject and a repo-relative content_path', () => {
    expect(entry.subject).toBe(subject);
    expect(entry.content_path).toBe(`./supabase/templates/${kind}.html`);
    expect(existsSync(join(ROOT, entry.content_path))).toBe(true);
  });

  test('the body is Japanese, links only through the Supabase confirmation URL and says what to do', () => {
    const html = readFileSync(join(ROOT, 'supabase/templates', `${kind}.html`), 'utf8');
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="ja">');
    expect(html).toMatch(new RegExp(`<h1(?: [^>]*)?>${heading}</h1>`));
    expect(html).toMatch(new RegExp(`<a href="\\{\\{ \\.ConfirmationURL \\}\\}"[^>]*>${button}</a>`));
    for (const text of required) expect(html).toContain(text);
    // 差し込み変数は確認 URL だけ（綴りを誤ると Supabase の送信時にテンプレートが壊れる）。
    expect([...new Set(html.match(/\{\{[^}]*\}\}/g))]).toEqual(['{{ .ConfirmationURL }}']);
    // 外部の画像・スクリプトを読み込まない（メールソフトで遮断され、追跡にも見える）。
    expect(html).not.toMatch(/<(img|script|link)\b/i);
  });
});

test('the local auth flow the E2E relies on is unchanged (sign-up without email confirmation)', () => {
  expect(config).toMatch(/^\[auth\.email\]\n[\s\S]*?^enable_confirmations = false$/m);
});

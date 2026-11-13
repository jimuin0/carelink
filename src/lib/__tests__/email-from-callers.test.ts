import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * 送信元の env を直読みする箇所を作らせない（2026年7月31日 新設）。
 *
 * 【なぜ必要か＝実際に起きていた取りこぼし】
 * 未検証ドメインを検証済み既定値へ倒すガードを email.ts に入れたが、それだけでは
 * 守れていなかった。cron 5本（review-request / waitlist-notify / customer-segment /
 * birthday-coupon / webhook-retry）とニュースレター配信が
 * `process.env.EMAIL_FROM || 'CareLink <noreply@...>'` を各自で組み立てて
 * resend.emails.send を直接呼んでおり、ガードを完全に迂回していた。
 * これらは予約リマインド・口コミ依頼など【ローンチ直後に客へ最初に届くメール】そのもので、
 * 最も守りたい経路が一番外れていた。
 *
 * 一箇所ずつ直しても、新しい送信箇所が増えるたびに同じ迂回が再発する。
 * env の読み取りを email-from.ts に閉じ込め、それ以外での直読みをここで機械的に禁じる。
 * これは「直し忘れ」を人の注意力に頼らない構造にするための検査である。
 */

const SRC = join(process.cwd(), 'src');
const SSOT = 'src/lib/email-from.ts';
const BANNED = ['process.env.EMAIL_FROM', 'process.env.NEWSLETTER_EMAIL_FROM'];

/**
 * 「表示名 <ローカル部@ドメイン>」形式のアドレス直書きを検出する。
 * 以前は `CareLink <noreply|newsletter@` だけを見ていたため、support@・info@ や
 * 表示名を変えた直書き（`Foo <noreply@...>`）を素通ししていた（点検 A49）。
 * 説明文中の RFC 予約例（example.com 等）は送信元ではないので除く。
 */
function hasHardcodedMailbox(line: string): boolean {
  const re = /<([^<>\s'"`]+)@([^<>\s'"`]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (!/^example\.(com|org|net)$/i.test(m[2])) return true;
  }
  return false;
}

/**
 * email-from.ts 以外で送信元の直書きを許すファイル（理由必須）。
 * platform-mail-contract.ts: 運営メール画面の From は support@ に固定する設計（CLAUDE.md「運営メール画面」）。
 */
const ADDRESS_ALLOWED = new Set(['src/lib/platform-mail-contract.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue; // テストは env を操作して検証するため対象外
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('送信元 env の直読み禁止（email-from.ts が唯一の入口）', () => {
  const files = walk(SRC).map((f) => relative(process.cwd(), f));

  it('走査対象のファイルが十分に集まっている（検査が空振りしていないことの確認）', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(SSOT);
  });

  it.each(BANNED)('%s は email-from.ts 以外に現れない', (banned) => {
    const offenders = files.filter(
      (f) => f !== SSOT && readFileSync(join(process.cwd(), f), 'utf8').includes(banned)
    );
    expect(offenders).toEqual([]);
  });

  /**
   * 既定値のハードコードも禁じる。`process.env.EMAIL_FROM` を消しても
   * `'CareLink <noreply@carelink-jp.com>'` を直書きすれば同じ迂回が復活し、
   * 検証済みドメインを変更したときに一箇所だけ古い値が残る。
   */
  it('送信元アドレスのハードコードが email-from.ts 以外に無い', () => {
    const offenders = files.filter((f) => {
      if (f === SSOT || ADDRESS_ALLOWED.has(f)) return false;
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      // コメント行での言及（経緯の説明）は許す。実コードでの使用のみ検出する。
      return src
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .some((line) => hasHardcodedMailbox(line));
    });
    expect(offenders).toEqual([]);
  });
});

describe('hasHardcodedMailbox（直書き検出器そのものの検証）', () => {
  it.each([
    "'CareLink <noreply@carelink-jp.com>'",
    "'CareLink <support@carelink-jp.com>'",
    '"Shop <info@carelink-jp.com>"',
    '`CareLink <noreply@${domain}>`',
    "'X <a@resend.dev>'",
  ])('検出する: %s', (line) => expect(hasHardcodedMailbox(line)).toBe(true));
  it.each(["'形式（Name <email@example.com>）で設定'", "const a = '<div>'", "'a@b.com'"])(
    '検出しない: %s',
    (line) => expect(hasHardcodedMailbox(line)).toBe(false),
  );
});

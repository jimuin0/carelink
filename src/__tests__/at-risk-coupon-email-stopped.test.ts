/**
 * 離脱リスク（at_risk）客への自動クーポンメールを止めたままにする（2026年10月22日 神原さん決定）。
 *
 * 🔴 なぜ止めたか
 * customer-segment cron は、最終来店から 60〜66 日の離脱リスク客へ
 * 「【店名】お久しぶりです！特別クーポンをお届けします」「クーポンコード: BACK…」「500円引き」を
 * 店舗の名前で自動送信していた。ところが
 *   - 予約フロー・/api/booking にコードを入れる場所が無く、オンラインでは値引きできない
 *   - 店舗の管理画面にも発行済みコードを確認する手段が無く、店頭でも照合できない
 *   - 店舗は送信に同意しておらず、送られていることも知らされていない
 *   - マイページの「お知らせメール」OFF も配信停止リンクも効かない
 * という、守れない約束を店舗の名前でする状態だった。送信は撤去し、RFM 分類だけを続けている。
 *
 * 【この検査の性質】
 * 送信の入口（クーポン発行＋メール予約の RPC と、それを包んでいた lib）を src から呼ぶ箇所が
 * 1 つでも戻ったら落とす。フラグで止める形にしなかったのは、誰かがうっかり戻せる
 * スイッチを残さないため。DB 側の RPC（reserve_/prepare_customer_coupon_email_atomic）は
 * migration 群と shadow の検査が参照しているので残してあるが、アプリからは呼ばない。
 *
 * 再開するなら、先に「コードを予約・店頭で使える仕組み」「店舗ごとの同意（既定 OFF）」
 * 「配信停止の確認と停止リンク」を揃え、その上でこの検査を書き換えること。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const SELF = 'src/__tests__/at-risk-coupon-email-stopped.test.ts';

/** 生成物（DB の型・スキーマの写し）は DB に残る RPC 名を載せているだけなので対象外。 */
const GENERATED = new Set(['src/types/database.types.ts']);

/** 送信の入口。どれか 1 つでも src に現れたら、クーポンメールの経路が戻ったとみなす。 */
const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /reserve_customer_coupon_email_atomic/, why: 'クーポンを発行して送信予約を作る RPC' },
  { pattern: /prepare_customer_coupon_email_atomic/, why: '送信キュー（webhook_retry_queue）へ積む RPC' },
  { pattern: /queueCustomerCouponEmail/, why: '上の 2 つを包んでいた関数' },
  { pattern: /customer-coupon-email/, why: '撤去した lib（src/lib/customer-coupon-email.ts）の import' },
  { pattern: /from\(\s*['"`]user_coupon_codes['"`]\s*\)/, why: '使い道の無いクーポンコード表への直接アクセス' },
  { pattern: /from\(\s*['"`]customer_coupon_email_operations['"`]\s*\)/, why: '送信予約の台帳への直接アクセス' },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function findCouponMailEntrypoints(source: string): string[] {
  return FORBIDDEN.filter(({ pattern }) => pattern.test(source)).map(({ why }) => why);
}

describe('離脱リスク客への自動クーポンメール（停止中）', () => {
  const files = sourceFiles(SRC)
    .map((full) => ({ rel: relative(ROOT, full).split('\\').join('/'), full }))
    .filter(({ rel }) => rel !== SELF && !GENERATED.has(rel));

  it('走査が空振りしていない（src 全体と customer-segment cron を実際に読んでいる）', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.map((f) => f.rel)).toContain('src/app/api/cron/customer-segment/route.ts');
  });

  it('検出器は旧実装の呼び出しを実際に検出できる（負の対照）', () => {
    const oldCronCall = `import { queueCustomerCouponEmail } from '@/lib/customer-coupon-email';
      const outcome = await queueCustomerCouponEmail(supabase, { facilityId: facility.id });`;
    const oldLibCall = `await db.rpc('reserve_customer_coupon_email_atomic', {});
      await db.rpc('prepare_customer_coupon_email_atomic', {});`;
    expect(findCouponMailEntrypoints(oldCronCall).length).toBeGreaterThan(0);
    expect(findCouponMailEntrypoints(oldLibCall).length).toBe(2);
    expect(findCouponMailEntrypoints("supabase.from('user_coupon_codes').insert({})")).toHaveLength(1);
    expect(findCouponMailEntrypoints("supabase.from('customer_segments').upsert([])")).toEqual([]);
  });

  it('src のどこからもクーポン発行・メール予約の入口を呼ばない', () => {
    const offenders = files
      .map(({ rel, full }) => ({ rel, hits: findCouponMailEntrypoints(readFileSync(full, 'utf8')) }))
      .filter(({ hits }) => hits.length > 0)
      .map(({ rel, hits }) => `${rel}: ${hits.join(' / ')}`);
    expect(offenders).toEqual([]);
  });

  it('撤去した送信用 lib が復活していない', () => {
    expect(existsSync(join(SRC, 'lib', 'customer-coupon-email.ts'))).toBe(false);
  });

  it('customer-segment cron はメール送信・送信キュー・RPC に触れない（分類だけを行う）', () => {
    const route = readFileSync(join(SRC, 'app', 'api', 'cron', 'customer-segment', 'route.ts'), 'utf8');
    // コメントの説明文は除いて、実際のコードだけを見る
    const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/RESEND_API_KEY|resend|sendEmail|sendOperatorNotification/i);
    expect(code).not.toMatch(/webhook_retry_queue/);
    expect(code).not.toMatch(/\.rpc\(/);
    // 分類の更新は続けている（停止の巻き添えで RFM まで止めていない）
    expect(code).toMatch(/from\('customer_segments'\)\s*\.upsert\(/);
  });
});

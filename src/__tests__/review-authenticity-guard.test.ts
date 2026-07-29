/**
 * 口コミ真正性ガードの整合テスト（2026年7月29日 新設）。
 *
 * 【背景・実データで確定】
 * 本番 facility_reviews に、サイト経由でない口コミ13件が一括 INSERT されていた
 * （created_at がマイクロ秒まで一致＝1回の INSERT 文／user_id・booking_id・reviewer_ip・
 * visit_date がすべて NULL）。これが rating_avg 経由で公開ページに ★4.6〜4.8 として表示され、
 * うち3件は予約実績が無いのに is_verified_visit=true ＝「来店確認済み」バッジ付きだった。
 * 表示確認用に作った文面であることを確認し、14件（テスト投稿1件を含む）を削除済み。
 *
 * 【このテストが守るもの】
 * 削除は症状の除去にすぎない。二度と起きないための予防は、
 *   (1) DB の CHECK 制約（migration 20260729000002）＝入口の物理封鎖
 *   (2) schema-drift-check cron の値監視＝制約が外された場合の検知
 * の2層で、その2層が成立する前提は「/api/review が唯一の INSERT 経路であり、
 * reviewer_ip を必ず書き、is_verified_visit を user_id 無しで true にしない」こと。
 * この前提が崩れると制約が正規の投稿を弾く（＝口コミが投稿できなくなる）ため、
 * 前提・制約・監視の3つが揃っていることをここで固定する。
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('口コミ真正性ガード', () => {
  describe('DB の CHECK 制約（入口の物理封鎖）', () => {
    const migrationName = '20260729000002_facility_reviews_authenticity_constraints.sql';
    const sql = read(join('supabase/migrations', migrationName));

    test('migration が存在する', () => {
      const files = readdirSync(join(root, 'supabase/migrations'));
      expect(files).toContain(migrationName);
    });

    test('サイト経由でない投入を禁じる制約が定義されている', () => {
      expect(sql).toContain('facility_reviews_reviewer_ip_required');
      expect(sql.replace(/\s+/g, ' ')).toContain('CHECK (reviewer_ip IS NOT NULL)');
    });

    test('裏付けの無い「来店確認済み」を禁じる制約が定義されている', () => {
      expect(sql).toContain('facility_reviews_verified_visit_requires_user');
      expect(sql.replace(/\s+/g, ' ')).toContain(
        'CHECK (is_verified_visit IS NOT TRUE OR user_id IS NOT NULL)',
      );
    });
  });

  describe('制約が正規の投稿を弾かない前提（これが崩れると口コミが投稿不能になる）', () => {
    const route = read('src/app/api/review/route.ts');

    test('facility_reviews への INSERT は /api/review の1経路のみ', () => {
      const offenders: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
          const rel = `${dir}/${entry.name}`;
          if (entry.isDirectory()) {
            if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
            walk(rel);
            continue;
          }
          if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
          const src = read(rel);
          // `.from('facility_reviews')` に続けて `.insert(` を呼んでいる箇所を拾う。
          if (/from\(\s*'facility_reviews'\s*\)[\s\S]{0,200}?\.insert\(/.test(src)) {
            offenders.push(rel);
          }
        }
      };
      walk('src');
      expect(offenders).toEqual(['src/app/api/review/route.ts']);
    });

    test('/api/review は reviewer_ip を必ず書く（条件付きにしない）', () => {
      // `...(cond ? { reviewer_ip } : {})` のような条件付きになると NULL があり得るため、
      // 無条件の `reviewer_ip: ip,` であることを固定する。
      expect(route).toMatch(/^\s*reviewer_ip:\s*ip,\s*$/m);
      expect(route).toContain('const ip = getClientIp(request);');
    });

    test('getClientIp は null を返さない（取得不能でも文字列を返す）', () => {
      const clientIp = read('src/lib/client-ip.ts');
      expect(clientIp).toMatch(/export function getClientIp\([^)]*\):\s*string\s*\{/);
      expect(clientIp).toContain("return 'unknown';");
    });

    test('is_verified_visit を立てるのはログイン済みの場合だけ', () => {
      // `...(user ? { user_id: user.id, is_verified_visit: isVerifiedVisit } : {})` の形。
      // user_id と同じ三項の中にあること＝user_id 無しで true になり得ないことを固定する。
      expect(route.replace(/\s+/g, ' ')).toContain(
        '...(user ? { user_id: user.id, is_verified_visit: isVerifiedVisit } : {})',
      );
    });
  });

  describe('制約が外された場合の検知（2層目）', () => {
    const cron = read('src/app/api/cron/schema-drift-check/route.ts');

    test('schema-drift-check が reviewer_ip 欠落を監視している', () => {
      expect(cron).toContain("is('reviewer_ip', null)");
    });

    test('schema-drift-check が裏付けの無い来店確認済みを監視している', () => {
      expect(cron.replace(/\s+/g, ' ')).toContain(
        ".eq('is_verified_visit', true) .is('user_id', null)",
      );
    });

    test('検知結果が driftCount に算入される（数えるだけで通知しない状態を防ぐ）', () => {
      // 【重要】`/driftCount\s*=[\s\S]*?reviewAuthenticityDrift\.length/` と書いてはならない。
      // [\s\S] は改行もセミコロンも越えるため、driftCount の式から外しても、後段の
      // alert メッセージ内にある `${reviewAuthenticityDrift.length}` にマッチして通ってしまう。
      // 実際に敵対検証で、driftCount の加算から外した状態でこのテストが緑のままだった
      // （2026年7月29日 実測）。式そのものを見るため、セミコロンを越えない [^;]* で囲う。
      const expr = cron.match(/const driftCount\s*=[^;]*;/);
      expect(expr).not.toBeNull();
      expect(expr![0]).toContain('reviewAuthenticityDrift.length');
    });
  });
});

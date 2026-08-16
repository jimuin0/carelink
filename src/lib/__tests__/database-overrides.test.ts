/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * `src/types/database-overrides.ts` の上書きが【今も必要か】を検査する。
 *
 * 🔴 なぜ必要か: 上書きは生成物 `database.types.ts` の一部を差し替えるので、生成器が将来
 * 関数引数の nullable を表現できるようになっても【何も壊れない】。壊れない代わりに、
 * 不要になった上書きが誰にも気づかれないまま永久に残り、生成物と手書きが二重管理になる。
 * 逆に上流が引数名を変えた場合、上書きは存在しないキーに対して働くので【黙って無効化】され、
 * 呼び出し側の `?? null` が型エラーになるまで誰も気づけない。どちらも lint も tsc も
 * 素通りするので、専用の検査が要る。
 *
 * ⚠️ このテストが赤くなったら、直すのはこのテストではなく上書きのほう。
 * メッセージに「上書きを外す」「引数名を追随させる」のどちらが必要かを書いてある。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { CREATE_BOOKING_NULLABLE_ARGS } from '@/types/database-overrides';
import type { Database } from '@/types/database-overrides';

const repoRoot = join(__dirname, '../../..');
const GENERATED_TYPES = join(repoRoot, 'src/types/database.types.ts');
// database-overrides.ts が根拠として挙げている migration。
const CITED_MIGRATION = join(
  repoRoot,
  'supabase/migrations/20260717000001_booking_gate_after_g1.sql',
);

/** 生成物から `create_booking_atomic` の Args ブロックだけを取り出す。 */
function generatedCreateBookingArgs(): Record<string, string> {
  const src = readFileSync(GENERATED_TYPES, 'utf8');
  const start = src.indexOf('create_booking_atomic: {');
  if (start === -1) throw new Error('生成物に create_booking_atomic が見つからない');
  const argsStart = src.indexOf('Args: {', start);
  const argsEnd = src.indexOf('}', argsStart);
  const block = src.slice(argsStart + 'Args: {'.length, argsEnd);

  const args: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*(p_[a-z_]+)\??:\s*(.+?)\s*$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

describe('database-overrides.ts の上書きが今も必要か', () => {
  const args = generatedCreateBookingArgs();

  it('【空振り防止】生成物から Args を実際に読み取れている', () => {
    // 解析に失敗して空オブジェクトになった場合、以降の each が 0 件実行になり
    // 「全部通った」ように見えてしまう。実測で 16 引数あるので下限を置く。
    expect(Object.keys(args).length).toBeGreaterThan(10);
    expect(args).toHaveProperty('p_facility_id');
  });

  it.each(CREATE_BOOKING_NULLABLE_ARGS)(
    '%s が生成物に実在する（上書きが空振りしていない）',
    (argName) => {
      // 上流が引数名を変えると、上書きは存在しないキーを Omit するだけの無意味な型になり
      // 黙って効かなくなる。その状態をここで止める。
      expect(Object.keys(args)).toContain(argName);
    },
  );

  it.each(CREATE_BOOKING_NULLABLE_ARGS)(
    '%s は生成物ではまだ非 null（上書きがまだ必要）',
    (argName) => {
      const declared = args[argName];
      // 生成器が `string | null` を出すようになったら上書きは不要。
      // その場合ここが赤くなるので、database-overrides.ts から当該引数を外すこと。
      expect(declared).toBeDefined();
      expect(declared).not.toMatch(/\|\s*null/);
    },
  );

  it('根拠として挙げている migration が実在し、対象引数を実際に扱っている', () => {
    const sql = readFileSync(CITED_MIGRATION, 'utf8');
    // コメントが引用している「NULL を前提に分岐している」根拠そのものを検査する。
    // migration が差し替わって根拠が消えたら、上書きの正当性も再確認が要る。
    expect(sql).toMatch(/p_staff_id\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/p_coupon_id\s+IS\s+NOT\s+NULL/i);
    for (const argName of CREATE_BOOKING_NULLABLE_ARGS) {
      expect(sql).toContain(argName);
    }
  });

  it('上書きを実際に強制している呼び出し側が存在する（tsc の検知経路が生きている）', () => {
    // 🔴 このテストファイル自身は tsc の対象外（tsconfig.json の exclude に
    // `**/__tests__/**` と `**/*.test.ts` がある。2026年8月16日に、わざと型エラーを
    // 書いても tsc が 0 件しか報告しないことで実測確認済み）。
    // つまり下の型注釈は【CI のゲートにはならない】。
    //
    // 上書きが壊れたときに実際に tsc を落とすのは、null を渡している呼び出し側のほう。
    // 実測: database-overrides.ts から 'p_staff_id' を外すと
    //   src/app/api/booking/route.ts(252,5): error TS2322
    //   src/app/api/admin/bookings/route.ts(102,5): error TS2322
    // の2件が出る。
    //
    // その検知経路は「呼び出し側が null を渡し続けていること」に依存する。
    // 誰かが `?? null` を外せば tsc は静かに通るようになり、上書きの妥当性を
    // 検査するものが何も無くなる。だからここで経路の存在自体を固定する。
    const enforcingCallSites = [
      { file: 'src/app/api/booking/route.ts', pattern: /p_staff_id:\s*.*\?\?\s*null/ },
      { file: 'src/app/api/admin/bookings/route.ts', pattern: /p_staff_id:\s*.*\?\?\s*null/ },
    ];
    for (const { file, pattern } of enforcingCallSites) {
      const src = readFileSync(join(repoRoot, file), 'utf8');
      expect(src).toMatch(pattern);
    }
  });

  it('上書き後の型は対象引数に null を渡せる（意図の記録・CI ゲートではない）', () => {
    // 上の it が説明したとおり、この型注釈は tsc の対象外なので CI では検査されない。
    // 上書きが「何を可能にするつもりなのか」を実行可能な形で残すための記録。
    const callArgs: Database['public']['Functions']['create_booking_atomic']['Args'] = {
      p_booking_date: '2026-08-16',
      p_customer_name: 'テスト',
      p_end_time: '11:00',
      p_facility_id: 'facility-1',
      p_menu_id: 'menu-1',
      p_start_time: '10:00',
      p_total_price: 0,
      p_staff_id: null,
      p_user_id: null,
      p_coupon_id: null,
      p_email: null,
      p_phone: null,
      p_note: null,
    };
    // 値としても成立していることを確認する（型注釈だけだと未使用変数になる）。
    expect(callArgs.p_staff_id).toBeNull();
    expect(callArgs.p_facility_id).toBe('facility-1');
  });
});

/**
 * 検索の絞り込みパネルは「施設が値を保存できる条件」だけを出す（2026年10月22日 新設）。
 *
 * 【背景・実際に起きたこと】
 * 「症状から探す」と「保険適用メニューあり」は、パネルが URL に書くだけで検索側が読んでおらず、
 * 選んでも結果が変わらなかった。検索側を直した（src/lib/facilities.ts の detailFilter）ところ、
 * 今度は【必ず 0 件】になった。施設が対応症状（facility_symptoms）や保険適用
 * （facility_menus.insurance_covered）を保存できる管理画面・API がアプリ全体に 1 本も無く、
 * 本番の該当データが 0 件だったため（/salon の比較表から同じ理由で行を落とした経緯は
 * src/__tests__/salon-comparison-claims.test.ts を参照）。単体テストは facility_symptoms などに
 * 行があるモックで通るので、この状態を見つけられない。
 *
 * 【このテストが守るもの】
 * パネルに出してよいのは、管理レイヤに書き込み経路がある条件だけ。双方向で固定する。
 *   - 書き込み経路が無いのに絞り込みを出している → 落とす（選ぶと必ず 0 件になる）
 *   - 書き込み経路を作ったのに絞り込みを出していない → 戻すよう促す
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const root = process.cwd();

/** コメントを除く。経緯の説明に条件名を書いても「出している」と誤判定しないため。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 絞り込みパネルがその条件を出している（見出しを描くか、URL のキーを読み書きしている）か。 */
function offersFilter(source: string, filter: { label: string; param: string }): boolean {
  const code = stripComments(source);
  return code.includes(filter.label) || new RegExp(`['"\`]${filter.param}['"\`]`).test(code);
}

/** 管理レイヤのファイルのうち、DB へ書き込む呼び出しを持つもの（読むだけのファイルは数えない）。 */
const WRITE_CALL = /\.(insert|update|upsert|rpc)\(/;

function readAdminWriteSources(): string[] {
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(rel);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      const source = readFileSync(join(root, rel), 'utf8');
      if (WRITE_CALL.test(source)) sources.push(stripComments(source));
    }
  };
  walk('src/app/api/admin');
  walk('src/app/admin');
  return sources;
}

function hasWritePath(writeSources: string[], writeSignal: string): boolean {
  return writeSources.some((source) => source.includes(writeSignal));
}

const FILTERS = [
  {
    label: '症状から探す',
    param: 'symptom',
    writeSignal: 'facility_symptoms',
    why: '施設が対応症状を登録できないと、どの症状を選んでも 0 件になる',
  },
  {
    label: '保険適用メニューあり',
    param: 'insurance',
    writeSignal: 'insurance_covered',
    why: '施設がメニューを保険適用に設定できないと、チェックを入れると必ず 0 件になる',
  },
];

const searchFilters = readFileSync(join(root, 'src/components/search/SearchFilters.tsx'), 'utf8');
const adminWriteSources = readAdminWriteSources();

describe('絞り込みパネルは施設が保存できる条件だけを出す', () => {
  test.each(FILTERS)('$label：書き込み経路の有無と絞り込みの有無が一致する', (filter) => {
    const writable = hasWritePath(adminWriteSources, filter.writeSignal);
    const offered = offersFilter(searchFilters, filter);

    if (offered && !writable) {
      throw new Error(
        `絞り込みパネルに「${filter.label}」を出しているが、管理レイヤに ${filter.writeSignal} への書き込み経路が無い。` +
          `${filter.why}。管理画面を実装するか、絞り込みを外すこと。`,
      );
    }
    if (!offered && writable) {
      throw new Error(
        `${filter.writeSignal} の書き込み経路を実装したのに、絞り込みパネルに「${filter.label}」が無い。` +
          'SearchFilters.tsx に戻し、同ファイルの経緯コメントも更新すること。',
      );
    }
    expect(offered).toBe(writable);
  });

  // 検出器そのものが空振りしていないこと（常に「出していない」と判定すると上のテストは素通りする）。
  describe('検出器の対照', () => {
    const before = `
      const [symptom, setSymptom] = useState(searchParams.get('symptom') || '');
      if (insuranceOnly) params.set("insurance", '1');
      <label htmlFor="filter-symptom">症状から探す</label>
    `;

    test('以前のパネル（見出し・URL キーあり）は「出している」と判定する', () => {
      for (const filter of FILTERS) expect(offersFilter(before, filter)).toBe(true);
    });

    test('URL キーだけでも「出している」と判定する', () => {
      expect(offersFilter("params.set('insurance', '1')", FILTERS[1])).toBe(true);
    });

    test('コメントの中の言及は数えない', () => {
      const commentOnly = `
        {/* 症状から探す・保険適用メニューあり は出さない（'symptom' / 'insurance'） */}
        // 'symptom' と 'insurance' は URL に書かない
        const href = 'https://example.invalid/';
      `;
      for (const filter of FILTERS) expect(offersFilter(commentOnly, filter)).toBe(false);
    });

    test('書き込みの呼び出しと識別子が同じファイルにあるときだけ書き込み経路とみなす', () => {
      const readOnly = "const { data } = await supabase.from('facility_symptoms').select('symptom_id');";
      const write = "await supabase.from('facility_symptoms').insert({ facility_id, symptom_id });";
      expect(WRITE_CALL.test(readOnly)).toBe(false);
      expect(WRITE_CALL.test(write)).toBe(true);
      expect(hasWritePath([write], 'facility_symptoms')).toBe(true);
      expect(hasWritePath([write], 'insurance_covered')).toBe(false);
    });

    test('管理レイヤの走査が空振りしていない', () => {
      // 管理画面には書き込みを持つファイルが多数ある。0 件なら走査の起点か判定が壊れている。
      expect(adminWriteSources.length).toBeGreaterThan(20);
    });
  });
});

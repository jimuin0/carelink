/**
 * 既知の本番専用テーブル台帳が **1 箇所** であることと、行の帰属判定を固定する。
 *
 * 🔴 why(2026年8月3日 実測): 台帳は元々 tests/contract の中だけに在り、新設した
 *   フィンガープリント監視はそれを知らなかった。結果、既知・受容済みの 7 テーブル由来の
 *   **約 140 項目を毎日ドリフトとして報告する**状態になった（誤報は検知の死）。
 *   同日 soel 側でも「同じ除外規則が 2 箇所に在り、片方だけ直された」欠陥を実際に踏んでいる。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  KNOWN_PROD_ONLY,
  isKnownProdOnlyLine,
  subjectTable,
} from '../known-prod-only';

const ROOT = join(__dirname, '..', '..', '..');

describe('台帳が単一の真実源であること', () => {
  it('JSON の中身がそのまま Set になっている', () => {
    const raw: string[] = JSON.parse(
      readFileSync(join(ROOT, 'src', 'lib', 'known-prod-only.json'), 'utf8'),
    );
    // 走査が空振りしていないことの下限。空の台帳を「一致」と読み替えさせない。
    // 2026-08-11: facilities/recruits/booking_menus の DROP で 7→4 件に減った
    // （意図した減少。実測ちょうどには置かず、壊れたときだけ割る位置＝実測の半分程度に置く）。
    expect(raw.length).toBeGreaterThanOrEqual(2);
    expect(new Set(raw).size).toBe(raw.length); // 重複が無い
    expect([...KNOWN_PROD_ONLY].sort()).toEqual([...raw].sort());
  });

  it('🔴 契約テストが台帳を再宣言していない（2 箇所になれば片方が必ず陳腐化する）', () => {
    const src = readFileSync(
      join(ROOT, 'tests', 'contract', 'migration-prod-drift.contract.test.ts'),
      'utf8',
    );
    // ⚠️ 単語境界が必須。これが無いと KNOWN_PROD_ONLY_COLUMNS（列用の別台帳・
    //   同ファイルで正当に宣言されている）に誤ヒットする。実際に踏んだ。
    expect(src).not.toMatch(/\bKNOWN_PROD_ONLY\b(?!_)[^=\n]*=\s*new Set\(/);
    // 負の対照: 列用の別台帳は在ってよい（この検査が「何でも落とす」ものでないこと）
    expect(src).toMatch(/\bKNOWN_PROD_ONLY_COLUMNS\b[^=\n]*=\s*new Set\(/);
    expect(src).toContain("from '@/lib/known-prod-only'");
  });

  it('🔴 CLI(schema-diff.mjs)も同じ JSON を読んでいる（別実装で値を持たない）', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'schema-diff.mjs'), 'utf8');
    expect(src).toContain('known-prod-only.json');
    // 値をハードコードし直していないこと
    expect(src).not.toMatch(/new Set\(\s*\[\s*'spatial_ref_sys'/);
  });
});

describe('subjectTable — 行がどのテーブルの話か', () => {
  it('テーブルに紐づく種別を解釈する', () => {
    expect(subjectTable('relation|facilities|r|rls=t|force=f')).toBe('facilities');
    expect(subjectTable('column|facilities.id|uuid|notnull=t')).toBe('facilities');
    expect(subjectTable('constraint|facilities|p|pk|PRIMARY KEY (id)')).toBe('facilities');
    expect(subjectTable('index|facilities|idx|CREATE INDEX')).toBe('facilities');
    expect(subjectTable('policy|facilities|p1|cmd=r')).toBe('facilities');
    expect(subjectTable('trigger|facilities|t1|CREATE TRIGGER')).toBe('facilities');
    expect(subjectTable('grant|facilities|anon|SELECT')).toBe('facilities');
  });

  it('🔴 テーブルに紐づかない種別は null（関数や enum を台帳で消さない）', () => {
    expect(subjectTable('function|foo()|returns=jsonb')).toBeNull();
    expect(subjectTable('enum|my_enum|a,b')).toBeNull();
    expect(subjectTable('meta|server_version_major|17')).toBeNull();
  });

  it('壊れた行でも落ちない', () => {
    expect(subjectTable('')).toBeNull();
    expect(subjectTable('relation')).toBeNull();       // 区切りが無い
    expect(subjectTable('relation|')).toBeNull();      // 対象が空
    expect(subjectTable('column|nodot|x')).toBeNull(); // table.column 形式でない
    expect(subjectTable('column|.leading|x')).toBeNull(); // 先頭がドット
    expect(subjectTable('relation|facilities')).toBe('facilities'); // 末尾に区切り無し
  });
});

describe('isKnownProdOnlyLine', () => {
  it('台帳のテーブルに属する行だけ true', () => {
    // facilities / recruits は 2026-08-11 に DROP され台帳から削除されたため、
    // 台帳に恒久的に残る他エントリへ repoint した（spatial_ref_sys は PostGIS 所有で
    // 常に台帳に残る。salon_customer_notes / facility_booking_suspensions は
    // PR #53 所有で main 未マージの間は台帳に残る）。
    expect(isKnownProdOnlyLine('column|salon_customer_notes.id|uuid')).toBe(true);
    expect(isKnownProdOnlyLine('grant|spatial_ref_sys|anon|SELECT')).toBe(true);
    expect(isKnownProdOnlyLine('policy|facility_booking_suspensions|p|cmd=r')).toBe(true);
  });

  it('🔴 台帳外は必ず false（除外しすぎは無音の取りこぼし＝もっと危険）', () => {
    expect(isKnownProdOnlyLine('column|bookings.id|uuid')).toBe(false);
    expect(isKnownProdOnlyLine('relation|facility_profiles|r|rls=t|force=f')).toBe(false);
    expect(isKnownProdOnlyLine('function|create_booking_atomic()|x')).toBe(false);
    // 名前の一部が一致するだけのものを巻き込まない
    expect(isKnownProdOnlyLine('relation|facilities_archive|r|rls=t|force=f')).toBe(false);
  });
});

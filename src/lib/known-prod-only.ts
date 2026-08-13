/**
 * 「本番には在るが migration が無い」既知の残存テーブル台帳。**唯一の真実源**。
 *
 * データ本体は `known-prod-only.json`（JSON にしてあるのは、TypeScript からも
 * `scripts/schema-diff.mjs`（plain Node）からも同じ実体を読むため。台帳を
 * 言語ごとに書き分けた時点で片方だけ更新される事故が確定する）。
 *
 * 🔴 なぜ 1 箇所に寄せるか（2026年8月3日）:
 *   この台帳は元々 tests/contract/migration-prod-drift.contract.test.ts の中だけに在り、
 *   新設したスキーマ・フィンガープリント監視はそれを知らなかった。結果、既知・受容済みの
 *   7 テーブルに由来する **約 140 項目を毎日「ドリフト」として報告する**状態になった。
 *   誤報は検知の死であり、「いつも鳴っているから見ない」に劣化する。
 *   同日 soel 側でも「同じ除外規則を 2 箇所に書いて片方だけ直した」欠陥を実際に踏んでいる。
 *
 * 台帳の中身と経緯:
 *   - spatial_ref_sys … PostGIS 所有。拡張オブジェクトなので introspection 側でも除外される
 *   - facilities / recruits / booking_menus … 旧世代の未使用残存だったが、2026-08-11 に
 *     supabase/migrations/20260811000004_drop_dead_prototype_tables.sql で DROP 済み
 *     （後継: facilities→facility_profiles・recruits→job_postings/facility_jobs・
 *     booking_menus→bookings.menu_ids）。本番実測（ref: xzafxiupbflvgbarrihe）で
 *     facilities=3行(神原さん確認: ゴミデータ)・recruits=0行・booking_menus=0行、
 *     3テーブルとも参照 FK ゼロ（依存なし・owner 承認済み）。DROP 後はテーブル自体が
 *     無くなる＝台帳で除外する対象が無くなるため本台帳から削除。
 *     （blog_authors は同様の残存だったが 2026-08-11 に
 *     supabase/migrations/20260811000003_backport_blog_authors_and_fk.sql で migration へ
 *     back-port済み＝migration-less ではなくなったため本台帳から削除。今回とは逆に
 *     「テーブルを残して migration を足す」形の解消だった点が異なる）
 *   - facility_booking_suspensions / facility_daily_capacity / salon_customer_notes …
 *     PR #53（feat/salon-board）所有の残存だったが、2026-08-13 に
 *     supabase/migrations/20260813000001_codify_prod_only_salon_board_tables.sql で
 *     migration へ back-port 済み（blog_authors と同じ「テーブルを残して migration を足す」形）。
 *     🔴 契機は **PR #53 が 2026-07-22 に unmerged のままクローズされた**こと。旧版の本
 *     docstring は「PR #53 が main へマージされたら台帳から削除すること」と書いていたが、
 *     その条件は永久に満たされない＝除外が恒久化し、3 テーブルに何が起きても
 *     （列の消失・RLS の改変・GRANT の拡大）永久に鳴らない状態だった。
 *     **「別 PR がマージされたら消す」という解除条件は、その PR が閉じた時点で腐る。**
 *     台帳へ足すときは解除条件を必ず書き、条件が消滅したら除外の恒久化ではなく
 *     back-port か DROP で解消すること。
 *
 * 現在の台帳は spatial_ref_sys 1 件のみ＝**完成形**（PostGIS 所有のシステムテーブルで、
 * 拡張オブジェクトなので introspection 側でも除外される＝原理的に減らせない唯一の 1 件）。
 * 業務テーブルは 1 つも除外されていない。
 *
 * ⚠️ ここへ足すのは「本番に在ることを把握し、受け入れると決めたもの」だけ。
 *   足せばフィンガープリント監視の対象外になる＝そのテーブルに何が起きても鳴らなくなる。
 */
import registry from './known-prod-only.json';

export const KNOWN_PROD_ONLY: ReadonlySet<string> = new Set(registry as string[]);

/**
 * フィンガープリント 1 行が「どのテーブルについての行か」を返す。無ければ null。
 *
 * 書式は `種別|対象|詳細…`。対象がテーブル名になる種別だけを解釈し、
 * function / enum / meta のようにテーブルへ紐づかない行は null を返す
 * （＝テーブル台帳では絶対に除外されない）。
 */
export function subjectTable(line: string): string | null {
  const i = line.indexOf('|');
  if (i < 0) return null;
  const kind = line.slice(0, i);
  const rest = line.slice(i + 1);
  const j = rest.indexOf('|');
  const first = j < 0 ? rest : rest.slice(0, j);

  if (kind === 'column') {
    // `column|<table>.<column>|…`
    const dot = first.indexOf('.');
    return dot > 0 ? first.slice(0, dot) : null;
  }
  if (
    kind === 'relation' || kind === 'constraint' || kind === 'index' ||
    kind === 'policy' || kind === 'trigger' || kind === 'grant'
  ) {
    return first === '' ? null : first;
  }
  return null;
}

/** 既知の本番専用テーブルに属する行か（＝突合対象から外す行か）。 */
export function isKnownProdOnlyLine(line: string): boolean {
  const t = subjectTable(line);
  return t !== null && KNOWN_PROD_ONLY.has(t);
}

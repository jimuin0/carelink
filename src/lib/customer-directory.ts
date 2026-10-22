/**
 * /admin/customers の一覧を組み立てる純粋ロジック（顧客台帳 × 来店集計 × RFM セグメントの突合・
 * 検索条件の当てはめ・CSV）。ページ（サーバ）とコンポーネント（クライアント）の両方から使う。
 *
 * - 突合キーは customerIdentityKey（メール優先、メールが無ければ電話番号）。台帳・来店・セグメントの
 *   3 者が同じキーを使うので、電話番号だけで登録したお客様にも来店回数と履歴が付く。
 * - 来店の無い台帳顧客にはセグメント・累計利用額を出さない。customer_segments は週 1 回の集計で、
 *   「完了」を「無断キャンセル」に訂正した直後は古い行が残っている（来店 0 回なのに「新規・¥8,000」になる）。
 * - 検索条件は台帳と「来店履歴から未登録のお客様」の両方に同じ規則で当てる。未登録のお客様は
 *   フリガナ・性別・誕生日を持たないので、これらの条件では（台帳の未入力の顧客と同じく）一致しない。
 * - CSV は画面に出ている行（絞り込み後の台帳＋未登録）をそのまま出す。
 */
import { canonicalizeEmail } from './email-canonical';
import { csvEscape } from './csv';
import { customerIdentityKey } from './customer-identity';

/**
 * 顧客一覧の来店集計 1 行（＝1 人）。email / phone / name は最も新しい来店のもの。
 * メールの無い来店（電話・来店受付）は予約の電話番号で同じ人かを判定する（src/lib/customer-identity.ts）。
 */
export type CustomerVisitSummary = {
  email: string | null;
  phone: string | null;
  name: string;
  visit_count: number;
  last_visit: string;
};

export interface MasterCustomer {
  id: string;
  name: string;
  name_kana: string | null;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  gender: string | null;
  notes: string | null;
  visit_count: number;
  last_visit: string | null;
  segment: string | null;
  total_spent: number | null;
  // 【監査M3】複数施設オーナー対応：各顧客が属する施設。編集/削除はこの facility_id を使う。
  facility_id: string;
  facility_name: string;
}

export interface UnregisteredCustomer {
  /** 突合キー（同じ施設の中で 1 人に 1 つ）。 */
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  visit_count: number;
  last_visit: string;
  // 【監査M3】未登録顧客も所属施設を持つ（「登録」時にその施設へ追加する）。
  facility_id: string;
  facility_name: string;
}

export type LedgerRow = Omit<MasterCustomer, 'visit_count' | 'last_visit' | 'segment' | 'total_spent' | 'facility_id' | 'facility_name'>;
export type SegmentRow = { customer_email: string; segment: string | null; total_spent: number | null };

/** 1 施設分の台帳・来店集計・セグメントを突合する（施設をまたいで突合しない）。 */
export function buildCustomerDirectory(input: {
  facilityId: string;
  facilityName: string;
  ledger: LedgerRow[];
  visits: CustomerVisitSummary[];
  segments: SegmentRow[];
}): { customers: MasterCustomer[]; unregistered: UnregisteredCustomer[] } {
  const { facilityId, facilityName } = input;

  // 同一人物が複数の表記（Gmail エイリアス等）で来店している場合はキーで合算する（来店数を過少にしない）。
  const visitByKey = new Map<string, CustomerVisitSummary>();
  for (const v of input.visits) {
    const key = customerIdentityKey(v.email, v.phone);
    if (!key) continue;
    const existing = visitByKey.get(key);
    if (existing) {
      existing.visit_count += v.visit_count;
      if (v.last_visit > existing.last_visit) existing.last_visit = v.last_visit;
    } else {
      visitByKey.set(key, { ...v });
    }
  }

  // セグメントのキーは cron が customerIdentityKey で作る（メールは canonical、電話は 'tel:数字'）。
  // 古い行（生メール）も canonical に寄せて突合する。
  const segmentByKey = new Map<string, SegmentRow>();
  for (const s of input.segments) {
    if (s.customer_email) segmentByKey.set(canonicalizeEmail(s.customer_email), s);
  }

  const matched = new Set<string>();
  const customers = input.ledger.map((c): MasterCustomer => {
    const key = customerIdentityKey(c.email, c.phone);
    const hit = key ? visitByKey.get(key) : undefined;
    if (key && hit) matched.add(key);
    // 来店が無いのにセグメント行だけ残っている＝訂正前の古い集計。表示しない。
    const seg = key && hit ? segmentByKey.get(key) : undefined;
    return {
      ...c,
      facility_id: facilityId,
      facility_name: facilityName,
      visit_count: hit?.visit_count ?? 0,
      last_visit: hit?.last_visit ?? null,
      segment: seg?.segment ?? null,
      total_spent: seg?.total_spent ?? null,
    };
  });

  // 来店履歴はあるが台帳に無いお客様（「登録」導線を出す・この施設内）。
  const unregistered: UnregisteredCustomer[] = [];
  for (const [key, v] of visitByKey) {
    if (matched.has(key)) continue;
    unregistered.push({ key, name: v.name, email: v.email, phone: v.phone, visit_count: v.visit_count, last_visit: v.last_visit, facility_id: facilityId, facility_name: facilityName });
  }
  return { customers, unregistered };
}

// HPB「お客様情報一覧」型の検索条件。CareLink の顧客マスターにある項目のみ（来店区分・年代・
// ダイレクト会員などデータ非保持の項目は除外）。
export type CustomerSearch = {
  name: string; kana: string; phone: string; email: string; gender: string;
  visitMin: string; visitMax: string; lastFrom: string; lastTo: string; birthday: string;
};
export const EMPTY_CUSTOMER_SEARCH: CustomerSearch = {
  name: '', kana: '', phone: '', email: '', gender: '',
  visitMin: '', visitMax: '', lastFrom: '', lastTo: '', birthday: '',
};

type SearchableCustomer = {
  name: string; name_kana: string | null; phone: string | null; email: string | null;
  gender: string | null; birthday: string | null; visit_count: number; last_visit: string | null;
};

const includesCI = (v: string | null, q: string) => !q || (v ?? '').toLowerCase().includes(q.toLowerCase());

export function matchesCustomerSearch(c: SearchableCustomer, search: CustomerSearch): boolean {
  return includesCI(c.name, search.name) &&
    includesCI(c.name_kana, search.kana) &&
    includesCI(c.phone, search.phone) &&
    includesCI(c.email, search.email) &&
    (!search.gender || c.gender === search.gender) &&
    (!search.visitMin || c.visit_count >= Number(search.visitMin)) &&
    (!search.visitMax || c.visit_count <= Number(search.visitMax)) &&
    (!search.lastFrom || (!!c.last_visit && c.last_visit >= search.lastFrom)) &&
    (!search.lastTo || (!!c.last_visit && c.last_visit <= search.lastTo)) &&
    includesCI(c.birthday, search.birthday);
}

/** 未登録のお客様に同じ条件を当てる（持たない項目は未入力として扱う）。 */
export function matchesUnregisteredSearch(u: UnregisteredCustomer, search: CustomerSearch): boolean {
  return matchesCustomerSearch({ ...u, name_kana: null, gender: null, birthday: null }, search);
}

/** 未登録のお客様が持たない項目（フリガナ・性別・誕生日）で絞り込んでいるか。 */
export function searchUsesLedgerOnlyFields(search: CustomerSearch): boolean {
  return Boolean(search.kana || search.gender || search.birthday);
}

export const CUSTOMER_SEGMENT_TEXT: Record<string, string> = {
  vip: 'VIP', regular: 'レギュラー', at_risk: '離脱リスク', lost: '離脱', new: '新規',
};

/**
 * 画面に出ている顧客の CSV（先頭に BOM）。列の並びは従来の 6 列を先頭に保ち、後ろに足す
 * （既存の表計算の取り込みを崩さない）。複数施設のときは施設名の列を最後に付ける。
 */
export function buildCustomersCsv(
  ledger: MasterCustomer[],
  unregistered: UnregisteredCustomer[],
  opts: { multiFacility: boolean },
): string {
  const header = ['お客様名', 'フリガナ', 'メール', '電話', '来店回数', '最終来店', 'セグメント', '累計利用額', '区分'];
  if (opts.multiFacility) header.push('施設');
  const rows: Array<Array<string | number>> = [
    ...ledger.map((c) => [
      c.name, c.name_kana ?? '', c.email ?? '', c.phone ?? '', c.visit_count, c.last_visit ?? '',
      (c.segment && CUSTOMER_SEGMENT_TEXT[c.segment]) || '', c.total_spent ?? '', '登録済み',
      ...(opts.multiFacility ? [c.facility_name] : []),
    ]),
    ...unregistered.map((u) => [
      u.name, '', u.email ?? '', u.phone ?? '', u.visit_count, u.last_visit, '', '', '未登録',
      ...(opts.multiFacility ? [u.facility_name] : []),
    ]),
  ];
  return '\uFEFF' + [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
}

/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  buildCustomerDirectory, buildCustomersCsv, EMPTY_CUSTOMER_SEARCH, matchesCustomerSearch, matchesUnregisteredSearch,
  searchUsesLedgerOnlyFields, type CustomerSearch, type CustomerVisitSummary, type LedgerRow, type MasterCustomer,
  type UnregisteredCustomer,
} from '../customer-directory';

const ledger = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  id: 'c1', name: '山田 花子', name_kana: null, email: null, phone: null, birthday: null, gender: null, notes: null, ...over,
});
const visit = (over: Partial<CustomerVisitSummary> = {}): CustomerVisitSummary => ({
  email: null, phone: null, name: '来店者', visit_count: 1, last_visit: '2026-05-01', ...over,
});
const build = (input: { ledger?: LedgerRow[]; visits?: CustomerVisitSummary[]; segments?: { customer_email: string; segment: string | null; total_spent: number | null }[] }) =>
  buildCustomerDirectory({ facilityId: 'f1', facilityName: '施設A', ledger: input.ledger ?? [], visits: input.visits ?? [], segments: input.segments ?? [] });

describe('buildCustomerDirectory', () => {
  test('電話番号だけで登録したお客様に、メール無しの電話予約の来店回数・最終来店・セグメントが付く（回帰）', () => {
    const { customers, unregistered } = build({
      ledger: [ledger({ phone: '090-1111-2222' })],
      visits: [visit({ phone: '09011112222', visit_count: 5, last_visit: '2026-05-10' })],
      segments: [{ customer_email: 'tel:09011112222', segment: 'vip', total_spent: 25000 }],
    });
    expect(customers).toEqual([expect.objectContaining({
      id: 'c1', visit_count: 5, last_visit: '2026-05-10', segment: 'vip', total_spent: 25000, facility_id: 'f1', facility_name: '施設A',
    })]);
    expect(unregistered).toEqual([]);
  });

  test('メールで台帳にいるお客様はメールで突合（Gmail エイリアスもまとめる）', () => {
    const { customers, unregistered } = build({
      ledger: [ledger({ email: 'foo@gmail.com', phone: '090-1111-2222' })],
      visits: [
        visit({ email: 'f.o.o@gmail.com', visit_count: 2, last_visit: '2026-04-01' }),
        visit({ email: 'foo+x@gmail.com', visit_count: 1, last_visit: '2026-05-01' }),
        visit({ email: 'FOO@gmail.com', visit_count: 1, last_visit: '2026-03-01' }),
      ],
      segments: [{ customer_email: 'F.O.O@gmail.com', segment: 'regular', total_spent: 9000 }],
    });
    expect(customers[0]).toMatchObject({ visit_count: 4, last_visit: '2026-05-01', segment: 'regular', total_spent: 9000 });
    expect(unregistered).toEqual([]);
  });

  test('台帳に無い来店客は電話番号だけの方も「未登録」に出る（メールも電話も無い来店は除く）', () => {
    const { customers, unregistered } = build({
      visits: [
        visit({ email: 'a@example.com', name: 'A', phone: '03-1234-5678', visit_count: 2, last_visit: '2026-05-02' }),
        visit({ phone: '090-1111-2222', name: '電話 花子', visit_count: 3, last_visit: '2026-05-01' }),
        visit({ name: '連絡先なし' }),
      ],
    });
    expect(customers).toEqual([]);
    expect(unregistered).toEqual([
      { key: 'a@example.com', name: 'A', email: 'a@example.com', phone: '03-1234-5678', visit_count: 2, last_visit: '2026-05-02', facility_id: 'f1', facility_name: '施設A', phone_in_ledger: false },
      { key: 'tel:09011112222', name: '電話 花子', email: null, phone: '090-1111-2222', visit_count: 3, last_visit: '2026-05-01', facility_id: 'f1', facility_name: '施設A', phone_in_ledger: false },
    ]);
  });

  test('来店の無い台帳顧客には、残っているセグメント・累計利用額を出さない（訂正前の古い集計）', () => {
    const { customers } = build({
      ledger: [ledger({ email: 'a@example.com' }), ledger({ id: 'c2', name: '連絡先なし' })],
      segments: [{ customer_email: 'a@example.com', segment: 'new', total_spent: 8000 }],
    });
    expect(customers.map((c) => [c.id, c.visit_count, c.last_visit, c.segment, c.total_spent])).toEqual([
      ['c1', 0, null, null, null],
      ['c2', 0, null, null, null],
    ]);
  });

  test('セグメント未計算・空キーの行は無視し、来店はあってもセグメント無しなら "—" のまま', () => {
    const { customers } = build({
      ledger: [ledger({ email: 'a@example.com' })],
      visits: [visit({ email: 'a@example.com' })],
      segments: [{ customer_email: '', segment: 'vip', total_spent: 1 }],
    });
    expect(customers[0]).toMatchObject({ visit_count: 1, segment: null, total_spent: null });
  });

  describe('メールと電話番号で登録したお客様の、同じ電話番号のメール無し来店（電話・来店受付）', () => {
    const yamada = ledger({ email: 'a@example.com', phone: '090-1111-2222' });
    const phoneVisits = visit({ name: '山田 花子', phone: '09011112222', visit_count: 3, last_visit: '2026-05-10' });

    test('本人の来店回数・最終来店に入り、「未登録」に別の行として出ない（回帰）', () => {
      const { customers, unregistered } = build({ ledger: [yamada], visits: [phoneVisits] });
      expect(customers[0]).toMatchObject({ id: 'c1', visit_count: 3, last_visit: '2026-05-10' });
      expect(unregistered).toEqual([]);
    });

    test('メールの来店と合算し、最終来店は新しい方', () => {
      const emailLater = build({ ledger: [yamada], visits: [phoneVisits, visit({ email: 'A@example.com', visit_count: 2, last_visit: '2026-06-01' })] });
      expect(emailLater.customers[0]).toMatchObject({ visit_count: 5, last_visit: '2026-06-01' });
      const phoneLater = build({ ledger: [yamada], visits: [visit({ email: 'a@example.com', visit_count: 2, last_visit: '2026-04-01' }), phoneVisits] });
      expect(phoneLater.customers[0]).toMatchObject({ visit_count: 5, last_visit: '2026-05-10' });
      expect(phoneLater.unregistered).toEqual([]);
    });

    test('セグメントはメールのキーの行を優先し、まだ電話番号のキーの行しか無ければそれを出す', () => {
      const both = build({
        ledger: [yamada], visits: [phoneVisits],
        segments: [{ customer_email: 'tel:09011112222', segment: 'new', total_spent: 1000 }, { customer_email: 'a@example.com', segment: 'regular', total_spent: 9000 }],
      });
      expect(both.customers[0]).toMatchObject({ segment: 'regular', total_spent: 9000 });
      const telOnly = build({ ledger: [yamada], visits: [phoneVisits], segments: [{ customer_email: 'tel:09011112222', segment: 'new', total_spent: 1000 }] });
      expect(telOnly.customers[0]).toMatchObject({ segment: 'new', total_spent: 1000 });
      // cron が寄せた後（電話予約の来店だけでも、行はメールのキーにある）
      const remapped = build({ ledger: [yamada], visits: [phoneVisits], segments: [{ customer_email: 'a@example.com', segment: 'regular', total_spent: 6000 }] });
      expect(remapped.customers[0]).toMatchObject({ segment: 'regular', total_spent: 6000 });
    });

    test('来店の無くなった電話番号のキーの古い行は、メールの来店があっても出さない', () => {
      const { customers } = build({
        ledger: [yamada], visits: [visit({ email: 'a@example.com', visit_count: 2 })],
        segments: [{ customer_email: 'tel:09011112222', segment: 'vip', total_spent: 99000 }],
      });
      expect(customers[0]).toMatchObject({ visit_count: 2, segment: null, total_spent: null });
    });

    test('台帳で同じ電話番号のお客様が 2 人いれば合算しない。「未登録」に残し、その旨の印を付ける', () => {
      const { customers, unregistered } = build({
        ledger: [yamada, ledger({ id: 'c2', name: '山田 一郎', email: 'b@example.com', phone: '090-1111-2222' })],
        visits: [phoneVisits],
      });
      expect(customers.map((c) => [c.id, c.visit_count])).toEqual([['c1', 0], ['c2', 0]]);
      expect(unregistered).toEqual([expect.objectContaining({ key: 'tel:09011112222', visit_count: 3, phone_in_ledger: true })]);
    });

    test('同じ電話番号で電話番号だけのお客様がいれば、その来店は電話番号だけのお客様のもの', () => {
      const { customers, unregistered } = build({
        ledger: [yamada, ledger({ id: 'c2', name: '電話のみ', phone: '090-1111-2222' })],
        visits: [phoneVisits],
      });
      expect(customers.map((c) => [c.id, c.visit_count])).toEqual([['c1', 0], ['c2', 3]]);
      expect(unregistered).toEqual([]);
    });

    test('別の電話番号のメール無し来店は寄せない（未登録の印も付けない）', () => {
      const { customers, unregistered } = build({ ledger: [yamada], visits: [visit({ phone: '080-3333-4444', visit_count: 2 })] });
      expect(customers[0].visit_count).toBe(0);
      expect(unregistered).toEqual([expect.objectContaining({ key: 'tel:08033334444', phone_in_ledger: false })]);
    });
  });

  test('入力の来店集計を書き換えない', () => {
    const visits = [visit({ email: 'a@example.com', visit_count: 1 }), visit({ email: 'A@example.com', visit_count: 2 })];
    build({ visits });
    expect(visits[0].visit_count).toBe(1);
  });
});

const master = (over: Partial<MasterCustomer> = {}): MasterCustomer => ({
  ...ledger(), visit_count: 1, last_visit: '2026-04-10', segment: null, total_spent: null, facility_id: 'f1', facility_name: '施設A', ...over,
});
const unreg = (over: Partial<UnregisteredCustomer> = {}): UnregisteredCustomer => ({
  key: 'tel:09011112222', name: '電話 花子', email: null, phone: '090-1111-2222', visit_count: 1, last_visit: '2026-04-10',
  facility_id: 'f1', facility_name: '施設A', phone_in_ledger: false, ...over,
});
const search = (over: Partial<CustomerSearch>): CustomerSearch => ({ ...EMPTY_CUSTOMER_SEARCH, ...over });

describe('検索条件は台帳と未登録のお客様に同じ規則で当てる', () => {
  const one = unreg({ key: 'a', name: 'Aさん', visit_count: 1, last_visit: '2026-04-10' });
  const six = unreg({ key: 'b', name: 'Bさん', visit_count: 6, last_visit: '2026-10-15' });

  test('来店回数・最終来店日で未登録のお客様も絞られる（回帰）', () => {
    const s = search({ visitMin: '5', lastFrom: '2026-10-01' });
    expect([one, six].filter((u) => matchesUnregisteredSearch(u, s))).toEqual([six]);
    expect([one, six].filter((u) => matchesUnregisteredSearch(u, search({ visitMax: '2', lastTo: '2026-05-01' })))).toEqual([one]);
    expect([one, six].filter((u) => matchesUnregisteredSearch(u, EMPTY_CUSTOMER_SEARCH))).toEqual([one, six]);
  });

  test('電話番号・氏名・メールでも絞れる', () => {
    expect(matchesUnregisteredSearch(unreg(), search({ phone: '1111' }))).toBe(true);
    expect(matchesUnregisteredSearch(unreg(), search({ phone: '9999' }))).toBe(false);
    expect(matchesUnregisteredSearch(unreg(), search({ name: '花子' }))).toBe(true);
    expect(matchesUnregisteredSearch(unreg(), search({ email: 'x' }))).toBe(false);
    expect(matchesUnregisteredSearch(unreg({ email: 'Mail@Example.com' }), search({ email: 'mail@' }))).toBe(true);
  });

  test('フリガナ・性別・誕生日の条件では、それを持たない未登録のお客様は一致しない（台帳の未入力の顧客と同じ）', () => {
    for (const s of [search({ kana: 'ヤマダ' }), search({ gender: 'female' }), search({ birthday: '05-01' })]) {
      expect(matchesUnregisteredSearch(unreg(), s)).toBe(false);
      expect(matchesCustomerSearch(master(), s)).toBe(false);
      expect(searchUsesLedgerOnlyFields(s)).toBe(true);
    }
    expect(searchUsesLedgerOnlyFields(search({ name: 'a', phone: '090', visitMin: '1', lastFrom: '2026-01-01' }))).toBe(false);
  });

  test('台帳の全条件（境界は含む）', () => {
    const c = master({ name_kana: 'ヤマダ ハナコ', gender: 'female', birthday: '1990-05-01', phone: '090-1111-2222', email: 'a@example.com', visit_count: 5, last_visit: '2026-10-01' });
    expect(matchesCustomerSearch(c, search({
      name: '山田', kana: 'ヤマダ', phone: '1111', email: 'A@EXAMPLE', gender: 'female',
      visitMin: '5', visitMax: '5', lastFrom: '2026-10-01', lastTo: '2026-10-01', birthday: '05-01',
    }))).toBe(true);
    expect(matchesCustomerSearch(c, search({ gender: 'male' }))).toBe(false);
    expect(matchesCustomerSearch(c, search({ visitMin: '6' }))).toBe(false);
    expect(matchesCustomerSearch(c, search({ visitMax: '4' }))).toBe(false);
    expect(matchesCustomerSearch(c, search({ lastFrom: '2026-10-02' }))).toBe(false);
    expect(matchesCustomerSearch(c, search({ lastTo: '2026-09-30' }))).toBe(false);
  });

  test('来店の無い台帳顧客は最終来店日の条件に一致しない', () => {
    const none = master({ visit_count: 0, last_visit: null });
    expect(matchesCustomerSearch(none, search({ lastFrom: '2026-01-01' }))).toBe(false);
    expect(matchesCustomerSearch(none, search({ lastTo: '2026-12-31' }))).toBe(false);
  });
});

describe('buildCustomersCsv（画面に出ている行をそのまま出す）', () => {
  const parse = (csv: string) => csv.replace(/^\uFEFF/, '').split('\n').map((line) => line.split(','));

  test('台帳が 0 件でも未登録のお客様を出す。従来の 6 列は先頭のまま（回帰）', () => {
    const csv = buildCustomersCsv([], [unreg({ visit_count: 3 }), unreg({ key: 'm', name: 'メール 太郎', email: 'm@example.com', phone: null })], { multiFacility: false });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(parse(csv)).toEqual([
      ['お客様名', 'フリガナ', 'メール', '電話', '来店回数', '最終来店', 'セグメント', '累計利用額', '区分'],
      ['電話 花子', '', '', '090-1111-2222', '3', '2026-04-10', '', '', '未登録'],
      ['メール 太郎', '', 'm@example.com', '', '1', '2026-04-10', '', '', '未登録'],
    ]);
  });

  test('台帳の行はセグメント名・累計利用額つき。複数施設なら施設名の列を付ける', () => {
    const csv = buildCustomersCsv([
      master({ name_kana: 'ヤマダ', email: 'a@example.com', phone: '090-1111-2222', segment: 'vip', total_spent: 50000 }),
      master({ id: 'c2', name: '未計算', segment: 'unknown', visit_count: 0, last_visit: null, facility_name: '施設B' }),
      master({ id: 'c3', name: '新規', segment: null }),
    ], [unreg()], { multiFacility: true });
    expect(parse(csv)).toEqual([
      ['お客様名', 'フリガナ', 'メール', '電話', '来店回数', '最終来店', 'セグメント', '累計利用額', '区分', '施設'],
      ['山田 花子', 'ヤマダ', 'a@example.com', '090-1111-2222', '1', '2026-04-10', 'VIP', '50000', '登録済み', '施設A'],
      ['未計算', '', '', '', '0', '', '', '', '登録済み', '施設B'],
      ['新規', '', '', '', '1', '2026-04-10', '', '', '登録済み', '施設A'],
      ['電話 花子', '', '', '090-1111-2222', '1', '2026-04-10', '', '', '未登録', '施設A'],
    ]);
  });

  test('単一施設なら施設名の列を付けない', () => {
    expect(parse(buildCustomersCsv([master()], [], { multiFacility: false }))[1]).toEqual(
      ['山田 花子', '', '', '', '1', '2026-04-10', '', '', '登録済み'],
    );
  });

  test('数式インジェクション対策（csvEscape）を通す', () => {
    expect(buildCustomersCsv([], [unreg({ name: '=HYPERLINK("x")' })], { multiFacility: false })).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
const mockFrom = jest.fn(), mockRpc = jest.fn();
jest.mock('../supabase-server-auth', () => ({ createServerSupabaseAuthClient: () => ({ from: mockFrom, rpc: mockRpc }) }));
import { getCustomerPhoneVisits, getCustomerVisits, getFacilityCustomerLedger, getLedgerCustomerVisits, getUniqueCustomers } from '../admin';
let chain: Record<string, jest.Mock>, pages: { data: unknown; error?: unknown }[];
beforeEach(() => {
  jest.clearAllMocks(); chain = {}; pages = [{ data: [] }];
  for (const key of ['select','eq','order','not']) chain[key] = jest.fn(() => chain);
  chain.range = jest.fn(async () => pages.shift() ?? { data: [] });
  mockFrom.mockReturnValue(chain); mockRpc.mockReturnValue(chain);
});
const visits = [{ customer_email: 'f.o.o@gmail.com', email_canonical: 'foo@gmail.com', customer_name: 'First', visit_date: '2026-04-10' },
  { customer_email: 'foo+shop@gmail.com', email_canonical: 'foo@gmail.com', customer_name: 'Old', visit_date: '2026-04-01' },
  { customer_email: 'other@example.invalid', customer_name: 'Other', visit_date: '2026-03-01' }];
const missing = { code: '42703', message: 'column "email_canonical" does not exist' };
test.each([undefined,'B.B+x@Gmail.com'])('visits maintain facility and canonical scope %s', async email => {
  pages = [{ data: visits }]; expect(await getCustomerVisits('f1', email)).toEqual(visits);
  expect(chain.eq).toHaveBeenCalledWith('facility_id','f1');
  if (email) expect(chain.eq).toHaveBeenCalledWith('email_canonical','bb@gmail.com');
  expect(chain.order).toHaveBeenCalledWith('visit_date',{ ascending: false });
  expect(chain.order).toHaveBeenCalledWith('id'); expect(chain.range).toHaveBeenCalledWith(0,999);
});
test.each([undefined,'b@test.com'])('empty visits remain empty %s', async email => {
  pages = [{ data: [] }]; expect(await getCustomerVisits('f1',email)).toEqual([]);
});
test('missing provider visit data cannot become measured empty history', async () => {
  pages = [{ data:null }]; await expect(getCustomerVisits('f1')).rejects.toThrow('来店履歴');
});
test('missing canonical column falls back to exact email without losing scope', async () => {
  pages = [{ data: null,error: missing },{ data: visits }];
  expect(await getCustomerVisits('f1','b@test.com')).toEqual(visits);
  expect(chain.eq).toHaveBeenCalledWith('customer_email','b@test.com');
});
test.each(['all','canonical','fallback'])('visit %s read error cannot become empty history', async kind => {
  pages = kind === 'fallback' ? [{ data: null,error: missing },{ data: null,error: {} }] : [{ data: null,error: {} }];
  await expect(getCustomerVisits('f1',kind === 'all' ? undefined : 'b@test.com')).rejects.toThrow('来店履歴');
});
test('visit pagination includes the 1001st record rather than truncating at PostgREST default', async () => {
  pages = [{ data: Array.from({ length: 1000 },(_,id) => ({ id })) },{ data: [{ id: 1000 }] }];
  expect(await getCustomerVisits('f1')).toHaveLength(1001);
  expect(chain.range).toHaveBeenLastCalledWith(1000,1999);
});
test('later page failure never returns partial measured history', async () => {
  pages = [{ data: Array(1000).fill(visits[0]) },{ data: null,error: {} }];
  await expect(getCustomerVisits('f1')).rejects.toThrow();
});

// ── 顧客一覧の集計（メール、メールが無ければ電話番号で 1 人にまとめる） ──
const summary = (over: Record<string, unknown> = {}) => ({ email:'a@test.com',phone:null,name:'A',visit_count:3,last_visit:'2026-05-01',...over });
// 予備の経路で読む来店行（電話番号は予約から引く）
const withBooking = [
  { customer_email: 'f.o.o@gmail.com', customer_name: 'First', visit_date: '2026-04-10', booking: { phone: '090-9999-0000' } },
  { customer_email: 'foo+shop@gmail.com', customer_name: 'Old', visit_date: '2026-04-01', booking: null },
  { customer_email: null, customer_name: '電話 花子', visit_date: '2026-03-20', booking: { phone: '０９０－１１１１－２２２２' } },
  { customer_email: ' ', customer_name: '電話 花子(旧)', visit_date: '2026-03-10', booking: { phone: '090-1111-2222' } },
  { customer_email: null, customer_name: 'Short', visit_date: '2026-03-05', booking: { phone: '1234' } },
  { customer_email: null, customer_name: 'Nobody', visit_date: '2026-03-02', booking: null },
  { customer_email: 'other@example.invalid', customer_name: 'Other', visit_date: '2026-03-01', booking: null },
];
const fallbackResult = [
  { email:'f.o.o@gmail.com',phone:'090-9999-0000',name:'First',visit_count:2,last_visit:'2026-04-10' },
  { email:null,phone:'０９０－１１１１－２２２２',name:'電話 花子',visit_count:2,last_visit:'2026-03-20' },
  { email:'other@example.invalid',phone:null,name:'Other',visit_count:1,last_visit:'2026-03-01' },
];
test('customer RPC is paginated and bigint count converted without fetching visits', async () => {
  pages = [{ data: [summary({ visit_count: '3' })] }];
  expect(await getUniqueCustomers('f1')).toEqual([summary()]);
  expect(mockRpc).toHaveBeenCalledWith('get_customer_visit_summary',{ p_facility_id:'f1' }); expect(mockFrom).not.toHaveBeenCalled();
});
test('customer RPC returns email-less phone customers (電話・来店受付の予約)', async () => {
  const phoneRow = summary({ email: null, phone: '090-1111-2222', name: '電話 花子', visit_count: 5 });
  pages = [{ data: [summary(), phoneRow] }];
  expect(await getUniqueCustomers('f1')).toEqual([summary(), phoneRow]);
});
test('a summary row with neither email nor usable phone is not shown as a customer', async () => {
  pages = [{ data: [summary(), summary({ email: null, phone: null }), summary({ email: ' ', phone: '1234' })] }];
  expect(await getUniqueCustomers('f1')).toEqual([summary()]); expect(mockFrom).not.toHaveBeenCalled();
});
test('customer RPC beyond 1000 is not silently truncated', async () => {
  pages = [{ data:Array(1000).fill(summary({ visit_count: 1 })) },{ data:[summary({ visit_count: 1 })] }];
  expect(await getUniqueCustomers('f1')).toHaveLength(1001); expect(chain.range).toHaveBeenCalledWith(1000,1999);
});
test.each([{ data:null,error:{ code:'PGRST202' } },{ data:null },{ data:{ broken:true } }])('unavailable or malformed RPC %j uses complete fallback with phones', async response => {
  pages = [response,{ data:withBooking }];
  expect(await getUniqueCustomers('f1')).toEqual(fallbackResult);
  expect(mockFrom).toHaveBeenCalledWith('customer_visits');
  expect(chain.select).toHaveBeenCalledWith('customer_email, customer_name, visit_date, booking:bookings(phone)');
  expect(chain.eq).toHaveBeenCalledWith('facility_id','f1');
});
test('fallback: contactless and short-phone visits never merge by name', async () => {
  pages = [{ data:null,error:{} },{ data:withBooking.slice(4,6) }];
  expect(await getUniqueCustomers('f1')).toEqual([]);
});
test('customer fallback failure cannot become zero', async () => {
  pages = [{ data:null,error:{} },{ data:null,error:{} }];
  await expect(getUniqueCustomers('f1')).rejects.toThrow('顧客集計');
});
test('RPC empty and fallback empty are genuine empty lists', async () => {
  expect(await getUniqueCustomers('f1')).toEqual([]);
  pages = [{ data:null,error:{} },{ data:[] }]; expect(await getUniqueCustomers('f1')).toEqual([]);
});
test.each([NaN, -1, 'broken', '9007199254740992'])('invalid RPC count %s falls back rather than rendering a false count', async visit_count => {
  pages = [{ data:[summary({ visit_count })] },{ data:withBooking }];
  expect((await getUniqueCustomers('f1'))[0].visit_count).toBe(2);
});
test.each([null, [{ customer_email: 'x@test.com', visit_date: '2026-01-01', booking: null }]])('missing or malformed fallback data %j cannot become measured empty customers', async data => {
  pages = [{ data:null,error:{} },{ data }]; await expect(getUniqueCustomers('f1')).rejects.toThrow('顧客集計');
});

// ── 電話番号で登録したお客様（メール無し）の来店履歴 ──
const phoneVisit = (id: string, over: Record<string, unknown> = {}) => ({ id, facility_id:'f1', booking_id:`b-${id}`, customer_email:null,
  customer_name:'電話 花子', visit_date:'2026-04-01', menu_name:null, staff_name:null, amount:1000, note:null, created_at:null, ...over });
test.each([null, undefined, '', '1234', '電話なし'])('unusable phone %p never queries (never returns the whole facility history)', async phone => {
  expect(await getCustomerPhoneVisits('f1', phone)).toEqual([]);
  expect(mockRpc).not.toHaveBeenCalled(); expect(mockFrom).not.toHaveBeenCalled();
});
test('phone history comes from the facility-scoped RPC with normalised digits', async () => {
  pages = [{ data: [phoneVisit('v1'), phoneVisit('v2')] }];
  expect(await getCustomerPhoneVisits('f1', '０９０-1111 2222')).toEqual([phoneVisit('v1'), phoneVisit('v2')]);
  expect(mockRpc).toHaveBeenCalledWith('get_customer_phone_visits',{ p_facility_id:'f1', p_phone:'09011112222' });
  expect(mockFrom).not.toHaveBeenCalled();
});
test('phone history RPC beyond 1000 is not truncated', async () => {
  pages = [{ data: Array(1000).fill(phoneVisit('v')) },{ data: [phoneVisit('last')] }];
  expect(await getCustomerPhoneVisits('f1', '090-1111-2222')).toHaveLength(1001);
});
test.each([{ data:null,error:{ code:'PGRST202' } },{ data:{ broken:true } }])('unavailable phone RPC %j falls back to the same rule over booking visits', async response => {
  pages = [response,{ data: [
    { ...phoneVisit('match'), booking: { phone: '090-1111-2222' } },
    { ...phoneVisit('blank-email'), customer_email: ' ', booking: { phone: '09011112222' } },
    { ...phoneVisit('has-email'), customer_email: 'mail@example.com', booking: { phone: '090-1111-2222' } },
    { ...phoneVisit('other-phone'), booking: { phone: '090-1111-9999' } },
    { ...phoneVisit('no-booking'), booking: null },
  ] }];
  expect(await getCustomerPhoneVisits('f1', '090-1111-2222')).toEqual([phoneVisit('match'), { ...phoneVisit('blank-email'), customer_email: ' ' }]);
  expect(chain.select).toHaveBeenCalledWith('*, booking:bookings(phone)');
  expect(chain.eq).toHaveBeenCalledWith('facility_id','f1');
  expect(chain.not).toHaveBeenCalledWith('booking_id','is',null);
});
test.each([{ data:null,error:{} },{ data:null }])('phone fallback failure %j cannot become empty history', async fallback => {
  pages = [{ data:null,error:{} },fallback];
  await expect(getCustomerPhoneVisits('f1','090-1111-2222')).rejects.toThrow('来店履歴');
});

// ── 顧客詳細：台帳のお客様 1 人の来店履歴（一覧と同じ突合） ──
describe('getLedgerCustomerVisits', () => {
  const emailVisit = (id: string, date: string) => ({ ...phoneVisit(id, { customer_email: 'a@example.com', visit_date: date }) });
  const yamada = { email: 'A@example.com', phone: '090-1111-2222' };

  test.each([null, ' '])('メールが無い（%p）お客様は電話番号の来店だけ（台帳は読まない）', async email => {
    pages = [{ data: [phoneVisit('p1')] }];
    expect(await getLedgerCustomerVisits('f1', { email, phone: '090-1111-2222' })).toEqual([phoneVisit('p1')]);
    expect(mockRpc).toHaveBeenCalledWith('get_customer_phone_visits', { p_facility_id: 'f1', p_phone: '09011112222' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('識別に使える電話番号が無いお客様はメールの来店だけ（台帳は読まない）', async () => {
    pages = [{ data: [emailVisit('e1', '2026-05-01')] }];
    expect(await getLedgerCustomerVisits('f1', { email: 'a@example.com', phone: '1234' })).toEqual([emailVisit('e1', '2026-05-01')]);
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('customer_visits');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('台帳でその電話番号を持つのが本人だけなら、メール無しの電話予約の来店も合わせて新しい順に並べる（回帰）', async () => {
    pages = [
      { data: [emailVisit('e2', '2026-05-01'), emailVisit('e1', '2026-03-01')] },
      { data: [yamada, { email: 'b@example.com', phone: '080-3333-4444' }] },
      { data: [phoneVisit('p2', { visit_date: '2026-05-10' }), phoneVisit('a0', { visit_date: '2026-05-01' }), phoneVisit('e1', { visit_date: '2026-03-01' })] },
    ];
    const result = await getLedgerCustomerVisits('f1', yamada);
    expect(result.map((v) => [v.id, v.visit_date])).toEqual([
      ['p2', '2026-05-10'], ['a0', '2026-05-01'], ['e2', '2026-05-01'], ['e1', '2026-03-01'],
    ]);
    expect(mockFrom).toHaveBeenCalledWith('customers');
    expect(chain.select).toHaveBeenCalledWith('email, phone');
    expect(chain.eq).toHaveBeenCalledWith('facility_id', 'f1');
    expect(chain.not).toHaveBeenCalledWith('phone', 'is', null);
    expect(chain.order).toHaveBeenCalledWith('id');
    expect(mockRpc).toHaveBeenCalledWith('get_customer_phone_visits', { p_facility_id: 'f1', p_phone: '09011112222' });
  });

  test('同じ電話番号のお客様が台帳に他にもいれば合わせない（一覧と同じ）', async () => {
    pages = [
      { data: [emailVisit('e1', '2026-05-01')] },
      { data: [yamada, { email: 'b@example.com', phone: '09011112222' }] },
    ];
    expect(await getLedgerCustomerVisits('f1', yamada)).toEqual([emailVisit('e1', '2026-05-01')]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test.each([{ data: null, error: {} }, { data: null }])('台帳を読めない %j ときは、少ない履歴を正しいものとして出さない', async ledgerPage => {
    pages = [{ data: [emailVisit('e1', '2026-05-01')] }, ledgerPage];
    await expect(getLedgerCustomerVisits('f1', yamada)).rejects.toThrow('顧客台帳');
  });
});

// ── 顧客一覧の台帳（2026年10月23日）：1000 件で切らない ──
// 一覧だけページングせずに読んでいたため、台帳が 1000 件を超える店舗では、全件を読む顧客詳細・RFM 集計と
// 電話番号での来店の寄せ方（ledgerPhoneLinks）が食い違っていた。
describe('getFacilityCustomerLedger', () => {
  const row = (id: number) => ({ id: `c${id}`, name: `N${id}`, name_kana: null, email: null, phone: '090-0000-0000', birthday: null, gender: null, notes: null });

  test('1001 件目も読む（1000 件で打ち切らない）・名前順で同名は id 順', async () => {
    pages = [{ data: Array.from({ length: 1000 }, (_, i) => row(i)) }, { data: [row(1000)] }];
    const ledger = await getFacilityCustomerLedger('f1');
    expect(ledger).toHaveLength(1001);
    expect(ledger[1000].id).toBe('c1000');
    expect(mockFrom).toHaveBeenCalledWith('customers');
    expect(chain.select).toHaveBeenCalledWith('id, name, name_kana, email, phone, birthday, gender, notes');
    expect(chain.eq).toHaveBeenCalledWith('facility_id', 'f1');
    expect(chain.order.mock.calls.slice(0, 2)).toEqual([['name', { ascending: true }], ['id']]);
    expect(chain.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  test.each(['PGRST205', '42P01'])('台帳のテーブルが未適用（%s）なら空（画面を落とさない）', async code => {
    pages = [{ data: null, error: { code, message: 'missing' } }];
    await expect(getFacilityCustomerLedger('f1')).resolves.toEqual([]);
  });

  test.each([
    [{ data: null, error: { code: '57014', message: 'timeout' } }, '顧客マスターの取得に失敗しました: timeout'],
    [{ data: null }, '顧客マスターの取得に失敗しました: customer ledger invalid'],
  ])('読めなければ例外（途中までの台帳を正しいものとして出さない）%#', async (page, message) => {
    pages = [{ data: Array.from({ length: 1000 }, (_, i) => row(i)) }, page];
    await expect(getFacilityCustomerLedger('f1')).rejects.toThrow(message);
  });
});

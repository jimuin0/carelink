/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/admin.ts
 * Covers getCustomerVisits and getUniqueCustomers
 */

let mockSupabase: { from: jest.Mock; rpc?: jest.Mock };

jest.mock('../supabase-server-auth', () => ({
  createServerSupabaseAuthClient: jest.fn(() => Promise.resolve(mockSupabase)),
}));

import { getCustomerVisits, getUniqueCustomers } from '../admin';

beforeEach(() => {
  jest.clearAllMocks();
  mockSupabase = { from: jest.fn() };
});

describe('getCustomerVisits()', () => {
  test('emailなし → facility_idのみでフィルタ', async () => {
    const visits = [
      { id: 'v1', facility_id: 'f1', customer_email: 'a@test.com', visit_date: '2026-04-01' },
    ];

    // Build chain: from().select().eq('facility_id').order()
    const orderFn = jest.fn(() => Promise.resolve({ data: visits }));
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: orderFn,
    };
    mockSupabase.from.mockReturnValue(chain);

    const result = await getCustomerVisits('f1');
    expect(result).toEqual(visits);
    expect(orderFn).toHaveBeenCalledWith('visit_date', { ascending: false });
  });

  test('emailあり → email_canonical(正規化)で絞り込む', async () => {
    const visits = [
      { id: 'v2', facility_id: 'f1', customer_email: 'b@test.com', visit_date: '2026-04-02' },
    ];

    // email 指定時は email_canonical で絞り込む（入力も canonicalizeEmail で正規化）
    const eqEmailFn = jest.fn(() => Promise.resolve({ data: visits }));
    const orderFn = jest.fn(() => ({ eq: eqEmailFn }));
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: orderFn,
    };
    mockSupabase.from.mockReturnValue(chain);

    // Gmail 別名で渡しても canonical に正規化して突合する
    const result = await getCustomerVisits('f1', 'B.B+x@Gmail.com');
    expect(result).toEqual(visits);
    expect(eqEmailFn).toHaveBeenCalledWith('email_canonical', 'bb@gmail.com');
  });

  test('data が null → 空配列を返す', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(() => Promise.resolve({ data: null })),
    };
    mockSupabase.from.mockReturnValue(chain);

    const result = await getCustomerVisits('f1');
    expect(result).toEqual([]);
  });

  test('email指定 + email_canonical 列未適用(42703) → customer_email でフォールバック', async () => {
    const visits = [{ id: 'v9', facility_id: 'f1', customer_email: 'b@test.com', visit_date: '2026-04-02' }];
    // base().eq(col,val) の終端。1回目(email_canonical)は列不在エラー、2回目(customer_email)は data。
    const tailEq = jest.fn((col: string) =>
      col === 'email_canonical'
        ? Promise.resolve({ data: null, error: { code: '42703', message: 'column "email_canonical" does not exist' } })
        : Promise.resolve({ data: visits })
    );
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(() => ({ eq: tailEq })),
    };
    mockSupabase.from.mockReturnValue(chain);

    const result = await getCustomerVisits('f1', 'b@test.com');
    expect(result).toEqual(visits);
    expect(tailEq).toHaveBeenCalledWith('email_canonical', 'b@test.com');
    expect(tailEq).toHaveBeenCalledWith('customer_email', 'b@test.com');
  });

  test('email指定 + 結果 data=null（エラーなし）→ 空配列（?? [] 分岐）', async () => {
    const tailEq = jest.fn(() => Promise.resolve({ data: null }));
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(() => ({ eq: tailEq })),
    };
    mockSupabase.from.mockReturnValue(chain);

    const result = await getCustomerVisits('f1', 'b@test.com');
    expect(result).toEqual([]);
  });
});

describe('getUniqueCustomers()', () => {
  test('データなし → 空配列', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(() => Promise.resolve({ data: null })),
    };
    mockSupabase.from.mockReturnValue(chain);

    const result = await getUniqueCustomers('f1');
    expect(result).toEqual([]);
  });

  test('複数訪問を email 別に集計', async () => {
    const rows = [
      { customer_email: 'a@test.com', customer_name: '山田', visit_date: '2026-04-10' },
      { customer_email: 'b@test.com', customer_name: '田中', visit_date: '2026-04-05' },
      { customer_email: 'a@test.com', customer_name: '山田', visit_date: '2026-04-01' }, // duplicate
    ];

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(() => Promise.resolve({ data: rows })),
    };
    mockSupabase.from.mockReturnValue(chain);

    const result = await getUniqueCustomers('f1');
    expect(result).toHaveLength(2);

    const aEntry = result.find(r => r.email === 'a@test.com');
    expect(aEntry?.visit_count).toBe(2);
    expect(aEntry?.name).toBe('山田');

    const bEntry = result.find(r => r.email === 'b@test.com');
    expect(bEntry?.visit_count).toBe(1);
  });

  test('email_canonical で Gmail 別名を同一人物に統合（表示は原文を保持）', async () => {
    // 同一人物が Gmail のドット/+tag 違いで来店 → email_canonical が同一なので1顧客に統合される
    const rows = [
      { customer_email: 'f.o.o@gmail.com', email_canonical: 'foo@gmail.com', customer_name: '太郎', visit_date: '2026-04-10' },
      { customer_email: 'foo+shop@gmail.com', email_canonical: 'foo@gmail.com', customer_name: '太郎', visit_date: '2026-04-05' },
    ];
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(() => Promise.resolve({ data: rows })),
    };
    mockSupabase.from.mockReturnValue(chain);

    const result = await getUniqueCustomers('f1');
    // 別名2件が1顧客に統合（visit_count=2）。表示メールは原文(最初の行)を保持。
    expect(result).toHaveLength(1);
    expect(result[0].visit_count).toBe(2);
    expect(result[0].email).toBe('f.o.o@gmail.com');
  });

  test('単一ユーザーは visit_count=1', async () => {
    const rows = [
      { customer_email: 'c@test.com', customer_name: '鈴木', visit_date: '2026-03-01' },
    ];

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(() => Promise.resolve({ data: rows })),
    };
    mockSupabase.from.mockReturnValue(chain);

    const result = await getUniqueCustomers('f1');
    expect(result).toHaveLength(1);
    expect(result[0].visit_count).toBe(1);
    expect(result[0].last_visit).toBe('2026-03-01');
  });

  test('email_canonical 列が未適用(42703) → customer_email を JS canonical 化してフォールバック', async () => {
    const rows = [
      { customer_email: 'f.o.o@gmail.com', customer_name: '太郎', visit_date: '2026-04-10' },
      { customer_email: 'foo+x@gmail.com', customer_name: '太郎', visit_date: '2026-04-05' },
    ];
    let call = 0;
    const orderFn = jest.fn(() => {
      call++;
      // 1回目(email_canonical 含む select)は列不在エラー、2回目(フォールバック select)は data
      if (call === 1) return Promise.resolve({ data: null, error: { code: '42703', message: 'column "email_canonical" does not exist' } });
      return Promise.resolve({ data: rows });
    });
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: orderFn,
    };
    mockSupabase.from.mockReturnValue(chain);

    const result = await getUniqueCustomers('f1');
    // canonicalizeEmail で foo@gmail.com に統合 → 1顧客 visit_count=2
    expect(result).toHaveLength(1);
    expect(result[0].visit_count).toBe(2);
  });

  test('集計 RPC が成功 → RPC 結果を使用し全行取得(from)しない（visit_count を数値化）', async () => {
    mockSupabase.rpc = jest.fn(() => Promise.resolve({
      data: [
        { email: 'a@test.com', name: '山田', visit_count: 3, last_visit: '2026-05-01' },
        { email: 'b@test.com', name: '田中', visit_count: '1', last_visit: '2026-04-20' }, // bigint が文字列で来ても数値化
      ],
      error: null,
    }));

    const result = await getUniqueCustomers('f1');

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_unique_customers', { p_facility_id: 'f1' });
    expect(mockSupabase.from).not.toHaveBeenCalled(); // RPC 成功時は全来店行を取得しない
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ email: 'a@test.com', name: '山田', visit_count: 3, last_visit: '2026-05-01' });
    expect(result[1].visit_count).toBe(1); // 文字列 '1' → 数値 1
  });

  test('集計 RPC 未適用(PGRST202) → 従来の JS 集計にフォールバック', async () => {
    mockSupabase.rpc = jest.fn(() => Promise.resolve({
      data: null,
      error: { code: 'PGRST202', message: 'function get_unique_customers does not exist' },
    }));
    const rows = [
      { customer_email: 'a@test.com', customer_name: '山田', visit_date: '2026-04-10' },
      { customer_email: 'a@test.com', customer_name: '山田', visit_date: '2026-04-01' },
    ];
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(() => Promise.resolve({ data: rows })),
    };
    mockSupabase.from.mockReturnValue(chain);

    const result = await getUniqueCustomers('f1');

    expect(mockSupabase.rpc).toHaveBeenCalled();
    expect(mockSupabase.from).toHaveBeenCalledWith('customer_visits'); // フォールバックで全行取得
    expect(result).toHaveLength(1);
    expect(result[0].visit_count).toBe(2);
  });

  test('集計 RPC が配列以外(null)を返す → JS 集計にフォールバック', async () => {
    mockSupabase.rpc = jest.fn(() => Promise.resolve({ data: null, error: null }));
    const rows = [
      { customer_email: 'z@test.com', customer_name: 'Z', visit_date: '2026-01-01' },
    ];
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(() => Promise.resolve({ data: rows })),
    };
    mockSupabase.from.mockReturnValue(chain);

    const result = await getUniqueCustomers('f1');

    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('z@test.com');
  });
});

/**
 * @jest-environment node
 *
 * Tests for lib/admin.ts
 * Covers getCustomerVisits and getUniqueCustomers
 */

let mockSupabase: { from: jest.Mock };

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

  test('emailあり → customer_emailでも絞り込む', async () => {
    const visits = [
      { id: 'v2', facility_id: 'f1', customer_email: 'b@test.com', visit_date: '2026-04-02' },
    ];

    // When email is provided, the route chains one more .eq('customer_email', email)
    const eqEmailFn = jest.fn(() => Promise.resolve({ data: visits }));
    const orderFn = jest.fn(() => ({ eq: eqEmailFn }));
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: orderFn,
    };
    mockSupabase.from.mockReturnValue(chain);

    const result = await getCustomerVisits('f1', 'b@test.com');
    expect(result).toEqual(visits);
    expect(eqEmailFn).toHaveBeenCalledWith('customer_email', 'b@test.com');
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
});

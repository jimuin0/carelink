const mockInsert = jest.fn().mockResolvedValue({});
const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });

jest.mock('../supabase-server', () => ({
  createServiceRoleClient: jest.fn(() => ({ from: mockFrom })),
}));

import { getRequestContext, diffValues, writeAuditLog } from '../audit-logger';

function createMockRequest(headers: Record<string, string> = {}): Request {
  return {
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as unknown as Request;
}

describe('getRequestContext', () => {
  test('extracts IP from x-forwarded-for header', () => {
    const req = createMockRequest({ 'x-forwarded-for': '192.168.1.1' });
    const { ip } = getRequestContext(req);
    expect(ip).toBe('192.168.1.1');
  });

  test('extracts LAST (trusted proxy) IP from x-forwarded-for with multiple IPs', () => {
    // セキュリティ修正: クライアントが詐称できる先頭値ではなく、最も外側の
    // 信頼できるプロキシが付与した末尾値を採用する。
    const req = createMockRequest({ 'x-forwarded-for': '192.168.1.1, 10.0.0.1, 172.16.0.1' });
    const { ip } = getRequestContext(req);
    expect(ip).toBe('172.16.0.1');
  });

  test('trims and takes last element of x-forwarded-for with whitespace', () => {
    const req = createMockRequest({ 'x-forwarded-for': '  192.168.1.1  , 10.0.0.1' });
    const { ip } = getRequestContext(req);
    expect(ip).toBe('10.0.0.1');
  });

  test('prefers x-real-ip over x-forwarded-for', () => {
    // プラットフォーム(Vercel 等)由来の x-real-ip を最優先する。
    const req = createMockRequest({
      'x-real-ip': '203.0.113.7',
      'x-forwarded-for': '1.2.3.4, 5.6.7.8',
    });
    const { ip } = getRequestContext(req);
    expect(ip).toBe('203.0.113.7');
  });

  test('returns "unknown" for missing IP headers', () => {
    const req = createMockRequest({});
    const { ip } = getRequestContext(req);
    expect(ip).toBe('unknown');
  });

  test('extracts user-agent header', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
    const req = createMockRequest({ 'user-agent': ua });
    const { ua: extractedUA } = getRequestContext(req);
    expect(extractedUA).toBe(ua);
  });

  test('returns null for missing user-agent', () => {
    const req = createMockRequest({});
    const { ua } = getRequestContext(req);
    expect(ua).toBeNull();
  });

  test('extracts both IP and user-agent together', () => {
    const req = createMockRequest({
      'x-forwarded-for': '203.0.113.42',
      'user-agent': 'CustomBot/1.0',
    });
    const { ip, ua } = getRequestContext(req);
    expect(ip).toBe('203.0.113.42');
    expect(ua).toBe('CustomBot/1.0');
  });

  test('handles IPv6 addresses', () => {
    const req = createMockRequest({ 'x-forwarded-for': '2001:0db8:85a3:0000:0000:8a2e:0370:7334' });
    const { ip } = getRequestContext(req);
    expect(ip).toBe('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
  });
});

describe('writeAuditLog', () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockInsert.mockClear();
    mockInsert.mockResolvedValue({});
  });

  test('inserts audit log with all fields', async () => {
    await writeAuditLog({
      userId: 'user-1',
      facilityId: 'fac-1',
      action: 'update',
      tableName: 'bookings',
      recordId: 'rec-1',
      oldValues: { status: 'pending' },
      newValues: { status: 'confirmed' },
      ipAddress: '1.2.3.4',
      userAgent: 'TestBot/1.0',
    });
    expect(mockFrom).toHaveBeenCalledWith('audit_logs');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      facility_id: 'fac-1',
      action: 'update',
      table_name: 'bookings',
      record_id: 'rec-1',
    }));
  });

  test('inserts with null defaults for optional fields', async () => {
    await writeAuditLog({ action: 'create', tableName: 'facilities' });
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: null,
      facility_id: null,
      record_id: null,
      old_values: null,
      new_values: null,
      ip_address: null,
      user_agent: null,
    }));
  });

  test('does not throw when insert fails (fire-and-forget)', async () => {
    mockInsert.mockRejectedValue(new Error('DB error'));
    await expect(writeAuditLog({ action: 'delete', tableName: 'users' })).resolves.toBeUndefined();
  });
});

describe('diffValues', () => {
  test('returns empty diff when objects are identical', () => {
    const obj = { name: 'test', value: 123 };
    const diff = diffValues(obj, obj);
    expect(diff.old).toEqual({});
    expect(diff.new).toEqual({});
  });

  test('detects changed primitive values', () => {
    const old = { name: 'old', value: 100 };
    const new_obj = { name: 'new', value: 100 };
    const diff = diffValues(old, new_obj);
    expect(diff.old).toEqual({ name: 'old' });
    expect(diff.new).toEqual({ name: 'new' });
  });

  test('detects changed numeric values', () => {
    const old = { price: 1000 };
    const new_obj = { price: 2000 };
    const diff = diffValues(old, new_obj);
    expect(diff.old).toEqual({ price: 1000 });
    expect(diff.new).toEqual({ price: 2000 });
  });

  test('detects changed boolean values', () => {
    const old = { active: true };
    const new_obj = { active: false };
    const diff = diffValues(old, new_obj);
    expect(diff.old).toEqual({ active: true });
    expect(diff.new).toEqual({ active: false });
  });

  test('detects null to value change', () => {
    const old = { description: null };
    const new_obj = { description: 'New description' };
    const diff = diffValues(old, new_obj);
    expect(diff.old).toEqual({ description: null });
    expect(diff.new).toEqual({ description: 'New description' });
  });

  test('detects value to null change', () => {
    const old = { description: 'Old description' };
    const new_obj = { description: null };
    const diff = diffValues(old, new_obj);
    expect(diff.old).toEqual({ description: 'Old description' });
    expect(diff.new).toEqual({ description: null });
  });

  test('detects object changes (JSON comparison)', () => {
    const old = { meta: { type: 'A' } };
    const new_obj = { meta: { type: 'B' } };
    const diff = diffValues(old, new_obj);
    expect(diff.old).toEqual({ meta: { type: 'A' } });
    expect(diff.new).toEqual({ meta: { type: 'B' } });
  });

  test('detects array changes', () => {
    const old = { tags: ['a', 'b'] };
    const new_obj = { tags: ['a', 'b', 'c'] };
    const diff = diffValues(old, new_obj);
    expect(diff.old).toEqual({ tags: ['a', 'b'] });
    expect(diff.new).toEqual({ tags: ['a', 'b', 'c'] });
  });

  test('only includes changed fields', () => {
    const old = { id: '1', name: 'old', status: 'active', email: 'test@example.com' };
    const new_obj = { id: '1', name: 'new', status: 'active', email: 'test@example.com' };
    const diff = diffValues(old, new_obj);
    expect(Object.keys(diff.old)).toEqual(['name']);
    expect(Object.keys(diff.new)).toEqual(['name']);
    expect(diff.old.name).toBe('old');
    expect(diff.new.name).toBe('new');
  });

  test('handles multiple changes', () => {
    const old = { a: 1, b: 2, c: 3 };
    const new_obj = { a: 10, b: 2, c: 30 };
    const diff = diffValues(old, new_obj);
    expect(diff.old).toEqual({ a: 1, c: 3 });
    expect(diff.new).toEqual({ a: 10, c: 30 });
  });

  test('handles deeply nested objects', () => {
    const old = { data: { nested: { value: 'old' } } };
    const new_obj = { data: { nested: { value: 'new' } } };
    const diff = diffValues(old, new_obj);
    expect(diff.old).toEqual({ data: { nested: { value: 'old' } } });
    expect(diff.new).toEqual({ data: { nested: { value: 'new' } } });
  });

  test('compares objects by JSON stringify (not reference)', () => {
    const a = { x: 1 };
    const b = { x: 1 };
    const old = { obj: a };
    const new_obj = { obj: b };
    const diff = diffValues(old, new_obj);
    // Should be equal since JSON stringified values are the same
    expect(diff.old).toEqual({});
    expect(diff.new).toEqual({});
  });
});

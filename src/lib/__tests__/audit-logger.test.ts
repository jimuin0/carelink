const mockInsert = jest.fn().mockResolvedValue({});
const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });

jest.mock('../supabase-server', () => ({
  createServiceRoleClient: jest.fn(() => ({ from: mockFrom })),
}));

import { getRequestContext, writeAuditLog } from '../audit-logger';

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

  test('insert が error を返す(DB拒否・throw しない) → console.error で証跡欠落を可視化', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // supabase-js は RLS 拒否・CHECK 制約違反等を throw せず戻り値の error に格納する。
    mockInsert.mockResolvedValue({ error: { message: 'new row violates row-level security' } });
    await writeAuditLog({ action: 'update', tableName: 'bookings', recordId: 'rec-x' });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('DB rejected'),
      expect.objectContaining({ recordId: 'rec-x' }),
    );
    consoleSpy.mockRestore();
  });

  test('insert error 時に recordId 未指定 → ログの recordId は null', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockInsert.mockResolvedValue({ error: { message: 'check constraint violation' } });
    await writeAuditLog({ action: 'create', tableName: 'facilities' });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: null }),
    );
    consoleSpy.mockRestore();
  });

  // toJsonValue の安全側フォールバック（JSON化不能な値は null に変換される）を固定する。
  // 関数値は typeof が 'object' でも配列でもないため toJsonValue の最終 `return null` に
  // 到達する。コメントで主張している契約なので、実際にその挙動をテストで検証する。
  test('oldValues/newValues に JSON化不能な値（関数）を含む → 該当キーは null に変換されて挿入される', async () => {
    await writeAuditLog({
      action: 'update',
      tableName: 'bookings',
      recordId: 'rec-x',
      oldValues: { status: 'pending', handler: () => {} },
      newValues: { status: 'confirmed', handler: () => {} },
    });
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      old_values: { status: 'pending', handler: null },
      new_values: { status: 'confirmed', handler: null },
    }));
  });
});


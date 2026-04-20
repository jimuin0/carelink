/**
 * @jest-environment node
 *
 * Tests for GET /api/health
 * Key assertions:
 *   - DB healthy → 200 with status=healthy
 *   - DB error → 503 with status=unhealthy
 *   - DB throws exception → 503 with status=unhealthy, db=exception
 *   - Response includes elapsed_ms and timestamp
 */

jest.mock('@/lib/supabase-server', () => {
  const mockSelect = jest.fn().mockReturnThis();
  const mockLimit = jest.fn().mockReturnThis();

  return {
    createServerSupabaseClient: jest.fn(() => ({
      from: jest.fn().mockReturnValue({
        select: mockSelect,
      }),
    })),
    __getMockSelect: () => mockSelect,
    __getMockLimit: () => mockLimit,
  };
});

const mockSelect = jest.fn().mockReturnThis();
const mockLimit = jest.fn().mockReturnThis();

beforeEach(() => {
  jest.clearAllMocks();
  mockSelect.mockClear().mockReturnThis();
  mockLimit.mockClear().mockReturnThis();

  const supabase = require('@/lib/supabase-server').createServerSupabaseClient;
  supabase.mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: mockSelect,
    }),
  });
});

describe('GET /api/health', () => {
  test('returns 200 with healthy status on success', async () => {
    mockSelect.mockReturnValue({
      limit: mockLimit,
    });
    mockLimit.mockResolvedValue({ data: [{ id: '123' }], error: null });

    const { GET } = await import('../route');
    const res = await GET();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('healthy');
    expect(json.db).toBe('ok');
  });

  test('returns 503 with unhealthy status on DB error', async () => {
    mockSelect.mockReturnValue({
      limit: mockLimit,
    });
    mockLimit.mockResolvedValue({
      data: null,
      error: { message: 'Connection timeout' },
    });

    const { GET } = await import('../route');
    const res = await GET();

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe('unhealthy');
    expect(json.db).toBe('error');
  });

  test('returns 503 with exception status on thrown error', async () => {
    mockSelect.mockReturnValue({
      limit: mockLimit,
    });
    mockLimit.mockRejectedValue(new Error('Network failed'));

    const { GET } = await import('../route');
    const res = await GET();

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe('unhealthy');
    expect(json.db).toBe('exception');
  });

  test('includes elapsed_ms in response', async () => {
    mockSelect.mockReturnValue({
      limit: mockLimit,
    });
    mockLimit.mockResolvedValue({ data: [], error: null });

    const { GET } = await import('../route');
    const res = await GET();

    const json = await res.json();
    expect(json.elapsed_ms).toBeDefined();
    expect(typeof json.elapsed_ms).toBe('number');
    expect(json.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  test('includes timestamp in ISO format', async () => {
    mockSelect.mockReturnValue({
      limit: mockLimit,
    });
    mockLimit.mockResolvedValue({ data: null, error: null });

    const { GET } = await import('../route');
    const res = await GET();

    const json = await res.json();
    expect(json.timestamp).toBeDefined();
    expect(typeof json.timestamp).toBe('string');
    expect(() => new Date(json.timestamp)).not.toThrow();
  });

  test('includes version from VERCEL_GIT_COMMIT_SHA', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc1234567890';

    mockSelect.mockReturnValue({
      limit: mockLimit,
    });
    mockLimit.mockResolvedValue({ data: null, error: null });

    const { GET } = await import('../route');
    const res = await GET();

    const json = await res.json();
    expect(json.version).toBe('abc1234');
  });

  test('uses local as version when VERCEL_GIT_COMMIT_SHA not set', async () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;

    mockSelect.mockReturnValue({
      limit: mockLimit,
    });
    mockLimit.mockResolvedValue({ data: null, error: null });

    const { GET } = await import('../route');
    const res = await GET();

    const json = await res.json();
    expect(json.version).toBe('local');
  });

  test('calls SELECT with count exact and head true', async () => {
    mockSelect.mockReturnValue({
      limit: mockLimit,
    });
    mockLimit.mockResolvedValue({ data: null, error: null });

    const { GET } = await import('../route');
    await GET();

    const supabase = require('@/lib/supabase-server').createServerSupabaseClient();
    expect(supabase.from).toHaveBeenCalledWith('facility_profiles');
    expect(mockSelect).toHaveBeenCalledWith('id', { count: 'exact', head: true });
  });

  test('limits query to 1 row', async () => {
    mockSelect.mockReturnValue({
      limit: mockLimit,
    });
    mockLimit.mockResolvedValue({ data: null, error: null });

    const { GET } = await import('../route');
    await GET();

    expect(mockLimit).toHaveBeenCalledWith(1);
  });

  test('measures elapsed time accurately', async () => {
    mockSelect.mockReturnValue({
      limit: mockLimit,
    });

    let resolveQuery: any;
    const delayedPromise = new Promise(resolve => {
      resolveQuery = resolve;
    });
    mockLimit.mockReturnValue(delayedPromise);

    const { GET } = await import('../route');
    const getPromise = GET();

    // Small delay to ensure some time passes
    await new Promise(r => setTimeout(r, 10));
    resolveQuery({ data: null, error: null });

    const res = await getPromise;
    const json = await res.json();
    expect(json.elapsed_ms).toBeGreaterThanOrEqual(10);
  });

  test('error response includes elapsed_ms on DB error', async () => {
    mockSelect.mockReturnValue({
      limit: mockLimit,
    });
    mockLimit.mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    });

    const { GET } = await import('../route');
    const res = await GET();

    const json = await res.json();
    expect(json.elapsed_ms).toBeDefined();
    expect(typeof json.elapsed_ms).toBe('number');
  });

  test('error response includes elapsed_ms on exception', async () => {
    mockSelect.mockReturnValue({
      limit: mockLimit,
    });
    mockLimit.mockRejectedValue(new Error('Unexpected error'));

    const { GET } = await import('../route');
    const res = await GET();

    const json = await res.json();
    expect(json.elapsed_ms).toBeDefined();
    expect(typeof json.elapsed_ms).toBe('number');
  });
});

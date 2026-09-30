/**
 * @jest-environment node
 */

jest.mock('@/lib/cron-auth', () => ({
  checkCronAuth: jest.fn(() => null),
}));
jest.mock('@/lib/cron-logger', () => ({
  cronError: jest.fn(async (_job: string, _started: Date, cause: unknown) => ({
    status: 500,
    json: async () => ({ error: cause instanceof Error ? cause.message : 'Internal Server Error' }),
  })),
  logCronRun: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(),
}));

import { checkCronAuth } from '@/lib/cron-auth';
import { cronError, logCronRun } from '@/lib/cron-logger';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { GET } from '../route';

type Config = {
  jobs?: Array<{ user_id: string }> | null;
  fetchError?: unknown;
  deleteErrors?: Array<unknown>;
  updateErrors?: Array<unknown>;
};

function setup(config: Config = {}) {
  let updateIndex = 0;
  const update = jest.fn((_patch: Record<string, unknown>) => ({
    eq: jest.fn().mockResolvedValue({ error: config.updateErrors?.[updateIndex++] ?? null }),
  }));
  const select = jest.fn(() => ({
    in: jest.fn(() => ({
      order: jest.fn(() => ({
        limit: jest.fn().mockResolvedValue({
          data: config.jobs === null ? null : config.jobs ?? [],
          error: config.fetchError ?? null,
        }),
      })),
    })),
  }));
  const client = {
    from: jest.fn((table: string) => {
      if (table !== 'account_deletion_jobs') throw new Error(`unexpected table: ${table}`);
      return { select, update };
    }),
    auth: {
      admin: {
        deleteUser: jest.fn()
          .mockResolvedValueOnce({ error: config.deleteErrors?.[0] ?? null })
          .mockResolvedValueOnce({ error: config.deleteErrors?.[1] ?? null })
          .mockResolvedValueOnce({ error: config.deleteErrors?.[2] ?? null }),
      },
    },
  };
  (createServiceRoleClient as jest.Mock).mockReturnValue(client);
  return { client, update };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

test('cron認証エラーはそのまま返す', async () => {
  const authError = { status: 401 };
  (checkCronAuth as jest.Mock).mockReturnValue(authError);

  const res = await GET(new Request('https://carelink-jp.com/api/cron/account-deletion-retry'));

  expect(res).toBe(authError);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});

test('job取得失敗はcronErrorで500', async () => {
  setup({ fetchError: { message: 'db unavailable' } });

  const res = await GET(new Request('https://carelink-jp.com/api/cron/account-deletion-retry'));

  expect(res.status).toBe(500);
  expect(cronError).toHaveBeenCalledWith(
    'account-deletion-retry', expect.any(Date), { message: 'db unavailable' }, { message: 'Internal Server Error' },
  );
});

test('job一覧がnullでも空として扱い、削除APIを呼ばない', async () => {
  const { client } = setup({ jobs: null });

  const res = await GET(new Request('https://carelink-jp.com/api/cron/account-deletion-retry'));

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ processed: 0, skipped: 0 });
  expect(client.auth.admin.deleteUser).not.toHaveBeenCalled();
});

test('既に削除済み・再試行成功・更新失敗を分類して集計する', async () => {
  const { client, update } = setup({
    jobs: [{ user_id: 'gone' }, { user_id: 'retry' }, { user_id: 'complete-fail' }],
    deleteErrors: [
      { status: 404, message: 'not found' },
      { status: 500, message: 'still exists' },
      null,
    ],
    updateErrors: [null, null, { message: 'complete write failed' }],
  });

  const res = await GET(new Request('https://carelink-jp.com/api/cron/account-deletion-retry'));
  const body = await res.json();

  expect(body).toEqual({ processed: 1, skipped: 2 });
  expect(client.auth.admin.deleteUser).toHaveBeenCalledTimes(3);
  expect(update).toHaveBeenCalledTimes(3);
  expect(logCronRun).toHaveBeenCalledWith(
    'account-deletion-retry', 'success', expect.any(Date), { processed: 1, skipped: 2 },
  );
});

test('auth削除失敗の状態更新失敗も処理を継続する', async () => {
  setup({
    jobs: [{ user_id: 'retry' }],
    deleteErrors: [{ message: 'temporary failure' }],
    updateErrors: [{ message: 'state write failed' }],
  });

  const res = await GET(new Request('https://carelink-jp.com/api/cron/account-deletion-retry'));

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ processed: 0, skipped: 1 });
  expect(console.error).toHaveBeenCalledWith(
    '[account-deletion-retry] state update failed',
    expect.objectContaining({ userId: 'retry' }),
  );
});

test('予期しない例外はcronErrorへ渡す', async () => {
  (createServiceRoleClient as jest.Mock).mockImplementation(() => {
    throw new Error('client init failed');
  });

  const res = await GET(new Request('https://carelink-jp.com/api/cron/account-deletion-retry'));

  expect(res.status).toBe(500);
  expect(cronError).toHaveBeenCalledWith('account-deletion-retry', expect.any(Date), expect.any(Error));
});

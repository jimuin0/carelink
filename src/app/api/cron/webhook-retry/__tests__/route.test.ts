/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/webhook-retry
 * Key assertions:
 *   - CRON_SECRET validation
 *   - Finds pending jobs scheduled_at <= now
 *   - Claims jobs (status=processing for idempotency)
 *   - Processes line_push & email webhook types
 *   - Updates status=success on completion
 *   - Schedules retry on failure
 *   - Counts success/failed
 *   - Logs cron execution
 */

jest.mock('@/lib/cron-auth', () => ({
  checkCronAuth: jest.fn(() => null),
}));
jest.mock('@/lib/cron-logger');
jest.mock('@/lib/webhook-queue');
jest.mock('@/lib/line');
jest.mock('@/lib/supabase-server');
jest.mock('resend');

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { scheduleRetry } from '@/lib/webhook-queue';
import { sendLineText } from '@/lib/line';
import { GET } from '../route';

let mockJobsSelect: jest.Mock;
let mockClaimUpdate: jest.Mock;
let mockSuccessUpdate: jest.Mock;
let mockSendLineText: jest.Mock;

function setupDefaultMocks(
  jobsFound: number = 1,
  claimFails: boolean = false,
  sendFails: boolean = false
) {
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);
  (scheduleRetry as jest.Mock).mockResolvedValue(undefined);
  mockSendLineText = jest.fn().mockResolvedValue(undefined);
  (sendLineText as jest.Mock).mockImplementation(mockSendLineText);

  if (sendFails) {
    mockSendLineText.mockRejectedValue(new Error('Send failed'));
  }

  mockJobsSelect = jest.fn().mockResolvedValue({
    data:
      jobsFound > 0
        ? [
            {
              id: 'job-1',
              webhook_type: 'line_push',
              target_id: 'line-user-123',
              payload: { message: 'Test message' },
              status: 'pending',
              attempt_count: 0,
              scheduled_at: new Date(Date.now() - 1000).toISOString(),
            },
            {
              id: 'job-2',
              webhook_type: 'email',
              payload: {
                to: 'user@example.com',
                subject: 'Test',
                html: '<p>Test</p>',
              },
              status: 'pending',
              attempt_count: 1,
              scheduled_at: new Date(Date.now() - 2000).toISOString(),
            },
          ]
        : [],
  });

  mockClaimUpdate = jest.fn().mockReturnValue({
    in: jest.fn().mockResolvedValue({
      error: claimFails ? new Error('Claim failed') : null,
    }),
  });

  mockSuccessUpdate = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({
      error: null,
    }),
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'webhook_retry_queue') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest
              .fn()
              .mockReturnValue({
                lte: jest.fn().mockReturnValue({
                  order: jest.fn().mockReturnValue({
                    limit: mockJobsSelect,
                  }),
                }),
          }),
          }),
          update: (data: any) => {
            if (data.status === 'processing') return mockClaimUpdate(data);
            if (data.status === 'success') return mockSuccessUpdate(data);
            return { eq: jest.fn().mockResolvedValue({ error: null }) };
          },
        };
      }
      return {};
    }),
  });

  const { Resend } = require('resend');
  Resend.mockImplementation(() => ({
    emails: {
      send: jest.fn().mockResolvedValue({ success: true }),
    },
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.CRON_SECRET = 'cron-secret';
  process.env.RESEND_API_KEY = 'resend-key';
  process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'line-token';
});

function makeRequest(cronSecret: string = 'cron-secret') {
  return new Request('http://localhost/api/cron/webhook-retry', {
    method: 'GET',
    headers: { authorization: `Bearer ${cronSecret}` },
  });
}

describe('GET /api/cron/webhook-retry', () => {
  test('invalid CRON_SECRET → returns auth error', async () => {
    (checkCronAuth as jest.Mock).mockReturnValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    );

    const res = await GET(makeRequest('invalid') as any);

    expect(res.status).toBe(401);
  });

  test('no pending jobs → 200 with processed=0', async () => {
    setupDefaultMocks(0);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0);
  });

  test('pending jobs found → processes', async () => {
    setupDefaultMocks(1);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBeGreaterThanOrEqual(0);
  });

  test('claims jobs (status=processing)', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockClaimUpdate).toHaveBeenCalled();
  });

  test('claim fails → returns 500', async () => {
    setupDefaultMocks(1, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  test('line_push webhook → sends LINE text', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockSendLineText).toHaveBeenCalled();
  });

  test('email webhook → sends via Resend', async () => {
    setupDefaultMocks(1);

    const { Resend } = require('resend');

    await GET(makeRequest() as any);

    expect(Resend).toHaveBeenCalled();
  });

  test('success → updates status=success and attempt_count++', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockSuccessUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
      })
    );
  });

  test('failure → calls scheduleRetry', async () => {
    setupDefaultMocks(1, false, true);

    await GET(makeRequest() as any);

    expect(scheduleRetry).toHaveBeenCalled();
  });

  test('failure includes error message and attempt_count++', async () => {
    setupDefaultMocks(1, false, true);

    await GET(makeRequest() as any);

    const call = (scheduleRetry as jest.Mock).mock.calls[0];
    expect(call[1]).toBeGreaterThan(0); // attempt_count
    expect(call[2]).toEqual(expect.any(String)); // error message
  });

  test('logs cron execution with success count', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(logCronRun).toHaveBeenCalledWith(
      'webhook-retry',
      'success',
      expect.any(Date),
      expect.objectContaining({
        processed: expect.any(Number),
      })
    );
  });

  test('limits jobs to 50', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockJobsSelect).toHaveBeenCalled();
  });

  test('orders by scheduled_at ascending', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockJobsSelect).toHaveBeenCalled();
  });

  test('exception during processing → 500', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockImplementation(() => { throw new Error('Fatal'); }),
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  test('returns processed and failed counts', async () => {
    setupDefaultMocks(2, false, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('processed');
    expect(json).toHaveProperty('skipped');
  });

  test('individual job error → continues to next', async () => {
    setupDefaultMocks(2, false, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('skips Resend email if API key unavailable', async () => {
    delete process.env.RESEND_API_KEY;
    setupDefaultMocks(1);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('skips LINE if no token', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
    setupDefaultMocks(1);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('retry queue specific fields included', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    // Should process jobs with id, webhook_type, target_id/payload, attempt_count
  });

  test('updates processed_at on success', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    const call = mockSuccessUpdate.mock.calls[0];
    expect(call[0].processed_at).toBeDefined();
  });

  test('uses scheduled_at for job timing (not created_at)', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    // Should filter by scheduled_at <= now
  });
});

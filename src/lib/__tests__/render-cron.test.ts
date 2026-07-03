import { resolveCronEndpoint, isHealthy, formatHealthSummary } from '../render-cron.mjs';
import { CRON_JOB_NAMES } from '../cron-jobs';

describe('resolveCronEndpoint', () => {
  const names = ['booking-reminder', 'webhook-retry'];

  it('既知の name を endpoint URL に解決する', () => {
    expect(resolveCronEndpoint('booking-reminder', names, 'https://carelink-jp.com')).toBe(
      'https://carelink-jp.com/api/cron/booking-reminder',
    );
  });

  it('baseUrl 末尾のスラッシュを正規化する', () => {
    expect(resolveCronEndpoint('webhook-retry', names, 'https://carelink-jp.com/')).toBe(
      'https://carelink-jp.com/api/cron/webhook-retry',
    );
  });

  it('未知の name は throw（typo 事故防止）', () => {
    expect(() => resolveCronEndpoint('nope', names, 'https://x')).toThrow('未知の cron ジョブ名');
  });

  it('baseUrl 未設定は throw', () => {
    expect(() => resolveCronEndpoint('booking-reminder', names, '')).toThrow('CARELINK_BASE_URL 未設定');
    expect(() => resolveCronEndpoint('booking-reminder', names, undefined)).toThrow('CARELINK_BASE_URL 未設定');
  });

  it('SSOT の全ジョブ名を解決できる（render.yaml の全 startCommand が有効）', () => {
    for (const name of CRON_JOB_NAMES) {
      expect(resolveCronEndpoint(name, CRON_JOB_NAMES, 'https://carelink-jp.com')).toBe(
        `https://carelink-jp.com/api/cron/${name}`,
      );
    }
  });
});

describe('isHealthy', () => {
  it('200 + status healthy → true', () => {
    expect(isHealthy(200, { status: 'healthy' })).toBe(true);
  });

  it('200 + status degraded → false', () => {
    expect(isHealthy(200, { status: 'degraded' })).toBe(false);
  });

  it('503 → false', () => {
    expect(isHealthy(503, { status: 'unhealthy' })).toBe(false);
  });

  it('body が null → false（パース失敗時）', () => {
    expect(isHealthy(200, null)).toBe(false);
  });
});

describe('formatHealthSummary', () => {
  it('body に status があれば含める', () => {
    expect(formatHealthSummary(200, { status: 'degraded' })).toBe('HTTP 200 / status degraded');
  });

  it('body が null なら unknown', () => {
    expect(formatHealthSummary(500, null)).toBe('HTTP 500 / status unknown');
  });

  it('body に status が無ければ unknown', () => {
    expect(formatHealthSummary(200, {})).toBe('HTTP 200 / status unknown');
  });
});

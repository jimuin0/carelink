/** @jest-environment node */
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));

import { GET } from '../route';
import { LISTING_FEES_NOTICE } from '@/lib/public-listing-terms';

describe('public support knowledge transport', () => {
  const original = process.env.VERCEL_GIT_COMMIT_SHA;
  afterEach(() => {
    if (original === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = original;
  });
  test('returns public source facts and prevents a browser/CDN from retaining an old snapshot', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'b'.repeat(40);
    const response = await GET(new Request('https://carelink-jp.com/api/line/support-knowledge'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const data = await response.json();
    expect(data.deployment).toBe('b'.repeat(40));
    expect(data.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(data.facts.pricing).toBe(LISTING_FEES_NOTICE);
    expect(data.facts.industries).toContain('歯科');
    expect(data.facts.registration.join()).toContain('書類を1点');
    expect(data.facts.registrationScope).toContain('個別の書類提出条件');
    expect(Object.keys(data).sort()).toEqual(['deployment', 'facts', 'revision', 'schema']);
    expect(Object.keys(data.facts).sort()).toEqual(['documentRequirement', 'industries', 'photos', 'pricing', 'publication', 'registration', 'registrationScope', 'sources']);
  });
  test('represents missing release provenance explicitly', async () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    const response = await GET(new Request('https://carelink-jp.com/api/line/support-knowledge'));
    expect((await response.json()).deployment).toBeNull();
  });
});

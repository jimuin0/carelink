/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import type { SupabaseClient } from '@supabase/supabase-js';
import { publishVerifiedFacilityIfReady } from '../listing-auto-publish';
import { checkPublishReadiness } from '../facility-publish-gate';

jest.mock('../facility-publish-gate', () => ({ checkPublishReadiness: jest.fn() }));
const facilityId = '75000000-0000-4000-8000-000000000001';
const actorId = '75000000-0000-4000-8000-000000000002';
const facility = jest.fn();
const approval = jest.fn();
const rpc = jest.fn();
const from = jest.fn((table: string) => ({
  select: () => ({ eq: (column: string, value: string) => {
    expect(value).toBe(facilityId);
    expect(column).toBe(table === 'facility_profiles' ? 'id' : 'facility_id');
    return { maybeSingle: table === 'facility_profiles' ? facility : approval };
  } }),
}));
const db = { from, rpc } as unknown as SupabaseClient;

beforeEach(() => {
  jest.clearAllMocks();
  facility.mockResolvedValue({ data: { status: 'draft' }, error: null });
  approval.mockResolvedValue({ data: { auto_publish_pending: true }, error: null });
  (checkPublishReadiness as jest.Mock).mockResolvedValue({ readiness: { ready: true, missing: [] }, error: null });
  rpc.mockResolvedValue({ data: 'published', error: null });
});

test('公開待ちの下書きの店舗は、アプリの公開の規則を通してから DB に公開を頼む', async () => {
  expect(await publishVerifiedFacilityIfReady(db, facilityId, actorId)).toBe('published');
  expect(checkPublishReadiness).toHaveBeenCalledWith(db, facilityId);
  expect(rpc).toHaveBeenCalledWith('try_auto_publish_verified_facility', { p_facility_id: facilityId, p_actor: actorId });
});

// 禁止表現などで公開の規則を満たさない店舗は、DB に頼まない（以前は DB の中だけで公開していた）。
test('公開の規則を満たさない店舗は公開しない', async () => {
  (checkPublishReadiness as jest.Mock).mockResolvedValue({ readiness: { ready: false, missing: ['キャッチコピー：…'] }, error: null });
  expect(await publishVerifiedFacilityIfReady(db, facilityId, actorId)).toBe('not_ready');
  expect(rpc).not.toHaveBeenCalled();
});

test.each([
  ['published', 'already_published'], ['suspended', 'suspended'],
])('%s の店舗は公開を試みない', async (status, outcome) => {
  facility.mockResolvedValue({ data: { status }, error: null });
  expect(await publishVerifiedFacilityIfReady(db, facilityId, actorId)).toBe(outcome);
  expect(checkPublishReadiness).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

test.each([{ data: null, error: null }, { data: { auto_publish_pending: false }, error: null }])('公開待ちの印が無ければ公開しない %#', async result => {
  approval.mockResolvedValue(result);
  expect(await publishVerifiedFacilityIfReady(db, facilityId, actorId)).toBe('not_pending');
  expect(rpc).not.toHaveBeenCalled();
});

test.each(['not_pending', 'not_ready', 'blocked'])('DB の結果 %s をそのまま返す', async outcome => {
  rpc.mockResolvedValue({ data: outcome, error: null });
  expect(await publishVerifiedFacilityIfReady(db, facilityId, actorId)).toBe(outcome);
});

test.each([
  ['facility lookup', () => facility.mockResolvedValue({ data: null, error: { message: 'x' } })],
  ['missing facility', () => facility.mockResolvedValue({ data: null, error: null })],
  ['approval lookup', () => approval.mockResolvedValue({ data: null, error: { message: 'x' } })],
  ['readiness', () => (checkPublishReadiness as jest.Mock).mockResolvedValue({ readiness: { ready: false, missing: [] }, error: { message: 'x' } })],
  ['rpc error', () => rpc.mockResolvedValue({ data: null, error: { message: 'x' } })],
  ['unknown rpc result', () => rpc.mockResolvedValue({ data: true, error: null })],
  // 読んだ後に別の操作で公開・休止された：結果を言い切らない。
  ['changed meanwhile', () => rpc.mockResolvedValue({ data: 'not_draft', error: null })],
  ['thrown', () => rpc.mockRejectedValue(new Error('network'))],
])('確認できないときは unavailable（%s）', async (_label, arrange) => {
  arrange();
  expect(await publishVerifiedFacilityIfReady(db, facilityId, actorId)).toBe('unavailable');
});

/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { releaseMismatchedGbpPlace } from '../gbp-place-release';

function client(update: { data: unknown; error: unknown }, cacheError: unknown = null) {
  const select = jest.fn().mockResolvedValue(update);
  const eqPlace = jest.fn(() => ({ select }));
  const eqId = jest.fn(() => ({ eq: eqPlace }));
  const updateFn = jest.fn(() => ({ eq: eqId }));
  const cacheEq = jest.fn().mockResolvedValue({ error: cacheError });
  const del = jest.fn(() => ({ eq: cacheEq }));
  const from = jest.fn((table: string) => (table === 'facility_profiles' ? { update: updateFn } : { delete: del }));
  return { db: { from } as never, from, updateFn, eqId, eqPlace, select, del, cacheEq };
}

// 回帰（2026年10月23日・レビュー指摘）: 照合が外れても評価を消すだけで Place ID を残していた。
describe('releaseMismatchedGbpPlace', () => {
  test('detaches the Place ID with its CID, connection time and rating, only while it is still the checked ID, then drops the audit', async () => {
    const c = client({ data: [{ id: 'f1' }], error: null });
    await expect(releaseMismatchedGbpPlace(c.db, 'f1', 'ChIJOther')).resolves.toBe('released');
    expect(c.updateFn).toHaveBeenCalledWith({ gbp_place_id: null, gbp_cid: null, gbp_connected_at: null, google_rating: null, google_review_count: 0 });
    expect(c.eqId).toHaveBeenCalledWith('id', 'f1');
    expect(c.eqPlace).toHaveBeenCalledWith('gbp_place_id', 'ChIJOther');
    expect(c.select).toHaveBeenCalledWith('id');
    expect(c.from).toHaveBeenCalledWith('gbp_audit_cache');
    expect(c.cacheEq).toHaveBeenCalledWith('facility_id', 'f1');
  });

  test.each([[[]], [null]])('a Place ID replaced meanwhile (%p rows) is left alone and the audit is kept', async (rows) => {
    const c = client({ data: rows, error: null });
    await expect(releaseMismatchedGbpPlace(c.db, 'f1', 'ChIJOther')).resolves.toBe('changed');
    expect(c.del).not.toHaveBeenCalled();
  });

  test('a failed update is reported, and the audit is not touched', async () => {
    const c = client({ data: null, error: { code: '08006' } });
    await expect(releaseMismatchedGbpPlace(c.db, 'f1', 'ChIJOther')).resolves.toBe('failed');
    expect(c.del).not.toHaveBeenCalled();
  });

  test('a failed audit cleanup is reported', async () => {
    const c = client({ data: [{ id: 'f1' }], error: null }, { code: '08006' });
    await expect(releaseMismatchedGbpPlace(c.db, 'f1', 'ChIJOther')).resolves.toBe('failed');
  });
});

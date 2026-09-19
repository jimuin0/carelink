import {
  adaptSalonRow,
  analyzeMerchantRegistrations,
  type MerchantEvidence,
  type MerchantSalonRow,
} from '../merchant-conversion';

const window = { startInclusive: '2026-09-01T00:00:00.000Z', endExclusive: '2026-10-01T00:00:00.000Z' };
const baseRow: MerchantSalonRow = {
  id: 'r_01',
  created_at: '2026-09-16T00:00:00.000Z',
  source: 'register',
  claimed_by_user_id: 'o_01',
};
const baseEvidence: MerchantEvidence = {
  registrationKey: 'r_01', facilityKey: 'f_01', operatorKey: 'o_01',
  recordedAt: '2026-09-16T00:00:00.000Z', evidence: 'persisted', audience: 'merchant',
  entry: 'register', ownership: 'external', novelty: 'new',
};

describe('server-side salon evidence adapter', () => {
  it('maps persisted server fields without treating unknown classification as external', () => {
    expect(adaptSalonRow(baseRow, { facilityKey: null, ownership: 'unknown', novelty: 'unknown' })).toEqual({
      ...baseEvidence, facilityKey: null, ownership: 'unknown', novelty: 'unknown',
    });
  });

  it('maps recruit and null source explicitly', () => {
    expect(adaptSalonRow({ ...baseRow, source: 'recruit', claimed_by_user_id: null }, {
      facilityKey: 'f_01', ownership: 'external', novelty: 'new',
    })).toMatchObject({ audience: 'merchant', entry: 'recruit', operatorKey: null, facilityKey: 'f_01' });
    expect(adaptSalonRow({ ...baseRow, source: null }, {
      facilityKey: 'f_01', ownership: 'unknown', novelty: 'unknown',
    })).toMatchObject({ audience: 'unknown', entry: 'unknown' });
  });

  it.each([
    [{ ...baseRow, id: 'bad key' }, { facilityKey: null, ownership: 'unknown', novelty: 'unknown' }],
    [{ ...baseRow, created_at: null }, { facilityKey: null, ownership: 'unknown', novelty: 'unknown' }],
    [{ ...baseRow, created_at: '2026-02-30T00:00:00.000Z' }, { facilityKey: null, ownership: 'unknown', novelty: 'unknown' }],
    [{ ...baseRow, source: 'other' }, { facilityKey: null, ownership: 'unknown', novelty: 'unknown' }],
  ] as const)('rejects non-authoritative row %j', (row, classification) => {
    expect(() => adaptSalonRow(row as MerchantSalonRow, classification)).toThrow();
  });

  it('rejects invalid opaque classification keys', () => {
    expect(() => adaptSalonRow(baseRow, { facilityKey: 'bad key', ownership: 'unknown', novelty: 'unknown' })).toThrow();
    expect(() => adaptSalonRow({ ...baseRow, claimed_by_user_id: 'bad key' }, {
      facilityKey: null, ownership: 'unknown', novelty: 'unknown',
    })).toThrow();
  });
});

describe('merchant registration evidence aggregation', () => {
  it('deduplicates replayed rows and counts the same facility once', () => {
    const result = analyzeMerchantRegistrations([baseEvidence, baseEvidence, { ...baseEvidence, registrationKey: 'r_02' }], window);
    expect(result.newExternalFacilities).toBe(1);
    expect(result.identicalReplayRows).toBe(1);
    expect(result.registrationCvr).toBeNull();
  });

  it('counts one facility per entry when snapshots disagree on entry', () => {
    const result = analyzeMerchantRegistrations([
      baseEvidence,
      { ...baseEvidence, registrationKey: 'r_02', entry: 'recruit' },
    ], window);
    expect(result.newExternalFacilities).toBe(1);
    expect(result.byEntry.multiple).toBe(1);
  });

  it.each([
    ['failed', { evidence: 'failed' }],
    ['page_view', { evidence: 'page_view' }],
    ['result_unknown', { evidence: 'result_unknown' }],
    ['customer', { audience: 'customer' }],
    ['audience_unknown', { audience: 'unknown' }],
    ['missing_registration_key', { registrationKey: null }],
    ['missing_facility_key', { facilityKey: null }],
  ] as const)('does not count %s as a valid external facility', (reason, change) => {
    const result = analyzeMerchantRegistrations([{ ...baseEvidence, ...change }], window);
    const bucket = ['result_unknown', 'audience_unknown', 'missing_registration_key', 'missing_facility_key'].includes(reason)
      ? result.pending
      : result.excluded;
    const key = reason === 'missing_registration_key' ? 'registration_key_missing'
      : reason === 'missing_facility_key' ? 'canonical_facility_missing'
        : reason === 'result_unknown' ? 'persistence_unknown'
          : reason === 'customer' ? 'customer_registration' : reason;
    expect(bucket[key]).toBe(1);
    expect(result.newExternalFacilities).toBe(0);
  });

  it('keeps outside-window records out on either boundary', () => {
    const before = { ...baseEvidence, recordedAt: '2026-08-31T23:59:59.999Z', registrationKey: 'before' };
    const after = { ...baseEvidence, recordedAt: '2026-10-01T00:00:00.000Z', registrationKey: 'after' };
    const result = analyzeMerchantRegistrations([before, after], window);
    expect(result.excluded.outside_window).toBe(2);
  });

  it.each([
    ['ownership_unknown', { ownership: 'unknown' }],
    ['owned', { ownership: 'owned' }],
    ['test', { ownership: 'test' }],
    ['newness_unknown', { novelty: 'unknown' }],
    ['already_registered', { novelty: 'existing' }],
  ] as const)('does not count %s', (reason, change) => {
    const result = analyzeMerchantRegistrations([{ ...baseEvidence, ...change }], window);
    const pending = reason === 'ownership_unknown' || reason === 'newness_unknown';
    expect((pending ? result.pending : result.excluded)[reason]).toBe(1);
    expect(result.newExternalFacilities).toBe(0);
  });

  it('keeps identity conflicts pending for ownership, novelty, or operator', () => {
    for (const change of [
      [{ ...baseEvidence, registrationKey: 'r_02', ownership: 'owned' as const }],
      [{ ...baseEvidence, registrationKey: 'r_02', novelty: 'existing' as const }],
      [{ ...baseEvidence, registrationKey: 'r_02', operatorKey: 'o_02' }],
    ]) {
      const result = analyzeMerchantRegistrations([baseEvidence, ...change], window);
      expect(result.pending.facility_identity_conflict).toBe(1);
      expect(result.newExternalFacilities).toBe(0);
    }
  });

  it('counts known operators and facilities without an operator', () => {
    const result = analyzeMerchantRegistrations([
      baseEvidence,
      { ...baseEvidence, registrationKey: 'r_02', facilityKey: 'f_02', operatorKey: null, entry: 'recruit' },
    ], window);
    expect(result.newExternalFacilities).toBe(2);
    expect(result.distinctKnownOperators).toBe(1);
    expect(result.eligibleFacilitiesWithoutOperator).toBe(1);
    expect(result.byEntry.register).toBe(1);
    expect(result.byEntry.recruit).toBe(1);
  });

  it('rejects malformed, PII-bearing, and conflicting snapshots', () => {
    expect(() => analyzeMerchantRegistrations([null], window)).toThrow();
    expect(() => analyzeMerchantRegistrations([[]], window)).toThrow();
    expect(() => analyzeMerchantRegistrations([{ ...baseEvidence, email: 'x@example.invalid' }], window)).toThrow();
    const missing = { ...baseEvidence } as Record<string, unknown>;
    delete missing.entry;
    missing.extra = 'x';
    expect(() => analyzeMerchantRegistrations([missing], window)).toThrow();
    expect(() => analyzeMerchantRegistrations([{ ...baseEvidence, registrationKey: 1 }], window)).toThrow();
    expect(() => analyzeMerchantRegistrations([{ ...baseEvidence, facilityKey: 'bad key' }], window)).toThrow();
    expect(() => analyzeMerchantRegistrations([{ ...baseEvidence, evidence: 'other' }], window)).toThrow();
    expect(() => analyzeMerchantRegistrations([{ ...baseEvidence, recordedAt: '2026-02-30T00:00:00.000Z' }], window)).toThrow();
    expect(() => analyzeMerchantRegistrations([{ ...baseEvidence, recordedAt: 1 }], window)).toThrow();
    expect(() => analyzeMerchantRegistrations([
      baseEvidence,
      { ...baseEvidence, entry: 'recruit' },
    ], window)).toThrow('Conflicting final snapshots');
    expect(() => analyzeMerchantRegistrations(null, window)).toThrow();
    expect(() => analyzeMerchantRegistrations([baseEvidence], { ...window, endExclusive: window.startInclusive })).toThrow();
  });
});

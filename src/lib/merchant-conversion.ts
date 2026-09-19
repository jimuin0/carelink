/**
 * Server-side merchant-registration evidence adapter and aggregate.
 *
 * The adapter accepts rows already read by an authorised server-side process. It does not
 * trust browser events, completion-page visits, or client-supplied ownership claims. The
 * current salons schema can persist the trusted entry point, while ownership and novelty
 * remain explicit inputs until an authoritative identity resolver supplies them.
 */
export type Evidence = 'persisted' | 'failed' | 'result_unknown' | 'page_view';
export type Entry = 'register' | 'recruit' | 'unknown';
export type Ownership = 'external' | 'owned' | 'test' | 'unknown';
export type Novelty = 'new' | 'existing' | 'unknown';

export interface MerchantSalonRow {
  id: string;
  created_at: string | null;
  source: 'register' | 'recruit' | null;
  claimed_by_user_id: string | null;
}

export interface MerchantClassification {
  facilityKey: string | null;
  ownership: Ownership;
  novelty: Novelty;
}

export interface MerchantEvidence {
  registrationKey: string | null;
  facilityKey: string | null;
  operatorKey: string | null;
  recordedAt: string;
  evidence: Evidence;
  audience: 'merchant' | 'customer' | 'unknown';
  entry: Entry;
  ownership: Ownership;
  novelty: Novelty;
}

const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function utcMillis(value: unknown): number {
  if (typeof value !== 'string' || !UTC_TIMESTAMP.test(value)) {
    throw new Error('Expected canonical UTC timestamp with milliseconds');
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== value) {
    throw new Error('Invalid UTC timestamp');
  }
  return millis;
}

function opaqueKey(value: string | null, label: string): string | null {
  if (value === null) return null;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new Error(`Expected opaque ${label}`);
  return value;
}

/** Convert an authoritative salons row plus an independently resolved classification. */
export function adaptSalonRow(row: MerchantSalonRow, classification: MerchantClassification): MerchantEvidence {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(row.id)) throw new Error('Expected opaque registration key');
  if (row.created_at === null) throw new Error('Persisted salon row requires created_at');
  utcMillis(row.created_at);
  if (row.source !== 'register' && row.source !== 'recruit' && row.source !== null) {
    throw new Error('Unexpected salon source');
  }
  return {
    registrationKey: row.id,
    facilityKey: opaqueKey(classification.facilityKey, 'facility key'),
    operatorKey: opaqueKey(row.claimed_by_user_id, 'operator key'),
    recordedAt: row.created_at,
    evidence: 'persisted',
    audience: row.source === null ? 'unknown' : 'merchant',
    entry: row.source ?? 'unknown',
    ownership: classification.ownership,
    novelty: classification.novelty,
  };
}

const KEYS = [
  'registrationKey', 'facilityKey', 'operatorKey', 'recordedAt', 'evidence',
  'audience', 'entry', 'ownership', 'novelty',
] as const;
const ENUMS = {
  evidence: ['persisted', 'failed', 'result_unknown', 'page_view'],
  audience: ['merchant', 'customer', 'unknown'],
  entry: ['register', 'recruit', 'unknown'],
  ownership: ['external', 'owned', 'test', 'unknown'],
  novelty: ['new', 'existing', 'unknown'],
} as const;

function parseEvidence(value: unknown, index: number): MerchantEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid evidence row ${index}`);
  }
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).length !== KEYS.length || !KEYS.every((key) => Object.prototype.hasOwnProperty.call(obj, key))) {
    throw new Error(`Unexpected or missing fields in row ${index}; no raw personal data is accepted`);
  }
  for (const key of ['registrationKey', 'facilityKey', 'operatorKey'] as const) {
    const item = obj[key];
    if (item !== null && (typeof item !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item))) {
      throw new Error(`Expected opaque key in row ${index}`);
    }
  }
  for (const key of Object.keys(ENUMS) as (keyof typeof ENUMS)[]) {
    if (typeof obj[key] !== 'string' || !(ENUMS[key] as readonly string[]).includes(obj[key] as string)) {
      throw new Error(`Invalid enum in row ${index}`);
    }
  }
  utcMillis(obj.recordedAt);
  return Object.fromEntries(KEYS.map((key) => [key, obj[key]])) as unknown as MerchantEvidence;
}

export interface MerchantConversionReport {
  scope: 'supplied_authoritative_snapshot_only';
  window: { startInclusive: string; endExclusive: string };
  inputRows: number;
  identicalReplayRows: number;
  uniqueSnapshotRows: number;
  newExternalFacilities: number;
  distinctKnownOperators: number;
  eligibleFacilitiesWithoutOperator: number;
  byEntry: Record<Entry | 'multiple', number>;
  pending: Record<string, number>;
  excluded: Record<string, number>;
  registrationCvr: null;
  limitations: string[];
}

export function analyzeMerchantRegistrations(
  input: unknown,
  window: { startInclusive: string; endExclusive: string },
): MerchantConversionReport {
  const start = utcMillis(window.startInclusive);
  const end = utcMillis(window.endExclusive);
  if (start >= end) throw new Error('Observation window must have positive duration');
  if (!Array.isArray(input) || input.length > 50000) throw new Error('Expected at most 50000 evidence rows');
  const parsed = input.map(parseEvidence);
  const report: MerchantConversionReport = {
    scope: 'supplied_authoritative_snapshot_only', window,
    inputRows: parsed.length, identicalReplayRows: 0, uniqueSnapshotRows: 0,
    newExternalFacilities: 0, distinctKnownOperators: 0, eligibleFacilitiesWithoutOperator: 0,
    byEntry: { register: 0, recruit: 0, unknown: 0, multiple: 0 }, pending: {}, excluded: {},
    registrationCvr: null,
    limitations: [
      'The snapshot must be produced by an authorised server-side evidence adapter.',
      'Ownership and novelty are counted only when their authoritative resolver says so.',
      'No visitor cohort supplied: registration CVR is not calculated.',
      'Input completeness is unverified; missing records are not inferred as zero.',
      'Opaque keys are pseudonymous, not automatically anonymous; output contains only aggregates.',
    ],
  };
  const seen = new Map<string, string>();
  const rows: MerchantEvidence[] = [];
  for (const row of parsed) {
    if (row.registrationKey !== null) {
      const canonical = JSON.stringify(row);
      const previous = seen.get(row.registrationKey);
      if (previous !== undefined) {
        if (previous !== canonical) throw new Error('Conflicting final snapshots; reconcile evidence before aggregation');
        report.identicalReplayRows++;
        continue;
      }
      seen.set(row.registrationKey, canonical);
    }
    rows.push(row);
  }
  report.uniqueSnapshotRows = rows.length;
  const add = (bucket: Record<string, number>, reason: string) => { bucket[reason] = (bucket[reason] ?? 0) + 1; };
  const groups = new Map<string, MerchantEvidence[]>();
  for (const row of rows) {
    const time = utcMillis(row.recordedAt);
    if (time < start || time >= end) { add(report.excluded, 'outside_window'); continue; }
    if (row.audience === 'customer') { add(report.excluded, 'customer_registration'); continue; }
    if (row.audience === 'unknown') { add(report.pending, 'audience_unknown'); continue; }
    if (row.evidence === 'failed' || row.evidence === 'page_view') { add(report.excluded, row.evidence); continue; }
    if (row.evidence === 'result_unknown') { add(report.pending, 'persistence_unknown'); continue; }
    if (row.registrationKey === null) { add(report.pending, 'registration_key_missing'); continue; }
    if (row.facilityKey === null) { add(report.pending, 'canonical_facility_missing'); continue; }
    const group = groups.get(row.facilityKey) ?? [];
    group.push(row);
    groups.set(row.facilityKey, group);
  }
  const operators = new Set<string>();
  for (const group of groups.values()) {
    if (new Set(group.map((row) => row.ownership)).size > 1 || new Set(group.map((row) => row.novelty)).size > 1 || new Set(group.map((row) => row.operatorKey)).size > 1) {
      add(report.pending, 'facility_identity_conflict'); continue;
    }
    const row = group[0];
    if (row.ownership === 'unknown') { add(report.pending, 'ownership_unknown'); continue; }
    if (row.ownership === 'owned' || row.ownership === 'test') { add(report.excluded, row.ownership); continue; }
    if (row.novelty === 'unknown') { add(report.pending, 'newness_unknown'); continue; }
    if (row.novelty === 'existing') { add(report.excluded, 'already_registered'); continue; }
    report.newExternalFacilities++;
    if (row.operatorKey === null) report.eligibleFacilitiesWithoutOperator++;
    else operators.add(row.operatorKey);
    const entries = new Set(group.map((item) => item.entry));
    report.byEntry[entries.size === 1 ? row.entry : 'multiple']++;
  }
  report.distinctKnownOperators = operators.size;
  return report;
}

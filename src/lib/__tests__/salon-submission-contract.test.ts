/** @jest-environment node */
import { canonicalSalonSubmission, SALON_CANONICAL_VERSION } from '../salon-submission-contract';
import {
  isSalonIntentProof, salonIntentCookieName, salonIntentProofHash, salonPayloadHmac,
  SALON_HMAC_SCHEME, SALON_INTENT_TTL_SECONDS,
} from '../salon-submission-proof';

const input = {
  facility_name: '合成施設', business_type: 'ヘアサロン', representative_name: '合成代表',
  contact_name: '合成担当', email: 'sample@example.invalid', phone: '09012345678', source: 'register',
};
// Synthetic, deliberately deterministic test-only capabilities. Never used by a server.
const proof = '01'.repeat(32);
const otherProof = '02'.repeat(32);

describe('registration intent canonical contract', () => {
  test.each([null, [], {}, { ...input, source: 'other' }, { ...input, seat_count: NaN },
    { ...input, phone: undefined }, { ...input, phone: null }, { ...input, phone: '' }])('rejects invalid input %j', value => {
    expect(canonicalSalonSubmission(value)).toBeNull();
  });

  test('normalizes absent, empty, nullable and transport-only fields identically', () => {
    const minimal = canonicalSalonSubmission(input)!;
    const explicit = canonicalSalonSubmission({
      ...input, email: 'SAMPLE@example.invalid', phone: '０９０－１２３４－５６７８',
      contact_phone: '', website: '', postal_code: '', address: '', prefecture: '', city: '',
      building_name: '', nearest_station: '', business_hours: '', regular_holiday: '',
      seat_count: null, staff_count: null, has_parking: false, features: [], pr_text: '',
      photo_urls: [], desired_start_date: '', recaptcha_token: 'synthetic-token', ignored: 'not saved',
    })!;
    expect(explicit.serialized).toBe(minimal.serialized);
    const nullable = canonicalSalonSubmission({
      ...input, contact_phone: null, website: null, postal_code: null, address: null,
      prefecture: null, city: null, building_name: null, nearest_station: null,
      business_hours: null, regular_holiday: null, seat_count: null, staff_count: null,
      pr_text: null, desired_start_date: null,
    })!;
    expect(nullable.serialized).toBe(minimal.serialized);
    expect(JSON.parse(minimal.serialized)).toEqual({ version: SALON_CANONICAL_VERSION, row: minimal.row });
    expect(minimal.row).toMatchObject({ address: null, prefecture: null, city: null, photo_url: null, photo_urls: [] });
  });

  test('retains every saved optional value, zero counts and explicit postal region', () => {
    const full = canonicalSalonSubmission({
      ...input, contact_phone: '03-1234-5678', website: 'https://example.invalid',
      postal_code: '445-0001', address: '愛知県西尾市合成町', prefecture: '愛知県', city: '西尾市',
      building_name: '合成建物', nearest_station: '合成駅', business_hours: '10-18', regular_holiday: '火',
      seat_count: 0, staff_count: 2, has_parking: true, features: ['合成特徴'], pr_text: '合成紹介',
      photo_urls: ['', 'https://example.invalid/a', 'https://example.invalid/b'], desired_start_date: 'undecided',
    });
    expect(full).not.toBeNull();
    expect(full!.row).toMatchObject({
      contact_phone: '0312345678', website: 'https://example.invalid', postal_code: '4450001',
      address: '愛知県西尾市合成町', prefecture: '愛知県', city: '西尾市', building_name: '合成建物',
      nearest_station: '合成駅', business_hours: '10-18', regular_holiday: '火', seat_count: 0,
      staff_count: 2, has_parking: true, features: ['合成特徴'], pr_text: '合成紹介',
      photo_url: 'https://example.invalid/a', photo_urls: ['https://example.invalid/a', 'https://example.invalid/b'],
      desired_start_date: 'undecided', source: 'register',
    });
  });

  test('falls back to address region and detects distinct shops, sources and photo order', () => {
    const base = canonicalSalonSubmission({ ...input, address: '愛知県西尾市合成町' })!;
    expect(base.row).toMatchObject({ prefecture: '愛知県', city: '西尾市' });
    for (const change of [{ facility_name: '別施設' }, { address: '大阪府大阪市合成町' }, { source: 'recruit' }]) {
      expect(canonicalSalonSubmission({ ...input, address: base.row.address, ...change })!.serialized).not.toBe(base.serialized);
    }
    expect(canonicalSalonSubmission({ ...input, photo_urls: ['a', 'b'] })!.serialized)
      .not.toBe(canonicalSalonSubmission({ ...input, photo_urls: ['b', 'a'] })!.serialized);
    expect(canonicalSalonSubmission({ ...input, address: '未解釈住所' })!.row).toMatchObject({ prefecture: null, city: null });
  });
});

describe('registration capability primitives', () => {
  test.each([null, 123, '', '01', 'g'.repeat(64), 'A'.repeat(64), 'a'.repeat(66)])('rejects malformed proof %#', value => {
    expect(isSalonIntentProof(value)).toBe(false);
  });
  test('validates strict cookie names with distinct intent isolation', () => {
    expect(isSalonIntentProof(proof)).toBe(true);
    expect(salonIntentCookieName('11111111-1111-4111-8111-111111111111')).toBe('carelink_salon_intent_11111111-1111-4111-8111-111111111111');
    expect(salonIntentCookieName('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toBe('carelink_salon_intent_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(salonIntentCookieName('../invalid;cookie')).toBeNull();
    expect(SALON_INTENT_TTL_SECONDS).toBe(259200);
    expect(SALON_HMAC_SCHEME).toBe('proof-hkdf-sha256-v1');
  });
  test('invalid capabilities cannot hash or sign business data', () => {
    expect(() => salonIntentProofHash('bad')).toThrow('Invalid registration proof');
    expect(() => salonPayloadHmac('bad', '{}')).toThrow('Invalid registration proof');
  });
  test('payload HMAC is deterministic, bound to proof and content, and domain-separated from proof hash', () => {
    // Immutable synthetic vector: changing HKDF salt/info requires a new scheme.
    expect(salonPayloadHmac(proof, '{}')).toBe('551d4c6602833e413edb0b0b28b601327c538666d8ccc4c7f3957f1226126b41');
    const serialized = canonicalSalonSubmission(input)!.serialized;
    const digest = salonPayloadHmac(proof, serialized);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).toBe(salonPayloadHmac(proof, serialized));
    expect(digest).not.toBe(salonPayloadHmac(otherProof, serialized));
    expect(digest).not.toBe(salonPayloadHmac(proof, serialized + ' '));
    expect(salonIntentProofHash(proof)).not.toBe(salonIntentProofHash(otherProof));
    expect(salonIntentProofHash(proof)).not.toBe(salonPayloadHmac(proof, proof));
  });
});

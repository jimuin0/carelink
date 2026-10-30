import { hasListingEvidenceSignature, LISTING_EVIDENCE_MAX_BYTES, listingEvidenceInputSchema, listingEvidenceOptions, listingEvidencePath, listingEvidencePrivacyNotice, listingSupportingEvidenceNotice } from '../listing-verification-evidence';

test('届出以外の店舗資料も選択でき、選択肢の識別子は重複しない', () => {
  const values = listingEvidenceOptions.map(option => option.value);
  expect(values).toEqual(expect.arrayContaining(['opening_certificate', 'lease', 'utility_bill', 'government_document', 'business_insurance', 'commercial_facility', 'other']));
  expect(new Set(values).size).toBe(values.length);
});

test('申告形式とファイルの先頭が一致しない資料は受け付けない', () => {
  expect(hasListingEvidenceSignature(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), 'application/pdf')).toBe(true);
  expect(hasListingEvidenceSignature(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png')).toBe(true);
  expect(hasListingEvidenceSignature(Uint8Array.from([0xff, 0xd8, 0xff]), 'image/jpeg')).toBe(true);
  expect(hasListingEvidenceSignature(Uint8Array.from([0xff, 0xd8]), 'image/jpeg')).toBe(false);
  expect(hasListingEvidenceSignature(Uint8Array.from([0xff, 0xd8, 0xff]), 'application/pdf')).toBe(false);
  expect(hasListingEvidenceSignature(Uint8Array.from([0xff, 0xd8, 0xff]), 'text/html')).toBe(false);
  expect(hasListingEvidenceSignature(Uint8Array.from([0xff, 0xd8, 0xff]), 'toString')).toBe(false);
});

test('受け付ける資料の形式・容量・識別子を限定する', () => {
  const valid = { type: 'lease', mimeType: 'application/pdf', byteSize: LISTING_EVIDENCE_MAX_BYTES };
  expect(listingEvidenceInputSchema.safeParse(valid).success).toBe(true);
  for (const input of [{ ...valid, type: 'website' }, { ...valid, mimeType: 'text/html' },
    { ...valid, byteSize: 0 }, { ...valid, byteSize: LISTING_EVIDENCE_MAX_BYTES + 1 }, { ...valid, extra: true }]) {
    expect(listingEvidenceInputSchema.safeParse(input).success).toBe(false);
  }
  const facility = '11111111-1111-4111-8111-111111111111';
  const evidence = '22222222-2222-4222-8222-222222222222';
  expect(listingEvidencePath(facility, evidence, 'application/pdf')).toBe(`facilities/${facility}/${evidence}.pdf`);
  expect(listingEvidencePath('../private', evidence, 'application/pdf')).toBeNull();
  expect(listingEvidencePath(facility, evidence, 'text/html')).toBeNull();
  expect(listingEvidencePath(facility, evidence, 'toString')).toBeNull();
});

test('掲載URLだけを承認根拠とせず、不要な個人情報を隠せるよう案内する', () => {
  expect(listingSupportingEvidenceNotice).toContain('参考資料');
  expect(listingSupportingEvidenceNotice).toContain('権限の確認');
  expect(listingEvidencePrivacyNotice).toContain('口座番号');
});

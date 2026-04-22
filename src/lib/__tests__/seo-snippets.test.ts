/**
 * Tests for lib/seo-snippets.ts
 * Pure functions — no mocking required for the main exports.
 */

import {
  getBusinessTypeContext,
  generatePrefTypeContent,
  generateCityContent,
  generateCityTypeContent,
} from '../seo-snippets';

describe('getBusinessTypeContext', () => {
  test('returns context for a valid type slug', () => {
    const ctx = getBusinessTypeContext('hair-salon');
    expect(ctx).not.toBeNull();
    expect(ctx!.keyword).toContain('ヘアサロン');
  });

  test('returns null for an unknown type slug', () => {
    expect(getBusinessTypeContext('unknown-type')).toBeNull();
  });

  test('returns context for nail-eyelash', () => {
    const ctx = getBusinessTypeContext('nail-eyelash');
    expect(ctx).not.toBeNull();
    expect(ctx!.faqs.length).toBeGreaterThan(0);
  });

  test('returns context for all known types', () => {
    const knownTypes = ['hair-salon', 'nail-eyelash', 'relaxation', 'esthetic', 'beauty-clinic', 'acupuncture', 'care-service', 'other'];
    for (const type of knownTypes) {
      expect(getBusinessTypeContext(type)).not.toBeNull();
    }
  });
});

describe('generatePrefTypeContent', () => {
  test('returns null for unknown prefecture slug', () => {
    const result = generatePrefTypeContent('unknown-pref', 'hair-salon');
    expect(result).toBeNull();
  });

  test('returns null for unknown business type slug', () => {
    const result = generatePrefTypeContent('tokyo', 'unknown-type');
    expect(result).toBeNull();
  });

  test('returns content for valid prefecture + type', () => {
    const result = generatePrefTypeContent('tokyo', 'hair-salon');
    expect(result).not.toBeNull();
    expect(result!.h2).toContain('東京都');
    expect(result!.intro).toContain('東京都');
    expect(result!.highlights.length).toBeGreaterThan(0);
    expect(result!.faqs.length).toBeGreaterThan(0);
  });

  test('includes the first FAQ about the prefecture + type', () => {
    const result = generatePrefTypeContent('osaka', 'nail-eyelash');
    expect(result).not.toBeNull();
    expect(result!.faqs[0].question).toContain('大阪府');
  });

  test('highlights include prefecture name', () => {
    const result = generatePrefTypeContent('kanagawa', 'relaxation');
    expect(result!.highlights[0]).toContain('神奈川県');
  });
});

describe('generateCityContent', () => {
  test('returns null for unknown prefecture slug', () => {
    const result = generateCityContent('unknown-pref', '豊中市');
    expect(result).toBeNull();
  });

  test('returns content for valid prefecture + city', () => {
    const result = generateCityContent('osaka', '豊中市');
    expect(result).not.toBeNull();
    expect(result!.h2).toContain('豊中市');
    expect(result!.intro).toContain('豊中市');
    expect(result!.highlights.length).toBe(5);
    expect(result!.faqs.length).toBe(3);
  });

  test('faqs include city name', () => {
    const result = generateCityContent('tokyo', '新宿区');
    expect(result!.faqs[0].question).toContain('新宿区');
    expect(result!.faqs[0].answer).toContain('新宿区');
  });

  test('highlights include city name in each entry', () => {
    const result = generateCityContent('tokyo', '渋谷区');
    result!.highlights.forEach((h) => expect(h).toContain('渋谷区'));
  });
});

describe('generateCityTypeContent', () => {
  test('returns null for unknown prefecture', () => {
    const result = generateCityTypeContent('unknown', '豊中市', 'hair-salon');
    expect(result).toBeNull();
  });

  test('returns null for unknown business type', () => {
    const result = generateCityTypeContent('osaka', '豊中市', 'unknown-type');
    expect(result).toBeNull();
  });

  test('returns content for valid pref + city + type', () => {
    const result = generateCityTypeContent('osaka', '豊中市', 'nail-eyelash');
    expect(result).not.toBeNull();
    expect(result!.h2).toContain('豊中市');
    expect(result!.intro).toContain('豊中市');
    expect(result!.highlights.length).toBeGreaterThan(0);
    expect(result!.faqs.length).toBeGreaterThan(0);
  });

  test('first FAQ answer includes searchPoints', () => {
    const result = generateCityTypeContent('tokyo', '渋谷区', 'esthetic');
    expect(result!.faqs[0].answer).toBeTruthy();
  });
});

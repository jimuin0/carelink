/**
 * @jest-environment node
 *
 * Tests for lib/gbp.ts
 * Covers: fetchPlaceDetails, calculateGbpScore, getScoreGrade
 */

import { fetchPlaceDetails, calculateGbpScore, getScoreGrade } from '../gbp';

beforeEach(() => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-api-key';
});

afterEach(() => {
  delete process.env.GOOGLE_MAPS_API_KEY;
  jest.restoreAllMocks();
});

describe('fetchPlaceDetails', () => {
  test('returns null when API key is not set', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const result = await fetchPlaceDetails('ChIJ1234');
    expect(result).toBeNull();
  });

  test('returns null for invalid placeId (too long)', async () => {
    const result = await fetchPlaceDetails('x'.repeat(301));
    expect(result).toBeNull();
  });

  test('returns null for placeId with invalid chars', async () => {
    const result = await fetchPlaceDetails('bad place<id>');
    expect(result).toBeNull();
  });

  test('returns null when fetch fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network'));
    const result = await fetchPlaceDetails('ChIJ1234');
    expect(result).toBeNull();
  });

  test('returns null when response is not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false } as Response);
    const result = await fetchPlaceDetails('ChIJ1234');
    expect(result).toBeNull();
  });

  test('returns null when Places API status is not OK', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ZERO_RESULTS', result: null }),
    } as Response);
    const result = await fetchPlaceDetails('ChIJ1234');
    expect(result).toBeNull();
  });

  test('returns place details on success', async () => {
    const mockPlace = { name: 'Test Salon', rating: 4.5, user_ratings_total: 50 };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'OK', result: mockPlace }),
    } as Response);
    const result = await fetchPlaceDetails('ChIJ1234');
    expect(result).toEqual(mockPlace);
  });
});

describe('calculateGbpScore', () => {
  const minFacility = { name: 'My Salon', description: null, phone: null, website_url: null, business_hours: null, main_photo_url: null, gbp_place_id: null };

  test('returns a valid audit result structure', () => {
    const result = calculateGbpScore(null, minFacility);
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('maxScore');
    expect(result).toHaveProperty('percentage');
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('fetchedAt');
    expect(Array.isArray(result.items)).toBe(true);
  });

  test('score >= 0 and <= maxScore', () => {
    const place = {
      name: 'Salon',
      rating: 4.8,
      user_ratings_total: 50,
      formatted_address: '123 St',
      formatted_phone_number: '06-1234-5678',
      website: 'https://example.com',
      business_status: 'OPERATIONAL',
      opening_hours: { weekday_text: ['Mon: 10-18'], open_now: true },
      photos: Array(12).fill({ photo_reference: 'ref' }),
      reviews: [],
      url: 'https://maps.google.com',
    };
    const facility = {
      name: 'Salon',
      description: '素晴らしいサロンです。豊中市でまつげエクステをお探しの方に最適なサロン。',
      phone: '06-1234-5678',
      website_url: 'https://example.com',
      business_hours: { mon: '10:00-18:00' },
      main_photo_url: 'https://example.com/photo.jpg',
      gbp_place_id: 'ChIJ1234',
    };
    const result = calculateGbpScore(place, facility);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(result.maxScore);
    expect(result.percentage).toBeLessThanOrEqual(100);
    expect(result.percentage).toBeGreaterThanOrEqual(0);
  });

  test('score is 0 when no data', () => {
    const result = calculateGbpScore(null, minFacility);
    expect(result.score).toBe(0);
  });

  test('contains 28 audit items', () => {
    const result = calculateGbpScore(null, minFacility);
    expect(result.items.length).toBe(28);
  });

  test('place_id item passes when gbp_place_id is set', () => {
    const facility = { ...minFacility, gbp_place_id: 'ChIJ1234' };
    const result = calculateGbpScore(null, facility);
    const placeIdItem = result.items.find((i) => i.id === 'place_id');
    expect(placeIdItem!.passed).toBe(true);
  });

  test('phone item passes when facility has phone', () => {
    const facility = { ...minFacility, phone: '06-1234-5678' };
    const result = calculateGbpScore(null, facility);
    const phoneItem = result.items.find((i) => i.id === 'phone');
    expect(phoneItem!.passed).toBe(true);
  });

  test('description item passes when description is 1-750 chars', () => {
    const facility = { ...minFacility, description: 'A'.repeat(200) };
    const result = calculateGbpScore(null, facility);
    const descItem = result.items.find((i) => i.id === 'description');
    expect(descItem!.passed).toBe(true);
  });

  test('review_rating item passes when rating >= 4.0', () => {
    const place = { rating: 4.5, user_ratings_total: 20, photos: [], reviews: [], opening_hours: undefined, business_status: 'OPERATIONAL', formatted_address: '123 St' };
    const result = calculateGbpScore(place, minFacility);
    const ratingItem = result.items.find((i) => i.id === 'review_rating');
    expect(ratingItem!.passed).toBe(true);
  });
});

describe('getScoreGrade', () => {
  test('returns S grade for >= 85%', () => {
    const { label, color } = getScoreGrade(85);
    expect(label).toContain('S');
    expect(color).toBe('green');
  });

  test('returns A grade for >= 70%', () => {
    const { label, color } = getScoreGrade(70);
    expect(label).toContain('A');
    expect(color).toBe('blue');
  });

  test('returns B grade for >= 55%', () => {
    const { label, color } = getScoreGrade(55);
    expect(label).toContain('B');
    expect(color).toBe('yellow');
  });

  test('returns C grade for >= 40%', () => {
    const { label, color } = getScoreGrade(40);
    expect(label).toContain('C');
    expect(color).toBe('orange');
  });

  test('returns D grade for < 40%', () => {
    const { label, color } = getScoreGrade(39);
    expect(label).toContain('D');
    expect(color).toBe('red');
  });
});

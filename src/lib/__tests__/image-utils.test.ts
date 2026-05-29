import {
  SHIMMER_BLUR,
  getTransformUrl,
  thumbUrl,
  cardUrl,
  heroUrl,
  avatarUrl,
} from '../image-utils';

describe('SHIMMER_BLUR', () => {
  test('is a valid data URL', () => {
    expect(SHIMMER_BLUR).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  test('decodes to valid SVG', () => {
    const base64 = SHIMMER_BLUR.split(',')[1];
    const svg = Buffer.from(base64, 'base64').toString('utf-8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('400');
    expect(svg).toContain('300');
  });
});

describe('getTransformUrl', () => {
  const supabaseUrl = 'https://supabase.co/storage/v1/object/public/salons/photo.jpg';
  const externalUrl = 'https://example.com/image.jpg';

  test('returns empty string for null/undefined', () => {
    expect(getTransformUrl(null)).toBe('');
    expect(getTransformUrl(undefined)).toBe('');
  });

  test('passes through non-Supabase URLs', () => {
    expect(getTransformUrl(externalUrl)).toBe(externalUrl);
  });

  test('非Supabase URL にオプションを渡してもそのまま返す（クエリパラメータを付加しない）', () => {
    // L22 StringLiteral "" mutation: includes('') が常に true になり early return しなくなる
    // → オプションがあるとクエリパラメータが付加されてしまう
    expect(getTransformUrl(externalUrl, { width: 400 })).toBe(externalUrl);
    expect(getTransformUrl(externalUrl, { width: 200, height: 200 })).toBe(externalUrl);
  });

  test('converts Supabase URL to render path', () => {
    const result = getTransformUrl(supabaseUrl);
    expect(result).toContain('/storage/v1/render/image/public/');
    expect(result).not.toContain('/storage/v1/object/public/');
  });

  test('adds width parameter', () => {
    const result = getTransformUrl(supabaseUrl, { width: 400 });
    expect(result).toContain('width=400');
  });

  test('adds height parameter', () => {
    const result = getTransformUrl(supabaseUrl, { height: 300 });
    expect(result).toContain('height=300');
  });

  test('adds quality parameter', () => {
    const result = getTransformUrl(supabaseUrl, { quality: 85 });
    expect(result).toContain('quality=85');
  });

  test('adds resize parameter', () => {
    const result = getTransformUrl(supabaseUrl, { resize: 'cover' });
    expect(result).toContain('resize=cover');
  });

  test('adds format parameter', () => {
    const result = getTransformUrl(supabaseUrl, { format: 'webp' });
    expect(result).toContain('format=webp');
  });

  test('combines multiple parameters', () => {
    const result = getTransformUrl(supabaseUrl, {
      width: 400,
      height: 300,
      resize: 'cover',
      format: 'webp',
      quality: 80,
    });
    expect(result).toContain('width=400');
    expect(result).toContain('height=300');
    expect(result).toContain('resize=cover');
    expect(result).toContain('format=webp');
    expect(result).toContain('quality=80');
  });

  test('skips undefined parameters', () => {
    const result = getTransformUrl(supabaseUrl, { width: 400, height: undefined });
    expect(result).toContain('width=400');
    expect(result).not.toContain('height=');
  });

  test('handles quality 0', () => {
    const result = getTransformUrl(supabaseUrl, { quality: 0 });
    expect(result).toContain('quality=0');
  });
});

describe('thumbUrl', () => {
  const supabaseUrl = 'https://supabase.co/storage/v1/object/public/salons/photo.jpg';

  test('returns empty string for null', () => {
    expect(thumbUrl(null)).toBe('');
  });

  test('uses 200x200 dimensions', () => {
    const result = thumbUrl(supabaseUrl);
    expect(result).toContain('width=200');
    expect(result).toContain('height=200');
  });

  test('uses cover resize', () => {
    const result = thumbUrl(supabaseUrl);
    expect(result).toContain('resize=cover');
  });

  test('uses webp format', () => {
    const result = thumbUrl(supabaseUrl);
    expect(result).toContain('format=webp');
  });

  test('uses 75 quality', () => {
    const result = thumbUrl(supabaseUrl);
    expect(result).toContain('quality=75');
  });
});

describe('cardUrl', () => {
  const supabaseUrl = 'https://supabase.co/storage/v1/object/public/salons/photo.jpg';

  test('uses 400x300 dimensions', () => {
    const result = cardUrl(supabaseUrl);
    expect(result).toContain('width=400');
    expect(result).toContain('height=300');
  });

  test('uses 80 quality', () => {
    const result = cardUrl(supabaseUrl);
    expect(result).toContain('quality=80');
  });
});

describe('heroUrl', () => {
  const supabaseUrl = 'https://supabase.co/storage/v1/object/public/salons/photo.jpg';

  test('uses 1200x630 dimensions (OG image)', () => {
    const result = heroUrl(supabaseUrl);
    expect(result).toContain('width=1200');
    expect(result).toContain('height=630');
  });

  test('uses 85 quality', () => {
    const result = heroUrl(supabaseUrl);
    expect(result).toContain('quality=85');
  });
});

describe('avatarUrl', () => {
  const supabaseUrl = 'https://supabase.co/storage/v1/object/public/users/avatar.jpg';

  test('uses 80x80 dimensions', () => {
    const result = avatarUrl(supabaseUrl);
    expect(result).toContain('width=80');
    expect(result).toContain('height=80');
  });

  test('uses 80 quality', () => {
    const result = avatarUrl(supabaseUrl);
    expect(result).toContain('quality=80');
  });
});

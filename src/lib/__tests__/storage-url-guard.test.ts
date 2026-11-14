import { isAllowedStorageUrl } from '../storage-url-guard';
const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
afterEach(() => {
  if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
});
test('missing provider configuration refuses image provenance instead of accepting an arbitrary URL', () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  expect(isAllowedStorageUrl('https://provider.example/storage/v1/object/public/reviews/photo.png', 'reviews')).toBe(false);
});
test('only the configured provider and requested public bucket are allowed', () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://provider.example';
  expect(isAllowedStorageUrl('https://provider.example/storage/v1/object/public/reviews/photo.png', 'reviews')).toBe(true);
  for (const url of ['https://other.example/storage/v1/object/public/reviews/photo.png',
    'https://provider.example/storage/v1/object/public/other/photo.png',
    'https://provider.example/storage/v1/object/public/reviews-malicious/photo.png']) {
    expect(isAllowedStorageUrl(url, 'reviews')).toBe(false);
  }
});
// 低 A222: ドットセグメントで別バケットへ抜ける URL を拒否する（前方一致だけでは通っていた）。
test.each([
  'https://provider.example/storage/v1/object/public/reviews/../review-photos/x.jpg',
  'https://provider.example/storage/v1/object/public/reviews/%2e%2e/review-photos/x.jpg',
  'https://provider.example/storage/v1/object/public/reviews/./../other/x.jpg',
])('dot-segment escape %s is refused', (url) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://provider.example';
  expect(isAllowedStorageUrl(url, 'reviews')).toBe(false);
});
test('a nested path inside the bucket stays allowed; an unparsable configured base refuses', () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://provider.example';
  expect(isAllowedStorageUrl('https://provider.example/storage/v1/object/public/reviews/a/b/../c.jpg', 'reviews')).toBe(true);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'not a url';
  expect(isAllowedStorageUrl('not a url/storage/v1/object/public/reviews/x.jpg', 'reviews')).toBe(false);
});

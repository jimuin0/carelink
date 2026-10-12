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

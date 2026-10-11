/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { readSalonStorageLimits, salonStorageLimitsSchema } from '../salon-storage-limits';
const canonical = { maxBytes: 10485760, mimeTypes: ['image/jpeg','image/png','image/webp','image/gif'] };
const bucket = { id: 'carelink-uploads', file_size_limit: null, allowed_mime_types: null };
function fixture(result: unknown = { data: bucket, error: null }) {
  const getBucket = jest.fn().mockResolvedValue(result);
  return { getBucket, db: { storage: { getBucket } } as unknown as Parameters<typeof readSalonStorageLimits>[0] };
}
test.each([bucket, { ...bucket, file_size_limit: 20971520 }])('verified explicitly unrestricted/larger bucket never relaxes application ceiling %j', async data => {
  const f = fixture({ data, error: null }); expect(await readSalonStorageLimits(f.db)).toEqual({ state: 'ready', limits: canonical });
  expect(f.getBucket).toHaveBeenCalledWith('carelink-uploads');
});
test('stricter bucket limit and MIME intersection are preserved exactly', async () => {
  const f = fixture({ data: { ...bucket, file_size_limit: 3, allowed_mime_types: ['image/png', 'application/pdf', 'image/png'] }, error: null });
  expect(await readSalonStorageLimits(f.db)).toEqual({ state: 'ready', limits: { maxBytes: 3, mimeTypes: ['image/png'] } });
});
test.each([
 { data: bucket, error: { message: '08006' } }, { data: bucket }, { data: null, error: null }, { data: {}, error: null },
 { data: { id: 'carelink-uploads' }, error: null }, { data: { id: 'carelink-uploads', file_size_limit: 10 }, error: null },
 { data: { id: 'carelink-uploads', allowed_mime_types: ['image/png'] }, error: null },
 { data: { ...bucket, id: 'other' }, error: null }, { data: { ...bucket, file_size_limit: 0 }, error: null },
 { data: { ...bucket, file_size_limit: '10' }, error: null }, { data: { ...bucket, allowed_mime_types: [] }, error: null },
 { data: { ...bucket, allowed_mime_types: ['image/*'] }, error: null }, { data: { ...bucket, allowed_mime_types: ['application/pdf'] }, error: null },
])('unknown or incompatible bucket cannot advertise an upload contract %#', async result => {
  const f = fixture(result); expect(await readSalonStorageLimits(f.db)).toEqual({ state: 'unavailable' });
});
test('transport exception never leaks provider details', async () => {
 const f = fixture(); f.getBucket.mockRejectedValue(new Error('private provider details')); expect(await readSalonStorageLimits(f.db)).toEqual({ state: 'unavailable' });
});
test.each([{ ...canonical, maxBytes: 10485761 }, { ...canonical, maxBytes: 0 }, { ...canonical, token: 'forbidden' },
 { ...canonical, mimeTypes: [] }, { ...canonical, mimeTypes: ['application/pdf'] }])('browser handshake rejects incompatible limit payload %#', value => {
 expect(salonStorageLimitsSchema.safeParse(value).success).toBe(false);
});

/** Synthetic protocol responses; never sends a registration. */
export function submissionResponse(url: string): Promise<Response> {
  const intentId = '11111111-1111-4111-8111-111111111111';
  const receiptId = '22222222-2222-4222-8222-222222222222';
  if (url === '/api/salons') throw new Error('Legacy registration must not be used');
  const body = url === '/api/salons/prepare'
    ? { state: 'prepared', intentId, consumerVersion: 2, photoLimits: {
      maxBytes: 10485760, mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    } }
    : url === '/api/salons/commit' ? { state: 'committed', receiptId }
    : { state: 'uncommitted' };
  const status = url === '/api/salons/prepare' || url === '/api/salons/commit' ? 201 : 200;
  return Promise.resolve({ ok: true, status, json: async () => body } as Response);
}

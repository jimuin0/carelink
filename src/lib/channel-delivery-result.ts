export type ChannelDeliveryResult = { outcome: 'delivered' | 'rejected' | 'uncertain'; status: number | null };
export function channelDeliveryResult(status: unknown): ChannelDeliveryResult {
  if (typeof status !== 'number' || !Number.isInteger(status)) return { outcome: 'uncertain', status: null };
  if (status >= 200 && status < 300) return { outcome: 'delivered', status };
  if ([400, 401, 403, 404, 410, 413, 422, 429].includes(status)) return { outcome: 'rejected', status };
  return { outcome: 'uncertain', status };
}

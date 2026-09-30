import { z } from 'zod';

// Keep Postgres timestamp precision in cursors. Converting through Date loses
// microseconds and can skip or duplicate rows on a page boundary.
export const inquiryCursor = z.object({
  createdAt: z.iso.datetime({ offset: true }).nullable(),
  id: z.uuid(),
}).strict();

export const inquiryListInput = z.object({
  status: z.enum(['all', 'open', 'in_progress', 'waiting', 'resolved', 'closed']).default('open'),
  cursor: inquiryCursor.nullable().default(null),
}).strict();

const trafficSource = z.object({
  source: z.string().min(1).max(100),
  medium: z.string().max(100).nullable(),
  referrerHost: z.string().max(253).nullable(),
  landingPath: z.string().startsWith('/').max(500),
  capturedAt: z.string().datetime(),
});

export const inquiryListDatabaseRow = z.object({
  id: z.uuid(),
  created_at: z.iso.datetime({ offset: true }).nullable(),
  name: z.string(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  inquiry_type: z.string().nullable(),
  message: z.string().nullable(),
  ticket_status: z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  ticket_notes: z.string().nullable(),
  resolved_at: z.iso.datetime({ offset: true }).nullable(),
  traffic_source: z.unknown().nullable(),
}).strict();

export const inquiryListRow = inquiryListDatabaseRow.extend({
  traffic_source: trafficSource.nullable(),
});

export const inquiryListResponse = z.object({
  contacts: z.array(inquiryListRow).max(50),
  nextCursor: inquiryCursor.nullable(),
}).strict();

export type InquiryCursor = z.infer<typeof inquiryCursor>;
export type InquiryListRow = z.infer<typeof inquiryListRow>;

export function inquiryCursorFilter(cursor: InquiryCursor): string {
  const checked = inquiryCursor.parse(cursor);
  if (checked.createdAt === null) return `and(created_at.is.null,id.lt.${checked.id})`;
  return `created_at.lt.${checked.createdAt},and(created_at.eq.${checked.createdAt},id.lt.${checked.id}),created_at.is.null`;
}

export function parseInquiryTrafficSource(value: unknown) {
  if (value === null) return null;
  const parsed = trafficSource.safeParse(value);
  return parsed.success ? parsed.data : null;
}

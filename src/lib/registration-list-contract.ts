import { z } from 'zod';

// Retain Postgres microseconds verbatim: Date conversion loses cursor precision.
const timestamp = z.iso.datetime({ offset: true });
export const registrationCursor = z.object({ createdAt: timestamp.nullable(), id: z.uuid() }).strict();
export const registrationListInput = z.object({
  field: z.enum(['receipt', 'facility', 'email']).default('facility'),
  query: z.string().trim().max(254).default(''),
  status: z.enum(['all', 'pending', 'approved', 'rejected', 'unknown']).default('all'),
  cursor: registrationCursor.nullable().default(null),
}).strict().superRefine((input, context) => {
  if (input.field === 'receipt' && input.query && !z.uuid().safeParse(input.query).success) {
    context.addIssue({ code: 'custom', path: ['query'], message: '受付番号を確認してください' });
  }
  if (input.field === 'facility' && input.query.length > 200) {
    context.addIssue({ code: 'custom', path: ['query'], message: '施設名を確認してください' });
  }
  if (input.query.includes('\0')) context.addIssue({ code: 'custom', path: ['query'], message: '検索条件を確認してください' });
});
export const registrationListRow = z.object({
  id: z.uuid(), name: z.string(), email: z.string(), phone: z.string().nullable(),
  status: z.string().nullable(), created_at: timestamp.nullable(),
  claimed_at: timestamp.nullable(), claimed_facility_id: z.uuid().nullable(),
  review_revision: z.number().int().min(0).max(2147483647),
}).strict();
export const registrationListResponse = z.object({
  salons: z.array(registrationListRow).max(50), nextCursor: registrationCursor.nullable(),
}).strict();
export type RegistrationListInput = z.infer<typeof registrationListInput>;
export type RegistrationCursor = z.infer<typeof registrationCursor>;
export type RegistrationListRow = z.infer<typeof registrationListRow>;

export function registrationCursorFilter(cursor: RegistrationCursor): string {
  const checked = registrationCursor.parse(cursor);
  if (checked.createdAt === null) return `and(created_at.is.null,id.lt.${checked.id})`;
  return `created_at.lt.${checked.createdAt},and(created_at.eq.${checked.createdAt},id.lt.${checked.id}),created_at.is.null`;
}

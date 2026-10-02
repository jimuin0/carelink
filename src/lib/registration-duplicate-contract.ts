import { z } from 'zod';

const pair = { duplicateId: z.uuid(), canonicalId: z.uuid() };
const revision = z.number().int().min(0).max(2147483647);
export const duplicateLinkInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), ...pair }).strict(),
  z.object({ action: z.literal('link'), ...pair, duplicateRevision: revision,
    canonicalRevision: revision, sameSite: z.literal(true) }).strict(),
]).refine(input => input.duplicateId !== input.canonicalId);
export const duplicateLinkPreview = z.object({
  outcome: z.literal('preview'), ...pair, duplicateRevision: revision, canonicalRevision: revision,
  facilityId: z.uuid(), name: z.string().min(1).max(200), businessType: z.string().min(1),
  prefecture: z.string().min(1), city: z.string().min(1), address: z.string().min(1),
  building: z.string().nullable(),
}).strict();
export const duplicateLinkResponse = z.union([
  duplicateLinkPreview,
  z.object({ outcome: z.enum(['linked', 'replay']), facilityId: z.uuid() }).strict(),
  z.object({ outcome: z.enum(['invalid', 'forbidden', 'conflict']) }).strict(),
]);
export type DuplicateLinkPreview = z.infer<typeof duplicateLinkPreview>;

import { z } from 'zod';
import { UUID_REGEX } from './constants';

export const JOB_APPLICATION_STATUSES = ['pending', 'reviewing', 'interview_scheduled', 'interview_done', 'offer_made', 'hired', 'rejected', 'withdrawn'] as const;
const id = z.string().regex(UUID_REGEX).transform(value => value.toLowerCase());
const name = z.string().trim().min(1).transform(value => Array.from(value).slice(0, 100).join(''));
export const applicationCreateSchema = z.object({
  facility_id: id,
  job_posting_id: id.or(z.literal('')).nullish(),
  applicant_name: name,
  applicant_email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).max(254),
  applicant_phone: z.string().transform(value => Array.from(value).slice(0, 20).join('')).nullish(),
  cover_letter: z.string().transform(value => Array.from(value).slice(0, 2000).join('')).nullish(),
});
export const applicationPatchSchema = z.object({
  status: z.enum(JOB_APPLICATION_STATUSES).optional(),
  referral_fee_yen: z.number().int().min(0).max(9999999).nullable().optional(),
  notes: z.string().transform(value => Array.from(value).slice(0, 2000).join('')).nullable().optional(),
}).refine(value => Object.keys(value).length > 0);
export const applicationSavedSchema = z.object({ id, facility_id: id, status: z.enum(JOB_APPLICATION_STATUSES) }).passthrough();
export const applicationUpdateReceiptSchema = z.object({ application: applicationSavedSchema, previous_status: z.enum(JOB_APPLICATION_STATUSES) });

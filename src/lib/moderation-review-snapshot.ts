import { z } from 'zod';
const score = z.number().min(1).max(5).nullable();
export const moderationReviewSnapshotSchema = z.object({
  id: z.uuid(), content_id: z.uuid(), content_type: z.literal('review'),
  report_reason:z.string().nullable(),auto_flags:z.array(z.string()),
  status: z.enum(['pending','approved','rejected','escalated']),
  reviewed_at: z.string().datetime({offset:true}).nullable(),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  review: z.object({flag_reason:z.string().nullable(),comment:z.string().nullable(),rating:z.number().min(1).max(5),
    photo_urls:z.array(z.string()).nullable(),rating_skill:score,rating_service:score,
    rating_atmosphere:score,rating_cleanliness:score,rating_explanation:score}),
});
export type ModerationReviewSnapshot = z.infer<typeof moderationReviewSnapshotSchema>;

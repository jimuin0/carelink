import { z } from 'zod';

export const publicSpecialHoursSchema = z.object({
  closed_dates: z.array(z.iso.date()).max(366),
  close_on_public_holidays: z.boolean(),
  reception_cutoff_minutes: z.number().int().min(0).max(1440).nullable(),
});
export type PublicSpecialHours = z.infer<typeof publicSpecialHoursSchema>;

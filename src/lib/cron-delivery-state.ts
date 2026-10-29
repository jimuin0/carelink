import type { createServiceRoleClient } from './supabase-server';
type Database = ReturnType<typeof createServiceRoleClient>;
type Job = 'daily-summary' | 'weekly-report';
type Followup = 'facility' | 'registration';

/** Older records remain legacy. Only new, stale pending claims are counted. */
export async function countReportDeliveryHolds(db: Database, job: Job, before: string): Promise<number | null> {
  try {
    const result = await db.from('cron_report_sends').select('id', { count: 'exact', head: true })
      .eq('job', job).eq('delivery_state', 'pending').lt('sent_at', before);
    return result.error === null && typeof result.count === 'number' ? result.count : null;
  } catch { return null; }
}
export async function countFollowupDeliveryHolds(db: Database, before: string): Promise<number | null> {
  try {
    const [facility, registration] = await Promise.all([
      db.from('facility_profiles').select('id', { count: 'exact', head: true }).eq('onboarding_email_delivery_state', 'pending').lt('onboarding_email_sent_at', before),
      db.from('salons').select('id', { count: 'exact', head: true }).eq('registration_followup_delivery_state', 'pending').lt('registration_followup_sent_at', before),
    ]);
    return facility.error === null && registration.error === null && typeof facility.count === 'number' && typeof registration.count === 'number'
      ? facility.count + registration.count : null;
  } catch { return null; }
}
export async function markReportDeliveryAccepted(db: Database, job: Job, facilityId: string, period: string, claimTime: string): Promise<boolean> {
  try {
    const result = await db.from('cron_report_sends').update({ delivery_state: 'delivered' }).eq('job', job)
      .eq('facility_id', facilityId).eq('period_key', period).eq('sent_at', claimTime).eq('delivery_state', 'pending').select('facility_id');
    return result.error === null && Array.isArray(result.data) && result.data.length === 1 && result.data[0].facility_id === facilityId;
  } catch { return false; }
}
export async function markFollowupDelivery(db: Database, kind: Followup, id: string, claimTime: string, state: 'delivered' | 'skipped'): Promise<boolean> {
  try {
    const result = kind === 'facility'
      ? await db.from('facility_profiles').update({ onboarding_email_delivery_state: state }).eq('id', id).eq('onboarding_email_sent_at', claimTime).eq('onboarding_email_delivery_state', 'pending').select('id')
      : await db.from('salons').update({ registration_followup_delivery_state: state }).eq('id', id).eq('registration_followup_sent_at', claimTime).eq('registration_followup_delivery_state', 'pending').select('id');
    return result.error === null && Array.isArray(result.data) && result.data.length === 1 && result.data[0].id === id;
  } catch { return false; }
}
/** Only this exact pending claim may be released after a known pre-send failure. */
export async function releaseFollowupDelivery(db: Database, kind: Followup, id: string, claimTime: string): Promise<boolean> {
  try {
    const result = kind === 'facility'
      ? await db.from('facility_profiles').update({ onboarding_email_sent_at: null, onboarding_email_delivery_state: 'legacy' }).eq('id', id).eq('onboarding_email_sent_at', claimTime).eq('onboarding_email_delivery_state', 'pending').select('id')
      : await db.from('salons').update({ registration_followup_sent_at: null, registration_followup_delivery_state: 'legacy' }).eq('id', id).eq('registration_followup_sent_at', claimTime).eq('registration_followup_delivery_state', 'pending').select('id');
    return result.error === null && Array.isArray(result.data) && result.data.length === 1 && result.data[0].id === id;
  } catch { return false; }
}

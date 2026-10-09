import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database-overrides';
import { fetchAllPaged } from './paginate';
import { newsletterUnsubUrl } from './newsletter-unsub';
import { newsletterFromEnv } from './email-from';

const emailRow = z.object({ email: z.string().nullable() }).passthrough();
const ownerRow = z.object({ user_id: z.string().uuid() }).passthrough();
const receiptSchema = z.object({
  operation_id: z.string().uuid(), campaign_id: z.string().uuid(),
  total: z.number().int().positive(), queued: z.number().int().nonnegative(),
  unconfirmed: z.number().int().nonnegative(), accepted: z.number().int().nonnegative(),
  suppressed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
}).strict();
export type NewsletterReceipt = z.infer<typeof receiptSchema>;
export class NewsletterSendError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
type Client = SupabaseClient<Database>;
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
function rpc(client: Client, name: string, args: Record<string, unknown>) {
  return (client.rpc as unknown as Rpc)(name, args);
}
function dependency() { return new NewsletterSendError(503, '送信準備を確認できません。同じキャンペーンの受付状況を確認してください。'); }
function checkedRows<T>(result: { data: unknown; error: unknown }, schema: z.ZodType<T>): T[] {
  if (result.error !== null || !Array.isArray(result.data)) throw dependency();
  const parsed = z.array(schema).safeParse(result.data);
  if (!parsed.success) throw dependency();
  return parsed.data;
}
async function paged<T>(page: (offset: number, limit: number) => PromiseLike<{ data: unknown; error: unknown }>, schema: z.ZodType<T>) {
  const result = await fetchAllPaged<T>(async (offset, limit) => ({ data: checkedRows(await page(offset, limit), schema), error: null }), { failOnTruncation: true });
  if (result.error) throw dependency();
  return result.rows;
}
const canonical = (email: string | null) => email?.trim().toLowerCase() ?? '';
export async function collectNewsletterRecipients(client: Client, kind: string): Promise<string[]> {
  const subType = kind === 'owner_monthly' ? 'owner_monthly' : 'user_digest';
  const subscribers = await paged((offset, limit) => client.from('newsletter_subscriptions').select('email')
    .or(`subscription_type.eq.${subType},subscription_type.eq.all`).eq('is_active', true).order('id').range(offset, offset + limit - 1), emailRow);
  const candidates = subscribers.map(row => canonical(row.email));
  if (kind === 'owner_monthly') {
    const owners = await paged((offset, limit) => client.from('facility_members').select('user_id')
      .eq('role', 'owner').order('id').range(offset, offset + limit - 1), ownerRow);
    const ids = [...new Set(owners.map(row => row.user_id))];
    for (let offset = 0; offset < ids.length; offset += 500) {
      const rows = checkedRows(await client.from('profiles').select('email').in('id', ids.slice(offset, offset + 500)), emailRow);
      candidates.push(...rows.map(row => canonical(row.email)));
    }
  }
  // Both suppression sources are mandatory even when the candidate set is empty.
  const profiles = await paged((offset, limit) => client.from('profiles').select('email')
    .eq('email_unsubscribed', true).order('id').range(offset, offset + limit - 1), emailRow);
  const inactive = await paged((offset, limit) => client.from('newsletter_subscriptions').select('email')
    .eq('is_active', false).order('id').range(offset, offset + limit - 1), emailRow);
  const suppressed = new Set([...profiles, ...inactive].map(row => canonical(row.email)));
  const emails = [...new Set(candidates.filter(email => email && !suppressed.has(email)))].sort();
  if (emails.some(email => !z.string().email().max(254).safeParse(email).success)) throw dependency();
  return emails;
}
function parseReceipt(data: unknown, campaignId: string): NewsletterReceipt {
  const parsed = receiptSchema.safeParse(data);
  if (!parsed.success || parsed.data.campaign_id !== campaignId) throw dependency();
  const receipt = parsed.data;
  if (receipt.total !== receipt.queued + receipt.unconfirmed + receipt.accepted + receipt.suppressed + receipt.failed) throw dependency();
  return receipt;
}
function rpcError(error: unknown): never {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (code === '42501') throw new NewsletterSendError(403, '配信権限を確認できません。');
  if (code === '40001') throw new NewsletterSendError(409, '本文・宛先・配信停止の状態が変わりました。一覧を更新して確認してください。');
  if (code === '23514') throw new NewsletterSendError(409, 'キャンペーンの状態または配信内容を確認してください。結果不明の旧配信は再送しません。');
  throw dependency();
}
export async function inspectNewsletterOperation(client: Client, actorId: string, campaignId: string): Promise<NewsletterReceipt | null> {
  const result = await rpc(client, 'inspect_newsletter_send_operation', { p_actor_id: actorId, p_campaign_id: campaignId });
  if (result.error !== null) rpcError(result.error);
  return result.data === null ? null : parseReceipt(result.data, campaignId);
}
export async function publishNewsletterOperation(client: Client, actorId: string, campaign: { id: string; campaign_type: string; updated_at: string }, expectedRevision: unknown): Promise<NewsletterReceipt> {
  if (typeof expectedRevision !== 'string' || !Number.isFinite(Date.parse(expectedRevision))) {
    throw new NewsletterSendError(409, 'ニュースレター一覧を開き直して配信内容を確認してください。');
  }
  if (campaign.updated_at !== expectedRevision) throw new NewsletterSendError(409, '配信内容が変わりました。一覧を更新して確認してください。');
  const emails = await collectNewsletterRecipients(client, campaign.campaign_type);
  if (emails.length === 0) throw new NewsletterSendError(409, '配信対象がありません。送信は開始していません。');
  const links: Record<string, string> = {};
  for (const email of emails) links[email] = newsletterUnsubUrl(email);
  const result = await rpc(client, 'publish_newsletter_send_operation', {
    p_actor_id: actorId, p_campaign_id: campaign.id, p_expected_revision: expectedRevision,
    p_expected_emails: emails, p_unsubscribe_links: links, p_from: newsletterFromEnv(),
  });
  if (result.error !== null) rpcError(result.error);
  return parseReceipt(result.data, campaign.id);
}

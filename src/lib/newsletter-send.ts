import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database-overrides';
import { fetchAllPaged } from './paginate';
import { newsletterUnsubUrl } from './newsletter-unsub';
import { newsletterFromEnv } from './email-from';

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
/**
 * 配信先（宛先から配信停止を除いたもの）。
 *
 * 🔴 宛先と配信停止の判定は DB の newsletter_current_recipients（service_role 専用）だけが持つ。
 * 以前はここでも profiles.email から宛先と抑止を組み立てていた（二重実装）。profiles.email は本人が自由に
 * 書き換えられるので、他人のアドレスを書いて配信停止にするだけで他人への配信を止められ、オーナーになって
 * 第三者のアドレスを書けばそこへ届いた。DB 側は確認済みのログインメール（auth.users）と
 * email_address_opted_out で決める（20261023150100）。publish_newsletter_send_operation も同じ関数で
 * 宛先の一致を確かめるので、ここで別の計算をすると食い違いの元になる。
 */
export async function collectNewsletterRecipients(client: Client, kind: string): Promise<string[]> {
  const rows = await paged((offset, limit) => client.rpc('newsletter_current_recipients', { p_kind: kind })
    .range(offset, offset + limit - 1), z.string());
  const emails = [...new Set(rows)].sort();
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

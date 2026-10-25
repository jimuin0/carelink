import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

// Actual Auth -> browser -> route -> disposable database. Provider credentials
// must be absent: no production mail, customer records or hosted seeding.
test.use({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' });
test.beforeAll(() => {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
    || !process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.RESEND_API_KEY
    || process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) throw new Error('Mail fixtures require isolated CI without sending credentials');
});
const localDb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
async function identity(db: ReturnType<typeof localDb>, platform = true) {
  const email = `synthetic-mail-${randomUUID()}@example.invalid`, password = randomUUID();
  const result = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (result.error || !result.data.user) throw new Error('Synthetic identity unavailable');
  const id = result.data.user.id;
  expect((await db.from('profiles').update({ is_platform_admin: platform }).eq('id', id)).error).toBeNull();
  return { email, password, id };
}

test('operator saves a durable draft; stale edits and unavailable transport preserve it', async ({ page }, info) => {
  await page.setExtraHTTPHeaders({ 'x-real-ip': `192.0.2.${240 + info.retry * 2 + (info.project.name === 'chromium' ? 0 : 1)}` });
  const db = localDb(), person = await identity(db), subject = `合成メール ${randomUUID()}`;
  const headers = { Origin: 'https://localhost:3000' };
  try {
    await page.goto('/auth/login?redirect=%2Fadmin%2Fmail');
    await page.getByRole('button', { name: '必須のみ', exact: true }).click();
    await page.getByLabel('メールアドレス', { exact: true }).fill(person.email);
    await page.getByLabel('パスワード', { exact: true }).fill(person.password);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    await page.waitForURL('**/admin/mail');
    await expect(page.getByRole('heading', { name: 'メール', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /新規作成/ }).click();
    await page.getByLabel('宛先', { exact: true }).fill('synthetic-recipient@example.invalid');
    await page.getByLabel('件名', { exact: true }).fill(subject);
    await page.getByLabel('本文', { exact: true }).fill('合成本文。実際には送信しません。');
    const [saved] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/admin/mail') && r.request().method() === 'POST'), page.getByRole('button', { name: '下書き保存', exact: true }).click()]);
    expect(saved.status()).toBe(200); expect(saved.headers()['cache-control']).toBe('no-store');
    const mail = (await saved.json()).mail;
    const stored = await db.from('platform_mail').select('recipient,subject,body,state,envelope,created_by').eq('id', mail.id).single();
    expect(stored.error).toBeNull(); expect(stored.data).toEqual({ recipient: 'synthetic-recipient@example.invalid', subject, body: '合成本文。実際には送信しません。', state: 'draft', envelope: null, created_by: person.id });
    await page.reload(); await page.getByRole('button', { name: '下書き', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(subject) }).click();
    await expect(page.getByLabel('本文', { exact: true })).toHaveValue('合成本文。実際には送信しません。');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const draft = { id: mail.id, revision: mail.revision, contactId: null, to: mail.recipient, subject, body: '別の画面で保存した本文', scheduledAt: null };
    expect((await page.request.post('/api/admin/mail', { headers, data: { action: 'save', draft } })).status()).toBe(200);
    const stale = await db.rpc('manage_platform_mail_atomic', { p_actor_id: person.id, p_mail_id: mail.id, p_action: 'save', p_values: draft });
    expect(stale.error?.code).toBe('40001');
    await page.getByLabel('本文', { exact: true }).fill('古い画面の入力は保持されます');
    const [conflict] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/admin/mail') && r.request().method() === 'POST'), page.getByRole('button', { name: '下書き保存', exact: true }).click()]);
    expect(conflict.status()).toBe(409); await expect(page.getByLabel('本文', { exact: true })).toHaveValue('古い画面の入力は保持されます');
    const dialog = page.getByRole('dialog', { name: '未保存の変更があります' });
    await page.getByRole('button', { name: '下書き', exact: true }).click(); await dialog.getByRole('button', { name: '保存せずに移動' }).click();
    await page.getByRole('button', { name: new RegExp(subject) }).click();
    await page.getByRole('button', { name: '送信内容を確認', exact: true }).click();
    const preview = page.getByRole('dialog', { name: '送信内容の確認' });
    await expect(preview.getByText('差出人：CareLink <support@carelink-jp.com>', { exact: true })).toBeVisible();
    const [unavailable] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/admin/mail') && r.request().method() === 'POST'), preview.getByRole('button', { name: 'この内容で送信', exact: true }).click()]);
    expect(unavailable.status()).toBe(503); await expect(preview.getByRole('alert')).toContainText('下書きは保持されています');
    expect((await db.from('platform_mail').select('state,envelope,reserved_at').eq('id', mail.id).single()).data).toEqual({ state: 'draft', envelope: null, reserved_at: null });
    expect((await db.from('profiles').update({ is_platform_admin: false }).eq('id', person.id)).error).toBeNull();
    expect((await page.request.get('/api/admin/mail?folder=draft')).status()).toBe(403);
    expect((await page.request.post('/api/admin/mail', { headers, data: { action: 'save', draft: { ...draft, revision: mail.revision + 2 } } })).status()).toBe(403);
  } finally { expect((await db.auth.admin.deleteUser(person.id)).error).toBeNull(); }
});

test('atomic mailbox permissions, concurrent reservations and old inquiry composer share one fence', async () => {
  const db = localDb(), person = await identity(db), ordinary = await identity(db, false);
  const contactId = randomUUID(), recipient = 'synthetic-contact@example.invalid';
  const rpc = (id: string, action: string, values = {}, actor = person.id) => db.rpc('manage_platform_mail_atomic', { p_actor_id: actor, p_mail_id: id, p_action: action, p_values: values });
  const draft = (id: string, scheduledAt: string | null = null, linked = true) => ({ id, revision: 0, contactId: linked ? contactId : null, to: recipient, subject: '合成件名', body: '合成本文', scheduledAt });
  const envelope = (scheduledAt: string | null = null) => ({ from: 'CareLink <support@carelink-jp.com>', replyTo: 'support@carelink-jp.com', to: recipient, subject: '合成件名', text: '合成本文', ...(scheduledAt ? { scheduledAt } : {}) });
  try {
    expect((await db.from('contacts').insert({ id: contactId, name: '合成問い合わせ', email: recipient, inquiry_type: '合成検証', message: '合成本文' })).error).toBeNull();
    const first = randomUUID(), second = randomUUID(), schedule = new Date(Date.now() + 3600000).toISOString();
    expect((await rpc(first, 'save', draft(first, schedule))).error).toBeNull();
    expect((await rpc(second, 'save', draft(second, schedule))).error).toBeNull();
    expect((await rpc(first, 'save', draft(first, schedule))).error?.code).toBe('40001');
    expect((await rpc(first, 'read', {}, ordinary.id)).error?.code).toBe('42501');
    expect((await db.from('platform_mail').insert({ id: randomUUID() })).error?.code).toBe('42501');
    const anonymous = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    expect((await anonymous.from('platform_mail').select('id')).error?.code).toBe('42501');
    expect((await anonymous.rpc('manage_platform_mail_atomic', { p_actor_id: person.id, p_mail_id: first, p_action: 'read' })).error?.code).toBe('42501');
    expect((await anonymous.auth.signInWithPassword({ email: ordinary.email, password: ordinary.password })).error).toBeNull();
    expect((await anonymous.from('platform_mail').select('id')).error?.code).toBe('42501');
    expect((await anonymous.rpc('manage_platform_mail_atomic', { p_actor_id: person.id, p_mail_id: first, p_action: 'read' })).error?.code).toBe('42501');
    expect((await rpc(first, 'reserve', { revision: 1, envelope: { ...envelope(schedule), from: 'Synthetic <forged@example.invalid>' } })).error?.code).toBe('22023');
    const outcomes = await Promise.all([first, second].map(id => rpc(id, 'reserve', { revision: 1, envelope: envelope(schedule) })));
    expect(outcomes.filter(result => !result.error)).toHaveLength(1); expect(outcomes.filter(result => result.error)).toHaveLength(1);
    expect(['40001', '23505']).toContain(outcomes.find(result => result.error)!.error!.code);
    const winner = outcomes[0].error ? second : first;
    const retried = await rpc(winner, 'reserve', { revision: 999, envelope: { text: 'changed' } });
    expect(retried.error).toBeNull(); expect(retried.data.envelope).toEqual(envelope(schedule));
    const oldReply = { id: randomUUID(), contact_id: contactId, author_id: person.id, author_name: '合成運営', body: '合成返信', is_internal: false };
    expect((await db.from('contact_replies').insert(oldReply)).error?.code).toBe('23505');
    expect((await rpc(winner, 'save', { ...draft(winner, schedule), revision: 2 })).error?.code).toBe('40001');
    const providerId = randomUUID();
    const observed = await rpc(winner, 'observe', { providerId, event: 'accepted' }); expect(observed.error).toBeNull(); expect(observed.data.state).toBe('scheduled');
    expect((await db.from('contact_replies').insert(oldReply)).error?.code).toBe('23505');
    expect((await rpc(winner, 'cancel')).data.state).toBe('cancelling');
    expect((await rpc(winner, 'observe', { providerId, event: 'scheduled' })).data.state).toBe('cancelling');
    expect((await db.from('contact_replies').insert(oldReply)).error?.code).toBe('23505');
    expect((await rpc(winner, 'observe', { providerId, event: 'cancelled' })).data.state).toBe('cancelled');
    expect((await rpc(winner, 'observe', { providerId, event: 'accepted' })).data.state).toBe('cancelled');
    expect((await db.from('contact_replies').insert(oldReply)).error).toBeNull();
    const blocked = winner === first ? second : first;
    expect((await rpc(blocked, 'reserve', { revision: 1, envelope: envelope(schedule) })).error?.code).toBe('40001');
    const instant = randomUUID(); expect((await rpc(instant, 'save', draft(instant, null, false))).error).toBeNull();
    expect((await rpc(instant, 'reserve', { revision: 1, envelope: envelope() })).error).toBeNull();
    const instantProvider = randomUUID(); expect((await rpc(instant, 'observe', { providerId: instantProvider, event: 'accepted' })).data.state).toBe('sent');
    expect((await rpc(instant, 'cancel')).error?.code).toBe('40001');
    expect((await rpc(instant, 'observe', { providerId: instantProvider, event: 'scheduled' })).data.state).toBe('sent');
    expect((await db.from('profiles').update({ is_platform_admin: false }).eq('id', person.id)).error).toBeNull();
    expect((await rpc(instant, 'read')).error?.code).toBe('42501');
  } finally {
    expect((await db.from('contact_replies').delete().eq('contact_id', contactId)).error).toBeNull();
    expect((await db.from('contacts').delete().eq('id', contactId)).error).toBeNull();
    expect((await db.auth.admin.deleteUser(person.id)).error).toBeNull(); expect((await db.auth.admin.deleteUser(ordinary.id)).error).toBeNull();
  }
});

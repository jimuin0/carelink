import { test, expect, type Response } from '@playwright/test';
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
function isMailAction(response: Response, action: 'save' | 'send'): boolean {
  const request = response.request();
  if (!response.url().endsWith('/api/admin/mail') || request.method() !== 'POST') return false;
  try { return request.postDataJSON()?.action === action; } catch { return false; }
}
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
    const checked = await page.request.post('/api/admin/mail', { headers, data: { action: 'sync', cursor: { at: '2099-01-01T00:00:00Z', id: randomUUID() } } });
    expect(checked.status()).toBe(200); expect(await checked.json()).toEqual({ checked: 0, unconfirmed: 0, remaining: false, nextCursor: null, observations: [] });
    await page.getByRole('button', { name: /新規作成/ }).click();
    await page.getByLabel('宛先', { exact: true }).fill('synthetic-recipient@example.invalid');
    await page.getByLabel('件名', { exact: true }).fill(subject);
    await page.getByLabel('本文', { exact: true }).fill('合成本文。実際には送信しません。');
    const [saved] = await Promise.all([page.waitForResponse(r => isMailAction(r, 'save')), page.getByRole('button', { name: '下書き保存', exact: true }).click()]);
    expect(saved.status()).toBe(200); expect(saved.headers()['cache-control']).toBe('no-store');
    const mail = (await saved.json()).mail;
    const stored = await db.from('platform_mail').select('recipient,subject,body,state,envelope,created_by').eq('id', mail.id).single();
    expect(stored.error).toBeNull(); expect(stored.data).toEqual({ recipient: 'synthetic-recipient@example.invalid', subject, body: '合成本文。実際には送信しません。', state: 'draft', envelope: null, created_by: person.id });
    await page.reload(); await page.getByRole('button', { name: '下書き', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(subject) }).click();
    await expect(page.getByLabel('本文', { exact: true })).toHaveValue('合成本文。実際には送信しません。');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Auth fields are gone; only this disposable synthetic draft is captured.
    await info.attach('operator-mail-composer', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    const draft = { id: mail.id, revision: mail.revision, contactId: null, to: mail.recipient, subject, body: '別の画面で保存した本文', scheduledAt: null };
    expect((await page.request.post('/api/admin/mail', { headers, data: { action: 'save', draft } })).status()).toBe(200);
    const stale = await db.rpc('manage_platform_mail_atomic', { p_actor_id: person.id, p_mail_id: mail.id, p_action: 'save', p_values: draft });
    expect(stale.error?.code).toBe('PT409');
    await page.getByLabel('本文', { exact: true }).fill('古い画面の入力は保持されます');
    const [conflict] = await Promise.all([page.waitForResponse(r => isMailAction(r, 'save')), page.getByRole('button', { name: '下書き保存', exact: true }).click()]);
    expect(conflict.status()).toBe(409); await expect(page.getByLabel('本文', { exact: true })).toHaveValue('古い画面の入力は保持されます');
    const dialog = page.getByRole('dialog', { name: '未保存の変更があります' });
    await page.getByRole('button', { name: '下書き', exact: true }).click(); await dialog.getByRole('button', { name: '保存せずに移動' }).click();
    await page.getByRole('button', { name: new RegExp(subject) }).click();
    await page.getByRole('button', { name: '送信内容を確認', exact: true }).click();
    const preview = page.getByRole('dialog', { name: '送信内容の確認' });
    await expect(preview.getByText('差出人：CareLink <support@carelink-jp.com>', { exact: true })).toBeVisible();
    await info.attach('operator-mail-confirmation', { body: await page.screenshot(), contentType: 'image/png' });
    const [unavailable] = await Promise.all([page.waitForResponse(r => isMailAction(r, 'send')), preview.getByRole('button', { name: 'この内容で送信', exact: true }).click()]);
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
    expect((await rpc(first, 'save', draft(first, schedule))).error?.code).toBe('PT409');
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
    expect(['PT409', '23505']).toContain(outcomes.find(result => result.error)!.error!.code);
    const winner = outcomes[0].error ? second : first;
    const retried = await rpc(winner, 'reserve', { revision: 999, envelope: { text: 'changed' } });
    expect(retried.error).toBeNull(); expect(retried.data.envelope).toEqual(envelope(schedule));
    const oldReply = { id: randomUUID(), contact_id: contactId, author_id: person.id, author_name: '合成運営', body: '合成返信', is_internal: false };
    expect((await db.from('contact_replies').insert(oldReply)).error?.code).toBe('23505');
    expect((await rpc(winner, 'save', { ...draft(winner, schedule), revision: 2 })).error?.code).toBe('PT409');
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
    expect((await rpc(blocked, 'reserve', { revision: 1, envelope: envelope(schedule) })).error?.code).toBe('PT409');
    const instant = randomUUID(); expect((await rpc(instant, 'save', draft(instant, null, false))).error).toBeNull();
    expect((await rpc(instant, 'reserve', { revision: 1, envelope: envelope() })).error).toBeNull();
    const instantProvider = randomUUID(); expect((await rpc(instant, 'observe', { providerId: instantProvider, event: 'accepted' })).data.state).toBe('sent');
    expect((await rpc(instant, 'cancel')).error?.code).toBe('PT409');
    expect((await rpc(instant, 'observe', { providerId: instantProvider, event: 'scheduled' })).data.state).toBe('sent');
    expect((await db.from('profiles').update({ is_platform_admin: false }).eq('id', person.id)).error).toBeNull();
    expect((await rpc(instant, 'read')).error?.code).toBe('42501');
  } finally {
    expect((await db.from('contact_replies').delete().eq('contact_id', contactId)).error).toBeNull();
    expect((await db.from('contacts').delete().eq('id', contactId)).error).toBeNull();
    expect((await db.auth.admin.deleteUser(person.id)).error).toBeNull(); expect((await db.auth.admin.deleteUser(ordinary.id)).error).toBeNull();
  }
});

test('compact inbox and unified history distinguish replies, drafts, queues and delivery on narrow and desktop widths', async ({ page }, info) => {
  await page.setExtraHTTPHeaders({ 'x-real-ip': `192.0.2.${230 + info.retry * 2 + (info.project.name === 'chromium' ? 0 : 1)}` });
  const db = localDb(), person = await identity(db), marker = `合成一覧 ${randomUUID()}`;
  const cases = ['未返信', '下書きあり', '予約中', '返信済み', '送信失敗', '送信結果不明', '旧返信', '配信完了'];
  const ids = cases.map(() => randomUUID());
  const receivedAt = new Date(Date.now() - 3600000).toISOString();
  const mailIds: Record<string, string> = {};
  const rpc = (id: string, action: string, values = {}) => db.rpc('manage_platform_mail_atomic', { p_actor_id: person.id, p_mail_id: id, p_action: action, p_values: values });
  try {
    expect((await db.from('contacts').insert(cases.map((label, index) => ({ id: ids[index], name: index === 0 ? '　山田　　太郎  ' : 'María  de la Cruz',
      email: 'synthetic-inbox@example.invalid', inquiry_type: marker + ' ' + label, message: '合成問い合わせ本文 ' + label, created_at: receivedAt,
      ticket_status: label === '未返信' ? 'closed' : 'open' })))).error).toBeNull();
    for (const label of cases.filter(label => label !== '未返信')) {
      const id = randomUUID(); mailIds[label] = id;
      const scheduledAt = label === '予約中' ? new Date(Date.now() + 3600000).toISOString() : null;
      const draft = { id, revision: 0, contactId: ids[cases.indexOf(label)], to: 'synthetic-inbox@example.invalid', subject: marker + ' ' + label, body: '合成返信本文 ' + label, scheduledAt };
      expect((await rpc(id, 'save', draft)).error).toBeNull();
      if (label === '下書きあり' || label === '旧返信') continue;
      expect((await rpc(id, 'reserve', { revision: 1, envelope: { from: 'CareLink <support@carelink-jp.com>', replyTo: 'support@carelink-jp.com', to: draft.to,
        subject: draft.subject, text: draft.body, ...(scheduledAt ? { scheduledAt } : {}) } })).error).toBeNull();
      if (label === '送信結果不明') continue;
      expect((await rpc(id, 'observe', { providerId: randomUUID(), event: label === '送信失敗' ? 'bounced' : label === '配信完了' ? 'delivered' : 'accepted' })).error).toBeNull();
    }
    expect((await db.from('contact_replies').insert([
      { id: randomUUID(), contact_id: ids[0], author_id: person.id, author_name: '合成担当', body: '社内の記録は返信ではありません', is_internal: true, created_at: new Date(Date.now() - 1200000).toISOString() },
      { id: randomUUID(), contact_id: ids[6], author_id: person.id, author_name: '合成担当', body: '旧画面から送信受付された合成返信', is_internal: false,
        created_at: new Date(Date.now() - 1800000).toISOString(), sent_at: new Date(Date.now() - 1800000).toISOString() },
    ])).error).toBeNull();
    await page.goto('/auth/login?redirect=%2Fadmin%2Fmail');
    await page.getByRole('button', { name: '必須のみ', exact: true }).click();
    await page.getByLabel('メールアドレス', { exact: true }).fill(person.email);
    await page.getByLabel('パスワード', { exact: true }).fill(person.password);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click(); await page.waitForURL('**/admin/mail');
    const row = (label: string) => page.getByRole('region', { name: 'メール一覧', exact: true }).getByRole('button').filter({ hasText: marker + ' ' + label });
    for (const label of cases) {
      const expected = label === '旧返信' || label === '配信完了' ? '返信済み' : label;
      await expect(row(label)).toContainText(expected);
      if (['未返信', '下書きあり', '予約中', '送信失敗', '送信結果不明'].includes(label)) {
        await expect(row(label)).toContainText('未返信'); await expect(row(label)).not.toContainText('返信済み');
      }
    }
    await expect(row('旧返信')).toContainText('下書きあり');
    await expect(row('未返信')).toContainText('山田　太郎');
    expect((await db.from('contacts').select('name').eq('id', ids[0]).single()).data?.name).toBe('　山田　　太郎  ');
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect((await row('未返信').boundingBox())!.height).toBeLessThan(110);
      await info.attach(`inbox-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    }
    await row('旧返信').click();
    const history = page.getByRole('region', { name: 'お問い合わせと返信の履歴', exact: true });
    await expect(history.getByRole('listitem')).toHaveCount(3);
    await expect(history.getByRole('listitem').nth(0)).toContainText('合成問い合わせ本文 旧返信');
    await expect(history.getByRole('listitem').nth(1)).toContainText('旧画面から送信受付された合成返信');
    await expect(history.getByRole('listitem').nth(1)).toContainText('配信完了は未確認');
    await expect(history.getByRole('listitem').nth(2)).toContainText('下書き');
    await history.getByRole('button', { name: '下書きを編集', exact: true }).click();
    await expect(page.getByLabel('本文', { exact: true })).toHaveValue('合成返信本文 旧返信');
    await expect(history).toBeVisible();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await info.attach(`thread-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    }
    await page.getByRole('button', { name: '送信エラー', exact: true }).click();
    await expect(page.getByRole('region', { name: 'メール一覧', exact: true }).getByRole('button').filter({ hasText: marker + ' 送信失敗' })).toContainText('宛先へ届けられませんでした');
    const failed = await page.request.get('/api/admin/mail?folder=failed'); expect(failed.status()).toBe(200);
    expect((await failed.json()).messages.map((mail: { id: string }) => mail.id)).toContain(mailIds['送信失敗']);
    expect((await db.from('platform_mail').select('state,delivery_status').eq('id', mailIds['返信済み']).single()).data).toEqual({ state: 'sent', delivery_status: 'accepted' });
    expect((await db.from('platform_mail').select('state,delivery_status').eq('id', mailIds['配信完了']).single()).data).toEqual({ state: 'sent', delivery_status: 'delivered' });
  } finally {
    expect((await db.from('contact_replies').delete().in('contact_id', ids)).error).toBeNull();
    expect((await db.from('contacts').delete().in('id', ids)).error).toBeNull();
    expect((await db.auth.admin.deleteUser(person.id)).error).toBeNull();
  }
});

// Disposable PG17 synthetic transactions only. No provider, HTTP or production I/O.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const local = process.argv[2] === '--local-docker-shadow';
assert.ok(process.argv.length === (local ? 3 : 2), 'unsupported runner mode');
assert.ok(!process.env.PGSERVICE && !process.env.PGSERVICEFILE && !process.env.PGHOSTADDR, 'alternate connection refused');
const database = 'carelink_shadow';
let binary, args, environment;
if (local) {
  assert.ok(process.env.DOCKER_HOST === 'unix:///Users/kam/.carelink-vm-20261008/.docker/run/docker.sock', 'dedicated local Docker socket required');
  binary = 'docker';
  args = ['exec', '-i', 'supabase_db_carelink', 'psql', '-U', 'postgres', '-d', database];
  environment = { PATH: process.env.PATH, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONFIG: process.env.DOCKER_CONFIG };
} else {
  assert.equal(process.env.CI, 'true'); assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.ok(['localhost', '127.0.0.1'].includes(process.env.PGHOST));
  assert.equal(process.env.PGPORT, '5432'); assert.equal(process.env.PGUSER, 'postgres'); assert.ok(process.env.PGPASSWORD);
  binary = 'psql'; args = ['-d', database];
  environment = { PATH: process.env.PATH, PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'postgres', PGPASSWORD: process.env.PGPASSWORD, PGSSLMODE: 'disable' };
}
args.push('-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose');
const prefix = `newsletter-race-${process.pid}-${Date.now().toString(36)}`;
const children = new Set();
let fixtureOwned = false;
const admin = randomUUID(), accountA = randomUUID(), accountB = randomUUID();
const campaignA = randomUUID(), campaignB = randomUUID();
const accounts = [admin, accountA, accountB];
const campaigns = [campaignA, campaignB];
const mailbox = suffix => `${prefix}-${suffix}@example.invalid`;
const emails = [mailbox('admin'), mailbox('a'), mailbox('b')];
const quoted = values => values.map(value => `'${value}'`).join(',');
const setup = name => `SET application_name='${name}'; SET statement_timeout='25s';\n`;
function safeQueryError(error) {
  // Never expose connection arguments, credentials or the failing SQL text.
  const state = String(error.stderr ?? '').match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1];
  return new Error(`fixture query failed${state ? ` (${state})` : ''}`);
}
function query(sql) {
  try {
    return execFileSync(binary, args, { env: environment, input: setup(`${prefix}-query`) + sql,
      encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (error) { throw safeQueryError(error); }
}
function client(sql, name) {
  assert.match(name, /^[a-z0-9-]+$/);
  const child = spawn(binary, args, { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child); let output = '', errors = '';
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('fixture client timeout')); }, 30000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 65536) child.kill('SIGTERM'); });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4096); });
    child.on('error', () => { clearTimeout(timer); reject(new Error('fixture client unavailable')); });
    child.on('close', code => {
      clearTimeout(timer); children.delete(child);
      if (code === 0) resolve(output.trim()); else reject(safeQueryError({ stderr: errors }));
    });
    child.stdin.on('error', () => child.kill('SIGTERM'));
  });
  done.catch(() => undefined);
  // SQL application_name is used in BOTH CI and Docker paths.
  child.stdin.write(setup(name));
  if (sql !== undefined) child.stdin.end(sql);
  return { child, done, output: () => output };
}
async function contend(label, heldTransaction, statements) {
  const name = `${prefix}-${label}`, coordinatorName = `${name}-coord`;
  const coordinator = client(undefined, coordinatorName);
  let ended = false;
  const coordinated = coordinator.done.then(value => { ended = true; return value; }, error => { ended = true; throw error; });
  coordinated.catch(() => undefined);
  coordinator.child.stdin.write(`BEGIN; ${heldTransaction}; SELECT 'fixture-locked';\n`);
  const deadline = Date.now() + 20000;
  while (!coordinator.output().includes('fixture-locked\n')) {
    if (ended || Date.now() > deadline) throw new Error('fixture coordinator lock unavailable');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const workers = statements.map(sql => client(sql, name).done);
  coordinator.child.stdin.end(`DO $$ DECLARE deadline timestamptz:=clock_timestamp()+interval '20 seconds'; BEGIN LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN (SELECT count(*) FROM pg_stat_activity a WHERE a.datname=current_database()
      AND a.application_name='${name}' AND a.state='active' AND a.wait_event_type='Lock'
      -- Row waiters can queue behind another waiter holding the tuple lock.
      -- Require the observed blocker chain to reach our coordinator; a direct
      -- pg_blocking_pids edge is sufficient for advisory locks but not row locks.
      AND EXISTS(WITH RECURSIVE blockers(pid,trail) AS (
        SELECT b.pid,ARRAY[a.pid,b.pid] FROM unnest(pg_blocking_pids(a.pid)) b(pid)
        UNION ALL SELECT b.pid,x.trail||b.pid FROM blockers x
          CROSS JOIN LATERAL unnest(pg_blocking_pids(x.pid)) b(pid) WHERE b.pid<>ALL(x.trail)
      ) SELECT 1 FROM blockers x JOIN pg_stat_activity c ON c.pid=x.pid
        WHERE c.datname=current_database() AND c.application_name='${coordinatorName}'))=${statements.length};
    IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'newsletter overlap not observed'; END IF;
    PERFORM pg_sleep(0.02);
  END LOOP; END $$; SELECT 'overlap-observed'; COMMIT;`);
  const results = await Promise.allSettled(workers);
  const observed = await coordinated;
  assert.match(observed, /overlap-observed/, 'actual PostgreSQL blocking must be observed');
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  console.log(`${label}: actual concurrent PostgreSQL lock wait observed`);
  return results.map(result => result.value);
}
const publish = campaign => `SET ROLE service_role; SELECT public.publish_newsletter_send_operation('${admin}','${campaign}',
 '2030-01-01T00:00:00Z',ARRAY['${emails[1]}','${emails[2]}'],
 jsonb_build_object('${emails[1]}','https://carelink-jp.com/unsubscribe?n='||repeat('a',64),
 '${emails[2]}','https://carelink-jp.com/unsubscribe?n='||repeat('b',64)),'CareLink <newsletter@carelink-jp.com>');`;
function queue(campaign, email) {
  return query(`SELECT r.queue_id FROM public.newsletter_send_recipients r JOIN public.newsletter_send_operations o USING(operation_id)
    WHERE o.campaign_id='${campaign}' AND r.email='${email}';`);
}
function claim(queueId) {
  const stamp = new Date().toISOString();
  assert.equal(query(`SET ROLE service_role; SELECT id FROM public.claim_webhook_retry_queue_v2(ARRAY['${queueId}'::uuid],'${stamp}');`), queueId,
    'new v2 gateway must claim exactly the owned queue');
  assert.equal(query(`SELECT consumed FROM public.webhook_dispatch_claim_proofs WHERE queue_id='${queueId}' AND claimed_at='${stamp}';`), 't');
  return stamp;
}
const start = (id, stamp) => `SET ROLE service_role; SELECT outcome FROM public.start_newsletter_delivery('${id}','${stamp}');`;
async function main() {
  assert.equal(query('SELECT current_database();'), database);
  assert.equal(query("SELECT current_setting('server_version_num')::int/10000;"), '17');
  assert.equal(query("SELECT to_regprocedure('public.publish_newsletter_send_operation(uuid,uuid,timestamp with time zone,text[],jsonb,text)') IS NOT NULL AND to_regprocedure('public.claim_webhook_retry_queue_v2(uuid[],timestamp with time zone)') IS NOT NULL;"), 't', 'final newsletter and v2 schema required');
  assert.equal(query('SELECT public.webhook_dispatch_v2_version();'), '1', 'enabled dispatch protocol version 1 required');
  // Do not publish to any pre-existing addresses, even in a disposable database.
  assert.equal(query("SELECT count(*) FROM public.newsletter_current_recipients('user_digest');"), '0', 'isolated newsletter audience required');
  assert.equal(query(`SELECT count(*) FROM auth.users WHERE id IN (${quoted(accounts)});`), '0');
  assert.equal(query(`SELECT count(*) FROM public.newsletter_campaigns WHERE id IN (${quoted(campaigns)});`), '0');
  fixtureOwned = true; // UUIDs are unused; cleanup also covers an unconfirmed setup response.
  query(`BEGIN;
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ('${admin}','${emails[0]}',now()),('${accountA}','${emails[1]}',now()),('${accountB}','${emails[2]}',now());
    UPDATE public.profiles SET is_platform_admin=true WHERE id='${admin}';
    INSERT INTO public.newsletter_subscriptions(user_id,email,subscription_type) VALUES ('${accountA}','${emails[1]}','user_digest'),('${accountB}','${emails[2]}','user_digest');
    INSERT INTO public.newsletter_campaigns(id,campaign_type,subject,html_content,text_content,updated_at) VALUES
      ('${campaignA}','user_digest','Synthetic same campaign','Frozen HTML','Frozen text','2030-01-01T00:00:00Z'),
      ('${campaignB}','user_digest','Synthetic suppression','Frozen HTML','Frozen text','2030-01-01T00:00:00Z');
    COMMIT;`);

  const receipts = (await contend('same-campaign', `SELECT public.lock_booking_account('${admin}')`, [publish(campaignA), publish(campaignA)])).map(JSON.parse);
  assert.equal(receipts[0].operation_id, receipts[1].operation_id); assert.equal(receipts[0].total, 2);
  assert.equal(query(`SELECT count(*) FROM public.newsletter_send_operations WHERE campaign_id='${campaignA}';`), '1');
  assert.equal(query(`SELECT count(*) FROM public.newsletter_send_recipients WHERE operation_id='${receipts[0].operation_id}';`), '2');
  const first = queue(campaignA, emails[1]), second = queue(campaignA, emails[2]);
  assert.equal(query(`SELECT bool_and(payload->'dispatch_version'='2'::jsonb) FROM public.webhook_retry_queue WHERE id IN ('${first}','${second}');`), 't');
  assert.equal(query(`SET ROLE service_role; WITH denied AS (UPDATE public.webhook_retry_queue SET status='processing',claimed_at=clock_timestamp()
    WHERE id='${first}' RETURNING id) SELECT count(*) FROM denied;`), '0', 'pinned old raw worker cannot claim v2');
  assert.equal(query(`SELECT status||':'||attempt_count FROM public.webhook_retry_queue WHERE id='${first}';`), 'pending:0');
  for (const id of [first, second]) { const stamp = claim(id); assert.equal(query(start(id, stamp)), 'ready'); }
  // Synthetic provider UUIDs test ledger acceptance only; no provider is called.
  const accepts = [first, second].map(id => `SET ROLE service_role; UPDATE public.webhook_retry_queue
    SET status='success',provider_message_id='${randomUUID()}',delivered_at=clock_timestamp(),processed_at=clock_timestamp()
    WHERE id='${id}' AND status='processing' RETURNING id;`);
  const accepted = await contend('acceptances', `SELECT id FROM public.newsletter_campaigns WHERE id='${campaignA}' FOR UPDATE`, accepts);
  assert.deepEqual(accepted.sort(), [first, second].sort());
  assert.equal(query(`SELECT status||':'||(stats->>'accepted')||':'||(stats->>'queued') FROM public.newsletter_campaigns WHERE id='${campaignA}';`), 'sent:2:0');

  JSON.parse(query(publish(campaignB)));
  const unsubQueue = queue(campaignB, emails[1]), unsubStamp = claim(unsubQueue);
  const suppressed = await contend('unsubscribe-before-start', `SET LOCAL ROLE service_role;
    SELECT public.unsubscribe_newsletter_atomic('${emails[1]}',NULL); RESET ROLE`, [start(unsubQueue, unsubStamp)]);
  assert.equal(suppressed[0], 'superseded');
  assert.equal(query(`SELECT state FROM public.newsletter_send_recipients WHERE queue_id='${unsubQueue}';`), 'suppressed');
  assert.equal(query(`SELECT delivery_started_at IS NULL FROM public.webhook_retry_queue WHERE id='${unsubQueue}';`), 't');

  const retireQueue = queue(campaignB, emails[2]), retireStamp = claim(retireQueue);
  const deleted = await contend('auth-delete-after-start', `SET LOCAL ROLE service_role;
    SELECT outcome FROM public.start_newsletter_delivery('${retireQueue}','${retireStamp}'); RESET ROLE`,
  [`WITH gone AS (DELETE FROM auth.users WHERE id='${accountB}' RETURNING id) SELECT count(*) FROM gone;`]);
  assert.equal(deleted[0], '1');
  assert.equal(query(`SELECT count(*) FROM auth.users WHERE id='${accountB}';`), '0');
  assert.equal(query(`SELECT state FROM public.newsletter_send_recipients WHERE queue_id='${retireQueue}';`), 'unconfirmed');
  assert.equal(query(`SELECT status='processing' AND delivery_started_at IS NOT NULL FROM public.webhook_retry_queue WHERE id='${retireQueue}';`), 't');
  assert.equal(query(start(retireQueue, retireStamp)), 'not_owned', 'started unknown operation cannot start again');
  assert.equal(query(`SET ROLE service_role; SELECT count(*) FROM public.claim_webhook_retry_queue_v2(ARRAY['${retireQueue}'::uuid],clock_timestamp());`), '0', 'started unknown operation cannot be reclaimed');
  console.log('Newsletter concurrency passed: four observed lock barriers, one campaign operation, exact concurrent acceptance counts, prior unsubscribe suppresses start, Auth deletion preserves unknown start; external provider calls=0.');
}
function cleanup() {
  if (children.size) {
    query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database()
      AND application_name LIKE '${prefix}-%' AND pid<>pg_backend_pid();`);
    for (const child of children) child.kill('SIGTERM');
  }
  if (!fixtureOwned) return;
  const queueIds = query(`SELECT id FROM public.webhook_retry_queue WHERE payload->>'campaign_id' IN (${quoted(campaigns)});`).split('\n').filter(Boolean);
  for (const id of queueIds) assert.match(id, /^[a-f0-9-]{36}$/);
  query(`BEGIN;
    DELETE FROM public.newsletter_send_recipients WHERE operation_id IN (SELECT operation_id FROM public.newsletter_send_operations WHERE campaign_id IN (${quoted(campaigns)}));
    DELETE FROM public.newsletter_send_operations WHERE campaign_id IN (${quoted(campaigns)});
    DELETE FROM public.webhook_retry_queue WHERE payload->>'campaign_id' IN (${quoted(campaigns)});
    DELETE FROM public.newsletter_campaigns WHERE id IN (${quoted(campaigns)});
    DELETE FROM public.newsletter_subscriptions WHERE email IN (${quoted(emails)});
    DELETE FROM auth.users WHERE id IN (${quoted(accounts)});
    DELETE FROM public.audit_logs WHERE table_name='auth.users' AND record_id IN (${quoted(accounts)});
    COMMIT;`);
  assert.equal(query(`SELECT (SELECT count(*) FROM auth.users WHERE id IN (${quoted(accounts)}))
    +(SELECT count(*) FROM public.profiles WHERE id IN (${quoted(accounts)}))
    +(SELECT count(*) FROM public.newsletter_subscriptions WHERE email IN (${quoted(emails)}))
    +(SELECT count(*) FROM public.newsletter_campaigns WHERE id IN (${quoted(campaigns)}))
    +(SELECT count(*) FROM public.webhook_retry_queue WHERE payload->>'campaign_id' IN (${quoted(campaigns)}))
    +(SELECT count(*) FROM public.webhook_dispatch_claim_proofs WHERE queue_id=ANY(ARRAY[${quoted(queueIds)}]::uuid[]))
    +(SELECT count(*) FROM public.newsletter_send_operations WHERE campaign_id IN (${quoted(campaigns)}))
    +(SELECT count(*) FROM public.audit_logs WHERE table_name='auth.users' AND record_id IN (${quoted(accounts)}));`), '0', 'all synthetic fixture rows cleaned');
  fixtureOwned = false;
  console.log('Synthetic newsletter fixtures and their claim proofs cleaned.');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  try { cleanup(); }
  catch { console.error('Synthetic newsletter cleanup could not be confirmed after interruption.'); }
  finally { process.exit(1); }
});
try { await main(); }
catch (error) {
  console.error('Newsletter concurrency contract failed; no production access authorized.', {
    failure: error instanceof assert.AssertionError ? error.message : error instanceof Error && error.message.startsWith('fixture ') ? error.message : 'fixture verification failed',
  }); process.exitCode = 1;
} finally { cleanup(); }

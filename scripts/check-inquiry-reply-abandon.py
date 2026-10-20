"""Real PG17 inquiry-reply abandonment guard and races in a disposable database only."""
import json, os, queue, subprocess, sys, threading, time

LOCAL = sys.argv[1:] == ['--local-shadow']
if LOCAL:
    assert os.environ.get('PGHOST', 'localhost') in ('localhost', '127.0.0.1')
    assert not any(os.environ.get(k) for k in ('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR'))
if not LOCAL:
    assert sys.argv[1:] == [] and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('CI') == 'true'
    assert os.environ.get('PGHOST') in ('localhost', '127.0.0.1') and os.environ.get('PGPORT') == '5432' and os.environ.get('PGUSER') == 'postgres'
    assert not any(os.environ.get(k) for k in ('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR'))
DB = 'carelink_shadow_reply_abandon_20261020' if LOCAL else 'carelink_shadow'
ARGS = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', DB]
RESULTS = []

ACTOR = 'fe201020-0000-4000-8000-000000000001'
OTHER = 'fe201020-0000-4000-8000-000000000002'
CONTACT = 'fe201020-0000-4000-8000-000000000011'
REPLY = 'fe201020-0000-4000-8000-000000000021'
NEXT = 'fe201020-0000-4000-8000-000000000022'
INTERNAL = 'fe201020-0000-4000-8000-000000000023'
PROVIDER = 'fe201020-0000-4000-8000-000000000031'
ENVELOPE = json.dumps({'from': 'Synthetic <support@example.invalid>', 'to': 'reply@example.invalid',
                       'replyTo': 'Synthetic <support@example.invalid>', 'subject': 'Synthetic', 'html': '<p>Synthetic</p>'})


def sql(text):
    r = subprocess.run(ARGS, input=text, text=True, capture_output=True, timeout=30)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout.strip()


def attempt(stmt):
    return sql("CREATE FUNCTION pg_temp.reply_try(statement text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE statement; RETURN 'OK'; "
               "EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$; SET ROLE service_role; SELECT pg_temp.reply_try($stmt$" + stmt + "$stmt$)")


class Session:
    def __init__(self):
        self.proc = subprocess.Popen(ARGS, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.lines = queue.Queue(); self.errors = []
        self.output_reader = threading.Thread(target=lambda: [self.lines.put(line.strip()) for line in self.proc.stdout], daemon=True)
        self.error_reader = threading.Thread(target=lambda: self.errors.extend(self.proc.stderr.readlines()), daemon=True)
        self.output_reader.start(); self.error_reader.start()
    def send(self, text):
        self.proc.stdin.write(text + '\n'); self.proc.stdin.flush()
    def mark(self, name):
        output = []
        try:
            self.send('\\echo ' + name)
            while True:
                line = self.lines.get(timeout=15)
                if line == name: return output
                output.append(line)
        except (BrokenPipeError, queue.Empty):
            self.error_reader.join(timeout=1)
            raise RuntimeError('session failed: ' + ''.join(self.errors)) from None
    def end(self, text='COMMIT;'):
        try: self.send(text); self.proc.stdin.close()
        except BrokenPipeError: pass
        code = self.proc.wait(timeout=25)
        self.error_reader.join(timeout=5); self.output_reader.join(timeout=5)
        return code, ''.join(self.errors)


def race(label, first, second, expected):
    a = Session(); b = Session()
    try:
        a.send('BEGIN; SET LOCAL ROLE service_role; ' + first + ';'); first_output = a.mark('held')
        b.send("SET application_name='carelink-reply-abandon-waiter'; SET ROLE service_role; " + second + ';')
        deadline = time.monotonic() + 15; observed = False
        while time.monotonic() < deadline:
            if sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='carelink-reply-abandon-waiter' AND state='active' AND wait_event_type='Lock';") == '1':
                observed = True; break
            time.sleep(0.02)
        assert observed, (label, 'real PostgreSQL waiter must be observed')
        code, error = a.end(); assert code == 0, (label, error)
        output = b.mark('done'); assert output == [expected], (label, output)
        assert b.end()[0] == 0
        RESULTS.append({'case': label, 'actual_lock_waiters': 1, 'second_result': expected, 'first_result': first_output})
    finally:
        for session in (a, b):
            if session.proc.poll() is None:
                try: session.proc.stdin.close()
                except (BrokenPipeError, ValueError): pass
                session.proc.kill(); session.proc.wait(timeout=5)


def reset(age='25 hours'):
    sql(f"DELETE FROM public.contacts WHERE id='{CONTACT}'; "
        f"INSERT INTO auth.users(id,email) VALUES('{ACTOR}','reply-abandon@example.invalid'),('{OTHER}','reply-abandon-other@example.invalid') ON CONFLICT(id) DO NOTHING; "
        f"INSERT INTO public.contacts(id,name,email,inquiry_type,message) VALUES('{CONTACT}','Synthetic','reply@example.invalid','その他','Synthetic'); "
        f"INSERT INTO public.contact_replies(id,contact_id,author_id,body,is_internal,created_at,delivery_envelope) "
        f"VALUES('{REPLY}','{CONTACT}','{ACTOR}','Synthetic body',false,now()-interval '{age}','{ENVELOPE}'::jsonb);")


ABANDON = f"UPDATE public.contact_replies SET delivery_abandoned_at='2000-01-01T00:00:00Z', delivery_abandoned_by='{ACTOR}' WHERE id='{REPLY}'"
GUARDED_ABANDON = ("WITH u AS (UPDATE public.contact_replies SET delivery_abandoned_at=now(), delivery_abandoned_by='" + ACTOR + "' "
                   "WHERE id='" + REPLY + "' AND sent_at IS NULL AND provider_message_id IS NULL AND delivery_abandoned_at IS NULL RETURNING id) SELECT count(*) FROM u")
GUARDED_ACCEPT = ("WITH u AS (UPDATE public.contact_replies SET sent_at=now(), provider_message_id='" + PROVIDER + "' "
                  "WHERE id='" + REPLY + "' AND sent_at IS NULL AND delivery_abandoned_at IS NULL RETURNING id) SELECT count(*) FROM u")


def state():
    return sql(f"SELECT (delivery_abandoned_at IS NOT NULL)::text||','||(sent_at IS NOT NULL)::text FROM public.contact_replies WHERE id='{REPLY}'")


try:
    assert 170000 <= int(sql('SHOW server_version_num')) < 180000
    assert sql("SELECT to_regclass('public.idx_contact_replies_one_pending_external') IS NULL") == 't'

    reset(); assert attempt(ABANDON) == 'OK'
    assert sql(f"SELECT delivery_abandoned_at > now()-interval '1 minute' AND delivery_abandoned_by='{ACTOR}' FROM public.contact_replies WHERE id='{REPLY}'") == 't'
    RESULTS.append({'case': 'abandon after 24h stamps the database clock, not the client value'})

    for label, stmt in [
        ('accept after abandon', f"UPDATE public.contact_replies SET sent_at=now(), provider_message_id='{PROVIDER}' WHERE id='{REPLY}'"),
        ('mark sent after abandon', f"UPDATE public.contact_replies SET sent_at=now() WHERE id='{REPLY}'"),
        ('rewrite abandonment time', f"UPDATE public.contact_replies SET delivery_abandoned_at=now()+interval '1 day' WHERE id='{REPLY}'"),
        ('clear abandonment', f"UPDATE public.contact_replies SET delivery_abandoned_at=NULL, delivery_abandoned_by=NULL WHERE id='{REPLY}'"),
        ('reassign abandonment actor', f"UPDATE public.contact_replies SET delivery_abandoned_by='{OTHER}' WHERE id='{REPLY}'"),
    ]:
        assert attempt(stmt) == '23514', label; assert state() == 'true,false', label
        RESULTS.append({'case': label, 'sqlstate': '23514'})

    abandoned_at = sql(f"SELECT delivery_abandoned_at FROM public.contact_replies WHERE id='{REPLY}'")
    sql(f"DELETE FROM auth.users WHERE id='{ACTOR}'")
    assert sql(f"SELECT delivery_abandoned_by IS NULL AND delivery_abandoned_at='{abandoned_at}' AND sent_at IS NULL FROM public.contact_replies WHERE id='{REPLY}'") == 't'
    RESULTS.append({'case': 'deleting the abandoning operator clears only the actor (ON DELETE SET NULL is not blocked)'})
    sql(f"INSERT INTO auth.users(id,email) VALUES('{ACTOR}','reply-abandon@example.invalid')")

    assert attempt(f"INSERT INTO public.contact_replies(id,contact_id,body,is_internal,delivery_envelope) VALUES('{NEXT}','{CONTACT}','Next',false,'{ENVELOPE}'::jsonb)") == 'OK'
    assert attempt(f"INSERT INTO public.contact_replies(contact_id,body,is_internal,delivery_envelope) VALUES('{CONTACT}','Third',false,'{ENVELOPE}'::jsonb)") == '23505'
    RESULTS.append({'case': 'abandoned row frees the one-open slot; a second open reply is still rejected'})

    reset('23 hours'); assert attempt(ABANDON) == '23514'; assert state() == 'false,false'
    RESULTS.append({'case': 'inside the 24h provider idempotency window', 'sqlstate': '23514'})

    reset(); sql(f"UPDATE public.contact_replies SET sent_at=now(), provider_message_id='{PROVIDER}' WHERE id='{REPLY}'")
    assert attempt(ABANDON) == '23514'; assert state() == 'false,true'
    RESULTS.append({'case': 'accepted reply cannot be abandoned', 'sqlstate': '23514'})

    reset()
    assert attempt(f"UPDATE public.contact_replies SET delivery_abandoned_by='{ACTOR}' WHERE id='{REPLY}'") == '23514'
    assert attempt(f"INSERT INTO public.contact_replies(contact_id,body,is_internal,delivery_abandoned_at) VALUES('{CONTACT}','Born abandoned',true,now())") == '23514'
    sql(f"INSERT INTO public.contact_replies(id,contact_id,body,is_internal,created_at) VALUES('{INTERNAL}','{CONTACT}','Memo',true,now()-interval '25 hours')")
    assert attempt(f"UPDATE public.contact_replies SET delivery_abandoned_at=now() WHERE id='{INTERNAL}'") == '23514'
    RESULTS.append({'case': 'actor without abandonment, created-abandoned and internal memo abandonment rejected'})

    reset(); race('acceptance commits before abandonment', GUARDED_ACCEPT, GUARDED_ABANDON, '0'); assert state() == 'false,true'
    reset(); race('abandonment commits before acceptance', GUARDED_ABANDON, GUARDED_ACCEPT, '0'); assert state() == 'true,false'

    print(json.dumps({'cases': RESULTS, 'actual_lock_waiters': sum(x.get('actual_lock_waiters', 0) for x in RESULTS), 'production_mutations': False}, indent=2))
finally:
    sql(f"DELETE FROM public.contacts WHERE id='{CONTACT}'; DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}');")

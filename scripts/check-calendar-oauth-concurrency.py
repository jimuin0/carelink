"""Real PG17 OAuth cancellation/credential races in a disposable database only."""
import json, os, queue, subprocess, sys, threading, time

LOCAL = sys.argv[1:] == ['--local-shadow']
if not LOCAL:
    assert sys.argv[1:] == [] and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('CI') == 'true'
    assert os.environ.get('PGHOST') in ('localhost', '127.0.0.1') and os.environ.get('PGPORT') == '5432' and os.environ.get('PGUSER') == 'postgres'
    assert not any(os.environ.get(k) for k in ('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR'))
DB = 'carelink_shadow_calendar_20261016' if LOCAL else 'carelink_shadow'
ARGS = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', DB]
ACTOR = 'fc180000-0000-4000-8000-000000000001'
TOKEN = 'fc180001-0000-4000-8000-000000000001'
H = 'a' * 64
H2 = 'b' * 64
RESULTS = []

def sql(text):
    r = subprocess.run(ARGS, input=text, text=True, capture_output=True, timeout=30)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout.strip()

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

def begin(h=H): return f"SET ROLE service_role; SELECT public.begin_google_calendar_oauth('{ACTOR}','{h}');"
def disconnect(): return f"SET ROLE service_role; SELECT public.disconnect_google_calendar('{ACTOR}');"
def save(observed=False, h=H):
    token = f"'{TOKEN}'" if observed else 'NULL'
    revision = "'2026-01-01T00:00:00Z'" if observed else 'NULL'
    return f"SET ROLE service_role; SELECT public.save_google_calendar_oauth('{ACTOR}','{h}',{token},{revision},'candidate-access','candidate-refresh','2099-01-01','calendar');"
def reset(token=False):
    sql(f"DELETE FROM auth.users WHERE id='{ACTOR}'; INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('{ACTOR}','calendar-oauth-fixture@example.invalid',now());")
    if token: sql(f"INSERT INTO public.google_calendar_tokens(id,user_id,access_token,refresh_token,expires_at,updated_at) VALUES('{TOKEN}','{ACTOR}','original-access','original-refresh','2099-01-01','2026-01-01');")
def row():
    return json.loads(sql(f"SELECT coalesce(jsonb_agg(jsonb_build_object('access',access_token,'refresh',refresh_token)), '[]'::jsonb) FROM public.google_calendar_tokens WHERE user_id='{ACTOR}';"))
def race(label, first, second, expected, finish="COMMIT;"):
    a = Session(); b = Session()
    try:
        a.send('BEGIN; ' + first); a.mark('held')
        b.send("SET application_name='carelink-oauth-race-waiter'; " + second)
        deadline = time.monotonic() + 15; observed = False
        while time.monotonic() < deadline:
            if sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='carelink-oauth-race-waiter' AND state='active' AND wait_event_type='Lock';") == '1':
                observed = True; break
            time.sleep(0.02)
        assert observed, 'real PostgreSQL waiter must be observed'
        code, error = a.end(finish); assert code == 0, (label, error)
        output = b.mark('done'); assert output == [expected], (label, output)
        assert b.end()[0] == 0
        RESULTS.append({'case': label, 'actual_lock_waiters': 1, 'second_result': expected})
    finally:
        for session in (a, b):
            if session.proc.poll() is None: session.proc.kill(); session.proc.wait(timeout=5)

assert sql('SELECT current_database();') == DB
assert sql(f"SELECT count(*) FROM auth.users WHERE id='{ACTOR}';") == '0', 'fixture already exists'
try:
    assert sql("SELECT relrowsecurity AND NOT has_table_privilege('anon',oid,'SELECT') AND NOT has_table_privilege('authenticated',oid,'INSERT') FROM pg_class WHERE oid='public.google_calendar_oauth_intents'::regclass;") == 't'
    for signature in ['lock_google_calendar_oauth_actor(uuid)', 'begin_google_calendar_oauth(uuid,text)', 'disconnect_google_calendar(uuid)', 'save_google_calendar_oauth(uuid,text,uuid,timestamptz,text,text,timestamptz,text)']:
        assert sql(f"SELECT has_function_privilege('service_role','public.{signature}','EXECUTE') AND NOT has_function_privilege('anon','public.{signature}','EXECUTE') AND NOT has_function_privilege('authenticated','public.{signature}','EXECUTE');") == 't'
    reset(); assert sql(begin()) == 't'; assert sql(save()) == 't'; assert sql(save()) == 'f'
    assert row() == [{'access': 'candidate-access', 'refresh': 'candidate-refresh'}]
    RESULTS.append({'case': 'complete grant consumed once', 'passed': True})
    reset(); sql(begin()); sql(disconnect()); assert sql(save()) == 'f'; assert row() == []
    RESULTS.append({'case': 'disconnect before callback token read cannot resurrect', 'passed': True})
    reset(); sql(begin()); sql(f"UPDATE public.google_calendar_oauth_intents SET expires_at=now()-interval '1 second' WHERE user_id='{ACTOR}';")
    assert sql(save()) == 'f'; assert row() == []
    RESULTS.append({'case': 'expired attempt cannot save', 'passed': True})
    reset(); assert sql(save()) == 'f'
    RESULTS.append({'case': 'legacy/unregistered attempt cannot save', 'passed': True})
    reset(); sql(begin()); race('disconnect wins over in-flight first callback', disconnect(), save(), 'f'); assert row() == []
    reset(); sql(begin()); race('disconnect after callback removes saved connection', save(), disconnect(), 't'); assert row() == []
    reset(); sql(begin()); race('newer authorization invalidates older callback', begin(H2), save(), 'f'); assert row() == []; assert sql(save(h=H2)) == 't'
    reset(); sql(begin()); race('simultaneous first callbacks save only once', save(), save(), 'f'); assert len(row()) == 1
    reset(True); sql(begin())
    race('refresh before callback preserves newer credentials', f"UPDATE public.google_calendar_tokens SET access_token='latest-access',refresh_token='latest-refresh',updated_at='2026-02-01' WHERE user_id='{ACTOR}';", save(True), 'f')
    assert row() == [{'access': 'latest-access', 'refresh': 'latest-refresh'}]
    reset(True); sql(begin()); sql(f"DELETE FROM public.google_calendar_tokens WHERE user_id='{ACTOR}';")
    assert sql(save(True)) == 'f'; assert row() == []
    RESULTS.append({'case': 'missing observed token is not recreated', 'passed': True})
    for isolation in ['REPEATABLE READ', 'SERIALIZABLE']:
        reset(); sql(begin()); stale = Session()
        try:
            stale.send(f'BEGIN ISOLATION LEVEL {isolation}; SELECT 1 FROM public.google_calendar_oauth_intents;'); stale.mark('snapshot')
            sql(disconnect())
            code, error = stale.end(save())
            assert code != 0 and '40001' in error, (isolation, error)
            assert row() == []
            RESULTS.append({'case': isolation + ' stale cancellation snapshot aborts', 'sqlstate': '40001'})
        finally:
            if stale.proc.poll() is None: stale.proc.kill(); stale.proc.wait(timeout=5)
    reset(); sql(begin()); race('account retirement after save removes intent and token', save(), f"DELETE FROM auth.users WHERE id='{ACTOR}'; SELECT true;", 't'); assert row() == []
    reset(); sql(begin()); race('account retirement before save blocks revival', f"DELETE FROM auth.users WHERE id='{ACTOR}';", save(), 'f'); assert row() == []
    for operation, statement in [('save', save(True)), ('disconnect', disconnect()), ('begin', begin(H2))]:
        reset(True); sql(begin())
        race('connected account retirement after ' + operation, statement, f"DELETE FROM auth.users WHERE id='{ACTOR}'; SELECT true;", 't')
        assert row() == []
        reset(True); sql(begin())
        race('connected account retirement before ' + operation, f"DELETE FROM auth.users WHERE id='{ACTOR}';", statement, 'f')
        assert row() == []
    for operation, statement in [('save', save(True)), ('disconnect', disconnect()), ('begin', begin(H2))]:
        reset(True); sql(begin())
        race('retirement split token/intent cleanup versus ' + operation,
             f"SELECT 1 FROM auth.users WHERE id='{ACTOR}' FOR UPDATE; DELETE FROM public.google_calendar_tokens WHERE user_id='{ACTOR}';",
             statement, 'f', f"DELETE FROM auth.users WHERE id='{ACTOR}'; COMMIT;")
        assert row() == []
    print(json.dumps({'database': DB, 'cases': RESULTS, 'production_or_provider_traffic': False}, indent=2))
finally:
    sql(f"DELETE FROM auth.users WHERE id='{ACTOR}';")
    assert sql(f"SELECT count(*) FROM public.google_calendar_oauth_intents WHERE user_id='{ACTOR}';") == '0'

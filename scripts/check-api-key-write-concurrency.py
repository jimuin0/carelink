"""Real PG17 API-key authority races in a disposable database only."""
import json, os, queue, subprocess, sys, threading, time

LOCAL = sys.argv[1:] == ['--local-shadow']
if not LOCAL:
    assert sys.argv[1:] == [] and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('CI') == 'true'
    assert os.environ.get('PGHOST') in ('localhost', '127.0.0.1') and os.environ.get('PGPORT') == '5432' and os.environ.get('PGUSER') == 'postgres'
    assert not any(os.environ.get(k) for k in ('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR'))
DB = 'carelink_shadow_content_write_20261017' if LOCAL else 'carelink_shadow'
ARGS = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', DB]
ACTOR = 'fa7e0000-0000-4000-8000-000000000001'
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

def race(label, first, second, expected, finish="COMMIT;"):
    a = Session(); b = Session()
    try:
        a.send('BEGIN; ' + first + ';'); a.mark('held')
        b.send("SET application_name='carelink-api-key-write-waiter'; " + second + ';')
        deadline = time.monotonic() + 15; observed = False
        while time.monotonic() < deadline:
            if sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='carelink-api-key-write-waiter' AND state='active' AND wait_event_type='Lock';") == '1':
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

FACILITY='fa7e0001-0000-4000-8000-000000000001'
OTHER_FACILITY='fa7e0001-0000-4000-8000-000000000002'
KEY='fa7e0002-0000-4000-8000-000000000001'
FOREIGN_KEY='fa7e0002-0000-4000-8000-000000000002'
OTHER='fa7e0000-0000-4000-8000-000000000002'
def quoted(x): return 'NULL' if x is None else "'"+str(x).replace("'","''")+"'"
VALUES={'name':'Synthetic','key_hash':'b'*64,'key_prefix':'ck_live_bbbbbbbb','scopes':['bookings:read']}
def save(action='create',values=None,actor=ACTOR,key=None,facility=FACILITY):
    if values is None: values=VALUES if action=='create' else {}
    if action=='revoke' and key is None: key=KEY
    return f"SELECT public.manage_facility_api_key_atomic('{actor}','{facility}',{quoted(key)},'{action}',{quoted(json.dumps(values))}::jsonb)"
def attempt(statement):
    return "CREATE FUNCTION pg_temp.key_try(statement text) RETURNS text LANGUAGE plpgsql AS $try$ BEGIN EXECUTE statement; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $try$; SET ROLE service_role; SELECT pg_temp.key_try("+quoted(statement)+");"
def cleanup():
    sql(f"DELETE FROM public.facility_profiles WHERE id IN ('{FACILITY}','{OTHER_FACILITY}'); DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}');")
def reset():
    cleanup()
    sql(f"INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('{ACTOR}','key-write@example.invalid',now()),('{OTHER}','key-other@example.invalid',now()); INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES('{FACILITY}','Synthetic key','synthetic-key-write','Other','P','C','A','draft'),('{OTHER_FACILITY}','Other key','synthetic-key-other','Other','P','C','A','draft'); INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('{ACTOR}','{FACILITY}','owner'),('{OTHER}','{OTHER_FACILITY}','owner'); INSERT INTO public.api_keys(id,facility_id,name,key_hash,key_prefix,scopes,created_by) VALUES('{KEY}','{FACILITY}','Original',repeat('a',64),'ck_live_aaaaaaaa',ARRAY['bookings:read'],'{ACTOR}'),('{FOREIGN_KEY}','{OTHER_FACILITY}','Foreign',repeat('c',64),'ck_live_cccccccc',ARRAY['bookings:read'],'{OTHER}');")
def snapshot():
    return json.loads(sql(f"SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM public.api_keys c WHERE facility_id='{FACILITY}'"))
def expect(label,statement,expected):
    actual=sql(attempt(statement));assert actual==expected,(label,actual)
    RESULTS.append({'case':label,'result':actual})
assert sql('SELECT current_database()')==DB
assert sql(f"SELECT count(*) FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}')")=='0'
try:
    reset()
    sig='public.manage_facility_api_key_atomic(uuid,uuid,uuid,text,jsonb)'
    assert sql(f"SELECT has_function_privilege('service_role','{sig}','EXECUTE') AND NOT has_function_privilege('anon','{sig}','EXECUTE') AND NOT has_function_privilege('authenticated','{sig}','EXECUTE')")=='t'
    assert sql("SELECT NOT has_table_privilege('authenticated','public.api_keys','INSERT') AND NOT has_table_privilege('authenticated','public.api_keys','UPDATE') AND NOT has_table_privilege('authenticated','public.api_keys','DELETE') AND NOT has_table_privilege('authenticated','public.api_keys','TRUNCATE') AND NOT has_table_privilege('anon','public.api_keys','SELECT') AND has_table_privilege('authenticated','public.api_keys','SELECT')")=='t'
    # The fingerprint shadow bootstraps auth.uid() as NULL. Emulate verified JWT
    # subject ONLY inside this rolled-back fixture transaction, never in production.
    for role in ('owner','admin','staff'):
        for operation in ("INSERT INTO public.api_keys(facility_id,name,key_hash,key_prefix,scopes) VALUES('"+FACILITY+"','Direct',repeat('d',64),'ck_live_dddddddd',ARRAY['bookings:read'])",f"UPDATE public.api_keys SET is_active=true WHERE id='{KEY}'",f"DELETE FROM public.api_keys WHERE id='{KEY}'"):
            query=f"BEGIN; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; UPDATE public.facility_members SET role='{role}' WHERE user_id='{ACTOR}'; SELECT set_config('request.jwt.claim.sub','{ACTOR}',true); CREATE FUNCTION pg_temp.key_try(statement text) RETURNS text LANGUAGE plpgsql AS $try$ BEGIN EXECUTE statement; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $try$; SET LOCAL ROLE authenticated; SELECT pg_temp.key_try({quoted(operation)}); SELECT count(*) FROM public.api_keys WHERE facility_id='{FACILITY}'; ROLLBACK;"
            output=sql(query).splitlines();assert output[-2]=='42501' and output[-1]==('1' if role in ('owner','admin') else '0'),output
            RESULTS.append({'case':role+' direct '+operation.split()[0]+' denied, metadata visibility preserved','result':'42501'})
    receipt=json.loads(sql('SET ROLE service_role; '+save()))
    assert receipt['is_active'] and 'key_hash' not in receipt and 'created_by' not in receipt
    assert snapshot()[-1] or receipt
    RESULTS.append({'case':'owner create, bounded non-secret receipt','result':'OK'})
    reset();expect('owner revoke',save('revoke'),'OK');expect('repeat revoke idempotent',save('revoke'),'OK');assert snapshot()[0]['is_active'] is False
    reset();sql(f"UPDATE public.facility_members SET role='admin' WHERE user_id='{ACTOR}'")
    expect('admin cannot issue',save(),'42501');expect('admin can revoke',save('revoke'),'OK')
    for action in ('create','revoke'):
        for revoke in ('DELETE','STAFF','ADMIN') if action=='create' else ('DELETE','STAFF'):
            reset()
            command=f"DELETE FROM public.facility_members WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}'" if revoke=='DELETE' else f"UPDATE public.facility_members SET role='{revoke.lower()}' WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}'"
            before=snapshot();race(action+' revocation first '+revoke,command,attempt(save(action)),'42501');assert snapshot()==before
            reset();race(action+' write first '+revoke,'SET LOCAL ROLE service_role; '+save(action),attempt(command),'OK')
    reset()
    for label,statement,code in [
      ('foreign actor',save(actor=OTHER),'42501'),('foreign key',save('revoke',key=FOREIGN_KEY),'P0002'),
      ('missing key',save('revoke',key=OTHER),'P0002'),('foreign facility',save(facility=OTHER_FACILITY),'42501'),
      ('forged identity',save(values={**VALUES,'created_by':OTHER}),'22023'),('forged active',save(values={**VALUES,'is_active':False}),'22023'),
      ('create with ID',save(key=KEY),'22023'),('revoke with values',save('revoke',VALUES),'22023'),('invalid action',save('delete'),'22023'),
    ]:
        before=snapshot();expect(label,statement,code);assert snapshot()==before
    for field,invalid in [('name',None),('name',' '),('name','x'*101),('key_hash','bad'),('key_prefix','bad'),('scopes',None),('scopes',{}),('scopes',[]),('scopes',['*']),('scopes',[{}]),('scopes',['bookings:read']*2),('scopes',['bookings:read']*4)]:
        before=snapshot();expect('invalid '+field+' '+str(invalid)[:20],save(values={**VALUES,field:invalid}),'22023');assert snapshot()==before
    sql("CREATE FUNCTION public.synthetic_key_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure' USING ERRCODE='23514'; END $$; CREATE TRIGGER synthetic_key_failure AFTER UPDATE ON public.api_keys FOR EACH ROW EXECUTE FUNCTION public.synthetic_key_failure();")
    try:
        before=snapshot();expect('revoke trigger rollback',save('revoke'),'23514');assert snapshot()==before
    finally: sql('DROP TRIGGER synthetic_key_failure ON public.api_keys; DROP FUNCTION public.synthetic_key_failure();')
    print(json.dumps({'postgres':sql('SHOW server_version'),'cases':RESULTS,'case_count':len(RESULTS),'actual_lock_waiters':sum(r.get('actual_lock_waiters',0) for r in RESULTS)},indent=2))
finally: cleanup()

"""Real PG17 facility integration authority races in a disposable database only."""
import json, os, queue, subprocess, sys, threading, time

LOCAL = sys.argv[1:] == ['--local-shadow']
if not LOCAL:
    assert sys.argv[1:] == [] and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('CI') == 'true'
    assert os.environ.get('PGHOST') in ('localhost', '127.0.0.1') and os.environ.get('PGPORT') == '5432' and os.environ.get('PGUSER') == 'postgres'
    assert not any(os.environ.get(k) for k in ('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR'))
DB = 'carelink_shadow_content_write_20261017' if LOCAL else 'carelink_shadow'
ARGS = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', DB]
ACTOR = 'fa810000-0000-4000-8000-000000000001'
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
        b.send("SET application_name='carelink-integration-write-waiter'; " + second + ';')
        deadline = time.monotonic() + 15; observed = False
        while time.monotonic() < deadline:
            if sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='carelink-integration-write-waiter' AND state='active' AND wait_event_type='Lock';") == '1':
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

FACILITY='fa810001-0000-4000-8000-000000000001'
OTHER='fa810000-0000-4000-8000-000000000002'
OTHER_FACILITY='fa810001-0000-4000-8000-000000000002'
TOKEN='carelink-verify='+'a'*32
VALUES={'gbp:connect':{'place_id':'NewPlace','cid':'123'},'gbp:refresh':{'rating':5,'review_count':20,'score':80,'details':{'synthetic':True}},'domain:configure':{'domain':'new.example.invalid','brand_name':'New','primary_color':'#123456','logo_url':None,'txt_record':'carelink-verify='+'b'*32},'domain:verify':{}}
EXPECTED={'gbp:connect':{},'gbp:refresh':{'place_id':'OldPlace'},'domain:configure':{},'domain:verify':{'domain':'old.example.invalid','txt_record':TOKEN}}
def quoted(x):return "'"+str(x).replace("'","''")+"'"
def save(kind='gbp:refresh',values=None,expected=None,actor=ACTOR,facility=FACILITY):
    if values is None:values=VALUES[kind]
    if expected is None:expected=EXPECTED[kind]
    return f"SELECT public.save_admin_facility_integration_atomic('{actor}','{facility}',{quoted(kind)},{quoted(json.dumps(expected))}::jsonb,{quoted(json.dumps(values))}::jsonb)"
def attempt(statement):return "CREATE FUNCTION pg_temp.integration_try(statement text) RETURNS text LANGUAGE plpgsql AS $try$ BEGIN EXECUTE statement; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $try$; SET ROLE service_role; SELECT pg_temp.integration_try("+quoted(statement)+");"
def cleanup():sql(f"DELETE FROM public.facility_profiles WHERE id IN ('{FACILITY}','{OTHER_FACILITY}'); DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}');")
def reset():
    cleanup()
    sql(f"INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('{ACTOR}','integration-write@example.invalid',now()),('{OTHER}','integration-other@example.invalid',now()); INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status,gbp_place_id,google_rating,google_review_count) VALUES('{FACILITY}','Synthetic integration','synthetic-integration-write','Other','P','C','A','draft','OldPlace',2,4); INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('{ACTOR}','{FACILITY}','owner'); INSERT INTO public.white_label_domains(facility_id,domain,brand_name,primary_color,txt_record) VALUES('{FACILITY}','old.example.invalid','Original','#123456','{TOKEN}'); INSERT INTO public.gbp_audit_cache(facility_id,score,details) VALUES('{FACILITY}',10,jsonb_build_object('old',true));")
def snapshot():return json.loads(sql(f"SELECT jsonb_build_object('profile',(SELECT jsonb_build_object('place',gbp_place_id,'cid',gbp_cid,'connected',gbp_connected_at,'rating',google_rating,'count',google_review_count) FROM public.facility_profiles WHERE id='{FACILITY}'),'domain',(SELECT to_jsonb(d) FROM public.white_label_domains d WHERE facility_id='{FACILITY}'),'cache',(SELECT to_jsonb(c) FROM public.gbp_audit_cache c WHERE facility_id='{FACILITY}'))"))
def expect(label,statement,code):
    actual=sql(attempt(statement));assert actual==code,(label,actual);RESULTS.append({'case':label,'result':actual})
assert sql('SELECT current_database()')==DB
assert sql(f"SELECT count(*) FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}')")=='0'
try:
    reset()
    sig='public.save_admin_facility_integration_atomic(uuid,uuid,text,jsonb,jsonb)'
    assert sql(f"SELECT has_function_privilege('service_role','{sig}','EXECUTE') AND NOT has_function_privilege('anon','{sig}','EXECUTE') AND NOT has_function_privilege('authenticated','{sig}','EXECUTE')")=='t'
    for table in ('white_label_domains','gbp_audit_cache'):
        for privilege in ('INSERT','UPDATE','DELETE','TRUNCATE'):
            assert sql(f"SELECT NOT has_table_privilege('anon','public.{table}','{privilege}') AND NOT has_table_privilege('authenticated','public.{table}','{privilege}')")=='t'
        # Owner metadata stays readable; direct verification/cache forging is denied.
        output=sql(f"BEGIN; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; SELECT set_config('request.jwt.claim.sub','{ACTOR}',true); CREATE FUNCTION pg_temp.integration_try(statement text) RETURNS text LANGUAGE plpgsql AS $try$ BEGIN EXECUTE statement; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $try$; SET LOCAL ROLE authenticated; SELECT count(*) FROM public.{table}; SELECT pg_temp.integration_try({quoted('UPDATE public.'+table+' SET '+('is_verified=true' if table=='white_label_domains' else 'score=999'))}); ROLLBACK;").splitlines()
        assert output[-2:]==['1','42501'],output;RESULTS.append({'case':table+' direct write denied, read preserved','result':'42501'})
    for kind in VALUES:
        reset();expect(kind+' owner succeeds',save(kind),'OK')
        for revoke in ('DELETE','STAFF'):
            reset();command=f"DELETE FROM public.facility_members WHERE user_id='{ACTOR}'" if revoke=='DELETE' else f"UPDATE public.facility_members SET role='staff' WHERE user_id='{ACTOR}'"
            before=snapshot();race(kind+' revoke first '+revoke,command,attempt(save(kind)),'42501');assert snapshot()==before
            reset();race(kind+' write first '+revoke,'SET LOCAL ROLE service_role; '+save(kind),attempt(command),'OK')
    for kind in VALUES:
        reset()
        race(kind+' current-role save while revoker holds parent FK lock',f"SELECT 1 FROM public.facility_members WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}' FOR SHARE",attempt(f"SELECT 1 FROM public.facility_profiles WHERE id='{FACILITY}' FOR KEY SHARE; UPDATE public.facility_members SET role='staff' WHERE user_id='{ACTOR}'"),'OK',finish='SET LOCAL ROLE service_role; '+save(kind)+'; COMMIT;')
    reset();race('place changes before old response','SET LOCAL ROLE service_role; '+save('gbp:connect'),attempt(save()),'40001');data=snapshot();assert data['profile']['place']=='NewPlace' and data['profile']['rating'] is None and data['profile']['count']==0 and data['cache'] is None
    reset();race('old response finishes before place replacement','SET LOCAL ROLE service_role; '+save(),attempt(save('gbp:connect')),'OK');assert snapshot()['cache'] is None and snapshot()['profile']['rating'] is None
    reset();race('domain changes before old DNS proof','SET LOCAL ROLE service_role; '+save('domain:configure'),attempt(save('domain:verify')),'40001');assert snapshot()['domain']['is_verified'] is False and snapshot()['domain']['verified_at'] is None
    reset();race('old DNS proof finishes before domain replacement','SET LOCAL ROLE service_role; '+save('domain:verify'),attempt(save('domain:configure')),'OK');assert snapshot()['domain']['is_verified'] is False and snapshot()['domain']['verified_at'] is None
    reset();expect('same place refresh accepted',save(),'OK');assert snapshot()['profile']['rating']==5 and snapshot()['cache']['score']==80
    # Fail the second table write after the profile update: both roll back.
    sql("CREATE FUNCTION public.synthetic_integration_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure' USING ERRCODE='23514'; END $$; CREATE TRIGGER synthetic_integration_failure BEFORE UPDATE OR DELETE ON public.gbp_audit_cache FOR EACH ROW EXECUTE FUNCTION public.synthetic_integration_failure();")
    try:
        before=snapshot();expect('cache failure rolls back public rating',save(values={**VALUES['gbp:refresh'],'rating':1}),'23514');assert snapshot()==before
        before=snapshot();expect('connection replacement rolls back if cache deletion fails',save('gbp:connect'),'23514');assert snapshot()==before
    finally:sql('DROP TRIGGER synthetic_integration_failure ON public.gbp_audit_cache; DROP FUNCTION public.synthetic_integration_failure();')
    reset()
    for kind in VALUES:before=snapshot();expect(kind+' foreign actor denied',save(kind,actor=OTHER),'42501');assert snapshot()==before
    for kind,values,expected,code in [
      ('gbp:connect',{'place_id':{},'cid':None},{},'22023'),('gbp:connect',{'place_id':'x','cid':'x','is_verified':True},{},'22023'),
      ('gbp:refresh',{**VALUES['gbp:refresh'],'review_count':0.5},EXPECTED['gbp:refresh'],'22023'),('gbp:refresh',{**VALUES['gbp:refresh'],'rating':6},EXPECTED['gbp:refresh'],'22023'),
      ('gbp:refresh',VALUES['gbp:refresh'],{'place_id':'OtherPlace'},'40001'),
      ('domain:configure',{**VALUES['domain:configure'],'is_verified':True},{},'22023'),('domain:configure',{**VALUES['domain:configure'],'domain':'bad..example.invalid'},{},'22023'),
      ('domain:verify',{}, {'domain':'old.example.invalid','txt_record':'bad'},'40001')]:
        before=snapshot();expect('invalid '+kind+' '+str(values)[:35],save(kind,values,expected),code);assert snapshot()==before
    reset();expect('300-character place identifier',save('gbp:connect',{'place_id':'a'*300,'cid':None}),'OK')
    reset();before=snapshot();expect('301-character place identifier rejected',save('gbp:connect',{'place_id':'a'*301,'cid':None}),'22023');assert snapshot()==before
    expect('498-character logo URL accepted',save('domain:configure',{**VALUES['domain:configure'],'logo_url':'https://'+'a'*490}),'OK')
    before=snapshot();expect('499-character logo URL rejected',save('domain:configure',{**VALUES['domain:configure'],'logo_url':'https://'+'a'*491}),'22023');assert snapshot()==before
    reset();sql(f"INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES('{OTHER_FACILITY}','Other synthetic integration','synthetic-integration-other','Other','P','C','A','draft'); INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('{OTHER}','{OTHER_FACILITY}','owner'); INSERT INTO public.white_label_domains(facility_id,domain,txt_record) VALUES('{OTHER_FACILITY}','new.example.invalid','{TOKEN}');")
    before=snapshot();expect('domain already belongs to another facility',save('domain:configure'),'23505');assert snapshot()==before
    reset();sql(f"DELETE FROM public.white_label_domains WHERE facility_id='{FACILITY}'");expect('missing domain cannot verify',save('domain:verify'),'P0002')
    reset();expect('unknown operation denied',save('unknown',{},{}),'22023')
    reset();expect('domain configuration upsert repeats without 42P10',save('domain:configure'),'OK');expect('domain configuration second update same row',save('domain:configure'),'OK');assert sql(f"SELECT count(*) FROM public.white_label_domains WHERE facility_id='{FACILITY}'")=='1'
    for kind in VALUES:
        reset();sql(f"UPDATE public.facility_members SET role='admin' WHERE user_id='{ACTOR}'");expect(kind+' admin succeeds',save(kind),'OK')
    print(json.dumps({'postgres':sql('SHOW server_version'),'cases':RESULTS,'case_count':len(RESULTS),'actual_lock_waiters':sum(x.get('actual_lock_waiters',0) for x in RESULTS)},indent=2))
finally:cleanup()

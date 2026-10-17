"""Real PG17 staff profile/assignment races in a disposable database only."""
import json, os, queue, subprocess, sys, threading, time

LOCAL = sys.argv[1:] == ['--local-shadow']
if not LOCAL:
    assert sys.argv[1:] == [] and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('CI') == 'true'
    assert os.environ.get('PGHOST') in ('localhost', '127.0.0.1') and os.environ.get('PGPORT') == '5432' and os.environ.get('PGUSER') == 'postgres'
    assert not any(os.environ.get(k) for k in ('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR'))
DB = 'carelink_shadow_staff_write_20261017' if LOCAL else 'carelink_shadow'
ARGS = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', DB]
ACTOR = 'fa7b0000-0000-4000-8000-000000000001'
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
        b.send("SET application_name='carelink-staff-write-waiter'; " + second + ';')
        deadline = time.monotonic() + 15; observed = False
        while time.monotonic() < deadline:
            if sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='carelink-staff-write-waiter' AND state='active' AND wait_event_type='Lock';") == '1':
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

FACILITY='fa7b0001-0000-4000-8000-000000000001'
OTHER_FACILITY='fa7b0001-0000-4000-8000-000000000002'
STAFF='fa7b0002-0000-4000-8000-000000000001'
OTHER_STAFF='fa7b0002-0000-4000-8000-000000000002'
MENU='fa7b0003-0000-4000-8000-000000000001'
MENU2='fa7b0003-0000-4000-8000-000000000002'
FOREIGN_MENU='fa7b0003-0000-4000-8000-000000000003'
OTHER='fa7b0000-0000-4000-8000-000000000002'
def quoted(x): return 'NULL' if x is None else "'"+str(x).replace("'","''")+"'"
def save(values=None,menus=None,actor=ACTOR,staff=STAFF):
    ids='NULL' if menus is None else 'ARRAY['+','.join(quoted(m) for m in menus)+']::uuid[]'
    return f"SELECT public.save_admin_staff_atomic('{actor}','{FACILITY}','{staff}',{quoted(json.dumps({'name':'Changed'} if values is None else values))}::jsonb,{ids})"
def attempt(statement):
    return "CREATE FUNCTION pg_temp.staff_try(statement text) RETURNS text LANGUAGE plpgsql AS $try$ BEGIN EXECUTE statement; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $try$; SET ROLE service_role; SELECT pg_temp.staff_try("+quoted(statement)+");"
def reset():
    sql(f"DELETE FROM public.facility_profiles WHERE id IN ('{FACILITY}','{OTHER_FACILITY}'); DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}');")
    sql(f"INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('{ACTOR}','staff-write@example.invalid',now()),('{OTHER}','staff-other@example.invalid',now()); INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES('{FACILITY}','Synthetic staff write','synthetic-staff-write','Other','P','C','A','draft'),('{OTHER_FACILITY}','Other synthetic','synthetic-staff-write-other','Other','P','C','A','draft'); INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('{ACTOR}','{FACILITY}','owner'),('{OTHER}','{OTHER_FACILITY}','owner'); INSERT INTO public.staff_profiles(id,facility_id,name,slug,is_active) VALUES('{STAFF}','{FACILITY}','Original','synthetic-staff-write',false),('{OTHER_STAFF}','{OTHER_FACILITY}','Foreign','synthetic-staff-write-other',true); INSERT INTO public.facility_menus(id,facility_id,category,name) VALUES('{MENU}','{FACILITY}','Cut','A'),('{MENU2}','{FACILITY}','Cut','B'),('{FOREIGN_MENU}','{OTHER_FACILITY}','Cut','Foreign'); INSERT INTO public.menu_staff(menu_id,staff_id) VALUES('{MENU}','{STAFF}');")
def snapshot():
    return json.loads(sql(f"SELECT jsonb_build_object('profile',(SELECT to_jsonb(s) FROM public.staff_profiles s WHERE id='{STAFF}'),'menus',(SELECT coalesce(jsonb_agg(menu_id ORDER BY menu_id),'[]') FROM public.menu_staff WHERE staff_id='{STAFF}'))"))
def expect(label,statement,expected):
    assert sql(attempt(statement))==expected,label
    RESULTS.append({'case':label,'result':expected})
assert sql('SELECT current_database()')==DB
assert sql(f"SELECT count(*) FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}')")=='0'
try:
    reset()
    sig='public.save_admin_staff_atomic(uuid,uuid,uuid,jsonb,uuid[])'
    assert sql(f"SELECT has_function_privilege('service_role','{sig}','EXECUTE') AND NOT has_function_privilege('anon','{sig}','EXECUTE') AND NOT has_function_privilege('authenticated','{sig}','EXECUTE')")=='t'
    expect('omitted assignments and paused state preserved',save(),'OK');state=snapshot();assert state['menus']==[MENU] and state['profile']['is_active'] is False
    expect('clear assignments atomic',save(menus=[]),'OK');assert snapshot()['menus']==[]
    expect('replace assignments atomic',save(menus=[MENU2]),'OK');assert snapshot()['menus']==[MENU2]
    for label,statement,code in [
      ('duplicate IDs rejected without partial save',save(menus=[MENU,MENU]),'22023'),
      ('foreign menu rejected',save(menus=[FOREIGN_MENU]),'22023'),
      ('missing menu rejected',save(menus=[OTHER]),'22023'),
      ('null menu element rejected',save(menus=[None]),'22023'),
      ('foreign staff rejected',save(staff=OTHER_STAFF),'P0002'),
      ('foreign actor rejected',save(actor=OTHER),'42501'),
      ('scope mass assignment rejected',save(values={'name':'Changed','facility_id':OTHER_FACILITY}),'22023'),
      ('empty mutation rejected',save(values={}),'22023'),
      ('empty name rejected',save(values={'name':''}),'22023'),
    ]:
        before=snapshot();expect(label,statement,code);assert snapshot()==before,label
    sql(f"UPDATE public.facility_members SET role='staff' WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}'");before=snapshot();expect('staff role forbidden',save(),'42501');assert snapshot()==before
    reset()
    # Actual failure after profile update and deletion must roll back both.
    sql("CREATE FUNCTION public.synthetic_staff_insert_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic insert failure' USING ERRCODE='23514'; END $$; CREATE TRIGGER synthetic_staff_insert_failure BEFORE INSERT ON public.menu_staff FOR EACH ROW EXECUTE FUNCTION public.synthetic_staff_insert_failure();")
    try:
        before=snapshot();expect('assignment insert failure rolls back profile and old links',save(menus=[MENU2]),'23514');assert snapshot()==before
    finally: sql('DROP TRIGGER synthetic_staff_insert_failure ON public.menu_staff; DROP FUNCTION public.synthetic_staff_insert_failure();')
    for action in [f"DELETE FROM public.facility_members WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}'",f"UPDATE public.facility_members SET role='staff' WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}'"]:
        reset();before=snapshot();race('revocation first denies atomic save',action,attempt(save(menus=[MENU2])),'42501');assert snapshot()==before
        reset();race('save first holds authority until commit','SET LOCAL ROLE service_role; '+save(menus=[MENU2]),attempt(action),'OK');assert snapshot()['menus']==[MENU2]
    reset();before=snapshot()
    race('member locked first, staff holds parent before revoke trigger',f"SELECT user_id FROM public.facility_members WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}' FOR UPDATE",attempt(save(menus=[MENU2])),'42501',finish=f"DELETE FROM public.facility_members WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}'; COMMIT;")
    assert snapshot()==before
    reset();race('menu deletion first rejects whole save',f"DELETE FROM public.facility_menus WHERE id='{MENU2}'",attempt(save(menus=[MENU2])),'22023');assert snapshot()['profile']['name']=='Original' and snapshot()['menus']==[MENU]
    reset();race('save first holds menu scope until commit','SET LOCAL ROLE service_role; '+save(menus=[MENU2]),attempt(f"UPDATE public.facility_menus SET facility_id='{OTHER_FACILITY}' WHERE id='{MENU2}'"),'OK')
    # Last serialized edit wins as a complete profile+assignment pair, never mixed.
    reset();race('two edits serialize without mixed profile/links','SET LOCAL ROLE service_role; '+save({'name':'First'},[MENU2]),attempt(save({'name':'Second'},[MENU])),'OK');state=snapshot();assert state['profile']['name']=='Second' and state['menus']==[MENU]
    reset();sql(f"UPDATE public.facility_members SET role='admin' WHERE user_id='{ACTOR}'");expect('admin can edit active state',save({'name':'Admin','is_active':True}),'OK');assert snapshot()['profile']['is_active'] is True
    print(json.dumps({'postgres':sql('SHOW server_version'),'cases':RESULTS,'case_count':len(RESULTS),'actual_lock_waiters':sum(r.get('actual_lock_waiters',0) for r in RESULTS)},indent=2))
finally:
    sql(f"DELETE FROM public.facility_profiles WHERE id IN ('{FACILITY}','{OTHER_FACILITY}'); DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}');")

"""Real PG17 menu authority/photo/revision races in a disposable database only."""
import json, os, queue, subprocess, sys, threading, time

LOCAL = sys.argv[1:] == ['--local-shadow']
if not LOCAL:
    assert sys.argv[1:] == [] and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('CI') == 'true'
    assert os.environ.get('PGHOST') in ('localhost', '127.0.0.1') and os.environ.get('PGPORT') == '5432' and os.environ.get('PGUSER') == 'postgres'
    assert not any(os.environ.get(k) for k in ('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR'))
DB = 'carelink_shadow_menu_write_20261017' if LOCAL else 'carelink_shadow'
ARGS = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', DB]
ACTOR = 'fa790000-0000-4000-8000-000000000001'
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
        a.send('BEGIN; ' + first); a.mark('held')
        b.send("SET application_name='carelink-menu-write-waiter'; " + second)
        deadline = time.monotonic() + 15; observed = False
        while time.monotonic() < deadline:
            if sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='carelink-menu-write-waiter' AND state='active' AND wait_event_type='Lock';") == '1':
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

FACILITY='fa790001-0000-4000-8000-000000000001'
OTHER_FACILITY='fa790001-0000-4000-8000-000000000002'
MENU='fa790002-0000-4000-8000-000000000001'
MENU2='fa790002-0000-4000-8000-000000000002'
FOREIGN_MENU='fa790002-0000-4000-8000-000000000003'
OTHER='fa790000-0000-4000-8000-000000000002'
PHOTO='https://images.unsplash.com/existing'
def quoted(x): return 'NULL' if x is None else "'"+str(x).replace("'","''")+"'"
def save(menu=MENU,values=None,actor=ACTOR,check=False,photo=None):
    return f"SELECT public.save_admin_menu_atomic('{actor}','{FACILITY}',{quoted(menu)},{quoted(json.dumps(values or {'price':200}))}::jsonb,{str(check).lower()},{quoted(photo)})"
def attempt(statement):
    return "CREATE FUNCTION pg_temp.menu_try(statement text) RETURNS text LANGUAGE plpgsql AS $try$ BEGIN EXECUTE statement; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $try$; SET ROLE service_role; SELECT pg_temp.menu_try("+quoted(statement)+");"
def reset():
    sql(f"DELETE FROM public.facility_profiles WHERE id IN ('{FACILITY}','{OTHER_FACILITY}'); DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}');")
    sql(f"INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('{ACTOR}','menu-write@example.invalid',now()),('{OTHER}','menu-other@example.invalid',now()); INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES('{FACILITY}','Synthetic menu write','synthetic-menu-write','Other','P','C','A','draft'),('{OTHER_FACILITY}','Other synthetic','synthetic-menu-write-other','Other','P','C','A','draft'); INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('{ACTOR}','{FACILITY}','owner'),('{OTHER}','{OTHER_FACILITY}','owner'); INSERT INTO public.facility_menus(id,facility_id,category,name,price,photo_url,is_featured,sort_order) VALUES('{MENU}','{FACILITY}','Cut','Original',100,'{PHOTO}',true,0),('{MENU2}','{FACILITY}','Cut','Second',200,NULL,false,1),('{FOREIGN_MENU}','{OTHER_FACILITY}','Cut','Foreign',300,NULL,false,0);")
def snapshot():
    return json.loads(sql(f"SELECT jsonb_build_object('revision',(SELECT updated_at FROM public.facility_profiles WHERE id='{FACILITY}'),'menus',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.facility_menus m WHERE facility_id='{FACILITY}'))"))
def expect(label,statement,expected):
    assert sql(attempt(statement))==expected,label
    RESULTS.append({'case':label,'result':expected})
assert sql('SELECT current_database()')==DB
assert sql(f"SELECT count(*) FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}')")=='0'
try:
    reset()
    sig='public.save_admin_menu_atomic(uuid,uuid,uuid,jsonb,boolean,text)'
    assert sql(f"SELECT has_function_privilege('service_role','{sig}','EXECUTE') AND NOT has_function_privilege('anon','{sig}','EXECUTE') AND NOT has_function_privilege('authenticated','{sig}','EXECUTE')")=='t'
    expect('owner creates',save(None,{'category':'Cut','name':'Created'}),'OK')
    assert len(snapshot()['menus'])==3
    before=snapshot(); expect('patch preserves omitted legacy photo and feature',save(),'OK');after=snapshot();row=next(x for x in after['menus'] if x['id']==MENU);assert row['price']==200 and row['photo_url']==PHOTO and row['is_featured'] is True and after['revision']!=before['revision']
    sql(f"UPDATE public.facility_members SET role='admin' WHERE user_id='{ACTOR}'");expect('admin edits',save(values={'name':'Admin edit'}),'OK')
    for label,command,expected in [
      ('other actor',save(actor=OTHER),'42501'),('foreign menu',save(menu=FOREIGN_MENU),'P0002'),
      ('forged scope key',save(values={'facility_id':OTHER_FACILITY}),'22023'),
      ('patch cannot reorder',save(values={'sort_order':5}),'22023'),
      ('empty patch',f"SELECT public.save_admin_menu_atomic('{ACTOR}','{FACILITY}','{MENU}','{{}}',false,NULL)",'22023'),
      ('stale photo observation',save(values={'photo_url':PHOTO},check=True,photo=None),'40001'),
      ('same legacy photo',save(values={'photo_url':PHOTO},check=True,photo=PHOTO),'OK')]:
        before=snapshot();expect(label,command,expected)
        if expected!='OK':assert snapshot()==before,label
    reset();before=snapshot();expect('duplicate create restores rows and revision',save(None,{'category':'Cut','name':'Original'}),'23505');assert snapshot()==before
    sql(f"UPDATE public.facility_members SET role='staff' WHERE user_id='{ACTOR}'");before=snapshot();expect('staff cannot create',save(None,{'category':'Cut','name':'Staff'}),'42501');expect('staff cannot patch',save(),'42501');assert snapshot()['menus']==before['menus']
    reset();sql(f"DELETE FROM public.facility_members WHERE user_id='{ACTOR}'");before=snapshot();expect('revoked cannot create',save(None,{'category':'Cut','name':'Revoked'}),'42501');expect('revoked cannot patch',save(),'42501');assert snapshot()['menus']==before['menus']
    reset();revision=snapshot()['revision'];expect('create bumps order revision',save(None,{'category':'Cut','name':'New'}),'OK');assert snapshot()['revision']!=revision
    reset();revision=snapshot()['revision'];expect('patch bumps order revision',save(),'OK')
    reorder=f"SELECT public.reorder_admin_menus_atomic('{ACTOR}','{FACILITY}',ARRAY['{MENU2}','{MENU}']::uuid[],ARRAY['{MENU}','{MENU2}']::uuid[],{quoted(revision)})"
    before=snapshot();expect('old reorder cannot follow an edit unnoticed',reorder,'40001');assert snapshot()==before
    reset()
    sql("CREATE FUNCTION public.synthetic_menu_revision_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_REVISION_FAILURE'; END $$; CREATE TRIGGER synthetic_menu_revision_failure BEFORE UPDATE ON public.facility_profiles FOR EACH ROW EXECUTE FUNCTION public.synthetic_menu_revision_failure();")
    try:
        before=snapshot();expect('create revision failure rolls back insertion',save(None,{'category':'Cut','name':'Rollback'}),'P0001');assert snapshot()==before
        expect('patch revision failure rolls back edit',save(),'P0001');assert snapshot()==before
    finally:sql('DROP TRIGGER synthetic_menu_revision_failure ON public.facility_profiles; DROP FUNCTION public.synthetic_menu_revision_failure();')
    for label,operation in [('create',save(None,{'category':'Cut','name':'Race'})),('patch',save())]:
        reset();before=snapshot();race('role revocation before '+label,f"UPDATE public.facility_members SET role='staff' WHERE user_id='{ACTOR}';",attempt(operation),'42501');assert snapshot()['menus']==before['menus']
        reset();race(label+' before role revocation',attempt(operation),f"UPDATE public.facility_members SET role='staff' WHERE user_id='{ACTOR}' RETURNING 'revoked';",'revoked')
        reset();before=snapshot();race('membership deletion before '+label,f"DELETE FROM public.facility_members WHERE user_id='{ACTOR}';",attempt(operation),'42501');assert snapshot()['menus']==before['menus']
    reset();race('photo removal before stale exemption',f"UPDATE public.facility_menus SET photo_url=NULL WHERE id='{MENU}';",attempt(save(values={'photo_url':PHOTO},check=True,photo=PHOTO)),'40001');assert next(x for x in snapshot()['menus'] if x['id']==MENU)['photo_url'] is None
    reset();same=save(None,{'category':'Cut','name':'Same concurrent name'});race('duplicate concurrent creates',attempt(same),attempt(same),'23505');assert len(snapshot()['menus'])==3
    for isolation in ['REPEATABLE READ','SERIALIZABLE']:
        reset();session=Session()
        try:
            session.send(f"BEGIN ISOLATION LEVEL {isolation}; SELECT role FROM public.facility_members WHERE user_id='{ACTOR}';");session.mark('snapshot')
            sql(f"UPDATE public.facility_members SET role='staff' WHERE user_id='{ACTOR}';")
            before=snapshot();session.send(attempt(save()));assert session.mark('done')==['40001'];assert session.end()[0]==0;assert snapshot()['menus']==before['menus']
            RESULTS.append({'case':isolation+' cannot authorize stale membership','result':'40001'})
        finally:
            if session.proc.poll() is None:session.proc.kill();session.proc.wait(timeout=5)
    print(json.dumps({'database':DB,'cases':RESULTS,'production_or_provider_traffic':False},indent=2))
finally:
    sql(f"DELETE FROM public.facility_profiles WHERE id IN ('{FACILITY}','{OTHER_FACILITY}'); DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}');")

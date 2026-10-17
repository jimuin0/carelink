"""Real PG17 customer-master authority races in a disposable database only."""
import json, os, queue, subprocess, sys, threading, time

LOCAL = sys.argv[1:] == ['--local-shadow']
if not LOCAL:
    assert sys.argv[1:] == [] and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('CI') == 'true'
    assert os.environ.get('PGHOST') in ('localhost', '127.0.0.1') and os.environ.get('PGPORT') == '5432' and os.environ.get('PGUSER') == 'postgres'
    assert not any(os.environ.get(k) for k in ('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR'))
DB = 'carelink_shadow_customer_write_20261017' if LOCAL else 'carelink_shadow'
ARGS = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', DB]
ACTOR = 'fa7c0000-0000-4000-8000-000000000001'
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
        b.send("SET application_name='carelink-customer-write-waiter'; " + second + ';')
        deadline = time.monotonic() + 15; observed = False
        while time.monotonic() < deadline:
            if sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='carelink-customer-write-waiter' AND state='active' AND wait_event_type='Lock';") == '1':
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

FACILITY='fa7c0001-0000-4000-8000-000000000001'
OTHER_FACILITY='fa7c0001-0000-4000-8000-000000000002'
CUSTOMER='fa7c0002-0000-4000-8000-000000000001'
OTHER_CUSTOMER='fa7c0002-0000-4000-8000-000000000002'
OTHER='fa7c0000-0000-4000-8000-000000000002'
def quoted(x): return 'NULL' if x is None else "'"+str(x).replace("'","''")+"'"
def save(action='update',values=None,actor=ACTOR,customer=CUSTOMER):
    if values is None: values={} if action=='delete' else {'name':'Changed'}
    return f"SELECT public.manage_admin_customer_atomic('{actor}','{FACILITY}',{quoted(customer)},'{action}',{quoted(json.dumps(values))}::jsonb)"
def attempt(statement):
    return "CREATE FUNCTION pg_temp.customer_try(statement text) RETURNS text LANGUAGE plpgsql AS $try$ BEGIN EXECUTE statement; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $try$; SET ROLE service_role; SELECT pg_temp.customer_try("+quoted(statement)+");"
def reset():
    sql(f"DELETE FROM public.facility_profiles WHERE id IN ('{FACILITY}','{OTHER_FACILITY}'); DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}');")
    sql(f"INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('{ACTOR}','customer-write@example.invalid',now()),('{OTHER}','customer-other@example.invalid',now()); INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES('{FACILITY}','Synthetic customer write','synthetic-customer-write','Other','P','C','A','draft'),('{OTHER_FACILITY}','Other synthetic','synthetic-customer-write-other','Other','P','C','A','draft'); INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('{ACTOR}','{FACILITY}','owner'),('{OTHER}','{OTHER_FACILITY}','owner'); INSERT INTO public.customers(id,facility_id,name,email,notes) VALUES('{CUSTOMER}','{FACILITY}','Original','customer-original@example.invalid','Original note'),('{OTHER_CUSTOMER}','{OTHER_FACILITY}','Foreign','foreign@example.invalid',NULL);")
def snapshot():
    return json.loads(sql(f"SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM public.customers c WHERE facility_id='{FACILITY}'"))
def expect(label,statement,expected):
    assert sql(attempt(statement))==expected,label
    RESULTS.append({'case':label,'result':expected})
assert sql('SELECT current_database()')==DB
assert sql(f"SELECT count(*) FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}')")=='0'
try:
    # Replay exactly the old direct service-role writes after revocation committed.
    reset();sql(f"DELETE FROM public.facility_members WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}'")
    sql(f"SET ROLE service_role; INSERT INTO public.customers(facility_id,name) VALUES('{FACILITY}','Unauthorized create'); UPDATE public.customers SET name='Unauthorized edit' WHERE id='{CUSTOMER}' AND facility_id='{FACILITY}';")
    assert len(snapshot())==2 and any(c['name']=='Unauthorized edit' for c in snapshot())
    sql(f"SET ROLE service_role; DELETE FROM public.customers WHERE id='{CUSTOMER}' AND facility_id='{FACILITY}'")
    assert len(snapshot())==1
    RESULTS.append({'case':'old direct create/update/delete after committed revocation reproduced','result':'REPRODUCED'})
    reset()
    sig='public.manage_admin_customer_atomic(uuid,uuid,uuid,text,jsonb)'
    assert sql(f"SELECT has_function_privilege('service_role','{sig}','EXECUTE') AND NOT has_function_privilege('anon','{sig}','EXECUTE') AND NOT has_function_privilege('authenticated','{sig}','EXECUTE')")=='t'
    expect('owner creates',save('create',customer=None),'OK');assert len(snapshot())==2
    expect('owner updates and preserves omitted notes',save(),'OK');row=next(c for c in snapshot() if c['id']==CUSTOMER);assert row['name']=='Changed' and row['notes']=='Original note'
    expect('owner deletes',save('delete'),'OK');assert all(c['id']!=CUSTOMER for c in snapshot())
    for action in ('create','update','delete'):
        for revoke in ('DELETE', 'STAFF'):
            reset()
            command=f"DELETE FROM public.facility_members WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}'" if revoke=='DELETE' else f"UPDATE public.facility_members SET role='staff' WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}'"
            statement=save(action,customer=None if action=='create' else CUSTOMER)
            before=snapshot();race(action+' revocation first '+revoke,command,attempt(statement),'42501');assert snapshot()==before
            reset();race(action+' write first '+revoke,'SET LOCAL ROLE service_role; '+statement,attempt(command),'OK')
    reset()
    for label,statement,code in [
      ('foreign actor denied',save(actor=OTHER),'42501'),
      ('foreign customer update denied',save(customer=OTHER_CUSTOMER),'P0002'),
      ('foreign customer delete denied',save('delete',customer=OTHER_CUSTOMER),'P0002'),
      ('missing customer denied',save(customer=OTHER),'P0002'),
      ('forged facility rejected',save(values={'name':'C','facility_id':OTHER_FACILITY}),'22023'),
      ('forged identity rejected',save(values={'id':OTHER_CUSTOMER}),'22023'),
      ('create with existing ID rejected',save('create'),'22023'),
      ('delete with values rejected',save('delete',{'name':'Forged'}),'22023'),
      ('unknown operation rejected',save('publish'),'22023'),
      ('empty name rejected',save(values={'name':' '}),'22023'),
    ]:
        before=snapshot();expect(label,statement,code);assert snapshot()==before,label
    expect('case-folded duplicate email rejected atomically',save('create',{'name':'Duplicate','email':'CUSTOMER-ORIGINAL@example.invalid'},customer=None),'23505');assert len(snapshot())==1
    # Synthetic trigger fails after row mutation; no partial name/email changes.
    sql("CREATE FUNCTION public.synthetic_customer_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure' USING ERRCODE='23514'; END $$; CREATE TRIGGER synthetic_customer_failure AFTER UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.synthetic_customer_failure();")
    try:
        before=snapshot();expect('update trigger failure restores all fields',save(values={'name':'Broken','email':'changed@example.invalid'}),'23514');assert snapshot()==before
    finally: sql('DROP TRIGGER synthetic_customer_failure ON public.customers; DROP FUNCTION public.synthetic_customer_failure();')
    reset();race('two concurrent customer edits serialize','SET LOCAL ROLE service_role; '+save(values={'name':'First','notes':'First note'}),attempt(save(values={'name':'Second','notes':'Second note'})),'OK');row=snapshot()[0];assert row['name']=='Second' and row['notes']=='Second note'
    reset();sql(f"UPDATE public.facility_members SET role='admin' WHERE user_id='{ACTOR}'");expect('admin can edit',save(),'OK')
    print(json.dumps({'postgres':sql('SHOW server_version'),'cases':RESULTS,'case_count':len(RESULTS),'actual_lock_waiters':sum(r.get('actual_lock_waiters',0) for r in RESULTS)},indent=2))
finally:
    sql(f"DELETE FROM public.facility_profiles WHERE id IN ('{FACILITY}','{OTHER_FACILITY}'); DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}');")

"""Real PG17 platform-editor write races in a disposable database only."""
import json, os, queue, subprocess, sys, threading, time

LOCAL = sys.argv[1:] == ['--local-shadow']
if LOCAL:
    assert os.environ.get('PGHOST','localhost') in ('localhost','127.0.0.1')
    assert not any(os.environ.get(k) for k in ('PGSERVICE','PGSERVICEFILE','PGHOSTADDR'))
if not LOCAL:
    assert sys.argv[1:] == [] and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('CI') == 'true'
    assert os.environ.get('PGHOST') in ('localhost', '127.0.0.1') and os.environ.get('PGPORT') == '5432' and os.environ.get('PGUSER') == 'postgres'
    assert not any(os.environ.get(k) for k in ('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR'))
DB = 'carelink_shadow_editor_write_20261019' if LOCAL else 'carelink_shadow'
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
        a.send('BEGIN; ' + first + ';'); first_output=a.mark('held')
        b.send("SET application_name='carelink-editor-write-waiter'; " + second + ';')
        deadline = time.monotonic() + 15; observed = False
        while time.monotonic() < deadline:
            if sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='carelink-editor-write-waiter' AND state='active' AND wait_event_type='Lock';") == '1':
                observed = True; break
            time.sleep(0.02)
        assert observed, (label,'real PostgreSQL waiter must be observed')
        code, error = a.end(finish); assert code == 0, (label, error)
        output = b.mark('done'); assert output == [expected], (label, output)
        assert b.end()[0] == 0
        RESULTS.append({'case': label, 'actual_lock_waiters': 1, 'second_result': expected,'first_result':first_output})
    finally:
        for session in (a, b):
            if session.proc.poll() is None:
                try: session.proc.stdin.close()
                except (BrokenPipeError,ValueError): pass
                session.proc.kill(); session.proc.wait(timeout=5)


ACTOR='fe190300-0000-4000-8000-000000000081'
OTHER='fe190300-0000-4000-8000-000000000082'
FA='fe190301-0000-4000-8000-000000000081'
FB='fe190301-0000-4000-8000-000000000082'
def q(v):return "'"+str(v).replace("'","''")+"'"
def save(values=None,actor=ACTOR,ids=None):
 if values is None:values={'name':'Synthetic bulk','discount_type':'percentage','discount_value':10}
 if ids is None:ids=[FA,FB]
 array='ARRAY['+','.join('NULL' if x is None else q(x) for x in ids)+']::uuid[]'
 return f"SELECT count(*) FROM public.create_chain_coupons_atomic('{actor}',{array},{q(json.dumps(values))}::jsonb)"
def attempt(stmt,role='service_role'):
 return "CREATE FUNCTION pg_temp.bulk_try(statement text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE statement; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$; SET ROLE "+role+"; SELECT pg_temp.bulk_try($stmt$"+stmt+"$stmt$)"
def reset():
 sql(f"DELETE FROM public.facility_profiles WHERE id IN ('{FA}','{FB}'); INSERT INTO auth.users(id,email) VALUES('{ACTOR}','bulk-owner@example.invalid'),('{OTHER}','bulk-other@example.invalid') ON CONFLICT(id) DO NOTHING; INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES('{FA}','Synthetic bulk A','synthetic-bulk-race-a','その他','Synthetic','Synthetic','Synthetic','draft'),('{FB}','Synthetic bulk B','synthetic-bulk-race-b','その他','Synthetic','Synthetic','Synthetic','draft'); INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('{ACTOR}','{FA}','owner'),('{ACTOR}','{FB}','admin'),('{OTHER}','{FA}','admin'),('{OTHER}','{FB}','owner');")
def count():return sql(f"SELECT count(*) FROM public.coupons WHERE facility_id IN ('{FA}','{FB}')")
try:
 assert 170000<=int(sql('SHOW server_version_num'))<180000
 for label,change in [('revoke',f"DELETE FROM public.facility_members WHERE user_id='{ACTOR}' AND facility_id='{FB}'"),('downgrade',f"UPDATE public.facility_members SET role='staff' WHERE user_id='{ACTOR}' AND facility_id='{FB}'"),('account delete',f"DELETE FROM auth.users WHERE id='{ACTOR}'"),('facility delete',f"DELETE FROM public.facility_profiles WHERE id='{FB}'")]:
  reset();race(label+' before bulk',change,attempt(save()),'42501');assert count()=='0'
  reset();race('bulk before '+label,'SET LOCAL ROLE service_role; '+save(),change+"; SELECT 'changed'",'changed');assert count()==('1' if label=='facility delete' else '2')
 for label,stmt,role,code in [('duplicate IDs',save(ids=[FA,FA]),'service_role','22023'),('null ID',save(ids=[FA,None]),'service_role','22023'),('empty targets',save(ids=[]),'service_role','22023'),('too many targets',save(ids=[FA]*51),'service_role','22023'),('anonymous',save(),'anon','42501'),('authenticated',save(),'authenticated','42501')]:
  reset();assert sql(attempt(stmt,role))==code,label;assert count()=='0';RESULTS.append({'case':label,'sqlstate':code})
 for dates in [{'valid_from':'0000-01-01'},{'valid_until':'2026-02-30'},{'valid_from':'2026-12-31','valid_until':'2026-01-01'}]:
  reset();values={'name':'Synthetic dates','discount_type':'fixed','discount_value':10,**dates};actual=sql(attempt(save(values)));assert actual=='22023',actual;assert count()=='0';RESULTS.append({'case':'invalid DATE rejected','input':dates})
 reset();sql(f"CREATE FUNCTION public.synthetic_bulk_second_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.facility_id='{FB}' AND NEW.name='Synthetic rollback' THEN RAISE EXCEPTION 'synthetic second insert failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_bulk_second_failure BEFORE INSERT ON public.coupons FOR EACH ROW EXECUTE FUNCTION public.synthetic_bulk_second_failure();")
 assert sql(attempt(save({'name':'Synthetic rollback','discount_type':'fixed','discount_value':10})))=='23514';assert count()=='0';RESULTS.append({'case':'second target insert failure rolls back first target'})
 sql('DROP TRIGGER synthetic_bulk_second_failure ON public.coupons; DROP FUNCTION public.synthetic_bulk_second_failure();')
 reset();assert sql(save({'name':'Synthetic dates','discount_type':'fixed','discount_value':10,'valid_from':'2026-01-01T23:00:00-05:00','valid_until':'2026-01-02'}))=='2';assert sql(f"SELECT bool_and(valid_from='2026-01-01'::date AND valid_until='2026-01-02'::date) FROM public.coupons WHERE facility_id IN ('{FA}','{FB}')")=='t';RESULTS.append({'case':'DATE calendar prefix preserved across timezone offset'})
 reset();a=Session();b=Session()
 try:
  a.send('BEGIN; SET LOCAL ROLE service_role; '+save()+';');assert a.mark('first')==['2']
  b.send('BEGIN; SET LOCAL ROLE service_role; '+save(actor=OTHER,ids=[FB,FA])+';');assert b.mark('second')==['2'];assert b.end()[0]==0;assert a.end()[0]==0
 finally:
  for x in (a,b):
   if x.proc.poll() is None:x.proc.kill();x.proc.wait()
 assert count()=='4';RESULTS.append({'case':'distinct actors reversed targets complete without deadlock'})
 reset();coupon=sql(f"INSERT INTO public.coupons(facility_id,name,discount_type,discount_value,valid_from,valid_until) VALUES('{FA}','Synthetic historical','fixed',10,'2026-12-31','2026-01-01') RETURNING id")
 assert sql(f"SET ROLE service_role; SELECT is_active FROM public.save_admin_coupon_atomic('{ACTOR}','{FA}','{coupon}','{{\"is_active\":false}}',NULL)")=='f';RESULTS.append({'case':'historical invalid range does not prevent deactivation'})
 print(json.dumps({'cases':RESULTS,'actual_lock_waiters':sum(x.get('actual_lock_waiters',0) for x in RESULTS),'production_mutations':False},indent=2))
finally:
 sql(f"DROP TRIGGER IF EXISTS synthetic_bulk_second_failure ON public.coupons; DROP FUNCTION IF EXISTS public.synthetic_bulk_second_failure(); DELETE FROM public.facility_profiles WHERE id IN ('{FA}','{FB}'); DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}');")

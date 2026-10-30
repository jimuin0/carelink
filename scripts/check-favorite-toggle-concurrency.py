"""Real PG17 favorite toggle races in a disposable database only."""
import json, os, queue, subprocess, sys, threading, time
from pathlib import Path

LOCAL = sys.argv[1:] == ['--local-shadow']
if LOCAL:
    assert os.environ.get('PGHOST', 'localhost') in ('localhost', '127.0.0.1')
    assert not any(os.environ.get(k) for k in ('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR'))
if not LOCAL:
    assert sys.argv[1:] == [] and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('CI') == 'true'
    assert os.environ.get('PGHOST') in ('localhost', '127.0.0.1') and os.environ.get('PGPORT') == '5432' and os.environ.get('PGUSER') == 'postgres'
    assert not any(os.environ.get(k) for k in ('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR'))
DB = 'carelink_shadow_favorite_toggle_20261018' if LOCAL else 'carelink_shadow'
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
        b.send("SET application_name='carelink-favorite-toggle-waiter'; " + second + ';')
        deadline = time.monotonic() + 15; observed = False
        while time.monotonic() < deadline:
            if sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='carelink-favorite-toggle-waiter' AND state='active' AND wait_event_type='Lock';") == '1':
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


FACILITY='fa7e0001-0000-4000-8000-000000000091'
OTHER='fa7e0000-0000-4000-8000-000000000092'
ACTOR='fa7e0000-0000-4000-8000-000000000091'
def toggle(actor=ACTOR,facility=FACILITY,desired=None):
    actor="NULL" if actor is None else "'"+actor+"'"
    return f"SELECT public.toggle_user_favorite_atomic({actor},'{facility}', {'NULL' if desired is None else str(desired).lower()})"
def attempt(statement,role='service_role'):
    return "CREATE FUNCTION pg_temp.favorite_try(statement text) RETURNS text LANGUAGE plpgsql AS $try$ BEGIN EXECUTE statement; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $try$; SET ROLE "+role+"; SELECT pg_temp.favorite_try($stmt$"+statement+"$stmt$)"
def reset():
    sql(f"DELETE FROM public.favorites WHERE facility_id='{FACILITY}'; INSERT INTO auth.users(id,email) VALUES('{ACTOR}','favorite-race@example.invalid'),('{OTHER}','favorite-other@example.invalid') ON CONFLICT(id) DO NOTHING; UPDATE public.facility_profiles SET status='published' WHERE id='{FACILITY}';")
def count(): return sql(f"SELECT count(*) FROM public.favorites WHERE facility_id='{FACILITY}'")
try:
    sql(f"INSERT INTO auth.users(id,email) VALUES('{ACTOR}','favorite-race@example.invalid'),('{OTHER}','favorite-other@example.invalid'); INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES('{FACILITY}','Synthetic favorite race','favorite-race-disposable','ヘアサロン','東京都','テスト市','テスト1','draft');")
    sql(Path('supabase/shadow/listing-verification-setup.sql').read_text() + f"\nSELECT pg_temp.approve_synthetic_listing('{FACILITY}'); UPDATE public.facility_profiles SET status='published' WHERE id='{FACILITY}';")
    # Reproduce the old two-read/two-insert algorithm without modifying a live API.
    a=Session();b=Session()
    try:
        for session in (a,b):
            session.send(f"BEGIN; SELECT count(*) FROM public.favorites WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}';")
            assert session.mark('empty')==['0']
        a.send(f"INSERT INTO public.favorites(user_id,facility_id) VALUES('{ACTOR}','{FACILITY}');")
        assert a.end()[0]==0
        b.send(f"INSERT INTO public.favorites(user_id,facility_id) VALUES('{ACTOR}','{FACILITY}');")
        code,error=b.end();assert code!=0 and '23505' in error
        RESULTS.append({'case':'old algorithm duplicate insertion','sqlstate':'23505','reproduced':True})
    finally:
        for session in (a,b):
            if session.proc.poll() is None:session.proc.kill();session.proc.wait(timeout=5)
    reset();race('two toggles serialize absent row','SET LOCAL ROLE service_role; '+toggle(),'SET ROLE service_role; '+toggle(),'f');assert count()=='0'
    reset();race('rolled back toggle does not consume next toggle','SET LOCAL ROLE service_role; '+toggle(),'SET ROLE service_role; '+toggle(),'t',finish='ROLLBACK;');assert count()=='1'
    reset();race('unpublish first rejects toggle',f"UPDATE public.facility_profiles SET status='draft' WHERE id='{FACILITY}'",attempt(toggle()),'P0002');assert count()=='0'
    reset();race('toggle first fences unpublish','SET LOCAL ROLE service_role; '+toggle(),attempt(f"UPDATE public.facility_profiles SET status='draft' WHERE id='{FACILITY}'"),'OK');assert count()=='1'
    reset();race('account removal first rejects toggle',f"DELETE FROM auth.users WHERE id='{ACTOR}'",attempt(toggle()),'P0001');assert count()=='0'
    reset();race('toggle first fences account deletion','SET LOCAL ROLE service_role; '+toggle(),attempt(f"DELETE FROM auth.users WHERE id='{ACTOR}'",role='postgres'),'OK');assert count()=='0'
    for desired in (True,False):
        reset()
        if not desired: assert sql('SET ROLE service_role; '+toggle(desired=True))=='t'
        result='t' if desired else 'f'
        race('same desired state is idempotent '+str(desired),'SET LOCAL ROLE service_role; '+toggle(desired=desired),'SET ROLE service_role; '+toggle(desired=desired),result)
        assert count()==('1' if desired else '0')
    reset()
    assert sql('SET ROLE service_role; '+toggle()+'; '+toggle(OTHER))=='t\nt';assert count()=='2'
    RESULTS.append({'case':'users have independent favorites','rows':2})
    for label,statement,role,code in [
        ('null actor',toggle(None),'service_role','22023'),
        ('missing facility',toggle(facility='fa7e0001-0000-4000-8000-000000000099'),'service_role','P0002'),
        ('authenticated RPC denied',toggle(),'authenticated','42501'),
        ('anon RPC denied',toggle(),'anon','42501'),
        ('authenticated direct delete denied',f"DELETE FROM public.favorites WHERE facility_id='{FACILITY}'",'authenticated','42501'),
        ('anon direct insert denied',f"INSERT INTO public.favorites(user_id,facility_id) VALUES('{ACTOR}','{FACILITY}')",'anon','42501'),
    ]:
        assert sql(attempt(statement,role))==code,label;RESULTS.append({'case':label,'sqlstate':code})
    assert sql("SELECT has_table_privilege('authenticated','public.favorites','SELECT')")=='t'
    print(json.dumps({'cases':RESULTS,'actual_lock_waiters':sum(x.get('actual_lock_waiters',0) for x in RESULTS)},indent=2))
finally:
    sql(f"DELETE FROM public.listing_verification_approval_documents WHERE facility_id='{FACILITY}'; DELETE FROM public.listing_verification_approvals WHERE facility_id='{FACILITY}'; DELETE FROM storage.objects WHERE bucket_id='listing-verification' AND name IN (SELECT object_path FROM public.listing_verification_documents WHERE facility_id='{FACILITY}'); DELETE FROM public.listing_verification_documents WHERE facility_id='{FACILITY}'; DELETE FROM public.facility_profiles WHERE id='{FACILITY}'; DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}');")

"""Real PG17 job-application write races in a disposable database only."""
import json, os, queue, subprocess, sys, threading, time

LOCAL = sys.argv[1:] == ['--local-shadow']
if LOCAL:
    assert os.environ.get('PGHOST','localhost') in ('localhost','127.0.0.1')
    assert not any(os.environ.get(k) for k in ('PGSERVICE','PGSERVICEFILE','PGHOSTADDR'))
if not LOCAL:
    assert sys.argv[1:] == [] and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('CI') == 'true'
    assert os.environ.get('PGHOST') in ('localhost', '127.0.0.1') and os.environ.get('PGPORT') == '5432' and os.environ.get('PGUSER') == 'postgres'
    assert not any(os.environ.get(k) for k in ('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR'))
DB = 'carelink_shadow_application_write_20261018' if LOCAL else 'carelink_shadow'
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
        b.send("SET application_name='carelink-application-write-waiter'; " + second + ';')
        deadline = time.monotonic() + 15; observed = False
        while time.monotonic() < deadline:
            if sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='carelink-application-write-waiter' AND state='active' AND wait_event_type='Lock';") == '1':
                observed = True; break
            time.sleep(0.02)
        assert observed, 'real PostgreSQL waiter must be observed'
        code, error = a.end(finish); assert code == 0, (label, error)
        output = b.mark('done'); assert output == [expected], (label, output)
        assert b.end()[0] == 0
        RESULTS.append({'case': label, 'actual_lock_waiters': 1, 'second_result': expected,'first_result':first_output})
    finally:
        for session in (a, b):
            if session.proc.poll() is None: session.proc.kill(); session.proc.wait(timeout=5)


ACTOR='fa7e0000-0000-4000-8000-000000000081'
OTHER='fa7e0000-0000-4000-8000-000000000082'
FACILITY='fa7e0001-0000-4000-8000-000000000081'
FOREIGN='fa7e0001-0000-4000-8000-000000000082'
APPLICATION='fa7e0002-0000-4000-8000-000000000081'
JOB='fa7e0003-0000-4000-8000-000000000081'
BUSINESS_TYPE='\u30d8\u30a2\u30b5\u30ed\u30f3'
def q(value): return 'NULL' if value is None else "'"+str(value).replace("'","''")+"'"
def save(patch=None,actor=ACTOR,facility=FACILITY,application=APPLICATION):
    if patch is None: patch={'status':'reviewing'}
    return f"SELECT public.update_job_application_atomic({q(actor)},{q(facility)},{q(application)},{q(json.dumps(patch))}::jsonb)#>>'{{application,status}}'"
def attempt(statement,role='service_role'):
    return "CREATE FUNCTION pg_temp.application_try(statement text) RETURNS text LANGUAGE plpgsql AS $try$ BEGIN EXECUTE statement; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $try$; SET ROLE "+role+"; SELECT pg_temp.application_try($stmt$"+statement+"$stmt$)"
def reset():
    sql(f"DELETE FROM public.job_applications WHERE facility_id IN ('{FACILITY}','{FOREIGN}'); INSERT INTO auth.users(id,email) VALUES('{ACTOR}','application-owner@example.invalid'),('{OTHER}','application-other@example.invalid') ON CONFLICT(id) DO NOTHING; INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES('{FACILITY}','Synthetic applications','application-write-fixture','{BUSINESS_TYPE}','Synthetic','Synthetic','Synthetic','draft'),('{FOREIGN}','Synthetic other','application-other-fixture','{BUSINESS_TYPE}','Synthetic','Synthetic','Synthetic','draft') ON CONFLICT(id) DO NOTHING; DELETE FROM public.facility_members WHERE facility_id IN ('{FACILITY}','{FOREIGN}'); INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('{ACTOR}','{FACILITY}','owner'),('{OTHER}','{FACILITY}','admin'),('{OTHER}','{FOREIGN}','owner'); INSERT INTO public.job_applications(id,facility_id,applicant_name,applicant_email) VALUES('{APPLICATION}','{FACILITY}','Synthetic','baseline@example.invalid');")
def snapshot():
    return sql(f"SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM public.job_applications a WHERE facility_id IN ('{FACILITY}','{FOREIGN}');")
def duplicate(job=None):
    return f"INSERT INTO public.job_applications(facility_id,job_posting_id,applicant_name,applicant_email) VALUES('{FACILITY}',{q(job)},'Synthetic','race@example.invalid')"
try:
    assert 170000<=int(sql("SHOW server_version_num"))<180000
    reset()
    for role_change in [f"DELETE FROM public.facility_members WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}'",f"UPDATE public.facility_members SET role='staff' WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}'"]:
        reset();before=snapshot();race('revoked authority before mutation',role_change,attempt(save()),'42501');assert snapshot()==before
    reset();race('mutation before role removal','SET LOCAL ROLE service_role; '+save(),attempt(f"DELETE FROM public.facility_members WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}'",role='postgres'),'OK')
    for label,change in [('transfer',f"UPDATE public.job_applications SET facility_id='{FOREIGN}' WHERE id='{APPLICATION}'"),('delete',f"DELETE FROM public.job_applications WHERE id='{APPLICATION}'"),('facility deletion',f"DELETE FROM public.facility_profiles WHERE id='{FACILITY}'")]:
        reset();race(label+' first',change,attempt(save()),'P0002')
        reset();race('mutation first '+label,'SET LOCAL ROLE service_role; '+save(),attempt(change,role='postgres'),'OK')
    reset();race('account deletion before mutation',f"DELETE FROM auth.users WHERE id='{ACTOR}'",attempt(save()),'P0001')
    reset();race('mutation before account deletion','SET LOCAL ROLE service_role; '+save(),attempt(f"DELETE FROM auth.users WHERE id='{ACTOR}'",role='postgres'),'OK')
    reset();race('simultaneous hired requests retain first transition timestamp','SET LOCAL ROLE service_role; '+save({'status':'hired'})+f"; SELECT hired_at::text FROM public.job_applications WHERE id='{APPLICATION}'",'SET ROLE service_role; '+save({'status':'hired'}),'hired')
    assert sql(f"SELECT hired_at::text FROM public.job_applications WHERE id='{APPLICATION}'")==RESULTS[-1]['first_result'][-1]
    reset();before=snapshot();race('aborted first update does not leak fields','SET LOCAL ROLE service_role; '+save({'status':'hired','notes':'rolled-back'}),'SET ROLE service_role; '+save({'notes':'kept'}),'pending',finish='ROLLBACK;')
    assert sql(f"SELECT status='pending' AND hired_at IS NULL AND notes='kept' FROM public.job_applications WHERE id='{APPLICATION}'")=='t'
    for finish,expected in [('COMMIT;','23505'),('ROLLBACK;','OK')]:
        reset();race('general application duplicate '+finish,'SET LOCAL ROLE service_role; '+duplicate(),attempt(duplicate()),expected,finish=finish)
        assert sql(f"SELECT count(*) FROM public.job_applications WHERE facility_id='{FACILITY}' AND applicant_email='race@example.invalid' AND job_posting_id IS NULL")=='1'
    reset();sql(f"INSERT INTO public.job_postings(id,title,facility_name,job_type,employment_type,description,salary,location) VALUES('{JOB}','Synthetic','Synthetic','Synthetic','Synthetic','Synthetic','Synthetic','Synthetic');")
    race('specific job duplicate','SET LOCAL ROLE service_role; '+duplicate(JOB),attempt(duplicate(JOB)),'23505')
    assert sql("SELECT indnullsnotdistinct FROM pg_index WHERE indexrelid='public.job_application_identity_unique'::regclass")=='t'
    reset();sql(duplicate()+";"+duplicate(JOB)+f"; INSERT INTO public.job_applications(facility_id,applicant_name,applicant_email) VALUES('{FOREIGN}','Synthetic','race@example.invalid');")
    assert sql(f"SELECT count(*) FROM public.job_applications WHERE facility_id IN ('{FACILITY}','{FOREIGN}') AND applicant_email='race@example.invalid'")=='3'
    RESULTS.append({'case':'identity uniqueness is scoped by facility and job','rows':3})
    reset();sql(f"UPDATE public.facility_members SET role='admin' WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}';");assert sql('SET ROLE service_role; '+save({'notes':'admin-confirmed'}))=='pending';RESULTS.append({'case':'current admin role retains supported update access'})
    reset();sql(f"UPDATE public.job_applications SET fee_invoiced_at='2000-01-01T00:00:00Z',fee_paid_at='2001-01-01T00:00:00Z' WHERE id='{APPLICATION}';")
    for patch in [{'notes':None},{'notes':'safe','referral_fee_yen':0},{'referral_fee_yen':9999999},{'referral_fee_yen':None}]:
        assert sql('SET ROLE service_role; '+save(patch))=='pending'
    assert sql(f"SELECT fee_invoiced_at='2000-01-01T00:00:00Z'::timestamptz AND fee_paid_at='2001-01-01T00:00:00Z'::timestamptz AND referral_fee_yen IS NULL FROM public.job_applications WHERE id='{APPLICATION}'")=='t'
    RESULTS.append({'case':'valid nullable fields preserve billing metadata'})
    for label,statement,role,code in [
      ('other facility',save(facility=FOREIGN),'service_role','42501'),('missing application',save(application=JOB),'service_role','P0002'),
      ('missing actor',save(actor=None),'service_role','42501'),('invalid scope',save(facility=None),'service_role','22023'),
      ('forged billing',save({'fee_paid_at':'2000-01-01'}),'service_role','22023'),('invalid status',save({'status':'forged'}),'service_role','22023'),
      ('null status',save({'status':None}),'service_role','22023'),('invalid notes',save({'notes':[]}),'service_role','22023'),
      ('long notes',save({'notes':'x'*2001}),'service_role','22023'),('negative fee',save({'referral_fee_yen':-1}),'service_role','22023'),
      ('overflow fee',save({'referral_fee_yen':10000000}),'service_role','22023'),('fraction fee',save({'referral_fee_yen':1.5}),'service_role','22023'),
      ('string fee',save({'referral_fee_yen':'100'}),'service_role','22023'),('empty patch',save({}),'service_role','22023'),
      ('authenticated RPC',save(),'authenticated','42501'),('anon RPC',save(),'anon','42501'),
      ('authenticated direct mutation',f"UPDATE public.job_applications SET status='hired' WHERE id='{APPLICATION}'",'authenticated','42501'),
      ('anon direct creation',duplicate(),'anon','42501'),
    ]:
        before=snapshot();assert sql(attempt(statement,role))==code,label;assert snapshot()==before,label;RESULTS.append({'case':label,'sqlstate':code})
    assert sql("SELECT has_table_privilege('authenticated','public.job_applications','SELECT')")=='t'
    print(json.dumps({'cases':RESULTS,'actual_lock_waiters':sum(r.get('actual_lock_waiters',0) for r in RESULTS)},indent=2))
finally:
    sql(f"DELETE FROM public.facility_profiles WHERE id IN ('{FACILITY}','{FOREIGN}'); DELETE FROM public.job_postings WHERE id='{JOB}'; DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}');")

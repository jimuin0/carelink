"""Real PG17 platform-control write races in a disposable database only."""
import json, os, queue, subprocess, sys, threading, time

LOCAL = sys.argv[1:] == ['--local-shadow']
if LOCAL:
    assert os.environ.get('PGHOST','localhost') in ('localhost','127.0.0.1')
    assert not any(os.environ.get(k) for k in ('PGSERVICE','PGSERVICEFILE','PGHOSTADDR'))
if not LOCAL:
    assert sys.argv[1:] == [] and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('CI') == 'true'
    assert os.environ.get('PGHOST') in ('localhost', '127.0.0.1') and os.environ.get('PGPORT') == '5432' and os.environ.get('PGUSER') == 'postgres'
    assert not any(os.environ.get(k) for k in ('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR'))
DB = 'carelink_shadow_platform_write_20261019' if LOCAL else 'carelink_shadow'
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
        b.send("SET application_name='carelink-platform-write-waiter'; " + second + ';')
        deadline = time.monotonic() + 15; observed = False
        while time.monotonic() < deadline:
            if sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='carelink-platform-write-waiter' AND state='active' AND wait_event_type='Lock';") == '1':
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


ACTOR='fe190000-0000-4000-8000-000000000081'
OTHER='fe190000-0000-4000-8000-000000000082'
FLAG='fe190001-0000-4000-8000-000000000081'
TICKET='fe190002-0000-4000-8000-000000000081'
FACILITY='fe190003-0000-4000-8000-000000000081'
BUSINESS_TYPE='\u30d8\u30a2\u30b5\u30ed\u30f3'
def q(v):return 'NULL' if v is None else "'"+str(v).replace("'","''")+"'"
def save(kind='flag:update',values=None,record=FLAG,actor=ACTOR):
 if values is None:values={'enabled':True}
 return f"SELECT public.manage_platform_control_atomic({q(actor)},{q(record)},{q(kind)},{q(json.dumps(values))}::jsonb)->>'id'"
def attempt(statement,role='service_role'):
 return "CREATE FUNCTION pg_temp.control_try(statement text) RETURNS text LANGUAGE plpgsql AS $try$ BEGIN EXECUTE statement; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $try$; SET ROLE "+role+"; SELECT pg_temp.control_try($stmt$"+statement+"$stmt$)"
def reset():
 sql(f"INSERT INTO auth.users(id,email) VALUES('{ACTOR}','platform-control@example.invalid'),('{OTHER}','platform-control-other@example.invalid') ON CONFLICT(id) DO NOTHING; UPDATE public.profiles SET is_platform_admin=true WHERE id IN ('{ACTOR}','{OTHER}'); DELETE FROM public.feature_flags WHERE key IN ('isolated-platform-control','isolated-platform-create'); INSERT INTO public.feature_flags(id,key,enabled,rollout_pct) VALUES('{FLAG}','isolated-platform-control',false,0); DELETE FROM public.contacts WHERE id='{TICKET}'; INSERT INTO public.contacts(id,name,email,inquiry_type,message) VALUES('{TICKET}','Synthetic','platform@example.invalid','other','Synthetic'); INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES('{FACILITY}','Synthetic control','isolated-platform-control','{BUSINESS_TYPE}','Synthetic','Synthetic','Synthetic','draft') ON CONFLICT(id) DO NOTHING;")
def snapshot():
 return sql(f"SELECT jsonb_build_object('flag',(select to_jsonb(f) from public.feature_flags f where id='{FLAG}'),'ticket',(select to_jsonb(t) from public.contacts t where id='{TICKET}'),'facility',(select to_jsonb(p) from public.facility_profiles p where id='{FACILITY}'))")
try:
 assert 170000<=int(sql('SHOW server_version_num'))<180000
 operations=[('flag:update',{'enabled':True},FLAG),('flag:create',{'key':'isolated-platform-create'},None),('ticket:update',{'ticket_status':'resolved'},TICKET),('facility:verify',{'is_verified':True},FACILITY)]
 for kind,values,record in operations:
  reset();before=snapshot()
  race(kind+' revocation first',f"UPDATE public.profiles SET is_platform_admin=false WHERE id='{ACTOR}'",attempt(save(kind,values,record)),'42501');assert snapshot()==before
  reset();race(kind+' write before revocation','SET LOCAL ROLE service_role; '+save(kind,values,record),f"UPDATE public.profiles SET is_platform_admin=false WHERE id='{ACTOR}'; SELECT 'revoked'",'revoked')
  reset();race(kind+' account deletion first',f"DELETE FROM auth.users WHERE id='{ACTOR}'",attempt(save(kind,values,record)),'42501')
  reset();race(kind+' write before account deletion','SET LOCAL ROLE service_role; '+save(kind,values,record),f"DELETE FROM auth.users WHERE id='{ACTOR}'; SELECT 'deleted'",'deleted')
 reset();race('ticket resolve replay preserves first timestamp',"SET LOCAL ROLE service_role; "+save('ticket:update',{'ticket_status':'resolved'},TICKET)+f"; SELECT resolved_at::text FROM public.contacts WHERE id='{TICKET}'",save('ticket:update',{'ticket_status':'resolved'},TICKET,actor=OTHER),TICKET)
 first=RESULTS[-1]['first_result'];assert first[0]==TICKET and len(first)==2;assert sql(f"SELECT resolved_at::text FROM public.contacts WHERE id='{TICKET}'")==first[1]
 timestamp=sql(f"SELECT resolved_at FROM public.contacts WHERE id='{TICKET}'");sql(save('ticket:update',{'ticket_status':'resolved'},TICKET));assert sql(f"SELECT resolved_at FROM public.contacts WHERE id='{TICKET}'")==timestamp
 RESULTS.append({'case':'resolved timestamp unchanged across retries'})
 sql(save('ticket:update',{'ticket_status':'open'},TICKET));assert sql(f"SELECT resolved_at IS NULL FROM public.contacts WHERE id='{TICKET}'")=='t';RESULTS.append({'case':'reopen clears resolved timestamp'})
 reset();before=snapshot();race('rollback leaves no flag write','SET LOCAL ROLE service_role; '+save(),"SELECT enabled::text FROM public.feature_flags WHERE id='"+FLAG+"' FOR SHARE",'false',finish='ROLLBACK;');assert snapshot()==before
 reset();race('different admins preserve independent flag fields','SET LOCAL ROLE service_role; '+save(values={'enabled':True}),save(values={'rollout_pct':100},actor=OTHER),FLAG)
 assert sql(f"SELECT jsonb_build_array(enabled,rollout_pct) FROM public.feature_flags WHERE id='{FLAG}'")=='[true, 100]'
 for finish,expected in [('COMMIT;','23505'),('ROLLBACK;','OK')]:
  reset();race('simultaneous flag creation '+finish,'SET LOCAL ROLE service_role; '+save('flag:create',{'key':'isolated-platform-create'},None),attempt(save('flag:create',{'key':'isolated-platform-create'},None,actor=OTHER)),expected,finish=finish)
 for kind,values,record,table in [('facility:verify',{'is_verified':True},FACILITY,'facility_profiles'),('ticket:update',{'priority':'high'},TICKET,'contacts')]:
  reset();race(kind+' deletion first',f"DELETE FROM public.{table} WHERE id='{record}'",attempt(save(kind,values,record)),'P0002')
  reset();race(kind+' write before deletion','SET LOCAL ROLE service_role; '+save(kind,values,record),f"DELETE FROM public.{table} WHERE id='{record}'; SELECT 'deleted'",'deleted')
 for label,statement,role,code in [
  ('missing actor',save(actor=None),'service_role','42501'),('empty patch',save(values={}),'service_role','22023'),
  ('forged actor field',save(values={'enabled':True,'actor_id':ACTOR}),'service_role','22023'),
  ('invalid flag boolean',save(values={'enabled':'false'}),'service_role','22023'),
  ('invalid flag pct',save(values={'rollout_pct':101}),'service_role','22023'),
  ('invalid fractional pct',save(values={'rollout_pct':0.5}),'service_role','22023'),
  ('invalid null pct',save(values={'rollout_pct':None}),'service_role','22023'),
  ('invalid key',save('flag:create',{'key':'BAD'},None),'service_role','22023'),
  ('invalid description',save('flag:create',{'key':'test','description':False},None),'service_role','22023'),
  ('invalid ticket status',save('ticket:update',{'ticket_status':'INVALID'},TICKET),'service_role','22023'),
  ('invalid ticket priority',save('ticket:update',{'priority':None},TICKET),'service_role','22023'),
  ('invalid ticket notes',save('ticket:update',{'ticket_notes':'x'*2001},TICKET),'service_role','22023'),
  ('invalid verification',save('facility:verify',{'is_verified':'false'},FACILITY),'service_role','22023'),
  ('invalid verification type',save('facility:verify',{'is_verified':True,'verified_type':'bad'},FACILITY),'service_role','22023'),
  ('wrong record',save(record='fe190001-0000-4000-8000-000000000099'),'service_role','P0002'),
  ('unknown operation',save('arbitrary:update',{'enabled':True}),'service_role','22023'),
  ('authenticated gateway',save(),'authenticated','42501'),('anon gateway',save(),'anon','42501'),
  ('normal direct flag write',f"UPDATE public.feature_flags SET enabled=true WHERE id='{FLAG}'",'authenticated','42501'),
 ]:
  reset();before=snapshot();actual=sql(attempt(statement,role));assert actual==code,(label,actual);assert snapshot()==before;RESULTS.append({'case':label,'sqlstate':actual})
 print(json.dumps({'cases':RESULTS,'actual_lock_waiters':sum(r.get('actual_lock_waiters',0) for r in RESULTS)},indent=2))
finally:
 sql(f"DELETE FROM public.feature_flags WHERE key IN ('isolated-platform-control','isolated-platform-create'); DELETE FROM public.contacts WHERE id='{TICKET}';DELETE FROM public.facility_profiles WHERE id='{FACILITY}';DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}');")

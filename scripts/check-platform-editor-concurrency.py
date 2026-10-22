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


ACTOR='fe190100-0000-4000-8000-000000000081'
OTHER='fe190100-0000-4000-8000-000000000082'
FEATURE='fe190101-0000-4000-8000-000000000081'
POST='fe190102-0000-4000-8000-000000000081'
CAMPAIGN='fe190103-0000-4000-8000-000000000081'
STOCK='https://example.invalid/legacy-fixture'
def q(v):return 'NULL' if v is None else "'"+str(v).replace("'","''")+"'"
def save(kind,values=None,record=None,actor=ACTOR,expected=None):
 if values is None:values={}
 return f"SELECT public.manage_platform_editor_atomic({q(actor)},{q(record)},{q(kind)},{q(json.dumps(values))}::jsonb,{q(expected)})->>'id'"
def attempt(statement,role='service_role'):
 return "CREATE FUNCTION pg_temp.editor_try(statement text) RETURNS text LANGUAGE plpgsql AS $try$ BEGIN EXECUTE statement; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $try$; SET ROLE "+role+"; SELECT pg_temp.editor_try($stmt$"+statement+"$stmt$)"
def reset():
 # Reconstruct only an owned historical row predating the NOT VALID constraint.
 # Restore the exact constraint before any gateway operation is tested. The
 # normal policy is independently asserted below; no provider or queue is run.
 sql(f"BEGIN; SET CONSTRAINTS ALL IMMEDIATE; DELETE FROM public.feature_articles WHERE id='{FEATURE}' OR title='Synthetic editor create'; DELETE FROM public.platform_blog_posts WHERE id='{POST}' OR slug='synthetic-editor-create'; DELETE FROM public.newsletter_campaigns WHERE id='{CAMPAIGN}' OR subject='Synthetic editor create'; INSERT INTO auth.users(id,email) VALUES('{ACTOR}','editor-owner@example.invalid'),('{OTHER}','editor-other@example.invalid') ON CONFLICT(id) DO NOTHING; UPDATE public.profiles SET is_platform_admin=true WHERE id IN ('{ACTOR}','{OTHER}'); INSERT INTO public.feature_articles(id,title,is_active) VALUES('{FEATURE}','Synthetic editor baseline',false); INSERT INTO public.platform_blog_posts(id,slug,title,is_published) VALUES('{POST}','synthetic-editor-baseline','Synthetic editor baseline',false); ALTER TABLE public.newsletter_campaigns DROP CONSTRAINT newsletter_manual_only; INSERT INTO public.newsletter_campaigns(id,campaign_type,subject,html_content,status,created_by) VALUES('{CAMPAIGN}','promo','Synthetic editor baseline','Synthetic','scheduled','{OTHER}'); ALTER TABLE public.newsletter_campaigns ADD CONSTRAINT newsletter_manual_only CHECK(status<>'scheduled') NOT VALID; COMMIT;")
def snapshot():
 return sql(f"SELECT jsonb_build_object('feature',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY id),'[]'::jsonb) FROM public.feature_articles f WHERE id='{FEATURE}' OR title='Synthetic editor create'),'post',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]'::jsonb) FROM public.platform_blog_posts b WHERE id='{POST}' OR slug='synthetic-editor-create'),'campaign',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY id),'[]'::jsonb) FROM public.newsletter_campaigns n WHERE id='{CAMPAIGN}' OR subject='Synthetic editor create'))")
try:
 assert 170000<=int(sql('SHOW server_version_num'))<180000
 constraint=sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='newsletter_manual_only' AND conrelid='public.newsletter_campaigns'::regclass")
 operations=[('feature:create',{'title':'Synthetic editor create','is_active':False},None),('feature:update',{'subtitle':'Synthetic update'},FEATURE),('feature:delete',{},FEATURE),('post:create',{'slug':'synthetic-editor-create','title':'Synthetic editor create','is_published':False},None),('post:update',{'description':'Synthetic update'},POST),('post:delete',{},POST),('newsletter:create',{'campaign_type':'promo','subject':'Synthetic editor create','html_content':'Synthetic'},None),('newsletter:cancel',{},CAMPAIGN)]
 for kind,values,record in operations:
  reset();before=snapshot();race(kind+' revocation first',f"UPDATE public.profiles SET is_platform_admin=false WHERE id='{ACTOR}'",attempt(save(kind,values,record)),'42501');assert snapshot()==before
  reset();race(kind+' write first','SET LOCAL ROLE service_role; '+save(kind,values,record),f"UPDATE public.profiles SET is_platform_admin=false WHERE id='{ACTOR}'; SELECT 'revoked'",'revoked')
  reset();race(kind+' account deletion first',f"DELETE FROM auth.users WHERE id='{ACTOR}'",attempt(save(kind,values,record)),'42501')
  reset()
  deletion=attempt(f"DELETE FROM auth.users WHERE id='{ACTOR}'",role='postgres')
  # Current account-retirement trigger clears the draft creator FK atomically.
  expected='OK'
  race(kind+' write before account deletion','SET LOCAL ROLE service_role; '+save(kind,values,record),deletion,expected)
  if kind=='newsletter:create':assert sql("SELECT created_by IS NULL FROM public.newsletter_campaigns WHERE subject='Synthetic editor create'")=='t'
 for kind,values,record,table,missing in [('feature:update',{'subtitle':'new'},FEATURE,'feature_articles','P0002'),('feature:delete',{},FEATURE,'feature_articles','P0002'),('post:update',{'description':'new'},POST,'platform_blog_posts','P0002'),('post:delete',{},POST,'platform_blog_posts','P0002'),('newsletter:cancel',{},CAMPAIGN,'newsletter_campaigns','40001')]:
  reset();race(kind+' target deletion first',f"DELETE FROM public.{table} WHERE id='{record}'",attempt(save(kind,values,record)),missing)
  reset();race(kind+' target write first','SET LOCAL ROLE service_role; '+save(kind,values,record),f"DELETE FROM public.{table} WHERE id='{record}';SELECT 'deleted'",'deleted')
 reset();sql(f"UPDATE public.feature_articles SET image_url={q(STOCK)} WHERE id='{FEATURE}'")
 race('distinct admin changes image before stale exemption','SET LOCAL ROLE service_role; '+save('feature:update',{'image_url':'https://example.invalid/new.png'},FEATURE,actor=OTHER),attempt(save('feature:update',{'image_url':STOCK},FEATURE,expected=STOCK)),'40001')
 assert sql(f"SELECT image_url FROM public.feature_articles WHERE id='{FEATURE}'")=='https://example.invalid/new.png'
 reset();sql(f"UPDATE public.feature_articles SET image_url={q(STOCK)} WHERE id='{FEATURE}'")
 assert sql(save('feature:update',{'image_url':STOCK,'subtitle':'unchanged image'},FEATURE,expected=STOCK))==FEATURE;RESULTS.append({'case':'unchanged legacy image accepted under lock'})
 reset();race('distinct admins preserve separate post fields','SET LOCAL ROLE service_role; '+save('post:update',{'title':'Synthetic other title'},POST),save('post:update',{'category':'Synthetic category'},POST,actor=OTHER),POST)
 assert sql(f"SELECT title||'/'||category FROM public.platform_blog_posts WHERE id='{POST}'")=='Synthetic other title/Synthetic category'
 reset();before=snapshot();race('rollback restores exact post','SET LOCAL ROLE service_role; '+save('post:update',{'description':'uncommitted'},POST),f"SELECT description FROM public.platform_blog_posts WHERE id='{POST}' FOR SHARE",'',finish='ROLLBACK;');assert snapshot()==before
 # The edit screen always resends is_published=true; re-saving a published post must keep its original date.
 published_at=lambda:sql(f"SELECT coalesce(published_at::text,'NULL') FROM public.platform_blog_posts WHERE id='{POST}'")
 reset();assert sql(save('post:update',{'is_published':True},POST))==POST;stamp=published_at();assert stamp!='NULL'
 assert sql(save('post:update',{'title':'Synthetic typo fixed','is_published':True},POST))==POST;assert published_at()==stamp;RESULTS.append({'case':'re-saving a published post keeps its original date'})
 assert sql(save('post:update',{'is_published':False},POST))==POST;assert published_at()=='NULL';RESULTS.append({'case':'unpublishing clears the date'})
 assert sql(save('post:update',{'is_published':True},POST))==POST;restamp=published_at();assert restamp not in ('NULL',stamp);RESULTS.append({'case':'republishing after unpublish assigns a new date'})
 reset();sql(f"UPDATE public.platform_blog_posts SET is_published=true,published_at=NULL WHERE id='{POST}'")
 assert sql(save('post:update',{'title':'Synthetic legacy','is_published':True},POST))==POST;assert published_at()!='NULL';RESULTS.append({'case':'legacy published post without a date gets one on save'})
 reset();race('distinct admins cancel once','SET LOCAL ROLE service_role; '+save('newsletter:cancel',{},CAMPAIGN),attempt(save('newsletter:cancel',{},CAMPAIGN,actor=OTHER)),'40001')
 for kind,values,record in operations:
  reset();before=snapshot();assert sql(attempt(save(kind,values,record),'authenticated'))=='42501';assert snapshot()==before;RESULTS.append({'case':kind+' authenticated gateway denied'})
 for label,stmt,code in [
  ('empty feature patch',save('feature:update',{},FEATURE),'22023'),
  ('image precondition wrong target',save('post:update',{'title':'Synthetic'},POST,expected=STOCK),'22023'),
  ('anonymous gateway',save('feature:update',{'title':'Synthetic'},FEATURE),'42501'),('unknown field',save('post:update',{'created_by':ACTOR},POST),'22023'),
  ('fractional order',save('feature:update',{'sort_order':0.5},FEATURE),'22023'),('fractional reading time',save('post:update',{'reading_time':1.5},POST),'22023'),
  ('invalid title type',save('feature:update',{'title':False},FEATURE),'22023'),('invalid slug',save('post:update',{'slug':'BAD'},POST),'22023'),
  ('invalid newsletter type',save('newsletter:create',{'campaign_type':'BAD','subject':'x','html_content':'x'}),'22023'),
  ('scheduled creation forbidden',save('newsletter:create',{'campaign_type':'promo','subject':'x','html_content':'x','scheduled_at':'2027-01-01'}),'22023'),
  ('direct new scheduled row forbidden',"INSERT INTO public.newsletter_campaigns(campaign_type,subject,html_content,status) VALUES('promo','Synthetic editor create','Synthetic','scheduled')",'23514'),
  ('normal feature direct write',f"UPDATE public.feature_articles SET title='bad' WHERE id='{FEATURE}'",'42501'),
 ]:
  reset();before=snapshot();role='authenticated' if label=='normal feature direct write' else 'anon' if label=='anonymous gateway' else 'service_role';actual=sql(attempt(stmt,role));assert actual==code,(label,actual);assert snapshot()==before;RESULTS.append({'case':label,'sqlstate':actual})
 assert sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='newsletter_manual_only' AND conrelid='public.newsletter_campaigns'::regclass")==constraint
 print(json.dumps({'cases':RESULTS,'actual_lock_waiters':sum(r.get('actual_lock_waiters',0) for r in RESULTS),'manual_only_constraint_restored':True,'provider_calls':0},indent=2))
finally:
 sql(f"DELETE FROM public.feature_articles WHERE id='{FEATURE}' OR title='Synthetic editor create'; DELETE FROM public.platform_blog_posts WHERE id='{POST}' OR slug='synthetic-editor-create'; DELETE FROM public.newsletter_campaigns WHERE id='{CAMPAIGN}' OR subject='Synthetic editor create';DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}');")

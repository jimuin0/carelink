"""Real PG17 catalog/blog/QA/job authority races in a disposable database only."""
import json, os, queue, subprocess, sys, threading, time

LOCAL = sys.argv[1:] == ['--local-shadow']
if not LOCAL:
    assert sys.argv[1:] == [] and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('CI') == 'true'
    assert os.environ.get('PGHOST') in ('localhost', '127.0.0.1') and os.environ.get('PGPORT') == '5432' and os.environ.get('PGUSER') == 'postgres'
    assert not any(os.environ.get(k) for k in ('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR'))
DB = 'carelink_shadow_content_write_20261017' if LOCAL else 'carelink_shadow'
ARGS = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', DB]
ACTOR = 'fa7d0000-0000-4000-8000-000000000001'
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
        b.send("SET application_name='carelink-content-write-waiter'; " + second + ';')
        deadline = time.monotonic() + 15; observed = False
        while time.monotonic() < deadline:
            if sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='carelink-content-write-waiter' AND state='active' AND wait_event_type='Lock';") == '1':
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

FACILITY='fa7d0001-0000-4000-8000-000000000001'
OTHER_FACILITY='fa7d0001-0000-4000-8000-000000000002'
RECORD='fa7d0002-0000-4000-8000-000000000001'
FOREIGN='fa7d0002-0000-4000-8000-000000000002'
OTHER='fa7d0000-0000-4000-8000-000000000002'
VALUES={'catalog:update':{'title':'Changed'},'catalog:delete':{},'job:update':{'title':'Changed'},'job:delete':{},'catalog:create':{'title':'Synthetic'},'blog:create':{'title':'Synthetic','slug':'synthetic-new','content':'Content','is_published':False},'blog:update':{'title':'Changed'},'blog:delete':{},'qa:answer':{'answer':'Synthetic answer'},'qa:toggle':{'is_public':True},'qa:delete':{},'job:create':{'title':'Synthetic','job_type':'Stylist','employment_type':'正社員'}}
def quoted(x): return 'NULL' if x is None else "'"+str(x).replace("'","''")+"'"
def save(kind,values=None,actor=ACTOR,record=RECORD):
    record=None if kind.endswith(':create') else record
    return f"SELECT public.manage_admin_content_atomic('{actor}','{FACILITY}',{quoted(record)},'{kind}',{quoted(json.dumps(VALUES[kind] if values is None else values))}::jsonb)"
def attempt(statement):
    return "CREATE FUNCTION pg_temp.content_try(statement text) RETURNS text LANGUAGE plpgsql AS $try$ BEGIN EXECUTE statement; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $try$; SET ROLE service_role; SELECT pg_temp.content_try("+quoted(statement)+");"
def reset():
    sql(f"DELETE FROM public.facility_profiles WHERE id IN ('{FACILITY}','{OTHER_FACILITY}'); DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}');")
    sql(f"INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('{ACTOR}','content-write@example.invalid',now()),('{OTHER}','content-other@example.invalid',now()); INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES('{FACILITY}','Synthetic content','synthetic-content-write','Other','P','C','A','draft'),('{OTHER_FACILITY}','Other synthetic','synthetic-content-other','Other','P','C','A','draft'); INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('{ACTOR}','{FACILITY}','owner'),('{OTHER}','{OTHER_FACILITY}','owner'); INSERT INTO public.treatment_catalogs(id,facility_id,title,tags) VALUES('{RECORD}','{FACILITY}','Original',ARRAY['original']),('{FOREIGN}','{OTHER_FACILITY}','Foreign',NULL); INSERT INTO public.facility_jobs(id,facility_id,title,job_type,employment_type) VALUES('{RECORD}','{FACILITY}','Original','Stylist','正社員'),('{FOREIGN}','{OTHER_FACILITY}','Foreign','Stylist','正社員'); INSERT INTO public.blog_posts(id,facility_id,title,slug,content,is_published) VALUES('{RECORD}','{FACILITY}','Original','synthetic-original','Original content',false),('{FOREIGN}','{OTHER_FACILITY}','Foreign','synthetic-foreign','Foreign',false); INSERT INTO public.facility_qa(id,facility_id,question) VALUES('{RECORD}','{FACILITY}','Synthetic question?'),('{FOREIGN}','{OTHER_FACILITY}','Foreign?');")
def snapshot():
    return json.loads(sql(f"SELECT jsonb_build_object('catalog',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.treatment_catalogs t WHERE facility_id='{FACILITY}'),'blog',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.blog_posts t WHERE facility_id='{FACILITY}'),'qa',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.facility_qa t WHERE facility_id='{FACILITY}'),'job',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.facility_jobs t WHERE facility_id='{FACILITY}'))"))
def expect(label,statement,expected):
    assert sql(attempt(statement))==expected,label
    RESULTS.append({'case':label,'result':expected})
assert sql('SELECT current_database()')==DB
assert sql(f"SELECT count(*) FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}')")=='0'
try:
    reset();sig='public.manage_admin_content_atomic(uuid,uuid,uuid,text,jsonb)'
    assert sql(f"SELECT has_function_privilege('service_role','{sig}','EXECUTE') AND NOT has_function_privilege('anon','{sig}','EXECUTE') AND NOT has_function_privilege('authenticated','{sig}','EXECUTE')")=='t'
    # Old direct privileged writes ignore already-committed member revocation.
    sql(f"DELETE FROM public.facility_members WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}'")
    sql(f"SET ROLE service_role; UPDATE public.treatment_catalogs SET title='Unauthorized edit' WHERE id='{RECORD}' AND facility_id='{FACILITY}'; UPDATE public.facility_jobs SET title='Unauthorized edit' WHERE id='{RECORD}' AND facility_id='{FACILITY}'; INSERT INTO public.treatment_catalogs(facility_id,title) VALUES('{FACILITY}','Unauthorized'); INSERT INTO public.blog_posts(facility_id,title,slug,content) VALUES('{FACILITY}','Unauthorized','unauthorized','Unauthorized'); UPDATE public.blog_posts SET title='Unauthorized edit' WHERE id='{RECORD}' AND facility_id='{FACILITY}'; UPDATE public.facility_qa SET answer='Unauthorized reply',answered_by='{ACTOR}',answered_at=now(),status='answered' WHERE id='{RECORD}' AND facility_id='{FACILITY}'; UPDATE public.facility_qa SET is_public=true WHERE id='{RECORD}' AND facility_id='{FACILITY}'; INSERT INTO public.facility_jobs(facility_id,title,job_type,employment_type) VALUES('{FACILITY}','Unauthorized','Stylist','正社員');")
    state=snapshot();assert len(state['catalog'])==2 and len(state['blog'])==2 and state['qa'][0]['is_public'] is True and len(state['job'])==2
    sql(f"SET ROLE service_role; DELETE FROM public.treatment_catalogs WHERE id='{RECORD}' AND facility_id='{FACILITY}'; DELETE FROM public.facility_jobs WHERE id='{RECORD}' AND facility_id='{FACILITY}'; DELETE FROM public.blog_posts WHERE id='{RECORD}' AND facility_id='{FACILITY}'; DELETE FROM public.facility_qa WHERE id='{RECORD}' AND facility_id='{FACILITY}';")
    state=snapshot();assert len(state['blog'])==1 and state['qa']==[] and len(state['catalog'])==1 and len(state['job'])==1
    RESULTS.append({'case':'old twelve operations after committed revocation reproduced','result':'REPRODUCED'})
    for kind in VALUES:
        reset();expect(kind+' owner succeeds',save(kind),'OK')
        state=snapshot()
        if kind=='blog:create': assert next(x for x in state['blog'] if x['slug']=='synthetic-new')['published_at'] is None
        if kind=='qa:answer': assert state['qa'][0]['answered_by']==ACTOR and state['qa'][0]['status']=='answered'
        if kind=='qa:toggle': assert state['qa'][0]['is_public'] is True
        reset();before=snapshot();expect(kind+' foreign actor denied',save(kind,actor=OTHER),'42501');assert snapshot()==before
        if not kind.endswith(':create'):
            expect(kind+' foreign record denied',save(kind,record=FOREIGN),'P0002');assert snapshot()==before
        for revoke in ('DELETE','STAFF'):
            command=f"DELETE FROM public.facility_members WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}'" if revoke=='DELETE' else f"UPDATE public.facility_members SET role='staff' WHERE user_id='{ACTOR}' AND facility_id='{FACILITY}'"
            reset();before=snapshot();race(kind+' revoke first '+revoke,command,attempt(save(kind)),'42501');assert snapshot()==before
            reset();race(kind+' save first '+revoke,'SET LOCAL ROLE service_role; '+save(kind),attempt(command),'OK')
        reset();before=snapshot();expect(kind+' cannot forge facility',save(kind,{**VALUES[kind],'facility_id':OTHER_FACILITY}),'22023');assert snapshot()==before
    reset();expect('published blog timestamp generated by DB',save('blog:create',{**VALUES['blog:create'],'is_published':True}),'OK');assert next(x for x in snapshot()['blog'] if x['slug']=='synthetic-new')['published_at'] is not None
    expect('publishing existing blog assigns timestamp',save('blog:update',{'is_published':True}),'OK');stamp=next(x for x in snapshot()['blog'] if x['id']==RECORD)['published_at'];assert stamp is not None
    expect('title edit preserves publication timestamp',save('blog:update',{'title':'Title only'}),'OK');assert next(x for x in snapshot()['blog'] if x['id']==RECORD)['published_at']==stamp
    expect('unpublish clears timestamp',save('blog:update',{'is_published':False}),'OK');assert next(x for x in snapshot()['blog'] if x['id']==RECORD)['published_at'] is None
    reset();sql(f"UPDATE public.blog_posts SET is_published=NULL WHERE id='{RECORD}'");expect('legacy null publication preserved on title-only edit',save('blog:update',{'title':'Legacy title'}),'OK');assert snapshot()['blog'][0]['is_published'] is None
    reset();before=snapshot();expect('answer cannot forge responder',save('qa:answer',{'answer':'A','answered_by':OTHER}),'22023');assert snapshot()==before
    sql("CREATE FUNCTION public.synthetic_content_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure' USING ERRCODE='23514'; END $$; CREATE TRIGGER synthetic_content_failure AFTER INSERT ON public.treatment_catalogs FOR EACH ROW EXECUTE FUNCTION public.synthetic_content_failure();")
    try:
        before=snapshot();expect('insert trigger failure leaves no content',save('catalog:create'),'23514');assert snapshot()==before
    finally: sql('DROP TRIGGER synthetic_content_failure ON public.treatment_catalogs; DROP FUNCTION public.synthetic_content_failure();')
    reset();sql(f"UPDATE public.facility_members SET role='admin' WHERE user_id='{ACTOR}'");expect('admin can edit content',save('blog:update'),'OK')
    print(json.dumps({'postgres':sql('SHOW server_version'),'cases':RESULTS,'case_count':len(RESULTS),'actual_lock_waiters':sum(r.get('actual_lock_waiters',0) for r in RESULTS)},indent=2))
finally:
    sql(f"DELETE FROM public.facility_profiles WHERE id IN ('{FACILITY}','{OTHER_FACILITY}'); DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}');")

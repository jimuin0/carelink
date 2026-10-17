"""Bounded disposable PG17 race proofs; never connects to a production DB."""
import json, os, queue, subprocess, sys, threading, time, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PSQL = 'psql'
LOCAL = sys.argv[1:] == ['--local-shadow']
if not LOCAL:
    assert sys.argv[1:] == []
    assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('CI') == 'true'
    assert os.environ.get('PGHOST') in ('localhost', '127.0.0.1')
    assert os.environ.get('PGPORT') == '5432' and os.environ.get('PGUSER') == 'postgres'
    assert not any(os.environ.get(k) for k in ('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR'))
DB = 'carelink_shadow_calendar_20261016' if LOCAL else 'carelink_shadow'
ARGS = [PSQL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', DB]
ACTOR = 'fc160000-0000-4000-8000-000000000001'
OTHER = 'fc160000-0000-4000-8000-000000000002'
BOOKING = 'fc160002-0000-4000-8000-000000000001'
FACILITY = 'fc160001-0000-4000-8000-000000000001'
TOKEN = 'fc160003-0000-4000-8000-000000000001'
REVISION = '2026-01-01T00:00:00Z'
CALENDAR = 'calendar-owner@example.invalid'
ROLE = 'carelink_calendar_retirement_fixture_' + str(os.getpid())
RESULTS = []

def sql(text, check=True):
    r = subprocess.run(ARGS, input=text, text=True, capture_output=True, timeout=30)
    if check and r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()

class Session:
    def __init__(self):
        self.proc = subprocess.Popen(ARGS, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.lines = queue.Queue()
        self.errors = []
        self.output_reader = threading.Thread(target=lambda: [self.lines.put(line.strip()) for line in self.proc.stdout], daemon=True)
        self.output_reader.start()
        self.error_reader = threading.Thread(target=lambda: self.errors.extend(self.proc.stderr.readlines()), daemon=True)
        self.error_reader.start()
    def send(self, text):
        self.proc.stdin.write(text + '\n'); self.proc.stdin.flush()
    def mark(self, name):
        self.send('\\echo ' + name)
        output = []
        while True:
            line = self.lines.get(timeout=15)
            if line == name: return output
            output.append(line)
    def end(self, text):
        try:
            self.send(text)
            self.proc.stdin.close()
        except BrokenPipeError:
            pass  # ON_ERROR_STOP already exited on the expected SQL rejection.
        code = self.proc.wait(timeout=25)
        self.error_reader.join(timeout=5)
        self.output_reader.join(timeout=5)
        return code, ''.join(self.errors)

def seed():
    sql((ROOT / 'supabase/shadow/calendar-operation-fixtures.sql').read_text())

def cleanup():
    # Only these synthetic identifiers in the exact disposable DB; owner fixture
    # cleanup intentionally does not confer DELETE privileges on service_role.
    sql(f"DELETE FROM public.calendar_sync_operations WHERE actor_id IN ('{ACTOR}','{OTHER}'); DELETE FROM public.bookings WHERE id='{BOOKING}'; DELETE FROM auth.users WHERE id IN ('{ACTOR}','{OTHER}'); DELETE FROM public.facility_profiles WHERE id='{FACILITY}';")

def prepare(op):
    return f"SET ROLE service_role; SELECT public.prepare_calendar_operation('{op}','{ACTOR}','{BOOKING}','sync','{{\"summary\":\"synthetic\",\"description\":\"\",\"location\":\"\",\"start\":{{}},\"end\":{{}},\"reminders\":{{}}}}'::jsonb,'{CALENDAR}','{TOKEN}','{REVISION}');"

def start(op):
    return f"SELECT public.start_calendar_operation('{op}','{ACTOR}','{CALENDAR}','{TOKEN}','{REVISION}');"

def target_delete(target):
    return f"SET ROLE {ROLE}; DELETE FROM auth.users WHERE id='{ACTOR}';" if target == 'account' else f"SET ROLE service_role; DELETE FROM public.bookings WHERE id='{BOOKING}';"

def retained(op):
    result = json.loads(sql(f"SELECT jsonb_build_object('actor',(SELECT count(*) FROM auth.users WHERE id='{ACTOR}'),'booking',(SELECT count(*) FROM public.bookings WHERE id='{BOOKING}'),'token',(SELECT count(*) FROM public.google_calendar_tokens WHERE id='{TOKEN}'),'intent',(SELECT count(*) FROM public.calendar_sync_operations WHERE id='{op}'))"))
    assert result == dict(actor=1,booking=1,token=1,intent=1), result

assert sql('SELECT current_database()') == DB
assert sql('SHOW server_version_num').startswith('17')
sql(f'CREATE ROLE {ROLE} NOLOGIN; GRANT USAGE ON SCHEMA auth TO {ROLE}; GRANT SELECT,DELETE ON auth.users TO {ROLE}; GRANT {ROLE} TO postgres;')
try:
    for isolation in ['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']:
        for target in ['account', 'booking']:
            for state in ['prepared', 'started']:
                seed(); op = str(uuid.uuid4()); session = Session()
                session.send(f'BEGIN ISOLATION LEVEL {isolation}; SELECT count(*) FROM public.calendar_sync_operations;')
                session.mark('SNAPSHOT_ESTABLISHED')
                created = json.loads(sql(prepare(op)))
                assert created['state'] == 'prepared'
                if state == 'started':
                    granted = json.loads(sql('SET ROLE service_role; ' + start(op)))
                    assert granted['dispatch'] is True
                code, error = session.end(target_delete(target) + ' COMMIT;')
                if state == 'started':
                    assert code != 0, f'Unsafe retirement committed: {isolation}/{target}/{state}'
                if code:
                    assert ('CALENDAR_OPERATION_PENDING' in error or '40001' in error), error
                    retained(op)
                    outcome = 'blocked-and-all-data-retained'
                else:
                    assert state == 'prepared'
                    assert sql(f"SELECT count(*) FROM public.calendar_sync_operations WHERE id='{op}'") == '0'
                    assert json.loads(sql('SET ROLE service_role; ' + start(op)))['state'] == 'conflict'
                    outcome = 'retired-without-dispatch'
                RESULTS.append(dict(isolation=isolation,target=target,state=state,order='snapshot-before-intent',outcome=outcome,sqlstate=('40001' if '40001' in error else '23503') if code else None))
                print(json.dumps(RESULTS[-1]), flush=True)
                cleanup()
            for start_after_snapshot in [False, True]:
                seed(); op = str(uuid.uuid4()); assert json.loads(sql(prepare(op)))['state'] == 'prepared'
                session = Session()
                session.send(f'BEGIN ISOLATION LEVEL {isolation}; SELECT count(*) FROM public.calendar_sync_operations;')
                session.mark('SNAPSHOT_ESTABLISHED')
                if start_after_snapshot:
                    assert json.loads(sql('SET ROLE service_role; ' + start(op)))['dispatch'] is True
                code, error = session.end(target_delete(target) + ' COMMIT;')
                if start_after_snapshot:
                    assert code != 0 and ('CALENDAR_OPERATION_PENDING' in error or '40001' in error), error
                    retained(op)
                    outcome = 'concurrent-start-retained'
                else:
                    assert code == 0, error
                    assert sql(f"SELECT count(*) FROM public.calendar_sync_operations WHERE id='{op}'") == '0'
                    assert json.loads(sql('SET ROLE service_role; ' + start(op)))['state'] == 'conflict'
                    outcome = 'undispatched-retirement-succeeds'
                RESULTS.append(dict(isolation=isolation,target=target,order='prepared-before-snapshot',start_after_snapshot=start_after_snapshot,outcome=outcome,sqlstate=('40001' if '40001' in error else '23503') if code else None))
                print(json.dumps(RESULTS[-1]), flush=True)
                cleanup()
            # Deletion owns the parent row first. An actual PG lock waiter is
            # observed before committing; no sleep-based guess about overlap.
            seed(); op = str(uuid.uuid4()); deleting = Session()
            deleting.send('BEGIN; ' + target_delete(target))
            deleting.mark('DELETE_HELD')
            preparing = Session()
            app = 'calendar-retirement-proof-' + str(uuid.uuid4())
            preparing.send(f"SET application_name='{app}'; BEGIN ISOLATION LEVEL {isolation}; " + prepare(op))
            deadline = time.monotonic() + 15
            while sql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{app}' AND wait_event_type='Lock'") != '1':
                assert time.monotonic() < deadline, 'No actual lock overlap observed'
                time.sleep(.05)
            assert deleting.end('COMMIT;')[0] == 0
            code, error = preparing.end('COMMIT;')
            output = []
            while not preparing.lines.empty(): output.append(preparing.lines.get_nowait())
            if code == 0:
                assert any('"state": "not_found"' in line for line in output), output
            else:
                assert '40001' in error, error
            assert sql(f"SELECT count(*) FROM public.calendar_sync_operations WHERE id='{op}'") == '0'
            RESULTS.append(dict(isolation=isolation,target=target,order='delete-before-prepare',actual_lock_waiter=True,outcome='no-intent-no-dispatch',sqlstate='40001' if code else None))
            print(json.dumps(RESULTS[-1]), flush=True)
            cleanup()
finally:
    cleanup()
    sql(f'DROP OWNED BY {ROLE}; DROP ROLE {ROLE};')
    print(json.dumps(dict(database=DB,cases=RESULTS,production_mutations=False,google_requests=0)), flush=True)
assert len(RESULTS) == 30

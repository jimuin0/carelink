import { execFileSync } from 'node:child_process';
import { UUID_REGEX } from '../src/lib/constants';

// Historical application fixtures are database-owner imports, never application
// service-role writes or fabricated fresh consent. The owner exception exists
// for maintenance; this helper can reach only the managed disposable CI DB.
const columns = ['id','email','facility_name','business_type','phone','representative_name',
  'contact_name','source','prefecture','city','address','building_name','is_public','status','created_at'];
export function seedSyntheticSalonHistory(rows: Readonly<Record<string, unknown>>[]) {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
    || process.env.RESEND_API_KEY || process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) {
    throw new Error('Synthetic history requires the managed disposable CI lifecycle');
  }
  if (!Array.isArray(rows) || !rows.length || rows.length>500 || rows.some(row=>typeof row.id!=='string' || !UUID_REGEX.test(row.id)
    || typeof row.email!=='string' || !/^[^@]+@example\.invalid$/.test(row.email)
    || !['register','recruit'].includes(String(row.source))
    || Object.keys(row).some(key=>!columns.includes(key)))) {
    throw new Error('Only bounded synthetic historical applications are permitted');
  }
  const fields=columns.filter(column=>rows.some(row=>Object.hasOwn(row,column)));
  const encoded=Buffer.from(JSON.stringify(rows)).toString('base64');
  execFileSync('docker',['exec','-i','supabase_db_carelink','psql','-U','postgres','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1'],{
    env:{PATH:process.env.PATH,DOCKER_HOST:'unix:///var/run/docker.sock'},
    input:`BEGIN; DO $$ BEGIN IF current_database()<>'postgres' OR current_user<>'postgres'
      OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
      THEN RAISE EXCEPTION 'disposable owner import required'; END IF; END $$;
      INSERT INTO public.salons(${fields.join(',')}) SELECT ${fields.map(field=>'p.'+field).join(',')}
      FROM jsonb_populate_recordset(NULL::public.salons,convert_from(decode('${encoded}','base64'),'UTF8')::jsonb) p;
      COMMIT;`,stdio:['pipe','pipe','pipe'],timeout:30000,
  });
}

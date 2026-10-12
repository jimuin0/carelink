/** @jest-environment node */
jest.mock('node:child_process',()=>({execFileSync:jest.fn()}));
import { execFileSync } from 'node:child_process';
import { seedSyntheticSalonHistory } from '../../e2e/synthetic-salon-history';
const env={...process.env};
const row={id:'11111111-1111-4111-8111-111111111111',email:'synthetic@example.invalid',source:'register',facility_name:'Synthetic history'};
beforeEach(()=>{
 jest.clearAllMocks();process.env.CI='true';process.env.GITHUB_ACTIONS='true';
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://localhost:54330';process.env.PLAYWRIGHT_BASE_URL='https://localhost:3000';
 delete process.env.RESEND_API_KEY;delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
});
afterEach(()=>{process.env={...env};});
test.each([{CI:'false'},{GITHUB_ACTIONS:'false'},{NEXT_PUBLIC_SUPABASE_URL:'https://production.invalid'},
 {PLAYWRIGHT_BASE_URL:'https://carelink-jp.com'},{RESEND_API_KEY:'synthetic-key'},{LINE_CHANNEL_ACCESS_TOKEN_CARELINK:'synthetic-token'}])('refuses unsafe fixture environment %#',bad=>{
 Object.assign(process.env,bad);expect(()=>seedSyntheticSalonHistory([row])).toThrow('managed disposable');expect(execFileSync).not.toHaveBeenCalled();
});
test.each([[],Array(501).fill(row),[{...row,email:'real@gmail.com'}],[{...row,id:'bad'}],[{...row,source:'other'}],[{...row,unexpected:'field'}]].map(rows=>({rows})))('refuses invalid historical fixture %#',({rows})=>{
 expect(()=>seedSyntheticSalonHistory(rows)).toThrow('bounded synthetic');expect(execFileSync).not.toHaveBeenCalled();
});
test('safe historical seed uses only fixed local Docker and encodes content without fabricating consent',()=>{
 seedSyntheticSalonHistory([{...row,facility_name:"Synthetic ' ); DROP TABLE salons; --"}]);
 const call=(execFileSync as jest.Mock).mock.calls[0];
 expect(call[0]).toBe('docker');expect(call[1]).toContain('supabase_db_carelink');
 expect(call[2].env).toEqual({PATH:process.env.PATH,DOCKER_HOST:'unix:///var/run/docker.sock'});
 expect(call[2].input).not.toContain('DROP TABLE salons');expect(call[2].input).not.toContain('registration_terms_sha256');
 expect(call[2].input).toContain("current_user<>'postgres'");
});

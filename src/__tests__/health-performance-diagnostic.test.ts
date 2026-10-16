/** @jest-environment node */
import {healthPerformanceDiagnostic} from '../../e2e/helpers/health-performance-diagnostic';
test('attaches only allowlisted timing and state, never dependency content or arbitrary headers',()=>{
 const result=healthPerformanceDiagnostic(1184,200,{elapsed_ms:35,deps:{supabase:{ok:true,elapsed_ms:33,error:'private-password',url:'private-url'},cron:{ok:false,elapsed_ms:35,retried:true,skipped:false,note:'private-key'},private:{token:'private-token'}},token:'private-token'},'gate;dur=12.3, checks;dur=35.1, app;dur=47.5, secret;dur=99');
 expect(result.server_timing_ms).toEqual({gate:12.3,checks:35.1,app:47.5});expect(result.dependencies.supabase).toEqual({ok:true,elapsed_ms:33,retried:null,skipped:null});expect(JSON.stringify(result)).not.toMatch(/private|secret/);
});
test.each([null,[],{elapsed_ms:'private-key',deps:{supabase:{elapsed_ms:-1,ok:'private-key'},cron:{elapsed_ms:Infinity,skipped:1}}}])('malformed body %j cannot leak strings or make invalid timing valid',body=>{
 const result=healthPerformanceDiagnostic(NaN,503,body,'gate;dur=private-key, app;dur=-3');expect(result.client_elapsed_ms).toBeNull();expect(result.route_elapsed_ms).toBeNull();expect(result.server_timing_ms).toEqual({gate:null,checks:null,app:null});expect(JSON.stringify(result)).not.toContain('private-key');
});

/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { resolveVerifiedLineOwner } from '../verified-line-owner';
const verified = {user_id:'actor',proof_version:1,verified_at:'2026-10-09T00:00:00Z'};
function client(profile:any={id:'actor'},link:any=verified,profileError:any=null,linkError:any=null):any {
  return {from:jest.fn((table:string)=>{const q:any={};q.select=jest.fn(()=>q);q.eq=jest.fn(()=>q);q.maybeSingle=jest.fn().mockResolvedValue(table==='profiles'?{data:profile,error:profileError}:{data:link,error:linkError});return q;})};
}
test('only both verified matching halves return an actor', async()=>{
  const db=client();expect(await resolveVerifiedLineOwner(db,'U_provider')).toBe('actor');
  const q=db.from.mock.results[1].value;expect(q.eq).toHaveBeenCalledWith('line_user_id','U_provider');expect(q.eq).toHaveBeenCalledWith('user_id','actor');
});
test.each([null,{}, {id:1},{id:''}])('missing/malformed profile %p grants no authority',async p=>expect(await resolveVerifiedLineOwner(client(p),'U_provider')).toBeNull());
test.each([null,{...verified,user_id:null},{...verified,user_id:'other'},{...verified,proof_version:null},{...verified,proof_version:2},{...verified,verified_at:null},{...verified,verified_at:'invalid'}])('legacy/mismatched link %p grants no authority',async l=>expect(await resolveVerifiedLineOwner(client(undefined,l),'U_provider')).toBeNull());
test.each([null,{id:'actor'}])('profile data+error %p is never accepted',async p=>expect(resolveVerifiedLineOwner(client(p,verified,{code:'XX000'}),'U_provider')).rejects.toThrow('profile lookup unavailable'));
test.each([null,verified])('link data+error %p is never accepted',async l=>expect(resolveVerifiedLineOwner(client(undefined,l,null,{code:'XX000'}),'U_provider')).rejects.toThrow('ownership lookup unavailable'));

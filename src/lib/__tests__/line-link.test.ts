import { resolveLineUserIdForUser, resolveLineUserIdsForUsers } from '../line-link';
const verified={user_id:'actor',line_user_id:'U_owned',proof_version:1,verified_at:'2026-10-09T00:00:00Z'};
function client(profile:any={line_user_id:'U_owned'},link:any=verified,profileError:any=null,linkError:any=null):any {
  return {from:jest.fn((table:string)=>{const q:any={};q.select=jest.fn(()=>q);q.eq=jest.fn(()=>q);q.in=jest.fn().mockResolvedValue(table==='profiles'?{data:profile,error:profileError}:{data:link,error:linkError});q.maybeSingle=jest.fn().mockResolvedValue(table==='profiles'?{data:profile,error:profileError}:{data:link,error:linkError});return q;})};
}
test('only matching verified ownership resolves an outbound recipient',async()=>expect(await resolveLineUserIdForUser(client(),'actor')).toBe('U_owned'));
test.each([null,{}, {line_user_id:null}])('empty profile %p has no recipient',async p=>expect(await resolveLineUserIdForUser(client(p),'actor')).toBeNull());
test.each([null,{...verified,user_id:null},{...verified,user_id:'other'},{...verified,line_user_id:'U_other'},{...verified,proof_version:null},{...verified,verified_at:null},{...verified,verified_at:'invalid'}])('legacy/mismatched outbound link %p never sends',async l=>expect(await resolveLineUserIdForUser(client(undefined,l),'actor')).toBeNull());
test.each([null,{line_user_id:'U_owned'}])('profile data+error %p remains unavailable',async p=>expect(resolveLineUserIdForUser(client(p,verified,{code:'XX000'}),'actor')).rejects.toThrow('profile lookup unavailable'));
test.each([null,verified])('link data+error %p remains unavailable',async l=>expect(resolveLineUserIdForUser(client(undefined,l,null,{code:'XX000'}),'actor')).rejects.toThrow('ownership lookup unavailable'));
test('bulk empty input avoids reads',async()=>{const db=client();expect(await resolveLineUserIdsForUsers(db,[])).toEqual(new Map());expect(db.from).not.toHaveBeenCalled();});
test('bulk resolves only verified current matching pairs',async()=>{
 const profiles=[{id:'actor',line_user_id:'U_owned'},{id:'legacy',line_user_id:'U_legacy'},{id:'other',line_user_id:'U_other'}];
 const links=[verified,{...verified,user_id:null},{...verified,line_user_id:null},{...verified,user_id:'other',line_user_id:'U_wrong'},{...verified,user_id:'legacy',line_user_id:'U_legacy',proof_version:null},{...verified,user_id:'legacy',line_user_id:'U_legacy',verified_at:null},{...verified,user_id:'legacy',line_user_id:'U_legacy',verified_at:'invalid'}];
 expect(await resolveLineUserIdsForUsers(client(profiles,links),['actor','other','legacy'])).toEqual(new Map([['actor','U_owned']]));
});
test.each([[null,null],[[],null],[null,[verified]]])('bulk nullable reads %p %p grant no recipient',async(p,l)=>expect(await resolveLineUserIdsForUsers(client(p,l),['actor'])).toEqual(new Map()));
test('bulk profile read failure cannot become empty success',async()=>expect(resolveLineUserIdsForUsers(client(null,[],{code:'XX000'}),['actor'])).rejects.toThrow('profile lookup unavailable'));
test('bulk link read failure cannot become empty success',async()=>expect(resolveLineUserIdsForUsers(client([],null,null,{code:'XX000'}),['actor'])).rejects.toThrow('ownership lookup unavailable'));

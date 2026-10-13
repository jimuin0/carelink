/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {checkScheduledEmailRecipient} from '../scheduled-email-recipient';
const id='11111111-1111-4111-8111-111111111111';
const payload={scheduled_email_version:1,scheduled_kind:'favorites_digest',scheduled_user_id:id};
const user={id,email:'synthetic@example.invalid',email_confirmed_at:'2026-10-13T00:00:00Z'};
const getUserById=jest.fn();const db={auth:{admin:{getUserById}}} as any;
beforeEach(()=>{getUserById.mockReset().mockResolvedValue({data:{user},error:null});});
test('review recipient is authoritatively checked against its booking by SQL, no Auth lookup',async()=>{
 expect(await checkScheduledEmailRecipient(db,{scheduled_email_version:1,scheduled_kind:'review_request'},user.email)).toBe(true);
 expect(getUserById).not.toHaveBeenCalled();
});
test('digest uses current verified Auth identity',async()=>{
 expect(await checkScheduledEmailRecipient(db,payload,user.email)).toBe(true);expect(getUserById).toHaveBeenCalledWith(id);
});
test.each([{id:'other'},{email:'other@example.invalid'},{email_confirmed_at:null},{email_confirmed_at:'invalid'}])('recipient changed or unverified prevents dispatch %#',async patch=>{
 getUserById.mockResolvedValue({data:{user:{...user,...patch}},error:null});expect(await checkScheduledEmailRecipient(db,payload,user.email)).toBe(false);
});
test.each([{data:{user:null},error:null},{data:{user},error:{message:'unavailable'}}])('lookup uncertainty is not consent %#',async result=>{
 getUserById.mockResolvedValue(result);await expect(checkScheduledEmailRecipient(db,payload,user.email)).rejects.toThrow('identity unavailable');
});
test('malformed operation never queries Auth',async()=>{
 await expect(checkScheduledEmailRecipient(db,{...payload,scheduled_user_id:'invalid'},user.email)).rejects.toThrow();expect(getUserById).not.toHaveBeenCalled();
});

/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {applyCompletionSideEffects,type CompletableBooking} from '../booking-completion';
import {awardReferralPointsOnCompletion} from '../referral';
jest.mock('../referral',()=>({awardReferralPointsOnCompletion:jest.fn().mockResolvedValue(undefined)}));
const base:CompletableBooking={id:'b1',facility_id:'f1',user_id:'u1',customer_name:'Synthetic',email:null,booking_date:'2030-01-07',total_price:5000,menu_id:null,staff_id:null};
const from=jest.fn(()=>{throw new Error('point and visit persistence must be inside the booking transaction');});
const admin={from} as unknown as Parameters<typeof applyCompletionSideEffects>[0];
beforeEach(()=>jest.clearAllMocks());
test('保存後のhelperはポイントや来店履歴を二重保存しない',async()=>{expect(await applyCompletionSideEffects(admin,base)).toBe(50);expect(from).not.toHaveBeenCalled();expect(awardReferralPointsOnCompletion).toHaveBeenCalledWith(admin,'u1');});
test.each([null,0,-100,50,99])('金額%sは0ポイント',async total_price=>expect(await applyCompletionSideEffects(admin,{...base,total_price})).toBe(0));
test.each([[100,1],[5099,50]])('金額%sは%sポイント',async(total_price,expected)=>expect(await applyCompletionSideEffects(admin,{...base,total_price})).toBe(expected));
test('ゲストは紹介や台帳へ触れない',async()=>{expect(await applyCompletionSideEffects(admin,{...base,user_id:null})).toBe(0);expect(from).not.toHaveBeenCalled();expect(awardReferralPointsOnCompletion).not.toHaveBeenCalled();});

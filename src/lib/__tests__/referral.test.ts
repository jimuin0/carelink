/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {awardReferralPointsOnCompletion} from '../referral';
const mockAlert=jest.fn();jest.mock('../alert',()=>({alertCaughtError:(...args:unknown[])=>mockAlert(...args)}));
const mockCapture=jest.fn();jest.mock('../safe',()=>({safeCaptureException:(...args:unknown[])=>mockCapture(...args)}));
beforeEach(()=>jest.clearAllMocks());
test.each([true,false])('原子的CAS+両者付与の結果%sで別INSERTしない',async data=>{
 const rpc=jest.fn().mockResolvedValue({data,error:null}),from=jest.fn();
 await awardReferralPointsOnCompletion({rpc,from} as unknown as Parameters<typeof awardReferralPointsOnCompletion>[0],'u1');
 expect(rpc).toHaveBeenCalledWith('award_referral_points_atomic',{p_user_id:'u1'});expect(from).not.toHaveBeenCalled();expect(mockCapture).not.toHaveBeenCalled();
});
test.each([null,true])('原子付与失敗・結果%sは監視し、別INSERTしない',async data=>{
 const error={message:'synthetic rollback'},rpc=jest.fn().mockResolvedValue({data,error}),from=jest.fn();
 await awardReferralPointsOnCompletion({rpc,from} as unknown as Parameters<typeof awardReferralPointsOnCompletion>[0],'u1');
 expect(mockCapture).toHaveBeenCalledWith(error,'referral-award-points');expect(from).not.toHaveBeenCalled();
});


test('RPC通信例外でもpendingを可視化し、本体を妨げない',async()=>{
 const error=new Error('synthetic connection failure');const rpc=jest.fn().mockRejectedValue(error);
 await awardReferralPointsOnCompletion({rpc} as unknown as Parameters<typeof awardReferralPointsOnCompletion>[0],'u1');
 expect(mockAlert).toHaveBeenCalledWith('referral-award-points',error,'booking-completion');
});
test.each([null,undefined,'true'])('結果不明%sをボーナス付与済みにしない',async data=>{
 const rpc=jest.fn().mockResolvedValue({data,error:null});
 await awardReferralPointsOnCompletion({rpc} as unknown as Parameters<typeof awardReferralPointsOnCompletion>[0],'u1');
 expect(mockAlert).toHaveBeenCalledWith('referral-award-points',expect.any(Error),'booking-completion');
});

import { reverseCompletionSideEffects } from '../booking-completion-reversal';
test('ポイント取り消しのみ実行し、来店履歴は原子的DB triggerへ任せる',async () => {
 const eq=jest.fn().mockResolvedValue({ error:null });
 const from=jest.fn(() => ({ delete:()=>({ eq }) }));
 await reverseCompletionSideEffects({ from } as unknown as Parameters<typeof reverseCompletionSideEffects>[0],'b1');
 expect(from).toHaveBeenCalledTimes(1);
 expect(from).toHaveBeenCalledWith('user_points');
 expect(eq).toHaveBeenCalledWith('booking_id','b1');
});
test('ポイント取り消しの失敗は可視化する',async () => {
 const spy=jest.spyOn(console,'error').mockImplementation(()=>{});
 try {
 const from=jest.fn(() => ({ delete:()=>({ eq:()=>Promise.resolve({ error:{ message:'synthetic failure' } }) }) }));
 await reverseCompletionSideEffects({ from } as unknown as Parameters<typeof reverseCompletionSideEffects>[0],'b1');
 expect(spy).toHaveBeenCalled();
 } finally { spy.mockRestore(); }
});

import {reverseCompletionSideEffects} from '../booking-completion-reversal';
test('保存後にポイント履歴を削除しない。取消補償は状態と同じtransactionで完了済み',async()=>{
 const from=jest.fn(()=>{throw new Error('destructive compensation is forbidden');});
 await reverseCompletionSideEffects({from} as unknown as Parameters<typeof reverseCompletionSideEffects>[0],'b1');
 expect(from).not.toHaveBeenCalled();
});

/** @jest-environment @stryker-mutator/jest-runner/jest-env/jsdom */
import { withReviewTransportFence, readReviewFence, finishReviewFence, validateRetainedReviewFences } from '../review-transport-fence';
let mockCleanupNeeded=false;
jest.mock('../client-cleanup-marker',()=>({hasClientCleanupNeeded:()=>mockCleanupNeeded}));
beforeEach(()=>{jest.restoreAllMocks();mockCleanupNeeded=false;localStorage.clear();let queue=Promise.resolve();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_key:string,_options:unknown,task:()=>Promise<unknown>)=>{const next=queue.then(task);queue=next.then(()=>undefined,()=>undefined);return next;}}});});
// 2026-10-23: a lost first result no longer blocks forever. The second attempt
// waits for the lock, then RESUMES the first operation id (the server returns
// the earlier review if it was saved), instead of starting a new operation.
test('competing tabs serialize before HTTP; a lost first result is resumed with the same operation',async()=>{
 let release!:()=>void;const second=jest.fn(async()=>undefined);const first=withReviewTransportFence('facility','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',async(operation,mode)=>{expect([operation,mode]).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','new']);await new Promise<void>(r=>{release=r;});});
 await Promise.resolve();const another=withReviewTransportFence('facility','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',second);expect(second).not.toHaveBeenCalled();release();await first;
 await another;expect(second).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','resume');expect(readReviewFence('facility')).toBe('v2:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});
test('an unreadable storage is never treated as "no earlier attempt"',()=>{
 jest.spyOn(Storage.prototype,'getItem').mockImplementationOnce(()=>{throw new Error('blocked');});expect(()=>readReviewFence('facility')).toThrow('UNCONFIRMED');
});
test('a browser without exclusive locks never sends',async()=>{
 Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});const action=jest.fn();
 await expect(withReviewTransportFence('facility','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',action)).rejects.toThrow('投稿結果の保護');expect(action).not.toHaveBeenCalled();
});
test('a corrupted fence is never sent as an operation',async()=>{
 localStorage.setItem('review-submission-pending:facility','not-an-operation');const action=jest.fn();
 await expect(withReviewTransportFence('facility','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',action)).rejects.toThrow('UNCONFIRMED');expect(action).not.toHaveBeenCalled();
});
test('only matching operation confirmation clears the fence; readback failure blocks',async()=>{
 await withReviewTransportFence('facility','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',async()=>undefined);expect(()=>finishReviewFence('facility','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toThrow();expect(readReviewFence('facility')).toBe('v2:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 finishReviewFence('facility','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');expect(readReviewFence('facility')).toBeNull();
 jest.spyOn(Storage.prototype,'setItem').mockImplementationOnce(()=>{});await expect(withReviewTransportFence('facility','cccccccc-cccc-4ccc-8ccc-cccccccccccc',async()=>undefined)).rejects.toThrow();
});
test('logout cleanup retains UUID-only uncertain receipt fences and does not retain any input',async()=>{
 localStorage.setItem('theme','dark');await withReviewTransportFence('one','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',async()=>undefined);validateRetainedReviewFences();expect(readReviewFence('one')).toBe('v2:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');expect(localStorage.getItem('theme')).toBe('dark');
});

test('pending personal cleanup blocks transport reads and non-UUID input is never persisted as a fence',async()=>{
 mockCleanupNeeded=true;expect(()=>readReviewFence('facility')).toThrow('UNCONFIRMED');mockCleanupNeeded=false;
 await expect(withReviewTransportFence('facility','private name',async()=>undefined)).rejects.toThrow('UNCONFIRMED');expect(readReviewFence('facility')).toBeNull();
});
test('a silent marker removal failure does not claim a confirmed local clear',async()=>{
 const operation='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';await withReviewTransportFence('facility',operation,async()=>undefined);
 jest.spyOn(Storage.prototype,'removeItem').mockImplementationOnce(()=>{});expect(()=>finishReviewFence('facility',operation)).toThrow('UNCONFIRMED');expect(readReviewFence('facility')).toBe('v2:'+operation);
});
test('unknown enumeration or corrupted marker requires inspection and cannot be silently purged',()=>{
 localStorage.setItem('theme','dark');jest.spyOn(Storage.prototype,'key').mockReturnValueOnce(null);expect(()=>validateRetainedReviewFences()).toThrow('UNCONFIRMED');
 localStorage.setItem('review-submission-pending:facility','not-an-operation');expect(()=>validateRetainedReviewFences()).toThrow('UNCONFIRMED');expect(localStorage.getItem('review-submission-pending:facility')).toBe('not-an-operation');
});

// 2026-10-23 review: fences written before the server stored operation ids are
// told apart from new ones. A bare UUID is resumed in 'legacy' mode so the
// server looks for the reviewer's earlier review instead of trusting the id.
test('a bare-UUID fence from the old form is resumed in legacy mode and finishes by its id',async()=>{
 localStorage.setItem('review-submission-pending:facility','dddddddd-dddd-4ddd-8ddd-dddddddddddd');const action=jest.fn(async()=>undefined);
 await withReviewTransportFence('facility','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',action);expect(action).toHaveBeenCalledWith('dddddddd-dddd-4ddd-8ddd-dddddddddddd','legacy');
 validateRetainedReviewFences();finishReviewFence('facility','dddddddd-dddd-4ddd-8ddd-dddddddddddd');expect(readReviewFence('facility')).toBeNull();
});
test('a new fence is stored with its version and only its own id clears it',async()=>{
 await withReviewTransportFence('facility','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',async()=>undefined);expect(localStorage.getItem('review-submission-pending:facility')).toBe('v2:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 expect(()=>finishReviewFence('facility','v2:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toThrow('UNCONFIRMED');
 expect(()=>finishReviewFence('other','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toThrow('UNCONFIRMED');
});
test('a versioned fence without a valid id is never sent and never purged silently',async()=>{
 localStorage.setItem('review-submission-pending:facility','v2:not-an-operation');const action=jest.fn();
 await expect(withReviewTransportFence('facility','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',action)).rejects.toThrow('UNCONFIRMED');expect(action).not.toHaveBeenCalled();
 expect(()=>validateRetainedReviewFences()).toThrow('UNCONFIRMED');expect(()=>finishReviewFence('facility','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toThrow('UNCONFIRMED');
});
test('a fence key whose value cannot be read back requires inspection',()=>{
 localStorage.setItem('review-submission-pending:facility','v2:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');jest.spyOn(Storage.prototype,'getItem').mockReturnValueOnce(null);
 expect(()=>validateRetainedReviewFences()).toThrow('UNCONFIRMED');
});

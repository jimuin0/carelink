/** @jest-environment @stryker-mutator/jest-runner/jest-env/jsdom */
import { withReviewTransportFence, readReviewFence, finishReviewFence, validateRetainedReviewFences } from '../review-transport-fence';
let mockCleanupNeeded=false;
jest.mock('../client-cleanup-marker',()=>({hasClientCleanupNeeded:()=>mockCleanupNeeded}));
beforeEach(()=>{jest.restoreAllMocks();mockCleanupNeeded=false;localStorage.clear();let queue=Promise.resolve();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_key:string,_options:unknown,task:()=>Promise<unknown>)=>{const next=queue.then(task);queue=next.then(()=>undefined,()=>undefined);return next;}}});});
test('competing tabs serialize before HTTP; a lost first result blocks the second',async()=>{
 let release!:()=>void;const second=jest.fn();const first=withReviewTransportFence('facility','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',()=>new Promise<void>(r=>{release=r;}));
 await Promise.resolve();const another=withReviewTransportFence('facility','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',second);expect(second).not.toHaveBeenCalled();release();await first;
 await expect(another).rejects.toThrow('UNCONFIRMED');expect(second).not.toHaveBeenCalled();expect(readReviewFence('facility')).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});
test('only matching operation confirmation clears the fence; readback failure blocks',async()=>{
 await withReviewTransportFence('facility','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',async()=>undefined);expect(()=>finishReviewFence('facility','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toThrow();expect(readReviewFence('facility')).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 finishReviewFence('facility','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');expect(readReviewFence('facility')).toBeNull();
 jest.spyOn(Storage.prototype,'setItem').mockImplementationOnce(()=>{});await expect(withReviewTransportFence('facility','cccccccc-cccc-4ccc-8ccc-cccccccccccc',async()=>undefined)).rejects.toThrow();
});
test('logout cleanup retains UUID-only uncertain receipt fences and does not retain any input',async()=>{
 localStorage.setItem('theme','dark');await withReviewTransportFence('one','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',async()=>undefined);validateRetainedReviewFences();expect(readReviewFence('one')).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');expect(localStorage.getItem('theme')).toBe('dark');
});

test('pending personal cleanup blocks transport reads and non-UUID input is never persisted as a fence',async()=>{
 mockCleanupNeeded=true;expect(()=>readReviewFence('facility')).toThrow('UNCONFIRMED');mockCleanupNeeded=false;
 await expect(withReviewTransportFence('facility','private name',async()=>undefined)).rejects.toThrow('UNCONFIRMED');expect(readReviewFence('facility')).toBeNull();
});
test('a silent marker removal failure does not claim a confirmed local clear',async()=>{
 const operation='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';await withReviewTransportFence('facility',operation,async()=>undefined);
 jest.spyOn(Storage.prototype,'removeItem').mockImplementationOnce(()=>{});expect(()=>finishReviewFence('facility',operation)).toThrow('UNCONFIRMED');expect(readReviewFence('facility')).toBe(operation);
});
test('unknown enumeration or corrupted marker requires inspection and cannot be silently purged',()=>{
 localStorage.setItem('theme','dark');jest.spyOn(Storage.prototype,'key').mockReturnValueOnce(null);expect(()=>validateRetainedReviewFences()).toThrow('UNCONFIRMED');
 localStorage.setItem('review-submission-pending:facility','not-an-operation');expect(()=>validateRetainedReviewFences()).toThrow('UNCONFIRMED');expect(localStorage.getItem('review-submission-pending:facility')).toBe('not-an-operation');
});

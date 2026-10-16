/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {readPageResult} from '../page-read-verification';
import {safeCaptureException} from '../safe';
jest.mock('../safe',()=>({safeCaptureException:jest.fn()}));
beforeEach(()=>jest.clearAllMocks());
test.each([null,[],[{id:'synthetic'}]])('successful nullable/empty/data result %j is retained',async data=>{const result={data,error:null};expect(await readPageResult(async()=>result,'synthetic-page')).toBe(result);expect(safeCaptureException).not.toHaveBeenCalled();});
test.each(['data-error','null-error','sync-throw','async-throw'])('%s never releases data or raw diagnostics',async fault=>{
 const error={code:'08006',message:'private-diagnostic'};
 const operation=()=>{if(fault==='sync-throw')throw error;if(fault==='async-throw')return Promise.reject(error);return Promise.resolve({data:fault==='data-error'?[{id:'private'}]:null,error});};
 await expect(readPageResult(operation,'synthetic-page')).rejects.toThrow('PAGE_DATA_UNAVAILABLE');expect(safeCaptureException).toHaveBeenCalledWith(new Error('DATABASE_FAILURE:08006'),'synthetic-page');
});

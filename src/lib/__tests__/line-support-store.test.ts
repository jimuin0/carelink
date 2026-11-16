/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('../supabase-server',()=>({createServiceRoleClient:jest.fn()}));
import { z } from 'zod';
import { createServiceRoleClient } from '../supabase-server';
import { lineSupportRpc } from '../line-support-store';
const abortSignal=jest.fn();const rpc=jest.fn(()=>({abortSignal}));
beforeEach(()=>{jest.clearAllMocks();(createServiceRoleClient as jest.Mock).mockReturnValue({rpc});});
test('validates the actual database receipt with a bounded timeout',async()=>{abortSignal.mockResolvedValueOnce({data:{status:'accepted'},error:null});expect(await lineSupportRpc('manage_line_support',{},z.object({status:z.string()}))).toEqual({status:'accepted'});expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);});
test('malformed database receipts never pass as confirmed operations',async()=>{abortSignal.mockResolvedValueOnce({data:{status:false},error:null});await expect(lineSupportRpc('manage_line_support',{},z.object({status:z.string()}))).rejects.toThrow();});
test.each(['42501',undefined])('database error %s exposes no provider detail',async code=>{abortSignal.mockResolvedValueOnce({data:null,error:{code,message:'private customer content'}});try{await lineSupportRpc('manage_line_support',{},z.unknown());throw new Error('expected rejection');}catch(error){expect(error).toMatchObject({message:'LINE support storage unavailable',code});expect(String(error)).not.toContain('private');}});

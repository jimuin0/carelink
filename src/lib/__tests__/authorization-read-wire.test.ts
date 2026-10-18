/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { readAuthorization, AuthorizationReadTimeoutError } from '../authorization-read';

test('real SDK SELECT aborts a nonresponding local HTTP transport without retries or mutations',async()=>{
 const calls:Array<{method:string|undefined;path:string|undefined}>=[];const sockets=new Set<Socket>();
 let sawClose! :()=>void;const closed=new Promise<void>(resolve=>{sawClose=resolve;});
 const server=createServer((request,_response)=>{calls.push({method:request.method,path:request.url});request.socket.once('close',sawClose);});
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const address=server.address();if(!address||typeof address==='string')throw new Error('local fixture unavailable');
  const db=createClient(`http://127.0.0.1:${address.port}`,'synthetic-only-key',{auth:{persistSession:false,autoRefreshToken:false}});
  await expect(readAuthorization(db.from('facility_members').select('facility_id'))).rejects.toBeInstanceOf(AuthorizationReadTimeoutError);
  await closed;
  expect(calls).toHaveLength(1);expect(calls[0].method).toBe('GET');expect(calls[0].path).toBe('/rest/v1/facility_members?select=facility_id');
 } finally {
  for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));
 }
},20000);

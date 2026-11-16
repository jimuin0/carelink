import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Execute the actual connection/quota implementations in workerd, not Node's fetch mock.
const bundle=await build({stdin:{contents:`
import {readLineSupportConnection} from './src/lib/line-support-connection';
import {hasLineSupportQuota} from './src/lib/line-support-quota';
export default {async fetch(request){
 if(new URL(request.url).pathname==='/negative'){
  try{await fetch('https://api.line.me/v2/bot/info',{redirect:'error'});return new Response('unexpected');}
  catch{return new Response('unsupported');}
 }
 return Response.json({connection:await readLineSupportConnection(),quota:await hasLineSupportQuota('synthetic')});
}};`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',define:{'process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK':'"synthetic"','process.env.LINE_SUPPORT_DESTINATION':JSON.stringify('U'+'1'.repeat(32))}});
for(const status of [200,302])test(`workerd provider status ${status} preserves account validation and fails closed on redirects`,async()=>{
 const calls=[];
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-26',outboundService:async request=>{
  calls.push(new URL(request.url).pathname);
  assert.equal(new URL(request.url).hostname,'api.line.me');
  assert.equal(request.headers.get('authorization'),'Bearer synthetic');
  if(status===302)return new Response(null,{status,headers:{location:'https://example.invalid'}});
  const path=new URL(request.url).pathname;
  return Response.json(path.endsWith('/info')?{userId:'U'+'1'.repeat(32),basicId:'@549rbbyi',displayName:'carelink'}:path.endsWith('/consumption')?{totalUsage:0}:{type:'limited',value:200});
 }}));
 try{
  const negative=await mf.dispatchFetch('http://localhost/negative');assert.equal(await negative.text(),'unsupported');assert.equal(calls.length,0);
  const response=await mf.dispatchFetch('http://localhost/');const result=await response.json();
  assert.equal(result.quota,status===200);
  if(status===200)assert.equal(result.connection.destinationMatches,true);else assert.equal(result.connection,null);
  assert.deepEqual(calls.sort(),['/v2/bot/info','/v2/bot/message/quota','/v2/bot/message/quota/consumption'].sort());
 }finally{await mf.dispose();}
});

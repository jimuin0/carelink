import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
const source=readFileSync(new URL('./line-support-wakeup.ts',import.meta.url),'utf8');
function adapterModule(env){const exports={};runInNewContext(transpileModule(source,{compilerOptions:{module:ModuleKind.CommonJS,target:ScriptTarget.ES2022}}).outputText,{exports,require:name=>{assert.equal(name,'cloudflare:workers');return {env};}});return exports;}
const adapter=env=>adapterModule(env).enqueueLineSupportEvents;
test('producer awaits the durable queue receipt and sends opaque IDs only',async()=>{
 let batch;let completed=false;
 const enqueue=adapter({LINE_SUPPORT_QUEUE:{sendBatch:async messages=>{batch=messages;await Promise.resolve();completed=true;}}});
 await enqueue(['event1','event2']);assert.equal(completed,true);assert.deepEqual(JSON.parse(JSON.stringify(batch)),[{body:{eventId:'event1'},contentType:'json'},{body:{eventId:'event2'},contentType:'json'}]);
});
test('missing or failing queue cannot be reported as accepted',async()=>{
 await assert.rejects(adapter({})(['event']),/not configured/);
 await assert.rejects(adapter({LINE_SUPPORT_QUEUE:{sendBatch:async()=>{throw new Error('offline');}}})(['event']),/offline/);
});
test('empty input needs no queue',async()=>{await adapter({})([]);});

test('runtime configuration requires a functioning producer binding shape',()=>{assert.equal(adapterModule({}).isLineSupportQueueConfigured(),false);assert.equal(adapterModule({LINE_SUPPORT_QUEUE:{}}).isLineSupportQueueConfigured(),false);assert.equal(adapterModule({LINE_SUPPORT_QUEUE:{sendBatch:'invalid'}}).isLineSupportQueueConfigured(),false);assert.equal(adapterModule({LINE_SUPPORT_QUEUE:{sendBatch:async()=>{}}}).isLineSupportQueueConfigured(),true);});

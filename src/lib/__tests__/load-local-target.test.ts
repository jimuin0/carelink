/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const modulePath=resolve('load-tests/local-target.mjs');
function check(value: string|null) {
 return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import {requireLocalLoadTarget} from ${JSON.stringify(modulePath)};try{process.stdout.write(JSON.stringify({target:requireLocalLoadTarget(JSON.parse(process.argv[1]))}));}catch{process.stdout.write(JSON.stringify({rejected:true}));}`,JSON.stringify(value)],{encoding:'utf8'}));
}
test.each([null,'','http://localhost:3309','https://127.0.0.1:3000/','http://[::1]'])('loopback destinations remain usable %s',value=>{expect(check(value).target).toBeDefined();});
test.each(['https://carelink-jp.com','https://carelink.vercel.app','http://localhost.evil.invalid','http://localhost@evil.invalid','http://127.0.0.1:0','http://localhost:65536','file:///tmp/test','http://localhost/path','http://localhost?x=1','http://localhost#x','http://127.0.0.2','http://2130706433'])('unsafe destination %s is refused before any k6/provider',value=>{expect(check(value)).toEqual({rejected:true});});

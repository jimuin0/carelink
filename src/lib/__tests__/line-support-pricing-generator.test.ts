/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
let root:string;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'carelink-support-pricing-'));mkdirSync(join(root,'src/app/terms'),{recursive:true});mkdirSync(join(root,'src/lib'),{recursive:true});});
afterEach(()=>rmSync(root,{recursive:true,force:true}));
function run(check=false){
 const moduleUrl=pathToFileURL(join(process.cwd(),'scripts/generate-line-support-pricing.mjs')).href;
 return spawnSync(process.execPath,['--input-type=module','-e',`import {generateListingFees} from ${JSON.stringify(moduleUrl)};generateListingFees(process.argv[1],{check:process.argv[2]==='check'});`,root,check?'check':'write'],{encoding:'utf8'});
}
function terms(text:string){writeFileSync(join(root,'src/app/terms/page.tsx'),text);}
test('a canonical terms update regenerates exactly the new public sentence',()=>{
 terms('<li>掲載料・予約手数料は無料です。</li>');expect(run().status).toBe(0);expect(run(true).status).toBe(0);
 terms('<li>掲載料・予約手数料は新しい条件を確認してください。</li>');expect(run(true).status).not.toBe(0);expect(run().status).toBe(0);
 expect(readFileSync(join(root,'src/lib/public-listing-terms.ts'),'utf8')).toContain('新しい条件');expect(run(true).status).toBe(0);
});
test.each(['<li>料金</li>','<li>掲載料・予約手数料A</li><li>掲載料・予約手数料B</li>','<li>掲載料・予約手数料{fee}</li>'])('ambiguous or dynamic pricing fails rather than keeping stale facts: %s',source=>{terms(source);expect(run().status).not.toBe(0);});

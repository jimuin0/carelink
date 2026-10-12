/** @jest-environment node */
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const {loadNycConfig}=require('@istanbuljs/load-nyc-config');
let directory:string;
beforeEach(()=>{
 directory=mkdtempSync(join(tmpdir(),'carelink-nyc-yaml-'));
 writeFileSync(join(directory,'package.json'),JSON.stringify({name:'synthetic-nyc-config'}));
});
afterEach(()=>rmSync(directory,{recursive:true,force:true}));
test('coverage YAML still loads arrays, inheritance, aliases and normalized keys with the supported parser',async()=>{
 writeFileSync(join(directory,'base.yaml'),'reporter: [lcov, json-summary]\ncheck-coverage: true\nlines: 85\n');
 writeFileSync(join(directory,'.nycrc.yml'),'extends: ./base.yaml\ninclude: &sources ["src/**/*.ts"]\nexclude: ["**/*.test.ts"]\nextension: [".ts", ".tsx"]\n');
 expect(await loadNycConfig({cwd:directory})).toMatchObject({reporter:['lcov','json-summary'],checkCoverage:true,lines:85,include:['src/**/*.ts'],exclude:['**/*.test.ts'],extension:['.ts','.tsx']});
});
test('YAML configuration does not construct functions from an unsafe tag',async()=>{
 writeFileSync(join(directory,'.nycrc.yaml'),'hook: !!js/function "function () { return 1; }"\n');
 await expect(loadNycConfig({cwd:directory})).rejects.toThrow(/unknown tag/);
});
test('YAML aliases retain their referenced array values',async()=>{
 writeFileSync(join(directory,'.nycrc.yml'),'include: &sources ["src/**/*.ts"]\nexclude: *sources\n');
 expect(await loadNycConfig({cwd:directory})).toMatchObject({include:['src/**/*.ts'],exclude:['src/**/*.ts']});
});

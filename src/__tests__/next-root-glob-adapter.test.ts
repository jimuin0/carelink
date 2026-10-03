import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const project = process.cwd();
const adapter = path.join(project, 'tools/next-root-glob/index.cjs');
const plugin = path.dirname(require.resolve('@next/eslint-plugin-next/package.json'));

describe('Next root discovery dependency replacement', () => {
  it('pins the reviewed upstream caller and rejects additional fast-glob call sites', () => {
    expect(require('@next/eslint-plugin-next/package.json').version).toBe('16.3.0');
    const caller = path.join(plugin, 'dist/utils/get-root-dirs.js');
    expect(crypto.createHash('sha256').update(fs.readFileSync(caller)).digest('hex'))
      .toBe('886677432990a735e5ebdfb345ff1cbd40e264f9947a8432eeeb254b3a926bde');
    const uses: string[] = [];
    function scan(dir: string) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name);
        if (item.isDirectory()) scan(file);
        else if (item.name.endsWith('.js') && fs.readFileSync(file, 'utf8').includes('require("fast-glob")')) uses.push(file);
      }
    }
    scan(path.join(plugin, 'dist'));
    expect(uses).toEqual([caller]);
    expect(require.resolve('fast-glob', { paths: [plugin] })).toBe(adapter);
  });

  it('preserves reviewed glob discovery, including braces, extglob, hidden directories and symlinks', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'carelink-root-glob-'));
    try {
      for (const dir of ['apps/a/pages', 'apps/b/app', 'apps/skip', 'apps/.hidden', 'packages/foo', 'packages/bar'])
        fs.mkdirSync(path.join(root, dir), { recursive: true });
      fs.symlinkSync(path.join(root, 'apps/a'), path.join(root, 'apps/linked'), 'dir');
      const cases = JSON.parse(fs.readFileSync(path.join(project, 'tools/next-root-glob/fixtures/fast-glob-3.3.1.json'), 'utf8'))
        .filter((item: { pattern: unknown }) => typeof item.pattern === 'string');
      const script = `const {globSync}=require(${JSON.stringify(adapter)}); const cases=${JSON.stringify(cases)};
        console.log(JSON.stringify(cases.map(item=>({pattern:item.pattern,matches:globSync(item.pattern,{onlyDirectories:true}).sort()}))));`;
      const actual = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8' }));
      expect(actual).toEqual(cases);

      const caller = path.join(plugin, 'dist/utils/get-root-dirs.js');
      const roots = `const {getRootDirs}=require(${JSON.stringify(caller)});const cwd=process.cwd();
        const inputs=[undefined,'apps/{a,b}',['apps/a','apps/b',null],'apps\\\\a',42];
        console.log(JSON.stringify(inputs.map(rootDir=>getRootDirs({cwd,settings:{next:{rootDir}}}).sort())));`;
      expect(JSON.parse(execFileSync(process.execPath, ['-e', roots], { cwd: root, encoding: 'utf8' })))
        .toEqual([[fs.realpathSync(root)], ['apps/a', 'apps/b'], ['apps/a', 'apps/b'], ['apps/a'], [fs.realpathSync(root)]]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('fails closed for unreviewed options or APIs', () => {
    const api = require(adapter);
    expect(Object.keys(api)).toEqual(['globSync']);
    for (const args of [[[], { onlyDirectories: true }], ['apps/*', undefined], ['apps/*', {}],
      ['apps/*', { onlyDirectories: false }], ['apps/*', { onlyDirectories: true, dot: true }]])
      expect(() => api.globSync(...args)).toThrow('Unsupported Next rootDir discovery API');
  });

  it('rejects the advisory nested-brace input before parsing or walking', () => {
    const script = `const {globSync}=require(${JSON.stringify(adapter)});
      const pattern='{'.repeat(4000)+'a'+'}'.repeat(4000);
      try { globSync(pattern,{onlyDirectories:true}); throw new Error('Unsafe input accepted'); }
      catch(error) { if(!(error instanceof SyntaxError)||!error.message.includes('nesting limit'))throw error; }`;
    expect(() => execFileSync(process.execPath, ['-e', script], { timeout: 5000, stdio: 'pipe' })).not.toThrow();
    expect(() => require(adapter).globSync('a'.repeat(10001), { onlyDirectories: true })).toThrow('length limit');
    expect(() => require(adapter).globSync('({)}', { onlyDirectories: true })).toThrow('mixed');
    expect(() => require(adapter).globSync('apps/{a/b,c/d}/*', { onlyDirectories: true })).toThrow('cross-directory');
  });

  it('does not read unnecessary deep or hidden directories, and terminates symlink cycles', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'carelink-root-glob-depth-'));
    try {
      for (const dir of ['apps/a/deep', 'apps/.hidden/deep']) fs.mkdirSync(path.join(root, dir), { recursive: true });
      fs.symlinkSync(path.join(root, 'apps'), path.join(root, 'apps/a/cycle'), 'dir');
      const script = `const fs=require('node:fs');const api=require(${JSON.stringify(adapter)});
        const original=fs.readdirSync;let globstar=false;
        fs.readdirSync=(file,options)=>{if(String(file).includes('.hidden')||(!globstar&&file!=='apps'))throw new Error('Unnecessary traversal');return original(file,options)};
        const shallow=api.globSync('apps/*',{onlyDirectories:true});
        if(JSON.stringify(shallow)!==JSON.stringify(['apps/a']))throw new Error('Shallow roots changed');
        globstar=true;const deep=api.globSync('apps/**',{onlyDirectories:true});
        if(!deep.includes('apps/a/deep')||deep.some(p=>p.includes('.hidden')))throw new Error('Globstar roots changed');`;
      expect(() => execFileSync(process.execPath, ['-e', script], { cwd: root, timeout: 5000, stdio: 'pipe' })).not.toThrow();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

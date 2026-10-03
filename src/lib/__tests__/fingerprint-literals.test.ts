/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { diffFingerprint } from '../schema-drift';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = join(__dirname, '../../..');
const base = Array.from({ length: 600 }, (_, i) => `column|fixture${i}.x|text`);
let generator: any;
let cli: any;
beforeAll(async () => {
  generator = await import(join(root, 'scripts/fingerprint-json.mjs'));
  cli = await import(join(root, 'scripts/schema-diff.mjs'));
});

describe('fingerprint JSON literal boundaries', () => {
  it.each([' ', '\n', '\u202f', '\u205f', '\u3000', '\ufeff', '  '])('preserves tail %j in both engines', (tail) => {
    const expected = [...base, `enum|fixture|label${tail}`];
    const actual = [...base, 'enum|fixture|label'];
    const ts = diffFingerprint(expected, actual);
    const js = cli.diffFingerprints(expected, actual);
    expect(ts.missing).toEqual([expected.at(-1)]);
    expect(js.missing).toEqual(ts.missing);
    expect(js.extra).toEqual(ts.extra);
    expect(generator.canonicalRecords(JSON.stringify(expected))).toContain(expected.at(-1));
  });
  it('keeps embedded LF and fake record prefix inside one item', () => {
    const literal = "constraint|fixture|ck|c|CHECK (x = 'a\nrelation|fake|r\nb')";
    const records = generator.canonicalRecords(JSON.stringify([...base, literal]));
    expect(records).toHaveLength(601);
    expect(records).toContain(literal);
    expect(cli.relationNames(records).size).toBe(0);
  });
  it('uses UTF8 byte order without normalizing payload', () => {
    const items = ['enum|z|z', 'enum|あ|あ', 'enum|Z|Z', 'enum|a|a'];
    expect(generator.canonicalRecords(JSON.stringify(items), 1)).toEqual(
      [...items].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
    );
  });
  it.each(['', 'broken', 'null', '{}', '[null]', '[1]', '[{}]', '[true]', '["  "]'])('rejects invalid/vacuous %j', (raw) => {
    expect(() => generator.canonicalRecords(raw)).toThrow();
  });
  it('does not let duplicated or whitespace-only records satisfy lower bound', () => {
    expect(() => generator.canonicalRecords(JSON.stringify(Array(600).fill('x')))).toThrow();
    expect(() => generator.canonicalRecords(JSON.stringify(Array(600).fill('\ufeff')))).toThrow();
  });
  it('write and check share validator and detect actual literal changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fingerprint-json-test-'));
    const input = join(dir, 'rpc.json'), output = join(dir, 'expected.json');
    const records = [...base, "column|fixture.x|text|default='a  b\n'", 'enum|fixture|tail\ufeff'];
    writeFileSync(input, JSON.stringify(records));
    expect(generator.main(['write', input, output])).toBe(0);
    expect(JSON.parse(readFileSync(output, 'utf8'))).toContain(records.at(-1));
    expect(generator.main(['--check', input, output])).toBe(0);
    writeFileSync(input, JSON.stringify([...base, "column|fixture.x|text|default='a b '", 'enum|fixture|tail']));
    expect(generator.main(['--check', input, output])).toBe(1);
    expect(() => generator.main(['wrong', input, output])).toThrow();
  });
  it('CLI parses JSON only and escapes LF in display while preserving comparison', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fingerprint-cli-test-'));
    const a = join(dir, 'a.json'), b = join(dir, 'b.json');
    const literal = 'enum|fixture|tail\nrelation|fake|r';
    writeFileSync(a, JSON.stringify([...base, literal]));
    writeFileSync(b, JSON.stringify(base));
    try {
      execFileSync('node', [join(root, 'scripts/schema-diff.mjs'), a, b], { stdio: 'pipe' });
      throw new Error('expected nonzero drift');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(String(error.stderr)).toContain(JSON.stringify(literal));
    }
    for (const raw of ['null', '{}', '[null]', '[2]', 'enum|legacy|txt\n']) {
      writeFileSync(a, raw);
      expect(() => cli.readLines(a)).toThrow();
    }
  });
});

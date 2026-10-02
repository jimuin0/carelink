/** RPC JSON record境界を維持する生成器。本文をtrim/正規化/改行分割しない。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function canonicalRecords(raw, minItems = 500) {
  const records = JSON.parse(raw);
  if (!Array.isArray(records) || records.some((record) => typeof record !== 'string')) {
    throw new Error('fingerprint must be a JSON array of strings');
  }
  const valid = records.filter((record) => record.trim().length > 0);
  if (new Set(valid).size < minItems) throw new Error('fingerprint introspection is vacuous');
  return valid.sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
}

export function main(argv) {
  const [mode, input, output] = argv;
  if (!['write', '--check'].includes(mode) || !input || !output) {
    throw new Error('usage: fingerprint-json.mjs write|--check <rpc.json> <expected.json>');
  }
  const actual = canonicalRecords(readFileSync(input, 'utf8'));
  if (mode === 'write') {
    writeFileSync(output, `[\n${actual.map((record) => JSON.stringify(record)).join(',\n')}\n]\n`, 'utf8');
    console.log(`fingerprint generated：${actual.length} records`);
    return 0;
  }
  const expected = canonicalRecords(readFileSync(output, 'utf8'));
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`fingerprint matches：${actual.length} records`);
    return 0;
  }
  const exp = new Set(expected), act = new Set(actual);
  const missing = expected.filter((record) => !act.has(record));
  const extra = actual.filter((record) => !exp.has(record));
  console.error(JSON.stringify({ missingCount: missing.length, extraCount: extra.length,
    missing: missing.slice(0, 20), extra: extra.slice(0, 20) }));
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

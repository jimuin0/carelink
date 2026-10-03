'use strict';

const fs = require('node:fs');
const picomatch = require('picomatch');

// Independent adapter for the one reviewed Next ESLint 16.3.0 call site.
// No fast-glob, micromatch or braces code is included. New APIs fail closed.
function globSync(pattern, options) {
  if (typeof pattern !== 'string' || !pattern || !options ||
      Object.keys(options).length !== 1 || options.onlyDirectories !== true) {
    throw new TypeError('Unsupported Next rootDir discovery API; review the upstream plugin before upgrading');
  }
  // Bound parser work before any glob compilation; escaped/class characters
  // cannot introduce recursive brace/parenthesis nesting.
  if (pattern.length > 10000) throw new SyntaxError('Next rootDir pattern exceeds the reviewed length limit');
  const nesting = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\\') { i++; continue; }
    if (char === '[') inClass = true;
    if (char === ']') inClass = false;
    if (inClass) continue;
    if (char === '{' || char === '(') {
      nesting.push(char);
      if (nesting.length > 100) throw new SyntaxError('Next rootDir pattern exceeds the reviewed nesting limit');
    }
    if (char === '}' || char === ')') {
      const expected = char === '}' ? '{' : '(';
      if (nesting.length && nesting.at(-1) !== expected) throw new SyntaxError('Unsupported mixed Next rootDir nesting');
      if (nesting.at(-1) === expected) nesting.pop();
    }
  }
  // Next maps rootDir arrays into separate single-pattern calls. An exclusion
  // by itself discovers no roots, exactly as the previous implementation did.
  if (pattern.startsWith('!') && !pattern.startsWith('!(')) return [];

  function directory(file) {
    try { return fs.statSync(file).isDirectory(); }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
      throw error;
    }
  }
  const scanned = picomatch.scan(pattern, { parts: true, tokens: true });
  if (!scanned.isGlob) return directory(pattern) ? [pattern] : [];
  // Cross-directory alternatives need a separately reviewed partial matcher;
  // never silently truncate their roots or walk unrelated directories.
  if (scanned.tokens.some(token => token.isGlob && token.value.includes('/'))) {
    throw new TypeError('Unsupported cross-directory Next rootDir alternative; review the adapter');
  }
  // fast-glob returns slashless dynamic directory matches, preserving a
  // trailing slash only for an explicit, non-glob directory input.
  const matcher = picomatch(pattern.replace(/\/$/, ''), { dot: false, strictSlashes: true });
  const prefixes = scanned.parts.map((_, index) => scanned.parts.slice(0, index + 1).join('/'))
    .filter(Boolean).map(part => picomatch(part, { dot: false, strictSlashes: true }));
  const maxDepth = scanned.isGlobstar ? Infinity : scanned.glob.split('/').filter(Boolean).length;
  const base = scanned.prefix + scanned.base;
  if (!directory(base || '.')) return [];
  const result = [];
  const pending = [{ file: base || '.', display: base, ancestors: new Set(), depth: 0 }];
  while (pending.length) {
    const item = pending.pop();
    const real = fs.realpathSync(item.file);
    if (item.ancestors.has(real)) continue; // symlink cycle: never recurse forever
    const ancestors = new Set(item.ancestors).add(real);
    for (const entry of fs.readdirSync(item.file, { withFileTypes: true })) {
      const display = item.display ? `${item.display}${item.display.endsWith('/') ? '' : '/'}${entry.name}` : entry.name;
      if (!directory(display)) continue;
      const matchPath = display.replace(/^\.\//, '');
      if (matcher(matchPath)) result.push(display);
      const depth = item.depth + 1;
      if (depth < maxDepth && prefixes.some(prefix => prefix(matchPath))) {
        pending.push({ file: display, display, ancestors, depth });
      }
    }
  }
  return result;
}

module.exports = Object.freeze({ globSync });

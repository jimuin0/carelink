'use strict';

const { minimatch } = require('minimatch-v11');

// ESLint 9, @eslint/eslintrc, @eslint/config-array and the Next ESLint plugins
// call the minimatch 3 CommonJS shape: the module itself is the match function
// and carries Minimatch and the helpers. minimatch 11 keeps that function object
// as its named export, so this package only exposes it as module.exports.
function minimatchV3(file, pattern, options) {
  return minimatch(file, pattern, options);
}
Object.assign(minimatchV3, minimatch);

// minimatch 11 no longer produces RegExps. Only eslint-plugin-import's
// no-internal-modules calls makeRe, and CareLink does not enable it.
minimatchV3.makeRe = function makeRe() {
  throw new Error('minimatch.makeRe is unavailable in the CareLink minimatch 3 adapter; review tools/minimatch-v3-compat before enabling the rule');
};

module.exports = minimatchV3;

# Local deepmerge security patch

This is the CommonJS distribution and TypeScript definitions from `deepmerge` 4.3.1 (MIT; see LICENSE), used by Jest's configuration loader. `package.json` adds this local copy as a development dependency so the locked Jest dependency resolves to it. The patch denies `__proto__`, `constructor` and `prototype` in both input objects, and treats unexpected errors in a property lookup as unsafe. Ordinary merge options and symbols remain supported.

The bundled distribution also contains `is-mergeable-object` 1.1.0 by TehShrike, published under the MIT license.

This addresses the reported attack cases in GHSA-gcqx-w48m-w2h4; `scripts/deepmerge-security.test.cjs` tests both the source and target paths and exercises Jest's resolved package. The original version is intentionally retained: npm audit still reports the advisory because it identifies the package by version and does not verify the local patch. A clean audit alone would not prove the patch safe or rule out future vulnerabilities. Reassess upstream releases and this dependency when updating Jest; remove the copy only after a verified fix is available.

The unmodified npm 4.3.1 `dist/cjs.js` has SHA-256 `2e5160f84a1141bd927264afe4d15766f1e6cf07daef182b37ff53fea121de7d`.

Upstream: https://github.com/TehShrike/deepmerge/tree/v4.3.1

Advisory: https://github.com/advisories/GHSA-gcqx-w48m-w2h4

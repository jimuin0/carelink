# Next ESLint root discovery adapter

This private package is independent CareLink code, not a renamed fast-glob release.
It replaces only the `fast-glob` dependency of `@next/eslint-plugin-next@16.3.0`.
All original Next rules, configuration and diagnostics remain in use. The upstream
distribution and its single call site are checked by hash and API tests.

The adapter uses patched `picomatch@4.0.7` and a directory-only iterative filesystem
walk. It does not contain fast-glob, micromatch or braces. Patterns are bounded
before compilation; symlink ancestors stop cycles; finite patterns stop at their
required depth; prefix matching prevents unrelated and hidden subtree traversal.
The original published fast-glob 3.3.1 produced the checked-in discovery fixture.

The supported API is `globSync(string, { onlyDirectories: true })`, exactly the
reviewed Next call. Unsupported options, excessive nesting, mixed delimiters and
cross-directory brace/extglob alternatives fail explicitly, rather than silently
omit roots. CareLink currently has no custom `settings.next.rootDir`. Changing that
setting or upgrading Next requires reviewing these limits and extending parity
tests as appropriate.

The npm override's `file:../../../tools/next-root-glob` resolves from the fixed
scoped parent package directory. The lock records a link to the repository-local
package, and the installed resolution is checked in the unit suite. CI must use
`npm ci` and ordinary `npm audit --audit-level=high`; no advisory is excluded.

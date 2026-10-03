# braces dependency removal

Security Audit at `f34e4c6d` failed with seven High findings from
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
These were one vulnerable library propagated through its parent dependencies,
not seven independently observed exploitation events. The paths were development
dependencies used by Tailwind content discovery/watch and Next ESLint root
discovery. No production exploitation or HTTP-to-pattern input path was established.

The change removes both dependency paths. Tailwind moves to the official v4
PostCSS integration; the published Next ESLint rules remain unchanged, with only
their fixed-version discovery dependency replaced by independent CareLink code.
See [adapter scope and limits](../tools/next-root-glob/README.md).
The original braces/micromatch code is absent; no package version is disguised,
and the normal Security Audit command and required checks remain unchanged.

The official Tailwind upgrade converted utility names and CSS configuration.
Its accidental conversion of the `SbButtonLink` API's `outline` variant was
reverted. Existing palette values, variable theme references, source directories,
placeholder colour, cursor, dialog margins and default ring settings are preserved.
Variable colour/font references use `@theme inline` so descendant themes work.
CSS selectors in existing E2E checks follow the equivalent renamed utilities.
No application hooks, API authorization, data flows or notification behaviour are
intentionally changed by this dependency migration.

Tailwind v4 requires Safari 16.4+, Chrome 111+ and Firefox 128+.
The existing legal page specifies the latest Chrome/Safari/Edge/Firefox versions;
this change does not rewrite that policy.
[Official upgrade guide](https://tailwindcss.com/docs/upgrade-guide).

Local checks found zero vulnerabilities with the ordinary npm audit, preserved
the existing four lint diagnostics exactly (rule, severity, message, line and
column), and passed TypeScript checking. Original Next fast-glob fixtures cover
18 discovery patterns; security and traversal regression checks cover excessive
nesting, mixed delimiters, finite depth, hidden subtrees and symlink cycles.

These local results do not replace final-SHA clean install, complete CI build,
coverage, isolated database/API contracts, browser E2E, independent review or
production deployment verification. The failed prior SHA remains failed.
Production settings, database migrations, actual data and delivery are outside
this change.

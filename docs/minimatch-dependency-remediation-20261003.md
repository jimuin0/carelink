# Mutation runner dependency compatibility

Weekly run [37144826789](https://github.com/jimuin0/carelink/actions/runs/37144826789)
at `1801e66f` failed before mutation testing started. All ten matrix jobs failed
both attempts with minimatch's ESM `expand` import from `brace-expansion`.
These are runner initialization failures, not ten established application bugs.

The global `brace-expansion: ^2.1.7` override supplied the legacy CommonJS function
to minimatch 10.2.5 and 10.2.6, whose published dependency is `^5.0.5` and whose
ESM entry requires the named `expand` export. Ordinary Jest did not exercise that
import and could pass while the mutation runner could not start.

The override now applies only to `brace-expansion@<3`. Legacy minimatch 3 and 9
retain 2.1.7; modern minimatch receives the compatible published 5.0.12 release.
The generated lock adds only four development dependency entries: two paths each
for brace-expansion 5.0.12 and its balanced-match 4.0.4 dependency. The previous
braces removal, audit command, application code, mutation configuration, module
list, thresholds and timeout gate remain unchanged.

The regression test loads every installed minimatch path from the lock through
both CommonJS and its published ESM entry, checks positive/negative brace glob
matching and nested expansion, and confirms the Stryker-resolved path is covered.
It reproduced the original import failure against the original installed tree,
then passed after clean installation. An independent reviewer also ran it.
The prior Next root discovery adapter regression remains passing; npm audit found
zero vulnerabilities.

Local mutation execution uses the official checksum-verified Node 24.21.0, matching
the failed CI jobs. Starting, instrumenting files and completing mutation tests
are separate evidence. Final commit-specific results are recorded in the PR;
normal required CI success does not establish the separate L4 mutation result.
No production changes or actual notifications are part of this fix.

The restored runner exposed a second initialization failure: 28 tests overrode
the Stryker environment with plain Node, preventing per-test coverage reporting.
Their environment pragmas now follow the existing Stryker wrapper convention.
The convention guard missed one-line docblocks ending with a closing comment;
its detection is corrected and checked with positive and negative examples for
all three supported environments. No test assertions or mutation gates are removed.

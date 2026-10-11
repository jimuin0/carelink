# Deferred database migration references

This directory is excluded from Supabase CLI replay. Its original signed-upload SQL is retained as the frozen design reference, not a production apply command.

## Forward signed-upload cutover

The new chronological source is `../migrations/20261011054500_salon_signed_upload_cutover.sql`. It preserves existing objects, public/private bucket configuration and stricter existing limits while retiring the two observed historical anonymous INSERT policy names. The marked reconciliation section is identical to the frozen reference.

Production V2 signed-upload UI/commit consumers were deployed and the enabled flag was observed on October11. Promotion in source alone is not proof of production application. Before applying, reconfirm the exact target project, deployed flag, bucket configuration, full policy list and release-specific migration history. Unexpected policies or incompatible MIME settings must fail the reviewed reconciliation guard.

Already-open V1 forms cannot upload after this cutover. Their unsent input/photos are held only by that browser; no server-side migration or automatic recovery is promised. Production application requires either verified retirement/compatibility of those forms or the user's informed acceptance of that effect. The production impact choice is tracked separately from the already-authorized overall remediation. Existing object counts do not prove browser sessions have drained.

Use the official Supabase `apply_migration` capability for only this reviewed forward migration. Verify the stored statement hash and resulting bucket/policy state afterward. Tool-generated hosted versions may differ from source filename versions: record the mapping, never repair history to conceal it, and never bulk-push old pending migrations. Do not replay an already-recorded source, apply this frozen reference directly, use SQL Editor DDL or guess an unexpected configuration.

## Disposable CI coverage

`supabase start` now replays the forward migration exactly once. The former post-start deferred overlay is removed; applying it twice would fail its historical-policy precondition. The upgrade runner reads the actual active migration section and exercises legacy policy names, stricter buckets, role denial and invalid configurations inside rollback-only fixtures. HTTPS E2E retains the final signed-only Storage policy. Local/CI results are not production or legacy-session-drain evidence.

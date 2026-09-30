# Deferred database migrations

This directory contains SQL that is deliberately excluded from Supabase CLI migration replay. Files here are not applied by `supabase start`, `supabase db reset`, or `supabase db push`.

## Signed-upload cutover

`20260927000001_salon_signed_upload_cutover.sql` removes the anonymous Storage insert policies used by the legacy registration form. The current production UI still has a V1 flow that uploads directly to `carelink-uploads`; putting this file in `supabase/migrations` before that flow is retired would make submissions with photos fail.

## Required release order

### Phase A: prepare the database without removing legacy uploads

Reconcile the complete hosted migration ledger against the physical schema first. Re-run every migration-specific read-only preflight against the exact target immediately before applying anything, including published-facility location violations and the `facility_welcome` / duplicate-notification constraints. Then use the protected Supabase CLI path to apply only the reviewed active migration batch while the V2 flag remains disabled. Because `supabase db push` applies every pending active migration, its dry-run must match the complete reviewed batch; do not proceed if there are unexplained historical gaps or unrelated pending migrations. Regenerate database types from the actual hosted schema and rerun the Contract gate rather than editing generated types to mimic unapplied schema.

Deploy the compatible V2 consumer only after Phase A's schema and types are verified. Keep the V2 flag disabled until the deployed UI, signed-upload endpoints, commit/claim consumer, RPC permissions, and rollback behavior are verified against that schema. Then enable V2 through its approved configuration path and verify new registrations use signed uploads while legacy V1 forms remain supported.

### Phase B: retire anonymous direct uploads

This deferred cutover must remain out of the production replay set until all of the following are evidenced:

- The signed-upload V2 UI and its commit/claim consumers are deployed and enabled in production.
- Existing V1 forms and sessions that depend on anonymous upload have been drained, expired, or covered by an explicitly verified compatibility path.
- A read-only production preflight confirms the actual bucket settings and the exact historical policies this SQL reconciles; any unexpected policy or incompatible setting is resolved through a reviewed forward migration, not guessed.
- The database's physical schema and `supabase_migrations.schema_migrations` history have been reconciled. No missing historical migration may be hidden with `migration repair`.
- A fresh `supabase db push --dry-run --linked` lists only the intended cutover migration, with no unrelated pending changes.
- The repository's protected production database-change gate and required approval/capability are satisfied.

Only after those gates pass should this SQL be promoted into `supabase/migrations` as a new chronological migration. Re-run `supabase db push --dry-run --linked` and confirm its only pending change is this cutover; then review and apply through the approved Supabase CLI migration path. Do not edit or replay an already-recorded migration, use the SQL Editor for production DDL, or apply the deferred file directly to production. After application, reconcile both the live Storage policy/bucket state and the migration ledger, then verify the deployed signed-upload flow and rejection of direct anonymous/authenticated uploads.

## Disposable CI coverage

The E2E workflow applies this SQL only after `supabase start`, using `docker exec` against exactly one running database container whose Supabase and Compose project labels both equal `carelink`. It feeds the SQL file to that container's `psql` with `ON_ERROR_STOP`; ambiguous or missing containers fail closed. This creates final-state Storage behavior for end-to-end tests without adding the cutover to production's pending migration batch or recording a hosted migration version. The separate shadow-database upgrade contract executes the marked reconciliation section in rollback-only fixtures. Neither local test path is production evidence.

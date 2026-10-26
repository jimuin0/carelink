# CareLink Cloudflare staging

This is an isolated migration experiment. The production Vercel project, domain,
root package.json/package-lock.json, database, cron and provider credentials are
unchanged. Do not merge or promote this branch as a production migration.

## Reproduce

Run `node scripts/prepare-cloudflare-staging.mjs` from the repository root. It
creates a fresh source-only workspace under ignored `work/cloudflare-staging/`
and records its path in `current.json`. In that workspace run:

```sh
npm ci --ignore-scripts
node scripts/ensure-eslint-plugin-link.mjs
npm audit --audit-level=moderate
npm run build:vinext
npm run start:vinext -- --port 3001
```

Configuration files here are templates copied to that workspace. The separate
lockfile pins the Cloudflare/Vite/React toolchain without changing production's
dependencies. Preparation refuses an application package change until this
toolchain is reviewed and refreshed. No existing workspace or original data is
deleted, and node_modules is not linked from another checkout.

## Isolation

- Hosted staging uses only `https://synthetic.invalid` and synthetic keys. It
  cannot authenticate against or write to the production database.
- POST/PUT/PATCH/DELETE are refused before application code in synthetic mode.
- No production notification, OAuth, payment or cron credentials are copied.
- Responses have X-Robots-Tag, and robots.txt disallows all crawling.
- There are no custom domain routes or scheduled triggers in this config.
- Real database/auth/booking tests run only against the disposable local
  Supabase stack in GitHub CI. Their result is not hosted staging verification.

The Cloudflare workflow uses the existing migration replay, DB contracts,
synthetic fixtures and HTTPS Playwright tests, with the Workers runtime in place
of Next's Node server. Existing production CI configuration remains unchanged.

## Runtime adaptations

`output: standalone` is disabled only for the Workers build. Only the OG
renderer's filesystem import is adapted: its own packaged Japanese font assets
come from ASSETS, and resvg uses a precompiled Wasm module. The SVG/image renderer
and its input escaping/limits remain the application's existing implementation.

## Completion requirements

Build success or the static 90% compatibility report is not migration success.
Record hosted deployment identity, browser checks, real isolated DB/auth/booking
results, notification completion behavior, CPU/memory and image behavior before
considering production. A paid plan or production domain switch requires the
user's confirmation. Preserve the current Vercel deployment for rollback.

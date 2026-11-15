# LINE Bot runtime verification

This is the independently deployed Render service whose root directory is `linebot` and whose deployment branch is `feat/carelink-linebot`. The repository's existing Next.js CI targets pull requests into `main`; it is unchanged. `linebot-ci.yml` checks this separate service on its deployment branch.

Use Node.js 26.13.1 and run:

```sh
npm ci
node --check index.js
npm test
```

The lockfile fixes dependency resolution. The test launches the actual application and installed Express dependencies in a subprocess, using a synthetic signature secret and no production credentials. Its preload binds the listener to loopback and rejects outbound socket, HTTP, HTTPS and fetch calls. It verifies health, missing/wrong/tampered signatures, invalid JSON, a signed empty event, an ignored image event and unknown routes. It does not send LINE, Slack or AI requests, connect to Supabase, or claim to verify every business conversation flow.

Do not load the test preload in production or call a real webhook with production credentials as a test. The application implementation and message-handling logic are unchanged by these runtime checks.

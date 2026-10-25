# CPU request diagnostics

Production `972a9c7` passed its live read-only checks and CI. In a 15-minute
production window (2026-10-25 22:26–22:41 JST) excluding this investigation's
verification requests, Vercel reported 21 active CPU seconds / 130 invocations,
P75 CPU 216 ms, 3.8% cold starts, and zero errors or timeouts. A constant rate
would consume 16.8 CPU hours per 30 days, above the normal Hobby 4-hour allowance.
The temporary 3× increase is not the normal quota. This short window does not
establish a permanent traffic forecast or a causal comparison with earlier runs.

There were 89 `/search` requests; Amzn-SearchBot accounted for only two of all
130 requests. Blocking that crawler alone cannot explain or resolve this window.
It remains allowed. A local response-compression experiment saved little CPU
while increasing uncompressed transfer about 3.3×, so compression was retained.

The runtime preload samples the first eligible request of each fixed route group
and every sixteenth request when the server has no other active request. It logs
only fixed groups, a random process correlation ID, numeric process CPU and
elapsed time, outcome, and overlap. The random ID contains no user identity.
Requests that start concurrently mark the sample as overlapping. Asset and write
requests participate in overlap accounting but are not sampled. No raw paths,
query values, headers, cookies, bodies, user identities or IP addresses are read
into diagnostic records. The observer does not change the handler or response.

Process CPU deltas can include background work and are not Vercel billing
measurements. Cumulative process CPU and uptime help distinguish startup/shared
work from response intervals. Overlapping records must not be attributed to one
route. Use the observations to choose the next improvement; instrumentation by
itself does not establish quota compliance.

The preload runs only in the deployed runtime command, after the image's
secret-free compile-cache warmup. Node remains pinned to 24.22.1. Existing auth,
CSP nonce, no-store headers, bot policy, DB permissions and health behavior stay
unchanged. Node integration tests exercise actual HTTP responses, sparse sampling,
overlap, aborted responses, and exclusion of synthetic private values.

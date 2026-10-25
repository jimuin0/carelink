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

## Footer rendering improvement

Synthetic local CPU profiling highlighted repeated Next Link/React rendering in
the large SEO footer. Category×prefecture links now use immutable HTML generated
once from the public taxonomy. All text and attribute values are escaped. No
request, user, facility, cookie or session data enters this shared string.
The actual anchor URLs remain in the initial HTML, including closed details.

One delegated footer handler routes ordinary internal clicks through Next's
router. Modifier/middle clicks, downloads, external URLs, fragments, non-self
targets and already-handled events retain native or existing link behavior.
The small set of static navigation links retains BrowseLink. SEO destination
counts, escaping, router behavior and both footers' document-preserving browser
navigation are tested. Existing CSP, no-store and prefetch budgets are unchanged.

Six alternating runs of independently built baseline/optimized pages used only
three synthetic facilities and intercepted all outbound fetches. Excluding the
first 15 requests, the measured 129-request intervals had median process CPU
14.844 → 10.577 ms/request (about 29% lower). All runs returned the same 2,039
anchor destinations. These local process CPU measurements do not establish
monthly production quota compliance; Vercel CPU must be observed after release.

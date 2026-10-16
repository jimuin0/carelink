/** Diagnostics must never attach raw dependency errors, URLs, headers or keys. */
export function healthPerformanceDiagnostic(elapsed: number, status: number, body: unknown, timing: string | null) {
  const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const duration = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const boolean = (value: unknown) => typeof value === 'boolean' ? value : null;
  const data = record(body), dependencies = record(data.deps);
  const server: Record<string, number | null> = { gate: null, checks: null, app: null };
  for (const match of (timing ?? '').slice(0, 1024).matchAll(/(?:^|,)\s*(gate|checks|app);dur=(\d+(?:\.\d+)?)(?=,|$)/g)) server[match[1]] = duration(Number(match[2]));
  return {
    client_elapsed_ms: duration(elapsed), http_status: status,
    route_elapsed_ms: duration(data.elapsed_ms), server_timing_ms: server,
    dependencies: Object.fromEntries(['supabase','rate_limit','stripe','resend','cron'].map(name => {
      const dep = record(dependencies[name]);
      return [name, { ok: boolean(dep.ok), elapsed_ms: duration(dep.elapsed_ms), retried: boolean(dep.retried), skipped: boolean(dep.skipped) }];
    })),
  };
}

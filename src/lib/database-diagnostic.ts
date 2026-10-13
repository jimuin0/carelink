/** Database messages/details may contain user input or credentials. Retain only
 * a bounded SQLSTATE/PostgREST code for operational diagnostics. */
export function databaseDiagnostic(cause: unknown): Error {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause
    && typeof cause.code === 'string' && cause.code.trim() === cause.code
    && /^(?:[A-Z0-9]{5}|PGRST[0-9]{3})$/.test(cause.code)
    ? cause.code : 'UNCLASSIFIED';
  return new Error(`DATABASE_FAILURE:${code}`);
}

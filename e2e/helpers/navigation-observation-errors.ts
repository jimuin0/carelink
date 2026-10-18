// Fixed classifications only: never include raw messages, URLs, query values or stacks.
export function navigationErrorClassification(error: Error) {
  const names = ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'AbortError',
    'SecurityError', 'AuthApiError', 'AuthRetryableFetchError', 'AuthSessionMissingError', 'AuthUnknownError'];
  return {
    errorName: names.includes(error.name) ? error.name : 'other',
    reactCode: /Minified React error #(\d{1,6})\b/.exec(error.message)?.[1] ?? null,
    transportFailure: /Failed to fetch|Load failed|NetworkError/.test(error.message),
    aborted: /abort|cancelled|canceled/i.test(error.message),
    chunkLoadFailure: /ChunkLoadError|Loading chunk|Failed to load chunk/i.test(error.message),
    undefinedReference: /is not defined|undefined is not|Cannot read properties of undefined/.test(error.message),
  };
}
export function navigationTransportFailure(text: string) {
  for (const code of ['ERR_ABORTED','ERR_CONNECTION_CLOSED','ERR_CONNECTION_RESET','ERR_TIMED_OUT','ERR_FAILED']) {
    if (text.includes(code)) return code;
  }
  return /abort|cancelled|canceled/i.test(text) ? 'cancelled' : 'other';
}

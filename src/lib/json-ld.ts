/**
 * JSON-LD structured data serialization with XSS prevention.
 *
 * JSON.stringify does not escape < or > characters, so user-controlled data
 * containing </script> can break out of a <script type="application/ld+json">
 * block and execute arbitrary JavaScript. This helper escapes those characters
 * using Unicode escape sequences, which are valid JSON and safe in HTML contexts.
 */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

'use strict';

// Next's content-hashed build files are public and immutable. Containers still
// invoke Node for them unless the CDN receives its own cache directive.
function headerValue(response, direct, name) {
  const lower = name.toLowerCase();
  const values = [];
  if (Array.isArray(direct)) {
    for (let i = 0; i < direct.length; i += 2) {
      if (String(direct[i]).toLowerCase() === lower) values.push(direct[i + 1]);
    }
  } else if (direct) {
    for (const key of Object.keys(direct)) {
      if (key.toLowerCase() === lower) values.push(direct[key]);
    }
  }
  // Treat duplicate policies conservatively: a private directive anywhere
  // prevents opting in, regardless of header casing or Node's merge behavior.
  return values.length ? values.flat().join(', ') : response.getHeader(name);
}

function attachStaticAssetCdnCache(server) {
  server.prependListener('request', (request, response) => {
    if ((request.method !== 'GET' && request.method !== 'HEAD') ||
        !request.url?.split('?', 1)[0].startsWith('/_next/static/')) return;
    const original = response.writeHead;
    response.writeHead = function writeHead(status, messageOrHeaders, headers) {
      const direct = typeof messageOrHeaders === 'string' ? headers : messageOrHeaders;
      const value = (name) => headerValue(this, direct, name);
      const policy = String(value('cache-control') ?? '');
      const type = String(value('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
      if (status === 200 &&
          /^(?:application|text)\/javascript$|^text\/css$|^font\/(?:woff2?|otf|ttf)$/.test(type) &&
          /(?:^|,)\s*public\s*(?:,|$)/i.test(policy) &&
          /(?:^|,)\s*immutable\s*(?:,|$)/i.test(policy) &&
          /(?:^|,)\s*max-age=31536000\s*(?:,|$)/i.test(policy) &&
          !/(?:^|,)\s*(?:private|no-store|no-cache)\s*(?:=|,|$)/i.test(policy) &&
          value('set-cookie') === undefined &&
          value('vercel-cdn-cache-control') === undefined &&
          !/(?:^|,)\s*(?:cookie|authorization|\*)\s*(?:,|$)/i.test(String(value('vary') ?? '')) &&
          !/nonce-/i.test(String(value('content-security-policy') ?? ''))) {
        this.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=31536000, immutable');
      }
      return Reflect.apply(original, this, arguments);
    };
  });
}

module.exports = { attachStaticAssetCdnCache };

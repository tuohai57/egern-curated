// Native equivalent of 可莉's del(.data.mult_home_banner), on that API only.
const endpoint = /^https:\/\/res\.xiaojukeji\.com\/resapi\/activity\/mget(?:\?[^#]*)?$/i;

export default async function(ctx) {
  try {
    if (!ctx.request || !endpoint.test(ctx.request.url) || !ctx.response || ctx.response.status !== 200) return;
    const encoding = (ctx.response.headers.get('content-encoding') || 'identity').trim().toLowerCase();
    const methods = {gzip: 'gunzip', 'x-gzip': 'gunzip', deflate: 'inflate', br: 'unbrotli'};
    if (encoding !== 'identity' && !methods[encoding]) return;
    const raw = new Uint8Array(await ctx.response.arrayBuffer());
    let bytes = raw;
    if (encoding !== 'identity') {
      const decode = ctx.compress?.[methods[encoding]];
      if (typeof decode === 'function') {
        try {const decoded = await decode.call(ctx.compress, raw); if (decoded instanceof Uint8Array && decoded.length) bytes = decoded;} catch (_) {}
      }
    }
    const obj = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const key of ['code', 'errno', 'errcode']) {
      if (Object.hasOwn(obj, key) && ![0, '0', 200, '200'].includes(obj[key])) return;
    }
    if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data) || !Object.hasOwn(obj.data, 'mult_home_banner')) return;
    delete obj.data.mult_home_banner;
    const headers = ctx.response.headers;
    for (const name of ['content-length', 'content-encoding', 'content-md5', 'digest', 'content-digest', 'repr-digest', 'etag']) headers.delete(name);
    return {headers, body: JSON.stringify(obj)};
  } catch (_) {
    // Includes HTML, invalid JSON, invalid UTF-8, read/decompression errors.
    // Keep the response; never fabricate gateway success or log its body.
  }
}

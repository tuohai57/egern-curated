const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const dir = path.resolve(__dirname, '../module-stack/scripts');

(async () => {
  const load = async file => (await import('data:text/javascript;base64,' + fs.readFileSync(path.join(dir, file)).toString('base64'))).default;
  const banner = await load('didi-banner-native.js');
  const gif = await load('static-tiny-gif-native.js');
  const input = {errno: 0, data: {mult_home_banner: [{id: 'advert'}], ordinary: {id: 123}, trip: {status: 'active'}}};
  const expected = {errno: 0, data: {ordinary: {id: 123}, trip: {status: 'active'}}};
  let checks = 0;
  const context = (body, encoding = 'identity', options = {}) => {
    const bytes = typeof body === 'string' ? Buffer.from(body) : Buffer.from(JSON.stringify(body));
    const wire = ({gzip: zlib.gzipSync, deflate: zlib.deflateSync, br: zlib.brotliCompressSync}[encoding] || (x=>x))(bytes);
    let reads = 0;
    const ctx = {request: {url: options.url || 'https://res.xiaojukeji.com/resapi/activity/mget?a=1'},
      response: {status: options.status ?? 200, headers: new Headers({'Content-Type': 'application/json', 'Content-Encoding': encoding, 'Content-Length': wire.length, etag: 'old'}),
        arrayBuffer: async () => {reads++; assert.equal(reads, 1); const data = options.decoded ? bytes : wire; return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);}},
      compress: {gunzip: async x=>new Uint8Array(zlib.gunzipSync(x)), inflate: async x=>new Uint8Array(zlib.inflateSync(x)), unbrotli: async x=>new Uint8Array(zlib.brotliDecompressSync(x))}};
    return ctx;
  };
  for (const encoding of ['identity', 'gzip', 'deflate', 'br']) {
    for (const decoded of [false, true]) {
      const result = await banner(context(input, encoding, {decoded}));
      assert.deepEqual(JSON.parse(result.body), expected);
      for (const h of ['content-encoding', 'content-length', 'etag']) assert.equal(result.headers.has(h), false);
      checks++;
    }
    for (const value of [null, [], {errno: 500, data: input.data}, {data: null}, {data: []}, {data: 'changed'}, {data: {ordinary: 'keep'}}, '<html>error</html>', '{invalid']) {
      assert.equal(await banner(context(value, encoding)), undefined); checks++;
    }
  }
  for (const options of [{url:'https://res.xiaojukeji.com/resapi/activity/mgetExtra?q=1'}, {status: 401}, {status: 500}]) {
    assert.equal(await banner(context(input, 'identity', options)), undefined); checks++;
  }
  assert.equal(await banner(context(input, 'unknown')), undefined); checks++;
  let called = 0;
  const result = await gif({request: {url: 'https://fuss10.elemecdn.com/a.mp4'}, respond: x => {called++; return x;}});
  assert.equal(called, 1); assert.equal(result.status, 200); assert.equal(result.headers['Content-Type'], 'image/gif');
  assert.equal(result.body.length, 42); assert.equal(Buffer.from(result.body).subarray(0, 6).toString(), 'GIF89a');
  assert.equal(await gif({}), undefined); checks += 2;
  console.log(JSON.stringify({passed: true, checks, scope: 'Native Egern API mocks and synthetic JSON/binary inputs, not a device test.'}));
})().catch(error => {console.error(error); process.exitCode = 1;});

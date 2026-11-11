const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const stack = path.resolve(__dirname, '../module-stack');
const yaml = fs.readFileSync(path.join(stack, 'modules/user-007.yaml'), 'utf8');
const filename = yaml.match(/script_url: https:\/\/[^\n]+\/([a-f0-9]{64}\.js)/)[1];
const bytes = fs.readFileSync(path.join(stack, 'scripts', filename));
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex') + '.js', filename);
const marker = Buffer.from('// BEGIN EXACT ORIGINAL\n');
const original = bytes.subarray(bytes.indexOf(marker) + marker.length, bytes.indexOf('\n// END EXACT ORIGINAL'));
const sha = 'f1a37c300126b1bd64451261207a9166ee2aad77a3e79705a0f5c24229aef46e';
assert.deepEqual(original, fs.readFileSync(path.join(stack, 'scripts', sha + '.js')));
assert.match(yaml, /binary_body: true/);

(async () => {
  const {default: adapt} = await import('data:text/javascript;base64,' + bytes.toString('base64'));
  const payload = Uint8Array.of(8, 1, 58, 3, 8, 150, 1);
  const ctx = (rpid, options = {}) => ({
    request: {url: 'https://home.umetrip.com/gateway/api/umetrip/native', headers: new Headers({rpid})},
    response: {status: options.status ?? 200,
      headers: new Headers({'content-type': 'application/x-protobuf', 'content-length': '7', ...options.headers}),
      arrayBuffer: options.read ?? (async () => payload.buffer)},
    compress: options.compress ?? {
      gunzip: async value => new Uint8Array(zlib.gunzipSync(value)),
      inflate: async value => new Uint8Array(zlib.inflateSync(value)),
      unbrotli: async value => new Uint8Array(zlib.brotliDecompressSync(value)),
    },
    abort() { throw new Error('A no-op must never abort the response'); }
  });
  const rewritten = await adapt(ctx('1000019'));
  assert.deepEqual([...rewritten.body], [8, 1, 58, 6, 10, 0, 16, 0, 32, 0]);
  assert.equal(rewritten.headers.get('content-type'), 'application/x-protobuf');
  assert.equal(rewritten.headers.has('content-length'), false);
  assert.equal(await adapt(ctx('not-an-ad')), undefined);
  assert.equal(await adapt(ctx('1000019', {read: async () => Uint8Array.of(255).buffer})), undefined);
  let unexpectedReads = 0;
  const shouldNotRead = async () => { unexpectedReads++; return payload.buffer; };
  assert.equal(await adapt(ctx('1000019', {status: 403, read: shouldNotRead})), undefined);
  assert.equal(await adapt(ctx('1000019', {headers: {'content-encoding': 'unrecognized'}, read: shouldNotRead})), undefined);
  assert.equal(unexpectedReads, 0);
  assert.equal(await adapt(ctx('1000019', {read: async () => { throw Error('read failed'); }})), undefined);

  let compressionCases = 0;
  for (const [encoding, pack] of [['gzip', zlib.gzipSync], ['x-gzip', zlib.gzipSync], ['deflate', zlib.deflateSync], ['br', zlib.brotliCompressSync]]) {
    const packed = pack(payload);
    const options = {headers: {'content-encoding': encoding, etag: 'old', 'content-md5': 'old', 'content-digest': 'old', 'cache-control': 'max-age=60'},
      read: async () => packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength)};
    const result = await adapt(ctx('1000019', options));
    assert.deepEqual([...result.body], [...rewritten.body], encoding);
    for (const name of ['content-encoding', 'content-length', 'etag', 'content-md5', 'content-digest']) assert.equal(result.headers.has(name), false, name);
    assert.equal(result.headers.get('cache-control'), 'max-age=60');
    const normal = ctx('not-an-ad', options);
    assert.equal(await adapt(normal), undefined);
    assert.equal(normal.response.headers.get('content-encoding'), encoding);
    // Engine-decoded data with an upstream encoding header must also work.
    for (const compress of [undefined, {}, {gunzip: async () => null, inflate: async () => null, unbrotli: async () => null}]) {
      const decoded = await adapt(ctx('1000019', {headers: {'content-encoding': encoding}, compress}));
      assert.deepEqual([...decoded.body], [...rewritten.body]);
      compressionCases++;
    }
    assert.equal(await adapt(ctx('1000019', {...options, compress: {}})), undefined);
    assert.equal(await adapt(ctx('1000019', {headers: {'content-encoding': encoding}, read: async () => Uint8Array.of(255, 254).buffer})), undefined);
    compressionCases += 4;
  }
  // Construct protobuf wire fixtures from the upstream's actual field/RPID
  // contracts. The non-advertising group must survive byte-for-byte.
  const varint = value => { const out = []; do {let byte = value % 128; value = Math.floor(value / 128); out.push(value ? byte | 128 : byte);} while(value); return Buffer.from(out); };
  const field = (id, value) => {const data = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value); return Buffer.concat([varint(id * 8 + 2), varint(data.length), data]);};
  const envelope = data => Buffer.concat([Buffer.from([8, 1]), field(7, data)]);
  const cases = [
    ['1000002', field(5, field(37, 'ADVERT')), field(5, field(37, 'NORMAL'))],
    ['1000029', field(8, field(1, '瀑布流_酒店')), field(8, field(1, '航班动态'))],
    ['1100001', field(5, field(8, field(3, '我的页面-会员卡片V3'))), field(5, field(8, field(3, '我的行程')))],
    ['1370126', field(8, field(1, '付费会员')), field(8, field(1, '行程提醒'))],
  ];
  for (const [rpid, ad, normal] of cases) {
    const input = envelope(Buffer.concat([ad, normal]));
    const response = await adapt(ctx(rpid, {read: async () => input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)}));
    assert.deepEqual(Buffer.from(response.body), envelope(normal), rpid + ': ordinary content preserved');
    const ordinary = envelope(normal);
    assert.equal(await adapt(ctx(rpid, {read: async () => ordinary.buffer.slice(ordinary.byteOffset, ordinary.byteOffset + ordinary.byteLength)})), undefined);
  }
  for (const rpid of ['1000019', '1420002', '1120000']) {
    const result = await adapt(ctx(rpid));
    assert.deepEqual([...result.body], [...rewritten.body], 'cold/warm splash ' + rpid);
  }
  const noHeader = Buffer.concat([field(5, '1000019'), field(7, Buffer.from([8, 150, 1]))]);
  assert.ok(await adapt(ctx('', {read: async () => noHeader.buffer.slice(noHeader.byteOffset, noHeader.byteOffset + noHeader.byteLength)})));
  for (const status of [204, 304, 401, 500]) {
    assert.equal(await adapt(ctx('1000019', {status, read: async () => new ArrayBuffer(0)})), undefined);
  }
  console.log('PASS: exact original bytes; ' + compressionCases + ' compression cases; cold/warm splash, home, waterfall, mine, trip, normal/error passthrough (synthetic fixtures, not device acceptance)');
})().catch(err => { console.error(err); process.exitCode = 1; });

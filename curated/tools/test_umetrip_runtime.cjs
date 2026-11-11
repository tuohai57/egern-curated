const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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
  console.log('PASS: original bytes, binary ad response, and unchanged/error/unknown encoding passthrough');
})().catch(err => { console.error(err); process.exitCode = 1; });

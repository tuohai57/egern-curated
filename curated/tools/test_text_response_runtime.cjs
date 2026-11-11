const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const stack = path.resolve(__dirname, '../module-stack');
const manifest = JSON.parse(fs.readFileSync(path.join(stack, 'manifest.json')));
const root = path.resolve(stack, '../..');

async function load(slug, sha) {
  const row = manifest.modules.find(r => r.repository_path.endsWith('/' + slug + '.yaml'));
  const change = row.changes.find(c => c.kind === 'text_response_noop_passthrough' && c.upstream_sha256 === sha);
  assert.ok(change);
  const yaml = fs.readFileSync(path.join(root, row.repository_path), 'utf8');
  const candidates = [...yaml.matchAll(/script_url: https:\/\/[^\n]+\/([a-f0-9]{64}\.js)/g)];
  for (const [,name] of candidates) {
    const bytes = fs.readFileSync(path.join(stack, 'scripts', name));
    const marker = Buffer.from('// BEGIN EXACT ORIGINAL\n');
    const start = bytes.indexOf(marker);
    if (start < 0) continue;
    const original = bytes.subarray(start + marker.length, bytes.indexOf('\n// END EXACT ORIGINAL'));
    if (crypto.createHash('sha256').update(original).digest('hex') !== sha) continue;
    assert.deepEqual(original, fs.readFileSync(path.join(stack, 'scripts', sha + '.js')));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex') + '.js', name);
    return (await import('data:text/javascript;base64,' + bytes.toString('base64'))).default;
  }
  assert.fail('Missing original-byte adapter: ' + slug);
}
const sample = (url, request, response, status = 200) => ({
  request: {url, text: async () => request},
  response: {status, headers: new Headers({'content-type':'application/json', 'content-length':'101'}),
             text: async () => response},
  abort() { assert.fail('Pass-through cannot abort'); }
});
const body = code => {
  const c = crypto.createCipheriv('aes-128-cbc',
    Buffer.from('376a69336b6a66793670316a64376636','hex'),
    Buffer.from('396637686b733633686a343964376236','hex'));
  return JSON.stringify({data: c.update(JSON.stringify({code}), 'utf8', 'base64') + c.final('base64')});
};
(async () => {
  const cotti = await load('native-068', '575593d5523fc66931ec7247a5550223565207fdfcff45684fe59e5cdb0471ac');
  const c = 'https://gateway.cotticoffee.com/cotti-capi/customer/position/list';
  assert.deepEqual(await cotti(sample(c, body('cotti-launch-window'), '{}')), {status:404});
  assert.equal(await cotti(sample(c, body('ordinary-order'), '{}')), undefined);
  assert.equal(await cotti(sample(c, '', '{}')), undefined);
  assert.equal(await cotti(sample(c, 'invalid json', '{}')), undefined);
  assert.equal(await cotti(sample(c, body('cotti-launch-window'), '{}', 403)), undefined);
  const keep = await load('user-021', '199783afcdd891bfd5fa298638e5806263521c14fd561ab6fda84efe5fe1e332');
  const k = 'https://api.gotokeep.com/athena/v3/people/my';
  const keepResult = await keep(sample(k, '', '{"data":{"floatingInfo":{"ad":1},"memberInfo":{},"normal":true}}'));
  assert.deepEqual(JSON.parse(keepResult.body), {data:{floatingInfo:{},normal:true}});
  assert.equal(keepResult.headers.get('content-length'), null);
  assert.equal(await keep(sample(k, '', '{bad json}')), undefined);
  assert.equal(await keep(sample(k, '', '{"error":true}', 401)), undefined);
  assert.equal(await keep(sample('https://api.gotokeep.com/other', '', '{}')), undefined);
  console.log('PASS: Cotti ad/normal/error and Keep JSON/normal/error; source bytes preserved');
})().catch(error => { console.error(error); process.exitCode = 1; });

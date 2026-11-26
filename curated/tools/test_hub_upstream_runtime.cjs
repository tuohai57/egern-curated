/* Synthetic checks for reviewed widget/App upstream changes. No network or real credentials. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'curated/hub-resources/manifest.json')));
let checks = 0;
function ok(value) { assert(value); checks++; }
function load(suffix, expose = '') {
  const row = manifest.dependencies.find(r => r.source_url.split('?')[0].endsWith(suffix));
  assert(row, suffix);
  const source = fs.readFileSync(path.join(root, row.repository_path), 'utf8');
  const context = vm.createContext({ console: { log() {}, error() {}, warn() {} }, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, setTimeout, clearTimeout });
  vm.runInContext(source.replace(/export default\s+/, 'globalThis.entry = ') + '\n' + expose, context, { timeout: 3000 });
  return context;
}
function storage() {
  const data = new Map();
  return { data, get: k => data.get(k), set: (k,v) => data.set(k,v), getJSON: k => data.get(k), setJSON: (k,v) => data.set(k,JSON.parse(JSON.stringify(v))) };
}
(async () => {
  for (const suffix of ['china-mobile-hark-dash.js', 'china-mobile-hark-ios.js']) {
    const c = load(suffix, 'globalThis.isLogin = isAutoLogin;');
    ok(c.isLogin('https://10086.online-cmcc.cn:20010/biz-orange/autoLogin'));
    ok(c.isLogin('https://10086.online-cmcc.cn:20010/refreshSession'));
    ok(!c.isLogin('https://10086.online-cmcc.cn:20010/queryCardInfo?next=autoLogin'));
    ok(!c.isLogin('https://10086.online-cmcc.cn:20010/payment/order'));
    ok(c.isLogin('https://client.app.coc.10086.cn/biz-orange/MC/refreshSession'));
  }
  const cu = load('ChinaUnicom_Widget.js', 'globalThis.replayOne = replayMiniRequest;');
  const store = storage();
  const req = { url: 'https://mina.10010.com/wxapplet/weixinNew/sspbigball', method: 'POST', headers: { Cookie: 'synthetic-session', 'Content-Type': 'application/json' }, body: '{"synthetic":"encrypted-request"}' };
  ok(await cu.entry({ env: { cuMiniCapture: 'false' }, storage: store, request: req }) === undefined);
  ok(store.data.size === 0);
  await cu.entry({ env: {}, storage: store, request: req });
  const saved = store.getJSON('unicom_mini_req_bigball');
  ok(saved.url === req.url && saved.body === req.body && saved.headers.cookie === 'synthetic-session');
  let calls = 0;
  const http = { post: async (url,opts) => { calls++; ok(url === req.url && opts.body === req.body); return { status: 200, json: async () => ({code:'9999', message:'synthetic error'}) }; } };
  ok(await cu.replayOne({ storage: store, http }, 'bigball') === false);
  ok(calls === 1);
  saved.ts = Date.now() - 13 * 3600000; store.setJSON('unicom_mini_req_bigball', saved);
  ok(await cu.replayOne({ storage: store, http }, 'bigball') === false && calls === 1);
  const before = JSON.stringify([...store.data]);
  await cu.entry({ env: {}, storage: store, request: {...req,url:'https://mina.10010.com/wxapplet/weixinNew/payment/order'} });
  ok(JSON.stringify([...store.data]) === before);
  await cu.entry({ env: {}, storage: store, request: req, response: { status: 500, json: async () => { throw new Error('must not read failed body'); } } });
  ok(JSON.stringify([...store.data]) === before);
  const vps = load('VPS_SSH.js', 'globalThis.pick = pickTrafficInterface; globalThis.cycle = cycleStartOf;');
  ok(vps.pick({interfaces:[{name:'docker0',traffic:{total:{rx:99999}}},{name:'eth0',traffic:{total:{rx:20}}}]}).name === 'eth0');
  ok(vps.pick({interfaces:[]}) === null);
  ok(vps.cycle(new Date(2026,10,10),15) === new Date(2026,9,15).getTime());
  ok(vps.cycle(new Date(2026,10,26),15) === new Date(2026,10,15).getTime());
  for (const [script,url,input,expected] of [
    ['bilibili-json.js','https://app.bilibili.com/x/v2/feed/index',{code:0,data:{items:[{card_type:'cm_v2',card_goto:'ad_av'},{card_type:'small_cover_v2',card_goto:'av',title:'normal video'}]}},'normal video'],
    ['zhihu.js','https://api.zhihu.com/topstory/recommend',{data:[{type:'feed_advert'},{type:'answer',content:'normal answer'}]},'normal answer']
  ]) {
    const c = load(script); const out = await c.entry({ request: { url, method:'GET' }, response: { body: true, text: async () => JSON.stringify(input) }, notify() {} });
    const text = out.body; ok(text.includes(expected));
    const body = JSON.parse(text); const list = body.data.items || body.data;
    ok(list.length === 1);
  }
  console.log(JSON.stringify({passed:true,checks,network_requests:0,device_verified:false}));
})().catch(e => { console.error(e); process.exit(1); });

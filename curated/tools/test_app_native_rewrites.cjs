// Execute actual Egern entry points with only the documented ctx surface.
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const assert = require('node:assert/strict');
const load = name => import('data:text/javascript;base64,' +
  readFileSync(join(__dirname, '../module-stack/scripts', name)).toString('base64'));

async function main() {
  const [{default: dcar}, {default: rail}] = await Promise.all(
    ['dcar-native.js', 'railway-12306-native.js'].map(load));
  const host = 'https://api5-normal-lq.dcarapi.com';
  const ad = host + '/motor/ad/?version=1';
  const feed = host + '/motor/stream_entrance/get_feed?cursor=123';
  const splash = host + '/motor/operation/activity/display/config/V2/';
  async function response(url, input, {status=200, encoding, fails=false} = {}) {
    const entries = new Map([['content-length', '99'], ['set-cookie', 'sample']]);
    if (encoding) entries.set('content-encoding', encoding);
    const headers = {get: k => entries.get(k), delete: k => entries.delete(k)};
    let reads = 0;
    const result = await dcar({request: {url}, response: {headers, status, json: async () => {
      reads++;
      if (fails) throw Error('unsupported body encoding');
      return structuredClone(input);
    }}});
    if (result) {
      assert.equal(entries.has('content-length'), false);
      assert.equal(entries.has('content-encoding'), false);
      assert.equal(entries.get('set-cookie'), 'sample');
    } else {
      assert.equal(entries.get('content-length'), '99');
      assert.equal(entries.get('content-encoding'), encoding);
    }
    return {body: result ? JSON.parse(result.body) : undefined, reads};
  }
  const product = {info: {label: '测评', video_detail_info: {id: 7}}};
  const promoted = {info: {label: '广告'}};
  const newShape = {unknown: 1};
  const body = {code: 0, message: 'success', request_id: 'sample', data: [promoted], countdown: 5};
  assert.deepEqual((await response(ad, body, {encoding: 'gzip'})).body, {...body, data: [], countdown: 0});
  assert.deepEqual((await response(feed, {data: [product, promoted, newShape, null], cursor: 9})).body,
    {data: [product, newShape, null], cursor: 9});
  assert.deepEqual((await response(splash, {status_code: 0, data: {
    splash: [1], show_splash: 1, countdown: 5, car_list: [{id: 3}],
  }})).body, {status_code: 0, data: {splash: [], show_splash: 0, countdown: 0, car_list: [{id: 3}]}});
  assert.deepEqual(await response(ad, body, {encoding: 'unsupported'}), {body: undefined, reads: 0});
  assert.deepEqual(await response(ad, body, {status: 500}), {body: undefined, reads: 0});
  assert.deepEqual(await response(ad, body, {fails: true}), {body: undefined, reads: 1});
  assert.equal((await response(ad, {...body, code: 401})).body, undefined);
  assert.equal((await response(feed, {data: [product, newShape]})).body, undefined);
  assert.equal((await response(ad, {code: 0, unknown: {untouched: true}})).body, undefined);
  for (const url of [host+'/motor/advice', host+'/motor/information/api/full', feed.replace('get_feed?', 'get_feed_extra?'),
    ad.replace('api5-normal-lq.dcarapi.com', 'example.com')]) {
    assert.deepEqual(await response(url, body), {body: undefined, reads: 0});
  }

  const gateway = 'https://mobile.12306.cn/otsmobile/app/mgs/mgw.htm';
  async function request(url, operation) {
    const ctx = {request: {url, headers: {get: k => {
      assert.equal(k, 'operation-type');
      return operation;
    }}, get body() { throw Error('shared gateway body must never be read'); }},
    respond: payload => payload, abort: () => assert.fail('must not abort')};
    return rail(ctx);
  }
  for (const operation of ['integration.activityBanner', 'newHomePage.initData', 'newHomePageBussData', 'paySuccBuss.bussEntryShow']) {
    assert.equal((await request(gateway + '?v=1', 'com.cars.otsmobile.'+operation)).status, 404);
  }
  for (const operation of ['checkLoginStatus', 'memberInfo.getMemberQa', 'newHomePageRefresh', 'newHomePage.initDataExtra', 'queryTicket',
    'travelPage.initData', 'paySuccBuss.bussEntryShowExtra', 'passenger.getList', 'pay', 'refund']) {
    assert.equal(await request(gateway, 'com.cars.otsmobile.'+operation), undefined);
  }
  assert.equal(await request(gateway, null), undefined);
  assert.equal(await request(gateway + '.extra', 'com.cars.otsmobile.integration.activityBanner'), undefined);
  assert.equal(await request('https://ad.12306.cn/ad/ser/getAdList', 'com.cars.otsmobile.integration.activityBanner'), undefined);
  console.log('Native Dcar and 12306 regression passed (synthetic responses/headers).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

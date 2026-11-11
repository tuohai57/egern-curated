// Native Egern rewrite. Feed ad marker: xiaomaoJT/QxScript.
// Ordinary feed entries, video, vehicle, order and account data are retained.
const host = 'https://api5-normal-lq.dcarapi.com';
const ads = /^\/motor\/ad(?:\/[^?#]*)?$/;
const config = /^\/motor\/operation\/activity\/display\/config\/V2\/?$/;
const feed = /^\/motor\/stream_entrance\/get_feed\/?$/;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const adFields = ['ad', 'ads', 'ad_list', 'ad_data', 'splash', 'splash_ad', 'splash_ads', 'splash_list', 'splash_data'];
const flags = ['show_ad', 'show_splash', 'enable_splash', 'is_show_ad'];
const timers = ['countdown', 'count_down', 'splash_duration', 'ad_duration', 'skip_time'];

export default async function(ctx) {
  const url = ctx.request?.url;
  const response = ctx.response;
  if (typeof url !== 'string' || !url.startsWith(host + '/') || !response ||
      response.status !== 200) return;
  const endpoint = url.slice(host.length).split('?', 1)[0];
  const dedicated = ads.test(endpoint);
  if (!dedicated && !config.test(endpoint) && !feed.test(endpoint)) return;
  const encoding = response.headers.get('content-encoding');
  // Do not guess whether the app/runtime can decode an unfamiliar format.
  if (encoding && !/^(?:identity|gzip|deflate|br)$/i.test(encoding.trim())) return;
  try {
    const data = await response.json();
    if (!object(data) ||
        (data.code !== undefined && ![0, '0', 200, '200'].includes(data.code)) ||
        (data.status_code !== undefined && ![0, '0', 200, '200'].includes(data.status_code)) ||
        (typeof data.message === 'string' && !['', 'success', 'ok', '成功'].includes(data.message.toLowerCase()))) return;

    let changed = false;
    if (feed.test(endpoint)) {
      if (!Array.isArray(data.data)) return;
      const kept = data.data.filter(card => card?.info?.label !== '广告');
      if (kept.length === data.data.length) return;
      data.data = kept;
      changed = true;
    } else {
      const clear = obj => {
        for (const [key, value] of Object.entries(obj)) {
          if (adFields.includes(key)) {
            if (Array.isArray(value) && value.length) { obj[key] = []; changed = true; }
            if (object(value) && Object.keys(value).length) { obj[key] = {}; changed = true; }
          } else if (flags.includes(key) && (value === true || value === 1)) {
            obj[key] = typeof value === 'number' ? 0 : false;
            changed = true;
          } else if (timers.includes(key) && typeof value === 'number' && value !== 0) {
            obj[key] = 0;
            changed = true;
          } else if (dedicated && ['data', 'list', 'items', 'materials'].includes(key) &&
                     Array.isArray(value) && value.length) {
            obj[key] = [];
            changed = true;
          } else if (object(value) && ['data', 'config', 'result'].includes(key)) {
            clear(value);
          }
        }
      };
      clear(data);
    }
    if (!changed) return;
    const body = JSON.stringify(data);
    const headers = response.headers;
    for (const name of ['content-length', 'content-encoding', 'etag', 'content-md5', 'digest']) headers.delete(name);
    return {headers, body};
  } catch (_) {
    // A codec/JSON failure must not abort the response.
    return;
  }
}

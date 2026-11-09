// Independently maintained Egern-compatible JSON response handlers.
// Implements the documented, inspectable endpoint subset only.
// No encrypted Loon dependency, remote execution, account bypass, or network I/O.
(function () {
  'use strict';
  const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const own = (obj, key) => isObject(obj) && Object.prototype.hasOwnProperty.call(obj, key);
  const remove = (obj, keys) => { if (isObject(obj)) for (const k of keys) delete obj[k]; };
  const at = (root, parts) => parts.reduce((v, key) => isObject(v) ? v[key] : undefined, root);
  function emptyKnown(obj, keys) {
    if (!isObject(obj)) return;
    for (const key of keys) {
      if (Array.isArray(obj[key])) obj[key] = [];
      else if (isObject(obj[key])) obj[key] = {};
    }
  }
  function setExisting(obj, key, value) { if (own(obj, key)) obj[key] = value; }
  // Applied only inside exact advertising endpoints; never global recursion.
  function clearTimers(obj) {
    if (!isObject(obj)) return;
    for (const key of ['countdown', 'countDown', 'duration', 'showTime', 'show_time', 'skipTime', 'skip_time', 'waitTime']) {
      if (typeof obj[key] === 'number') obj[key] = 0;
      else if (typeof obj[key] === 'string' && /^\d+(\.\d+)?$/.test(obj[key])) obj[key] = '0';
    }
  }
  function clearAdvertising(obj) {
    emptyKnown(obj, ['ad', 'ads', 'ad_info', 'ads_info', 'ad_list', 'adList', 'ads_list',
      'splash', 'splash_ad', 'splash_ads', 'splashList', 'banner', 'banners', 'bannerList',
      'popup', 'popups', 'popupList', 'welcomeList', 'advertisement_info', 'advertisement_data']);
    clearTimers(obj);
  }
  function explicitAd(item) {
    return isObject(item) && (item.is_ad === true || item.isAd === true ||
      item.type === 'advertisement' || item.card_type === 'ad' ||
      (own(item, 'ad_info') && item.ad_info !== null && item.ad_info !== false));
  }
  function filterAds(obj, key) {
    if (isObject(obj) && Array.isArray(obj[key])) obj[key] = obj[key].filter(x => !explicitAd(x));
  }
  let result = {};
  try {
    if (typeof $request === 'undefined' || typeof $response === 'undefined') return $done(result);
    const code = String($response.statusCode ?? $response.status ?? 200).match(/(?:^|\s)(\d{3})(?:\s|$)/);
    if (code && (+code[1] < 200 || +code[1] >= 300)) return $done(result);
    if (typeof $response.body !== 'string' || !$response.body.trim()) return $done(result);
    const obj = JSON.parse($response.body);
    if (!isObject(obj) || obj.error || obj.success === false || (typeof obj.code === 'number' && obj.code < 0)) return $done(result);
    if (Array.isArray(obj.ret) && obj.ret.some(x => typeof x === 'string' && /^(?:FAIL|ERROR)/.test(x))) return $done(result);
    const url = new URL($request.url);
    const host = url.hostname, path = url.pathname;
    const before = JSON.stringify(obj);
    if (host === 'ad.12306.cn' && path === '/ad/ser/getAdList') {
      remove(obj, ['materialsList', 'advertParam']);
      clearTimers(obj);
      if (isObject(obj.data)) {
        remove(obj.data, ['materialsList', 'advertParam']);
        clearTimers(obj.data);
      }
    } else if (host === 'appconf.mail.163.com' && path === '/mailmaster/api/page/v2/conf.do') {
      remove(obj.data, ['activityTabInfoList']);
    } else if (host === 'appconf.mail.163.com' && path === '/mailmaster/api/config/function.do') {
      if (isObject(obj.data) && Array.isArray(obj.data.config)) {
        obj.data.config = obj.data.config.filter(x => !isObject(x) || x.functionName !== 'Function-AD');
      }
    } else if (host === 'api.xiaoheihe.cn' && path === '/bbs/app/feeds/news') {
      if (isObject(obj.result) && Array.isArray(obj.result.links)) {
        obj.result.links = obj.result.links.filter(x => !isObject(x) || x.content_type !== 27);
      }
    } else if (host === 'api.xiaoheihe.cn' && path === '/account/get_ads_info_v2') {
      clearAdvertising(obj);
      clearAdvertising(obj.result);
      clearAdvertising(obj.data);
    } else if (host === 'api.meiyan.com' && path === '/operation/get_config.json') {
      remove(obj.response, ['bubble', 'time_limit']);
      setExisting(at(obj, ['response', 'function_pop', 'meiyan_style']), 'is_pop', false);
      setExisting(at(obj, ['response', 'onoff', 'vip_half_window_exit_remain_popup']), 'open', 0);
      setExisting(at(obj, ['response', 'onoff']), 'vip_home_exit_remain_popup', 0);
    } else if (host === 'api.meiyan.com' && path === '/operation/home_banner.json') {
      clearAdvertising(obj.response);
      clearAdvertising(obj.data);
    } else if (host === 'api.meiyan.com' && path === '/operation/home.json') {
      for (const key of ['items', 'list', 'modules']) filterAds(obj.response, key);
    } else if (host === 'acs.m.taobao.com' && /^\/gw\/mtop\.damai\.wireless\.user\.my\.content\.get(?:\/|$)/.test(path)) {
      remove(obj.data, ['banner']);
    } else if (host === 'acs.m.taobao.com' && /^\/gw\/mtop\.damai\.wireless\.mypage\.feed(?:\/|$)/.test(path)) {
      filterAds(obj.data, 'feedCard');
    } else if (host === 'acs.m.taobao.com' && /^\/gw\/mtop\.damai\.mec\.aristotle\.get(?:\/|$)/.test(path)) {
      remove(at(obj, ['data', 'data', 'top']), ['keywords']);
    } else if (host === 'acs.m.taobao.com' && /^\/gw\/mtop\.damai\.(?:wireless\.home\.welcome|mec\.popup\.get)(?:\/|$)/.test(path)) {
      clearAdvertising(obj.data);
    } else if (host === 'mp.weixin.qq.com' && path === '/mp/getappmsgad') {
      emptyKnown(obj, ['advertisement_info', 'advertisement_data', 'ad_list']);
      setExisting(obj, 'advertisement_num', 0);
    } else if (host === 'mp.weixin.qq.com' && path === '/mp/cps_product_info') {
      emptyKnown(obj, ['product_list', 'advertisement_info']);
      setExisting(obj, 'advertisement_num', 0);
    } else if (host === 'api.pinduoduo.com' && path === '/api/alexa/homepage/hub') {
      remove(at(obj, ['result', 'dy_module']), ['irregular_banner_dy']);
      if (isObject(obj.result) && Array.isArray(obj.result.module_order)) {
        obj.result.module_order = obj.result.module_order.filter(x => !isObject(x) || x.module_name !== 'ad_module');
      }
    }
    if (JSON.stringify(obj) !== before) result = {body: JSON.stringify(obj)};
  } catch (_) {
    // Unknown schema, transport errors, and non-JSON responses pass unchanged.
  }
  $done(result);
})();

/* 懂车帝广告接口适配。参考 xiaomaoJT/QxScript 的公开接口范围。
 * 仅处理广告专用路径；不删除普通视频、车款信息、订单或账号字段。
 * 接口字段或外层结构不能识别时原样返回。不能解除客户端证书绑定。
 */
(() => {
  const original = $response.body;
  const url = String($request.url || '');
  const target = /^https:\/\/api\d+-(?:normal|core)(?:-[a-z0-9]+)*\.(?:dcarapi|snssdk)\.com\/motor\/(?:ad(?:\/[^?#]*)?|operation\/activity\/display\/config\/V2\/?)(?:\?[^#]*)?$/i;
  if (!target.test(url) || typeof original !== 'string') return $done({});
  try {
    const obj = JSON.parse(original);
    if (!obj || Array.isArray(obj) || typeof obj !== 'object') return $done({});
    if (obj.code !== undefined && obj.code !== 0 && obj.code !== '0' && obj.code !== 200) return $done({});
    if (obj.status_code !== undefined && obj.status_code !== 0 && obj.status_code !== 200) return $done({});
    if (typeof obj.message === 'string' && !['', 'success', 'ok', '成功'].includes(obj.message.toLowerCase())) return $done({});
    let changed = false;
    const clear = (value, dedicated = false) => {
      if (!value || typeof value !== 'object') return;
      for (const key of Object.keys(value)) {
        if (['ad', 'ads', 'ad_list', 'ad_data', 'splash', 'splash_ad', 'splash_ads', 'splash_list', 'splash_data'].includes(key)) {
          if (Array.isArray(value[key])) { value[key] = []; changed = true; }
          else if (value[key] && typeof value[key] === 'object') { value[key] = {}; changed = true; }
        } else if (['show_ad', 'show_splash', 'enable_splash', 'is_show_ad'].includes(key) && typeof value[key] === 'boolean') {
          value[key] = false; changed = true;
        } else if (['countdown', 'count_down', 'splash_duration', 'ad_duration', 'skip_time'].includes(key) && typeof value[key] === 'number') {
          value[key] = 0; changed = true;
        } else if (dedicated && ['data', 'list', 'items', 'materials'].includes(key) && Array.isArray(value[key])) {
          value[key] = []; changed = true;
        } else if (value[key] && typeof value[key] === 'object' && !Array.isArray(value[key])) {
          clear(value[key], dedicated);
        }
      }
    };
    clear(obj, /\/motor\/ad(?:\/|\?|$)/i.test(url));
    $done(changed ? {body: JSON.stringify(obj)} : {});
  } catch (_) { $done({}); }
})();

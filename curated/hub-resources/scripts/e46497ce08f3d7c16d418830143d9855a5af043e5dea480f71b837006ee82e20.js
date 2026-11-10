'use strict';

const API_URL = 'https://app.10099.com.cn/contact-web/api/busi/qryUserInfo';
const MINI_API_URL = 'https://wx.10099.com.cn/contact-web/api/busi/qryUserInfo';
const ALIPAY_API_URL = 'https://zfb.10099.com.cn/contact-web/api/busi/qryUserInfo';
const SUPPORTED_API_URLS = [API_URL, MINI_API_URL, ALIPAY_API_URL];
const BLOCKED_API_URL = 'https://wx.10099.com.cn/contact-web/api/busi/qryNeedPaperLess';
const KEY = 'ChinaBroadnet';
// 每 25 分钟最多一个采样点，96 个点约覆盖 24 小时，"今日流量"才有完整曲线（原来只留 24 个点）。
const HISTORY_LIMIT = 96;

const C = {
  // 低饱和环境渐变 + 统一中性色玻璃；主题色只用于图标、关键数字和进度。
  fee: '#E28A16',
  flow: '#079ACB',
  voice: '#8B5CF6',
  // 文本色随系统外观自动切换，避免深色模式下深色文字落在深色玻璃上。
  txt: { light: '#172B45', dark: '#F3F7FC' },
  sub: { light: '#586D84', dark: '#B8C7D8' },
  title: '#0F9F91',
  cyan: '#22B8CF',
  violet: '#9B7BFF',
  pink: '#EC6FA7',
  green: '#27A879',
  glass: { light: '#FFFFFFD9', dark: '#263D55D9' },
  glassBorder: { light: '#FFFFFF70', dark: '#FFFFFF25' },
  glassShadow: { light: '#64748B06', dark: '#00000000' },
};


function readRequestBody(ctx) {
  const req = ctx.request || {};

  function parseBody(raw) {
    if (raw == null || raw === '') return null;

    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    }

    // Some runtimes expose the body as a byte buffer instead of a string.
    if (typeof raw === 'object') {
      try {
        if (raw.data != null) return raw;
        if (typeof raw.text === 'function') return null;
        if (typeof raw.length === 'number' &&
            (raw instanceof Uint8Array || Object.prototype.toString.call(raw) === '[object Uint8Array]')) {
          let text = '';
          for (let i = 0; i < raw.length; i++) text += String.fromCharCode(raw[i]);
          try {
            return JSON.parse(decodeURIComponent(escape(text)));
          } catch (e) {
            try { return JSON.parse(text); } catch (e2) { return null; }
          }
        }
      } catch (e) {}
      // An empty Request-like object is not the parsed payload. Let json()/text()
      // read the actual body instead of returning {} and masking it.
      try {
        if (Object.keys(raw).length > 0) return raw;
      } catch (e) {}
      return null;
    }

    return null;
  }

  return (async () => {
    // Some Egern runtimes expose req.body as an empty Request-like object while
    // the actual payload is available through req.json() or req.text().
    try {
      const body = parseBody(req.body);
      if (body != null && (typeof body !== 'object' || Object.keys(body).length > 0)) return body;
    } catch (e) {}

    try {
      if (typeof req.json === 'function') {
        const body = await req.json();
        if (body != null) {
          const parsed = parseBody(body);
          if (parsed != null) return parsed;
        }
      }
    } catch (e) {}

    try {
      if (typeof req.text === 'function') {
        const raw = await req.text();
        const body = parseBody(raw);
        if (body != null) return body;
      }
    } catch (e) {}

    try {
      if (typeof $request !== 'undefined' && $request && $request.body != null) {
        const body = parseBody($request.body);
        if (body != null) return body;
      }
    } catch (e) {}

    return null;
  })();
}

function getHeader(headers, name) {
  if (!headers) return '';
  try {
    if (typeof headers.get === 'function') return headers.get(name) || '';
  } catch (e) {}
  try {
    for (const k of Object.keys(headers)) {
      if (String(k).toLowerCase() === name.toLowerCase()) return headers[k] || '';
    }
  } catch (e) {}
  return '';
}

function findValue(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return null;
}

function scanPlanFields(root) {
  const out = [];
  const seen = new Set();
  const words = /(flow|traffic|data|voice|call|quota|total|used|remain|balance|resource|package|plan|usage|limit|free|gprs|fee)/i;

  function walk(v, path, depth) {
    if (depth > 8 || v == null) return;

    if (typeof v === 'object') {
      if (seen.has(v)) return;
      seen.add(v);

      for (const k of Object.keys(v)) {
        const value = v[k];
        const nextPath = path ? path + '.' + k : k;
        const keyHit = words.test(k);

        if (keyHit && (typeof value === 'number' || (typeof value === 'string' && /^-?\\d+(?:\\.\\d+)?$/.test(value.trim())))) {
          out.push({
            path: nextPath,
            key: k,
            value: Number(value),
          });
        }

        if (typeof value === 'object' && value !== null) {
          walk(value, nextPath, depth + 1);
        }
      }
    }
  }

  walk(root, '', 0);
  return out.slice(0, 80);
}

function pickPlanMetric(candidates, kind) {
  const list = candidates || [];
  const re = kind === 'total'
    ? /(total|quota|limit|package|plan|free)/i
    : kind === 'used'
      ? /(used|usage|consume|consumed)/i
      : /(remain|left|balance|available)/i;

  return list.find(x => re.test(x.key) || re.test(x.path)) || null;
}

function calcPlanPercent(total, used, remain) {
  const t = Number(total);
  const u = Number(used);
  const r = Number(remain);

  if (Number.isFinite(t) && t > 0 && Number.isFinite(u) && u >= 0) {
    return Math.max(0, Math.min(1, u / t));
  }
  if (Number.isFinite(t) && t > 0 && Number.isFinite(r) && r >= 0) {
    return Math.max(0, Math.min(1, 1 - r / t));
  }
  return null;
}

function formatFee(v) {
  const n = Number(v);
  return Number.isFinite(n) ? (n / 100).toFixed(2) : '--';
}

function formatFlow(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return { number: '--', unit: 'GB' };

  // 广电 qryUserInfo 的 flowAll / flowUserd / flow 字段单位为 KB。
  // 采用 1024 进制换算，保证总量、已用、剩余及历史记录显示一致。
  const gb = 1024 * 1024;
  const mb = 1024;
  if (n >= gb) return { number: (n / gb).toFixed(2), unit: 'GB' };
  if (n >= mb) return { number: (n / mb).toFixed(2), unit: 'MB' };
  if (n >= 1) return { number: n.toFixed(2), unit: 'KB' };
  return { number: (n * 1024).toFixed(2), unit: 'B' };
}

function formatVoice(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(0) : '--';
}

function detectCaptureSource(req) {
  const headers = req && req.headers;
  const hints = [
    getHeader(headers, 'referer'),
    getHeader(headers, 'origin'),
    getHeader(headers, 'user-agent'),
    getHeader(headers, 'x-requested-with'),
  ].join(' ').toLowerCase();

  if (/alipay|alipayclient|alipay\.com|mini\.alipay|my\.alipay/.test(hints)) return '支付宝小程序';
  if (/weixin|micromessenger|wx\.qq\.com|servicewechat/.test(hints)) return '微信小程序';
  return '中国广电 App 或未识别来源';
}

async function capture(ctx) {
  // cbCapture is injected by the module argument into ctx.env. Default to enabled for older installs.
  if (ctx.env && String(ctx.env.cbCapture).toLowerCase() === 'false') {
    console.log('[ChinaBroadnet] 数据抓取已关闭，跳过 HTTP 捕获');
    return;
  }
  const req = ctx.request || {};
  const url = String(req.url || '');
  const method = String(req.method || '').toUpperCase();
  // Ignore this endpoint entirely; the widget must never query it.
  if (url.startsWith(BLOCKED_API_URL)) return;
  // Parse the request body once and reuse it for both probing and capture.
  let parsedBody = null;
  let bodyRead = false;
  const getParsedBody = async () => {
    if (!bodyRead) {
      parsedBody = await readRequestBody(ctx);
      bodyRead = true;
    }
    return parsedBody;
  };

  if (/^https:\/\/(?:app|wx|zfb)\.10099\.com\.cn\//i.test(url)) {
    try {
      const body = await getParsedBody();
      const keys = [];

      function collectKeys(v, depth) {
        if (depth > 5 || v == null || typeof v !== 'object') return;
        for (const k of Object.keys(v)) {
          if (!keys.includes(k)) keys.push(k);
          if (v[k] && typeof v[k] === 'object') collectKeys(v[k], depth + 1);
        }
      }

      collectKeys(body, 0);

      const old = ctx.storage.getJSON(KEY + '.apiProbe') || [];
      const item = {
        ts: Date.now(),
        method,
        url,
        keys: keys.slice(0, 80),
      };

      const next = old.filter(x => !(x.url === url && x.method === method));
      next.push(item);
      ctx.storage.setJSON(KEY + '.apiProbe', next.slice(-60));

      // Log only the shape of the request context; never log header values or body contents.
      let bodyType = body == null ? 'null' : (Array.isArray(body) ? 'array' : typeof body);
      let bodyKeys = [];
      try {
        if (body && typeof body === 'object') bodyKeys = Object.keys(body).slice(0, 30);
      } catch (e) {}
      let requestKeys = [];
      try { requestKeys = Object.keys(req).slice(0, 40); } catch (e) {}
      let headerKeys = [];
      try {
        const hs = req.headers;
        if (hs && typeof hs === 'object') headerKeys = Object.keys(hs).slice(0, 40);
      } catch (e) {}
      let rawBodyType = 'missing';
      try {
        const rawBody = req.body;
        rawBodyType = rawBody == null ? 'null' : (Array.isArray(rawBody) ? 'array' : typeof rawBody);
      } catch (e) {}

      // 只记录是否存在关键字段及 data 的结构，不输出 access 或业务数据本身。
      let hasAccess = false;
      try { hasAccess = !!String(getHeader(req.headers, 'access') || '').trim(); } catch (e) {}
      let dataType = body && body.data == null ? 'missing' : (body && Array.isArray(body.data) ? 'array' : typeof (body && body.data));
      let dataKeys = [];
      let dataLength = 0;
      let dataLooksBase64 = false;
      let dataParsesAsJson = false;
      try {
        if (body && body.data && typeof body.data === 'object') dataKeys = Object.keys(body.data).slice(0, 30);
        if (typeof (body && body.data) === 'string') {
          const dataText = body.data.trim();
          dataLength = dataText.length;
          dataLooksBase64 = dataText.length > 0 &&
            dataText.length % 4 === 0 &&
            /^[A-Za-z0-9+/]+={0,2}$/.test(dataText);
          try { JSON.parse(dataText); dataParsesAsJson = true; } catch (e) {}
        }
      } catch (e) {}

      console.log(
        '[ChinaBroadnet] API侦察[v20261024-1149]: ' +
        method + ' ' + url +
        (keys.length ? ' | keys=' + keys.join(',') : '') +
        ' | bodyType=' + bodyType +
        ' | bodyKeys=' + bodyKeys.join(',') +
        ' | dataType=' + dataType +
        ' | dataKeys=' + dataKeys.join(',') +
        ' | dataLength=' + dataLength +
        ' | dataLooksBase64=' + dataLooksBase64 +
        ' | dataParsesAsJson=' + dataParsesAsJson +
        ' | accessPresent=' + hasAccess +
        ' | rawBodyType=' + rawBodyType +
        ' | requestKeys=' + requestKeys.join(',') +
        ' | headerKeys=' + headerKeys.join(',')
      );
    } catch (e) {
      console.log('[ChinaBroadnet] probe error: ' + e);
    }
  }

  const matchedApi = SUPPORTED_API_URLS.find(api => url.startsWith(api));
  if (!matchedApi) return;
  if (method !== 'POST') return;

  try {
    const access = String(getHeader(req.headers, 'access') || '').trim();
    const body = await getParsedBody();
    if (!access || !body || body.data == null) {
      console.log('[ChinaBroadnet-Hark] 捕获未完成: ' + (!access ? '缺少 access 请求头' : '请求体中缺少 data'));
      return;
    }

    ctx.storage.set(KEY + '.url', url);
    ctx.storage.set(KEY + '.access', access);
    ctx.storage.setJSON(KEY + '.data', body.data);
    ctx.storage.set(KEY + '.captureTime', String(Date.now()));

    // 捕获成功通知独立开关；只提示已捕获并开始查询，不提前声称套餐查询成功。
    if ((!ctx.env || String(ctx.env.cbCaptureNotice).toLowerCase() !== 'false') &&
        typeof ctx.notify === 'function') {
      const source = detectCaptureSource(req);
      ctx.notify({
        title: '中国广电数据捕获成功',
        body: source + '数据捕获成功，正在查询套餐接口',
        sound: false,
      });
    }
  } catch (e) {
    console.log('[ChinaBroadnet-Hark] capture error: ' + e);
  }
}

async function fetchData(ctx, access, data, preferredUrl) {
  // 优先使用捕获到的域名；失败或业务状态异常时自动回退到其他支持的端点。
  const candidates = [preferredUrl, ...SUPPORTED_API_URLS.filter(u => u !== preferredUrl)].filter(Boolean);
  let lastErr = null;

  for (const targetUrl of candidates) {
    if (targetUrl.startsWith(BLOCKED_API_URL)) continue;
    try {
      const resp = await ctx.http.post(targetUrl, {
        timeout: 4500,
        headers: {
          access,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        },
        body: { data },
      });

      if (resp && resp.status >= 200 && resp.status < 300) {
        const json = await resp.json();
        if (json && json.status === '000000') return json;
        lastErr = new Error('API业务状态异常：' + String(json && json.status || 'empty-response'));
      } else {
        lastErr = new Error('HTTP ' + (resp ? resp.status : 'no-response'));
      }
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('所有可用接口更新均失败');
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '刚刚';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return '刚刚';
  if (totalMin < 60) return totalMin + '分';
  const hours = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  if (hours < 24) return hours + '小时' + (remMin > 0 ? remMin + '分' : '');
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return days + '天' + (remHours > 0 ? remHours + '小时' : '');
}

// 数据新旧的自然描述（与联通一致）
function ageText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '刚刚';
  const min = Math.floor(ms / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + '分钟';
  const hours = Math.floor(min / 60);
  const restMin = min % 60;
  if (hours < 24) return hours + '小时' + (restMin > 0 ? restMin + '分' : '');
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return days + '天' + (restHours > 0 ? restHours + '小时' : '');
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

function saveHistory(ctx, flow, fallback) {
  try {
    const stored = ctx.storage.getJSON(KEY + '.history');
    const old = Array.isArray(stored) && stored.length ? stored : (Array.isArray(fallback) ? fallback : []);
    const n = Number(flow);
    if (!Number.isFinite(n)) return old;

    const now = Date.now();
    const next = old.filter(x => now - Number(x.ts) < 7 * 86400000);
    const last = next[next.length - 1];
    if (!last || now - Number(last.ts) >= 25 * 60 * 1000 || Number(last.flowKB) !== n) {
      next.push({ ts: now, flowKB: n });
    }
    const trimmed = next.slice(-HISTORY_LIMIT);
    if (JSON.stringify(trimmed) !== JSON.stringify(old)) {
      ctx.storage.setJSON(KEY + '.history', trimmed);
    }
    return trimmed;
  } catch (e) {
    return [];
  }
}

async function loadData(ctx, options) {
  // 兼容旧调用：布尔值表示是否强制刷新；对象形式可附带 reason / bypassThrottle。
  const opts = typeof options === 'boolean' ? { forceRefresh: options } : (options || {});
  // 手动刷新识别：60 秒内再次渲染（下拉/点按刷新）且上一次渲染没有真正请求时，绕过缓存查询一次
  const lastRenderAt = Number(ctx.storage.get(KEY + '.lastRenderAt') || 0);
  const lastFetchAt = Number(ctx.storage.get(KEY + '.lastFetchAt') || 0);
  const lastRenderFetched = ctx.storage.get(KEY + '.lastRenderFetched') === '1';
  const manualRefresh = lastRenderAt > 0 && Date.now() - lastRenderAt < 60000
    && !lastRenderFetched && Date.now() - lastFetchAt > 5000;
  ctx.storage.set(KEY + '.lastRenderAt', String(Date.now()));
  ctx.storage.set(KEY + '.lastRenderFetched', '0');
  const forceRefresh = !!opts.forceRefresh || manualRefresh;
  const reason = opts.reason || 'render';
  const bypassThrottle = !!opts.bypassThrottle;
  // 成功路径的响应结构/业务数值只在模块参数 cbDebug=true 时打印，默认不刷日志。
  const debug = String((ctx.env && ctx.env.cbDebug) || '').toLowerCase() === 'true';
  const debugLog = (...args) => { if (debug) console.log(...args); };
  // 关闭抓取时不再主动请求 qryUserInfo，仅展示最后一次成功缓存。
  if (ctx.env && String(ctx.env.cbCapture).toLowerCase() === 'false') {
    const cached = ctx.storage.getJSON(KEY + '.datasource') || null;
    if (cached) { cached.stale = true; const ts = Number(ctx.storage.get(KEY + '.captureTime') || 0); cached.captureDuration = ts > 0 ? formatDuration(Math.max(0, Number(cached.updatedAt || Date.now()) - ts)) : ''; }
    return { configured: !!cached, data: cached, fromCache: true, captureDisabled: true };
  }
  // 套餐缓存有效期调整为 15 分钟，提升数据实时性。
  const CACHE_TTL = 15 * 60 * 1000;
  const cachedData = ctx.storage.getJSON(KEY + '.datasource') || null;
  const currentCaptureTime = String(ctx.storage.get(KEY + '.captureTime') || '');
  const queriedCaptureTime = String(ctx.storage.get(KEY + '.queriedCaptureTime') || '');
  const cachedAt = Number(cachedData && cachedData.updatedAt || 0);
  const cacheAge = cachedAt > 0 ? Date.now() - cachedAt : Number.POSITIVE_INFINITY;
  const hasNewCapture = currentCaptureTime && currentCaptureTime !== queriedCaptureTime;
  const captureTs = Number(currentCaptureTime || 0);
  const captureDuration = captureTs > 0 ? formatDuration(Date.now() - captureTs) : '';
  // 缓存数据冻结在数据生成时刻，避免数据过期后「凭据保持」还在增长
  const cachedCaptureDuration = captureTs > 0
    ? formatDuration(Math.max(0, (cachedAt > 0 ? cachedAt : Date.now()) - captureTs))
    : '';

  // 15 分钟内且没有新捕获凭据时直接命中新鲜缓存；强制刷新时跳过缓存判断。
  if (!forceRefresh && cachedData && !hasNewCapture && cacheAge >= 0 && cacheAge < CACHE_TTL) {
    cachedData.stale = false;
    cachedData.captureDuration = cachedCaptureDuration;
    return { configured: true, data: cachedData, fromCache: true, skipped: true };
  }

  // 最近 15 秒内已经尝试过请求时先显示旧缓存，避免组件切屏/保活与渲染同时打接口。
  // 保活（forceRefresh）同样受此保护，只有手动强制刷新入口可以绕过。
  const lastAttemptAt = Number(ctx.storage.get(KEY + '.lastAttemptAt') || 0);
  const attemptAge = Date.now() - lastAttemptAt;
  if (!bypassThrottle && cachedData && !hasNewCapture && lastAttemptAt > 0 &&
      attemptAge >= 0 && attemptAge < 15000) {
    cachedData.stale = true;
    cachedData.captureDuration = cachedCaptureDuration;
    return { configured: true, data: cachedData, fromCache: true, skipped: true };
  }

  // SWR：缓存过期时先返回旧数据渲染，同时启动一次后台刷新；新捕获凭据则仍立即同步查询。
  if (!forceRefresh && cachedData && !hasNewCapture && cacheAge >= CACHE_TTL) {
    const accessForRefresh = ctx.storage.get(KEY + '.access');
    const dataForRefresh = ctx.storage.getJSON(KEY + '.data');
    if (accessForRefresh && dataForRefresh != null) {
      cachedData.stale = true;
      cachedData.captureDuration = cachedCaptureDuration;
      ctx.storage.set(KEY + '.lastAttemptAt', String(Date.now()));
      refreshNow(ctx, 'swr', { force: true, bypassThrottle: true }).catch(e => {
        console.log('[ChinaBroadnet-Hark] 后台静默刷新异常: ' + e);
      });
      return { configured: true, data: cachedData, fromCache: true, skipped: true };
    }
  }

  const access = ctx.storage.get(KEY + '.access');
  const data = ctx.storage.getJSON(KEY + '.data');
  const url = ctx.storage.get(KEY + '.url') || API_URL;

  if (!access || data == null) {
    return { configured: false, data: null };
  }

  try {
    ctx.storage.set(KEY + '.lastAttemptCaptureTime', currentCaptureTime);
    ctx.storage.set(KEY + '.lastAttemptAt', String(Date.now()));
    ctx.storage.set(KEY + '.lastFetchAt', String(Date.now()));
    ctx.storage.set(KEY + '.lastRenderFetched', '1');
    ctx.storage.set(KEY + '.lastRefreshReason', reason);
    const result = await fetchData(ctx, access, data, url);
    // 仅记录响应结构与字段是否存在，不记录手机号、令牌或业务字段原值。
    const responseUser = result && result.data && (result.data.userData || result.data);
    const responseKeys = result && typeof result === 'object' ? Object.keys(result).slice(0, 20) : [];
    const responseDataKeys = result && result.data && typeof result.data === 'object'
      ? Object.keys(result.data).slice(0, 30)
      : [];
    const responseUserKeys = responseUser && typeof responseUser === 'object'
      ? Object.keys(responseUser).filter(k => /^(voice|flow|flowUserd|flowAll|voiceAll|voiceUsed|fee|finBalance|packName)$/.test(k))
      : [];
    debugLog(
      '[ChinaBroadnet-Hark] API响应诊断[v20261024-1149]: ' +
      'status=' + String(result && result.status) +
      ' | ok=' + String(result && result.ok) +
      ' | resultKeys=' + responseKeys.join(',') +
      ' | dataType=' + (result && result.data === null ? 'null' : typeof (result && result.data)) +
      ' | dataKeys=' + responseDataKeys.join(',') +
      ' | userDataPresent=' + Boolean(result && result.data && result.data.userData) +
      ' | userDataKeys=' + responseUserKeys.join(',') +
      ' | flowFieldsComplete=' + Boolean(responseUser &&
        responseUser.flowAll != null && responseUser.flowUserd != null && responseUser.flow != null) +
      ' | flowSumMatches=' + Boolean(responseUser &&
        Number(responseUser.flowUserd) + Number(responseUser.flow) === Number(responseUser.flowAll))
    );
    if (!result || result.status !== '000000' || !result.data) {
      const resultKeys = result && typeof result === 'object'
        ? Object.keys(result).slice(0, 20)
        : [];
      const responseDataKeys = result && result.data && typeof result.data === 'object'
        ? Object.keys(result.data).slice(0, 30)
        : [];
      console.log(
        '[ChinaBroadnet-Hark] API响应诊断[v20261019-2318]: ' +
        'resultType=' + (result === null ? 'null' : typeof result) +
        ' | status=' + String(result && result.status).slice(0, 40) +
        ' | message=' + String(result && result.message || '').replace(/[\\r\\n]+/g, ' ').slice(0, 120) +
        ' | updateMes=' + String(result && result.updateMes || '').replace(/[\\r\\n]+/g, ' ').slice(0, 120) +
        ' | ok=' + String(result && result.ok) +
        ' | resultKeys=' + resultKeys.join(',') +
        ' | dataPresent=' + Boolean(result && result.data) +
        ' | dataType=' + (result && result.data === null ? 'null' : typeof (result && result.data)) +
        ' | dataKeys=' + responseDataKeys.join(',')
      );
      throw new Error('API 返回异常');
    }

    const user = result.data.userData || result.data;

    const planFields = scanPlanFields(result.data);
    const totalField = pickPlanMetric(planFields, 'total');
    const usedField = pickPlanMetric(planFields, 'used');
    const remainField = pickPlanMetric(planFields, 'remain');
    const planPercent = calcPlanPercent(
      totalField && totalField.value,
      usedField && usedField.value,
      remainField && remainField.value
    );

    ctx.storage.setJSON(KEY + '.planDebug', {
      capturedAt: Date.now(),
      fields: planFields,
      total: totalField,
      used: usedField,
      remain: remainField,
      percent: planPercent,
    });

    const feeRaw = findValue(user, ['fee', 'balance', 'money', 'remainFee']);
    const flowTotalRaw = findValue(user, ['flowAll']);
    const flowUsedRaw = findValue(user, ['flowUserd']);
    const flowRaw = findValue(user, ['flow', 'remainFlow', 'flowRemain']);
    const voiceTotalRaw = findValue(user, ['voiceAll']);
    const voiceUsedRaw = findValue(user, ['voiceUsed']);
    const voiceRaw = findValue(user, ['voice', 'remainVoice', 'voiceRemain']);

    const flowTotal = flowTotalRaw != null ? Number(flowTotalRaw) : (totalField && /flow/i.test(totalField.path) ? totalField.value : null);
    const flowUsed = flowUsedRaw != null ? Number(flowUsedRaw) : (usedField && /flow/i.test(usedField.path) ? usedField.value : null);
    const flowRemain = flowRaw != null ? Number(flowRaw) : (remainField && /flow/i.test(remainField.path) ? remainField.value : null);
    const voiceTotal = voiceTotalRaw != null ? Number(voiceTotalRaw) : (totalField && /voice/i.test(totalField.path) ? totalField.value : null);
    const voiceUsed = voiceUsedRaw != null ? Number(voiceUsedRaw) : (usedField && /voice/i.test(usedField.path) ? usedField.value : null);
    const voiceRemain = voiceRaw != null ? Number(voiceRaw) : (remainField && /voice/i.test(remainField.path) ? remainField.value : null);

    const flow = formatFlow(flowRemain);
    const flowPercent = calcPlanPercent(flowTotal, flowUsed, flowRemain);
    const voicePercent = calcPlanPercent(voiceTotal, voiceUsed, voiceRemain);
    const history = saveHistory(ctx, flowRemain);

    const ds = {
      stale: false,
      captureDuration,
      fee: {
        title: '剩余话费',
        number: formatFee(feeRaw),
        unit: '元',
      },
      flow: {
        title: '剩余流量',
        number: flow.number,
        unit: flow.unit,
      },
      voice: {
        title: '剩余语音',
        number: formatVoice(voiceRemain),
        unit: '分钟',
      },
      updatedAt: Date.now(),
      history,
      plan: {
        total: flowTotal,
        used: flowUsed,
        remain: flowRemain,
        percent: flowPercent,
        totalPath: flowTotalRaw != null ? 'userData.flowAll' : (totalField ? totalField.path : null),
        usedPath: flowUsedRaw != null ? 'userData.flowUserd' : (usedField ? usedField.path : null),
        remainPath: flowRaw != null ? 'userData.flow' : (remainField ? remainField.path : null),
        voiceTotal,
        voiceUsed,
        voiceRemain,
        voicePercent,
      },
    };

    ctx.storage.setJSON(KEY + '.datasource', ds);
    if (currentCaptureTime) ctx.storage.set(KEY + '.queriedCaptureTime', currentCaptureTime);

    // 每次新捕获只发送一次完整套餐通知；小组件每分钟刷新不会重复打扰。
    const captureTime = String(ctx.storage.get(KEY + '.captureTime') || '');
    const notifiedCaptureTime = String(ctx.storage.get(KEY + '.notifiedCaptureTime') || '');
    if (captureTime && captureTime !== notifiedCaptureTime) {
      if ((!ctx.env || String(ctx.env.cbPlanNotice).toLowerCase() !== 'false') &&
          typeof ctx.notify === 'function') {
      const totalFlowText = formatFlow(flowTotal);
      const usedFlowText = formatFlow(flowUsed);
      const remainFlowText = formatFlow(flowRemain);
      const body = [
        '剩余话费：¥' + formatFee(feeRaw),
        '流量：已用 ' + usedFlowText.number + ' ' + usedFlowText.unit +
          ' / 总量 ' + totalFlowText.number + ' ' + totalFlowText.unit,
        '剩余流量：' + remainFlowText.number + ' ' + remainFlowText.unit,
        '语音：剩余 ' + formatVoice(voiceRemain) + ' / 总量 ' +
          formatVoice(voiceTotal) + ' 分钟',
      ].join('\n');
      ctx.notify({
        title: '中国广电套餐查询成功',
        body,
        sound: false,
      });
      }
      // 即使关闭通知也标记已处理，避免之后刷新时补发旧捕获的通知。
      ctx.storage.set(KEY + '.notifiedCaptureTime', captureTime);
    }

    // 直接输出接口已确认的套餐字段，避免依赖递归扫描结果而漏掉字段。
    debugLog(
      '[ChinaBroadnet-Hark] 套餐字段探测: ' +
      'userData.voice=' + String(user.voice) +
      ', userData.flowUserd=' + String(user.flowUserd) +
      ', userData.voiceAll=' + String(user.voiceAll) +
      ', userData.fee=' + String(user.fee) +
      ', userData.flowAll=' + String(user.flowAll) +
      ', userData.voiceUsed=' + String(user.voiceUsed) +
      ', userData.flow=' + String(user.flow)
    );


    return { configured: true, data: ds, fromCache: false };
  } catch (e) {
    console.log('[ChinaBroadnet-Hark] query error: ' + e);
    return {
      configured: true,
      data: (() => {
        const cached = ctx.storage.getJSON(KEY + '.datasource') || null;
        if (cached) cached.stale = true;
        return cached;
      })(),
      fromCache: true,
    };
  }
}


/* =========================================================
 * 保活模式（schedule 定时任务调用）
 * 触达服务端的同时强制刷新套餐数据，并复用 loadData 的历史记录与存储逻辑
 * ========================================================= */
function parseKeepAliveInterval(value) {
  // 参数只接受正整数，单位固定为分钟；无效输入回退到默认 15 分钟。
  const raw = String(value == null ? '15' : value).trim();
  if (!/^[0-9]+$/.test(raw)) return 15 * 60 * 1000;
  const minutes = Number(raw);
  if (!Number.isSafeInteger(minutes) || minutes <= 0) return 15 * 60 * 1000;
  return Math.max(15 * 60 * 1000, Math.min(24 * 60 * 60 * 1000, minutes * 60 * 1000));
}

/* =========================================================
 * 保活模式（schedule 每分钟触发，由用户输入的易读间隔控制实际执行频率）
 * ========================================================= */
// 所有主动刷新（渲染 SWR / 定时保活 / 手动刷新）共用同一入口，统一记录来源。
async function refreshNow(ctx, reason, options) {
  const opts = options || {};
  return loadData(ctx, {
    forceRefresh: !!opts.force,
    bypassThrottle: !!opts.bypassThrottle,
    reason,
  });
}

// 保活连续失败：指数退避 + 每连续 3 次以上发一条通知（60 分钟限频）。
function registerKeepAliveFailure(ctx, reason) {
  const fails = Number(ctx.storage.get(KEY + '.keepAliveFailCount') || 0) + 1;
  ctx.storage.set(KEY + '.keepAliveFailCount', String(fails));
  console.log('[ChinaBroadnet] 保活失败（连续 ' + fails + ' 次）：' + reason);
  if (fails < 3) return;
  const lastNotify = Number(ctx.storage.get(KEY + '.keepAliveFailNotifyAt') || 0);
  if (Date.now() - lastNotify < 60 * 60 * 1000) return;
  if (typeof ctx.notify !== 'function') return;
  ctx.storage.set(KEY + '.keepAliveFailNotifyAt', String(Date.now()));
  ctx.notify({
    title: '中国广电保活失败',
    body: '已连续 ' + fails + ' 次未能更新套餐数据，凭据可能失效，请打开中国广电 App 查询一次',
    sound: false,
  });
}

async function handleKeepAlive(ctx) {
  const env = ctx && ctx.env ? ctx.env : {};
  const intervalMs = parseKeepAliveInterval(env.cbKeepaliveInterval == null ? '15' : env.cbKeepaliveInterval);
  const forceManual = String(env.CB_KEEPALIVE_FORCE || '').toLowerCase() === 'true';
  const debug = String(env.cbDebug || '').toLowerCase() === 'true';
  const tag = forceManual ? '手动强制刷新' : '定时保活';
  const now = Date.now();
  const lastRun = Number(ctx.storage.get(KEY + '.keepAliveLastRun') || 0);

  // 1) 按用户设置的间隔节流；手动强制入口不受限。
  if (!forceManual && lastRun && now - lastRun < intervalMs) return;

  // 2) 未捕获凭据：日志每 6 小时最多一条，避免 cron 每分钟刷屏。
  const access = ctx.storage.get(KEY + '.access');
  const data = ctx.storage.getJSON(KEY + '.data');
  if (!access || data == null) {
    const lastSkip = Number(ctx.storage.get(KEY + '.keepAliveSkipLoggedAt') || 0);
    if (!lastSkip || now - lastSkip > 6 * 60 * 60 * 1000) {
      ctx.storage.set(KEY + '.keepAliveSkipLoggedAt', String(now));
      console.log('[ChinaBroadnet] 保活跳过：尚未捕获有效凭据（每 6 小时提示一次）');
    }
    return;
  }

  // 3) 数据 2 分钟内刚更新过（用户正在看组件或刚刷新），本轮不必再打接口。
  const lastUpdated = Number((ctx.storage.getJSON(KEY + '.datasource') || {}).updatedAt || 0);
  if (!forceManual && lastUpdated && now - lastUpdated < 2 * 60 * 1000) {
    if (debug) console.log('[ChinaBroadnet] 保活跳过：数据 2 分钟内刚更新过');
    return;
  }

  // 4) 连续失败按指数退避，最长 60 分钟，避免凭据失效后每轮都打接口。
  const failCount = Number(ctx.storage.get(KEY + '.keepAliveFailCount') || 0);
  if (!forceManual && failCount > 0) {
    const backoff = Math.min(intervalMs * Math.pow(2, failCount), 60 * 60 * 1000);
    if (lastRun && now - lastRun < backoff) {
      if (debug) {
        console.log('[ChinaBroadnet] 保活退避中：连续失败 ' + failCount +
          ' 次，下次至少 ' + Math.round(backoff / 60000) + ' 分钟后');
      }
      return;
    }
  }

  const previousLastRun = ctx.storage.get(KEY + '.keepAliveLastRun');
  ctx.storage.set(KEY + '.keepAliveLastRun', String(now));

  try {
    const res = await refreshNow(ctx, forceManual ? 'manual' : 'keepalive', {
      force: true,
      bypassThrottle: forceManual,
    });
    // 命中断流/缓存（15 秒内刚有刷新）不算失败，也不占用本轮间隔。
    if (res && res.skipped) {
      if (previousLastRun) ctx.storage.set(KEY + '.keepAliveLastRun', String(previousLastRun));
      else ctx.storage.delete(KEY + '.keepAliveLastRun');
      if (debug) console.log('[ChinaBroadnet] ' + tag + '跳过：刚刚已有刷新进行中');
      return;
    }
    const ok = res && res.data && !res.data.stale && !res.fromCache;
    if (ok) {
      if (failCount > 0) ctx.storage.delete(KEY + '.keepAliveFailCount');
      if (debug) console.log('[ChinaBroadnet] ' + tag + '成功：已写入最新套餐数据');
      return;
    }
    registerKeepAliveFailure(ctx, res && res.data ? '数据未完全更新（可开启 cbDebug 查看详情）' : '接口未返回数据');
  } catch (e) {
    registerKeepAliveFailure(ctx, String((e && e.message) || e));
  }
}

function fontSize(size) {
  if (typeof size === 'number') {
    if (size <= 8) return 9;
    if (size <= 10) return 10;
    if (size <= 13) return 12;
    if (size <= 19) return 16;
    return 24;
  }

  const named = {
    caption2: 9,
    caption1: 10,
    footnote: 12,
    body: 16,
    title3: 20,
    title2: 22,
    title: 24,
  };
  return named[size] || 12;
}

function t(text, size, weight, color, extra) {
  return Object.assign({
    type: 'text',
    text: String(text),
    font: { size: fontSize(size), weight: weight || 'regular' },
    textColor: color || C.txt,
    maxLines: 1,
    minScale: 0.6,
  }, extra || {});
}

function glass(children, extra) {
  // 所有尺寸共用单一外层玻璃；此 helper 只负责透明布局，不再绘制内层卡片。
  return Object.assign({
    type: 'stack',
    direction: 'column',
    gap: 6,
    padding: [8, 10],
    borderRadius: 16,
    backgroundColor: { light: '#00000000', dark: '#00000000' },
    borderWidth: 0,
    borderColor: { light: '#00000000', dark: '#00000000' },
    shadowRadius: 0,
    children,
  }, extra || {}, {
    backgroundColor: { light: '#00000000', dark: '#00000000' },
    borderWidth: 0,
    borderColor: { light: '#00000000', dark: '#00000000' },
    shadowRadius: 0,
  });
}

function gaugeSvg(pct, color, w) {
  const stroke = 11;
  const r = (w - stroke) / 2;
  const cx = w / 2;
  const cy = w / 2;
  const h = w / 2 + stroke / 2;
  const p = Math.max(0, Math.min(1, Number(pct) || 0));

  const pt = a => [
    (cx - r * Math.cos(a)).toFixed(2),
    (cy - r * Math.sin(a)).toFixed(2),
  ];

  const [x0, y0] = pt(0);
  const [x1, y1] = pt(Math.PI);
  const [xp, yp] = pt(Math.PI * p);

  let body =
    `<path d='M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}' fill='none' stroke='${color}' stroke-opacity='0.18' stroke-width='${stroke}' stroke-linecap='round'/>`;

  if (p > 0.005) {
    body +=
      `<path d='M ${x0} ${y0} A ${r} ${r} 0 0 1 ${xp} ${yp}' fill='none' stroke='${color}' stroke-width='${stroke}' stroke-linecap='round'/>`;
  }

  return 'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'>${body}</svg>`
    );
}

function flowStatus(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) {
    return { color: C.flow, label: '套餐用量' };
  }
  const p = Number(pct);
  if (p >= 0.9) return { color: '#C4475B', label: '用量偏高' };
  if (p >= 0.7) return { color: C.fee, label: '注意余量' };
  // 用量正常与「无使用率数据」统一用蓝色，避免同一仪表盘出现两种主色
  return { color: C.flow, label: '用量正常' };
}

function trendStrip(ds) {
  const today = todayFlowUsage(ds.history);
  const used = today.value == null ? null : formatFlow(today.value);
  return glass([
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 6,
      children: [
        ...(used
          ? [{
              type: 'image',
              src: historySvg(today.history, C.flow, 100, 30),
              width: 72,
              height: 22,
            }]
          : []),
        {
          type: 'stack',
          direction: 'column',
          alignItems: 'start',
          gap: 1,
          flex: 1,
          children: [
            t('今日流量使用', 9, 'semibold', C.txt),
            t(today.label, 8, 'medium', C.sub, { minScale: 0.65 }),
          ],
        },
        ...(used ? [t(used.number + ' ' + used.unit, 9, 'bold', C.flow, { minScale: 0.7 })] : []),
      ],
    },
  ], {
    height: 42,
    padding: [5, 8],
    borderRadius: 13,
    gap: 0,
    backgroundColor: { light: '#00000000', dark: '#00000000' },
    borderColor: { light: '#00000000', dark: '#00000000' },
  });
}

function historySvg(history, color, w, h) {
  const vals = (history || []).map(x => Number(x.flowKB)).filter(Number.isFinite).slice(-12);
  const baseline = h - 2;
  const empty = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'><path d='M 2 ${baseline} H ${w-2}' stroke='${color}' stroke-opacity='.22' stroke-width='1.5' stroke-linecap='round' stroke-dasharray='3 4'/></svg>`;
  // 只有一个采样点时会变成一根满高柱子（看起来像实心方块），直接退回虚线基线
  if (vals.length < 2) return 'data:image/svg+xml,' + encodeURIComponent(empty);

  const max = Math.max(1, ...vals);
  const padX = Math.min(3, w * 0.025);
  const gap = Math.max(2, Math.min(5, w * 0.035));
  const count = vals.length;
  const barW = Math.max(2, (w - padX * 2 - gap * (count - 1)) / count);
  const usableH = h - 5;
  const bars = vals.map((v, i) => {
    const bh = Math.max(2, (Math.max(0, v) / max) * usableH);
    const x = padX + i * (barW + gap);
    const y = baseline - bh;
    const opacity = i === count - 1 ? 1 : 0.48 + 0.42 * ((i + 1) / count);
    return `<rect x='${x.toFixed(1)}' y='${y.toFixed(1)}' width='${barW.toFixed(1)}' height='${bh.toFixed(1)}' rx='${Math.min(2, barW / 2).toFixed(1)}' fill='${color}' fill-opacity='${opacity.toFixed(2)}'/>`;
  }).join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'><path d='M 1 ${baseline} H ${w-1}' stroke='${color}' stroke-opacity='.12' stroke-width='1'/>${bars}</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function heroFlowCard(ds, cardHeight, cardFlex, isMedium) {
  const remain = ds.flow.number + ' ' + ds.flow.unit;
  const total = ds.plan && ds.plan.total != null ? formatFlow(ds.plan.total) : null;
  const used = ds.plan && ds.plan.used != null ? formatFlow(ds.plan.used) : null;
  const compactFlowDetail = !cardHeight
    ? '总量 ' + (total ? total.number + ' ' + total.unit : '--') + ' · 已用 ' + (used ? used.number + ' ' + used.unit : '--')
    : '';
  const p = ds.plan && ds.plan.percent != null ? ds.plan.percent : null;
  const flowStyle = flowStatus(p);
  const flowContent = isMedium
    ? {
        // 中号：左侧显示剩余数值和套餐详情，右侧显示缩小的半圆仪表盘。
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 6,
        children: [
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'start',
            gap: 2,
            flex: 1,
            children: [
              t(remain, cardHeight ? 22 : 19, 'bold', C.txt, { minScale: 0.55 }),
              t(compactFlowDetail || '当前剩余', 8, 'medium', C.sub, { minScale: 0.45 }),
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'center',
            gap: 0,
            children: [
              {
                type: 'image',
                src: gaugeSvg(p != null ? p : 0, flowStyle.color, 68),
                width: 44,
                height: 24,
              },
              t(p != null ? Math.round(p * 100) + '% 已用' : '—', 8, 'bold', flowStyle.color),
            ],
          },
        ],
      }
    : {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 12,
        children: [
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'center',
            gap: -2,
            children: [
              {
                type: 'image',
                src: gaugeSvg(p != null ? p : 0, flowStyle.color, 86),
                width: 64,
                height: 34,
              },
              t(p != null ? Math.round(p * 100) + '% 已用' : '—', 10, 'bold', flowStyle.color),
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'start',
            gap: 1,
            flex: 1,
            children: [
              t(remain, cardHeight ? 23 : 20, 'bold', C.txt, { minScale: 0.55 }),
              t('当前剩余', 9, 'medium', C.sub),
              ...(!cardHeight ? [t(compactFlowDetail, 8, 'medium', C.sub, { minScale: 0.45 })] : []),
            ],
          },
        ],
      };
  return glass([
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 6,
      children: [
        {
          type: 'image',
          src: 'sf-symbol:chart.pie.fill',
          width: 13,
          height: 13,
          color: C.flow,
        },
        t('流量主卡', 10, 'semibold', C.txt),
        { type: 'spacer' },
      ],
    },
    flowContent,
  ], {
    width: 0,
    flex: cardFlex || 1,
    ...(cardHeight ? { height: cardHeight, maxWidth: 360 } : {}),
    padding: [8, 10],
    borderRadius: 18,
    gap: 4,
    backgroundColor: { light: '#00000000', dark: '#00000000' },
    borderColor: { light: '#00000000', dark: '#00000000' },
    shadowColor: { light: '#52677A18', dark: '#00000028' },
    shadowRadius: 0,
    shadowOffset: { x: 0, y: 0 },
  });
}

// 统一页头副标题：缓存/更新时间 + 凭据保持 + 凭据待更新（三种样式共用）
function headerMeta(ds) {
  const staleView = Boolean(ds.stale);
  const ageMs = ds.updatedAt ? Date.now() - Number(ds.updatedAt) : null;
  const when = staleView
    ? '缓存 ' + (ageMs != null ? ageText(ageMs) + '前' : fmtTime(ds.updatedAt))
    : '更新 ' + fmtTime(ds.updatedAt);
  const dur = ds.captureDuration ? ' · 凭据保持 ' + ds.captureDuration : '';
  const auth = ds.authFailed ? ' · 凭据待更新' : '';
  return {
    text: when + dur + auth,
    expired: staleView && ageMs != null && ageMs > 24 * 60 * 60 * 1000,
  };
}

function buildHeader(title, ds, opts) {
  const o = opts || {};
  const meta = headerMeta(ds);
  const iconSize = o.iconSize || 13;
  const titleSize = o.titleSize || 'footnote';
  const metaEl = t(meta.text, o.metaSize || 9, 'medium', meta.expired ? C.fee : C.sub, { minScale: o.minScale || 0.55 });
  const titleRow = {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 5,
    children: [
      { type: 'image', src: 'sf-symbol:antenna.radiowaves.left.and.right', width: iconSize, height: iconSize, color: C.flow },
      t(title, titleSize, 'semibold', C.txt),
    ],
  };
  if (o.twoLine) {
    return { type: 'stack', direction: 'column', alignItems: 'start', gap: 2, children: [titleRow, metaEl] };
  }
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 5,
    children: [
      { type: 'image', src: 'sf-symbol:antenna.radiowaves.left.and.right', width: iconSize, height: iconSize, color: C.flow },
      t(title, titleSize, 'semibold', C.txt),
      { type: 'spacer' },
      metaEl,
    ],
  };
}

function header(title, ds, fromCache, mediumInset) {
  const built = buildHeader(title, ds, { iconSize: 13, titleSize: 'footnote', metaSize: 9, minScale: 0.6 });
  return mediumInset ? Object.assign(built, { padding: [4, 6] }) : built;
}

// 数据是缓存/过期时尽快重渲染，让后台刷新的结果尽快呈现；正常数据维持 15 分钟。
function nextRefreshAfter(ds) {
  const delay = ds && ds.stale ? 2 * 60 * 1000 : 15 * 60 * 1000;
  return new Date(Date.now() + delay).toISOString();
}

function buildSmall(title, ds, fromCache) {
  const dur = ds.captureDuration ? ' · ' + ds.captureDuration : '';
  const p = ds.plan && ds.plan.percent != null ? ds.plan.percent : null;
  const flowStyle = flowStatus(p);
  const remain = ds.flow.number + ' ' + ds.flow.unit;
  const used = ds.plan && ds.plan.used != null
    ? formatFlow(ds.plan.used).number + ' ' + formatFlow(ds.plan.used).unit
    : '--';
  const total = ds.plan && ds.plan.total != null
    ? formatFlow(ds.plan.total).number + ' ' + formatFlow(ds.plan.total).unit
    : '--';

  return {
    type: 'widget',
    padding: [13, 13],
    gap: 6,
    backgroundColor: '#00000000',
    refreshAfter: nextRefreshAfter(ds),
    children: [
      buildHeader(title, ds, { iconSize: 12, titleSize: 12, metaSize: 7.5, twoLine: true }),

      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 4,
        flex: 1,
        children: [
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'start',
            gap: 2,
            flex: 1,
            children: [
              t('剩余流量', 9, 'medium', C.sub),
              {
                type: 'stack',
                direction: 'row',
                alignItems: 'end',
                gap: 2,
                children: [
                  t(ds.flow.number, 23, 'bold', C.txt, { minScale: 0.35 }),
                  t(ds.flow.unit, 9, 'semibold', C.sub, { minScale: 0.7 }),
                ],
              },
              {
                type: 'stack',
                direction: 'column',
                alignItems: 'start',
                gap: 2,
                children: [
                  t(
                    ds.plan && ds.plan.used != null
                      ? '已用 ' + used
                      : '已用量待确认',
                    8,
                    'semibold',
                    flowStyle.color,
                    { minScale: 0.65 }
                  ),
                  t(
                    ds.plan && ds.plan.total != null
                      ? '总量 ' + total
                      : (ds.plan && ds.plan.remain != null
                        ? '余量 ' + formatFlow(ds.plan.remain).number + ' ' + formatFlow(ds.plan.remain).unit
                        : '总量待确认'),
                    8,
                    'medium',
                    C.sub,
                    { minScale: 0.45 }
                  ),
                ],
              },
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'center',
            gap: -2,
            children: [
              {
                type: 'image',
                src: gaugeSvg(p, flowStyle.color, 78),
                width: 44,
                height: 27,
              },
              t(
                p != null ? Math.round(p * 100) + '% 已用' : '套餐',
                8,
                'bold',
                flowStyle.color
              ),
              t(
                (() => {
                  const today = todayFlowUsage(ds.history);
                  return today.value != null
                    ? '今日 ' + formatFlow(today.value).number + formatFlow(today.value).unit
                    : '今日采集中';
                })(),
                8,
                'medium',
                C.sub,
                { minScale: 0.6 }
              ),
            ],
          },
        ],
      },

      {
        type: 'stack',
        direction: 'row',
        gap: 5,
        children: [
          glass([
            { type: 'stack', direction: 'row', alignItems: 'center', gap: 3, children: [
              { type: 'image', src: 'sf-symbol:phone.fill', width: 10, height: 10, color: C.voice },
              t('剩余语音', 8, 'medium', C.sub),
            ]},
            { type: 'stack', direction: 'row', alignItems: 'end', gap: 2, children: [
              t(ds.voice.number === '--' ? '暂无' : ds.voice.number, 18, 'bold', C.txt, { minScale: 0.4 }),
              t(ds.voice.number === '--' ? '' : '分钟', 8, 'semibold', C.sub),
            ]},
          ], { width: 0, flex: 1, height: 48, padding: [7, 7], gap: 4, borderRadius: 15 }),
          glass([
            { type: 'stack', direction: 'row', alignItems: 'center', gap: 3, children: [
              { type: 'image', src: 'sf-symbol:yensign.circle.fill', width: 10, height: 10, color: C.fee },
              t('剩余话费', 8, 'medium', C.sub),
            ]},
            { type: 'stack', direction: 'row', alignItems: 'end', gap: 2, children: [
              t('¥', 10, 'semibold', C.fee),
              t(ds.fee.number, 18, 'bold', C.txt, { minScale: 0.4 }),
            ]},
          ], { width: 0, flex: 1, height: 48, padding: [7, 7], gap: 4, borderRadius: 15 }),
        ],
      }
    ],
  };
}

function buildMedium(title, ds, fromCache) {
  // 中号内容增加内缩留白，避免标题与信息区贴近玻璃卡片边缘。
  const compactFee = glass([
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 4,
      children: [
        {
          type: 'image',
          src: 'sf-symbol:yensign.circle.fill',
          width: 10,
          height: 10,
          color: C.fee,
        },
        t('话费', 9, 'medium', C.sub),
        { type: 'spacer' },
        t('¥' + ds.fee.number, 15, 'bold', C.txt, { minScale: 0.6 }),
      ],
    },
  ], {
    flex: 1,
    padding: [6, 8],
    gap: 1,
    borderRadius: 14,
    justifyContent: 'center',
  });

  const compactVoice = glass([
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 4,
      children: [
        {
          type: 'image',
          src: 'sf-symbol:phone.fill',
          width: 10,
          height: 10,
          color: C.voice,
        },
        t('语音', 9, 'medium', C.sub),
        { type: 'spacer' },
        t(ds.voice.number, 15, 'bold', C.txt, { minScale: 0.6 }),
        t('分', 8, 'semibold', C.sub),
      ],
    },

  ], {
    flex: 1,
    padding: [6, 8],
    gap: 1,
    borderRadius: 14,
  });

  const row = {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 5,
    children: [
      heroFlowCard(ds, null, null, true),
      {
        type: 'stack',
        direction: 'column',
        alignItems: 'center',
        gap: 5,
        width: 100,
        children: [
          compactFee,
          compactVoice,
        ],
      },
    ],
  };

  return {
    type: 'widget',
    padding: [12, 14],
    gap: 6,
    backgroundColor: { light: '#F4F7FB', dark: '#161B22' },
    refreshAfter: nextRefreshAfter(ds),
    children: [
      header(title, ds, fromCache, true),
      row,
      trendStrip(ds),
    ],
  };
}


function todayFlowUsage(history) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const all = (history || [])
    .filter(x => Number.isFinite(Number(x.ts)) && Number.isFinite(Number(x.flowKB)))
    .sort((a, b) => Number(a.ts) - Number(b.ts));
  const before = all.filter(x => Number(x.ts) < startOfDay);
  const today = all.filter(x => Number(x.ts) >= startOfDay);
  // 昨天最后一个采样点作为今天 00:00 的基线：跨天后第一次渲染就能算出今日用量
  const baseline = before.length ? Number(before[before.length - 1].flowKB) : null;

  if (!today.length) {
    return {
      value: null,
      history: baseline != null ? [{ ts: startOfDay, flowKB: 0 }] : [],
      label: '今日数据采集中',
    };
  }

  const first = baseline != null ? baseline : Number(today[0].flowKB);
  const last = Number(today[today.length - 1].flowKB);
  if (!Number.isFinite(first) || !Number.isFinite(last) || (baseline == null && today.length < 2)) {
    return { value: null, history: today, label: '今日数据采集中' };
  }

  const value = Math.max(0, first - last);
  const points = (baseline != null ? [{ ts: startOfDay, flowKB: first }] : []).concat(today).map(x => ({
    ts: x.ts,
    flowKB: Math.max(0, first - Number(x.flowKB)),
  }));
  return {
    value,
    history: points,
    label: value < 1 ? '今日暂无明显消耗' : '按今日已记录余量变化估算',
  };
}


function buildLarge(title, ds, fromCache) {
  const staleView = Boolean(ds.stale);
  const ageMs = ds.updatedAt ? Date.now() - Number(ds.updatedAt) : null;
  const expired = staleView && ageMs != null && ageMs > 24 * 60 * 60 * 1000;
  const plan = ds.plan || {};
  const total = plan.total != null ? formatFlow(plan.total) : null;
  const usedFlow = plan.used != null ? formatFlow(plan.used) : null;
  const remain = plan.remain != null ? formatFlow(plan.remain) : null;
  const voicePct = plan.voicePercent != null
    ? Math.max(0, Math.min(1, Number(plan.voicePercent)))
    : null;
  const voiceUsed = plan.voiceUsed != null ? formatVoice(plan.voiceUsed) : null;
  const voiceTotal = plan.voiceTotal != null ? formatVoice(plan.voiceTotal) : null;
  const p = plan.percent != null ? Math.max(0, Math.min(1, Number(plan.percent))) : null;
  const flowStyle = flowStatus(p);
  const today = todayFlowUsage(ds.history);
  const todayUsed = today.value == null ? null : formatFlow(today.value);

  // 大号组件内部只排版内容，不创建子卡片；玻璃背景由 liquidGlassWidget 统一提供。
  return {
    type: 'widget',
    padding: [16, 17],
    gap: 9,
    backgroundColor: '#00000000',
    refreshAfter: nextRefreshAfter(ds),
    children: [
      header(title, ds, fromCache),
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 12,
        height: 112,
        children: [
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'start',
            justifyContent: 'center',
            gap: 7,
            flex: 1.25,
            children: [
              {
                type: 'stack',
                direction: 'row',
                alignItems: 'center',
                gap: 5,
                children: [
                  { type: 'image', src: 'sf-symbol:chart.pie.fill', width: 13, height: 13, color: C.flow },
                  t('剩余流量', 10, 'semibold', C.sub),
                  { type: 'spacer' },
                ],
              },
              {
                type: 'stack',
                direction: 'row',
                alignItems: 'end',
                gap: 3,
                children: [
                  t(ds.flow.number, 29, 'bold', C.txt, { minScale: 0.45 }),
                  t(ds.flow.unit, 11, 'semibold', C.sub),
                ],
              },
              {
                type: 'stack',
                direction: 'row',
                gap: 4,
                height: 5,
                children: [
                  {
                    type: 'stack',
                    flex: p == null ? 1 : Math.max(0.03, p),
                    backgroundColor: flowStyle.color,
                    borderRadius: 4,
                    children: [],
                  },
                  {
                    type: 'stack',
                    flex: p == null ? 0.001 : Math.max(0.03, 1 - p),
                    backgroundColor: { light: '#7890A52B', dark: '#FFFFFF2B' },
                    borderRadius: 4,
                    children: [],
                  },
                ],
              },
              t('总量 ' + (total ? total.number + ' ' + total.unit : '--') +
                '  ·  已用 ' + (usedFlow ? usedFlow.number + ' ' + usedFlow.unit : '--'), 9, 'medium', C.sub, { minScale: 0.55 }),
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0,
            width: 90,
            children: [
              { type: 'image', src: gaugeSvg(p, flowStyle.color, 110), width: 76, height: 40 },
              t(p != null ? Math.round(p * 100) + '% 已用' : '用量统计', 9, 'bold', flowStyle.color),
            ],
          },
        ],
      },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 10,
        padding: [8, 0],
        children: [
          {
            type: 'stack',
            direction: 'column',
            gap: 4,
            flex: 1,
            children: [
              { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [
                { type: 'image', src: 'sf-symbol:yensign.circle.fill', width: 12, height: 12, color: C.fee },
                t('剩余话费', 10, 'medium', C.sub),
              ]},
              { type: 'stack', direction: 'row', alignItems: 'end', gap: 2, children: [
                t('¥' + ds.fee.number, 21, 'bold', C.txt, { minScale: 0.5 }),
                t('元', 9, 'medium', C.sub),
              ]},
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            gap: 4,
            flex: 1,
            children: [
              { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [
                { type: 'image', src: 'sf-symbol:phone.fill', width: 12, height: 12, color: C.voice },
                t('剩余语音', 10, 'medium', C.sub),
              ]},
              { type: 'stack', direction: 'row', alignItems: 'end', gap: 2, children: [
                t(ds.voice.number === '--' ? '暂无' : ds.voice.number, 21, 'bold', C.txt, { minScale: 0.5 }),
                t(ds.voice.number === '--' ? '' : '分钟', 9, 'medium', C.sub),
              ]},
              t(voiceUsed != null && voiceTotal != null
                ? '已用 ' + voiceUsed + ' / ' + voiceTotal + ' 分钟'
                : '套餐分钟明细暂不可用', 8, 'medium', C.sub, { minScale: 0.55 }),
            ],
          },
        ],
      },
      {
        type: 'stack',
        direction: 'column',
        gap: 5,
        padding: [7, 0, 0, 0],
        children: [
          {
            type: 'stack',
            direction: 'row',
            alignItems: 'center',
            gap: 4,
            children: [
              { type: 'image', src: 'sf-symbol:chart.bar.fill', width: 10, height: 10, color: C.flow },
              t('今日流量使用', 10, 'semibold', C.txt),
              { type: 'spacer' },
              ...(todayUsed ? [t(todayUsed.number + ' ' + todayUsed.unit, 10, 'bold', C.flow)] : []),
            ],
          },
          ...(todayUsed
            ? [{
                type: 'image',
                src: historySvg(today.history.map(x => ({ flowKB: x.flowKB })), C.flow, 270, 38),
                width: 270,
                height: 38,
              }]
            : []),
          t(today.label, 8, 'medium', C.sub),
          {
            type: 'stack',
            direction: 'row',
            alignItems: 'center',
            gap: 4,
            children: [
              { type: 'image', src: 'sf-symbol:clock', width: 9, height: 9, color: C.sub },
              t(staleView ? '缓存 ' + (ageMs != null ? ageText(ageMs) + '前' : '') : '实时数据', 8, 'medium', expired ? C.fee : C.sub),
              { type: 'spacer' },
              t(expired ? '数据已过期' : (ds.captureDuration ? '凭据已保持 ' + ds.captureDuration : '定时保活中'), 8, 'medium', expired ? C.fee : C.sub),
            ],
          },
        ],
      },
    ],
  };
}

function buildLock(title, ds, family) {
  const dur = ds.captureDuration ? ' · 保持' + ds.captureDuration : '';
  if (family === 'accessoryInline') {
    return {
      type: 'widget',

      refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      children: [
        {
          type: 'text',
          text: `¥${ds.fee.number} · ${ds.flow.number}${ds.flow.unit} · ${ds.voice.number}分${dur}`,
          maxLines: 1,
          minScale: 0.6,
        },
      ],
    };
  }

  if (family === 'accessoryCircular') {
    return {
      type: 'widget',

      refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      padding: 7,
      children: [
        { type: 'spacer' },
        {
          type: 'stack',
          direction: 'column',
          alignItems: 'center',
          gap: 0,
          children: [
            {
              type: 'image',
              src: 'sf-symbol:wifi',
              width: 11,
              height: 11,
              color: C.flow,
            },
            t(ds.flow.number, 14, 'bold', C.txt, { minScale: 0.5 }),
            t(ds.flow.unit, 8, 'regular', C.sub),
          ],
        },
        { type: 'spacer' },
      ],
    };
  }

  return {
    type: 'widget',

    refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    padding: [3, 5],
    gap: 2,
    children: [
      t(`话费 ¥${ds.fee.number}`, 'footnote', 'bold', C.fee),
      t(`流量 ${ds.flow.number}${ds.flow.unit} · 语音 ${ds.voice.number}分`, 'caption2', 'semibold', C.txt, {
        minScale: 0.6,
      }),
      t(`更新 ${fmtTime(ds.updatedAt)}${dur}`, 'caption2', 'regular', C.sub, { minScale: 0.55 }),
    ],
  };
}

function liquidGlassWidget(widget) {
  if (!widget || widget.type !== 'widget') return widget;
  // 透明模式下根节点完全透明，避免系统底色覆盖壁纸；内容仍按各自颜色绘制。
  widget.backgroundColor = '#00000000';
  delete widget.glassContentPadding;
  return widget;
}

function buildError(title, message) {
  return {
    type: 'widget',

    refreshAfter: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    padding: 14,
    gap: 6,
    backgroundColor: '#00000000',
    children: [
      t(title, 'footnote', 'semibold'),
      { type: 'spacer' },
      {
        type: 'image',
        src: 'sf-symbol:exclamationmark.triangle.fill',
        width: 22,
        height: 22,
        color: C.fee,
      },
      t(message, 'caption1', 'medium', C.txt, {
        maxLines: 4,
        minScale: 0.7,
      }),
      { type: 'spacer' },
    ],
  };
}

/* ============ 备选 UI：仪表盘版 / iOS 版（uiStyle = dash / ios） ============ */

function daysInMonthLeft() {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(1, last - now.getDate() + 1);
}

function altHeader(title, ds, size, small) {
  return buildHeader(title, ds, {
    iconSize: size,
    titleSize: size,
    metaSize: small ? 7.5 : 8,
    twoLine: Boolean(small),
    minScale: 0.5,
  });
}

// 多层同心圆环（iOS 版）；items: [{pct, color, stroke}]
function ringsSvg(items, size) {
  const cx = size / 2;
  const cy = size / 2;
  let svg = '<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 ' + size + ' ' + size + '\'>';
  // 以最大描边为准留边，避免最外圈被 viewBox 裁掉
  let maxStroke = 8;
  for (const it of items) maxStroke = Math.max(maxStroke, it.stroke || 8);
  let r = size / 2 - maxStroke / 2 - 1;
  for (const it of items) {
    const stroke = it.stroke || 8;
    const c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(1, Number(it.pct) || 0));
    svg += '<circle cx=\'' + cx + '\' cy=\'' + cy + '\' r=\'' + r.toFixed(1) + '\' fill=\'none\' stroke=\'' + it.color +
      '\' stroke-opacity=\'0.16\' stroke-width=\'' + stroke + '\'/>';
    if (p > 0.001) {
      svg += '<circle cx=\'' + cx + '\' cy=\'' + cy + '\' r=\'' + r.toFixed(1) + '\' fill=\'none\' stroke=\'' + it.color +
        '\' stroke-width=\'' + stroke + '\' stroke-linecap=\'round\' stroke-dasharray=\'' + (c * p).toFixed(1) + ' ' + c.toFixed(1) +
        '\' transform=\'rotate(-90 ' + cx + ' ' + cy + ')\'/>';
    }
    r -= stroke + 3;
  }
  svg += '</svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function altGauge(pct, color, w) {
  return {
    type: 'image',
    src: gaugeSvg(pct == null ? 0 : Math.max(0, Math.min(1, pct)), color, w),
    width: w,
    height: Math.round(w / 2) + 6,
  };
}

function altStrip(ds, compact) {
  const today = todayFlowUsage(ds.history);
  const used = today.value == null ? null : formatFlow(today.value);
  const daysLeft = daysInMonthLeft();
  const remain = ds.plan && ds.plan.remain != null ? ds.plan.remain : null;
  const avg = remain != null ? formatFlow(Math.round(remain / daysLeft)) : null;
  const enough = remain != null && today.value ? Math.max(0, Math.floor(remain / today.value)) : null;
  const children = [
    { type: 'image', src: historySvg(today.history, C.flow, 90, 20), width: compact ? 38 : 54, height: 16 },
    t('今日 ' + (used ? used.number + ' ' + used.unit : '—'), compact ? 7.5 : 8, 'medium', C.txt, { minScale: 0.55 }),
  ];
  children.push({ type: 'spacer' });
  if (avg && !compact) children.push(t('日均 ' + avg.number + ' ' + avg.unit, 7.5, 'medium', C.sub, { minScale: 0.55 }));
  if (enough != null) children.push(t('够用 ' + enough + ' 天 ✓', 7.5, 'semibold', C.green, { minScale: 0.55 }));
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 6,
    padding: [3, 8],
    borderRadius: 11,
    backgroundColor: { light: '#FFFFFF80', dark: '#1E2C3C55' },
    children,
  };
}

// 仪表盘版卡片（尺寸随布局档位变化）
function altCard(opts) {
  const gaugeW = opts.gaugeW || 40;
  const valueSize = opts.valueSize || 13;
  const labelSize = opts.labelSize || 7.5;
  const pad = opts.pad || [6, 3];
  const children = [
    {
      type: 'stack', direction: 'row', alignItems: 'center', gap: 2,
      children: [
        { type: 'image', src: opts.icon, width: 9, height: 9, color: opts.color },
        t(opts.label, labelSize, 'medium', C.sub, { minScale: 0.55 }),
      ],
    },
  ];
  if (opts.pct != null) children.push(altGauge(opts.pct, opts.color, gaugeW));
  children.push({
    type: 'stack', direction: 'row', alignItems: 'end', gap: 1,
    children: [t(opts.value, valueSize, 'bold', C.txt, { minScale: 0.45 })]
      .concat(opts.unit ? [t(opts.unit, opts.unitSize || 7, 'medium', C.sub)] : []),
  });
  if (opts.sub) children.push(t(opts.sub, 6.5, 'medium', C.sub, { minScale: 0.55 }));
  return {
    type: 'stack', direction: 'column', alignItems: 'center', gap: 2,
    flex: 1, padding: pad, borderRadius: 12,
    backgroundColor: { light: '#FFFFFFB8', dark: '#1E2C3C7A' },
    children,
  };
}

// 大号仪表盘版：今日趋势区
function dashboardLower(ds) {
  const today = todayFlowUsage(ds.history);
  const used = today.value == null ? null : formatFlow(today.value);
  const daysLeft = daysInMonthLeft();
  const remain = ds.plan && ds.plan.remain != null ? ds.plan.remain : null;
  const avg = remain != null ? formatFlow(Math.round(remain / daysLeft)) : null;
  const enough = remain != null && today.value ? Math.max(0, Math.floor(remain / today.value)) : null;
  return {
    type: 'stack', direction: 'column', gap: 4, padding: [7, 10], borderRadius: 12,
    backgroundColor: { light: '#FFFFFF80', dark: '#1E2C3C55' },
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 6,
        children: [
          { type: 'image', src: 'sf-symbol:chart.bar.fill', width: 10, height: 10, color: C.flow },
          t('今日流量使用', 10, 'semibold', C.txt),
          { type: 'spacer' },
          t(used ? used.number + ' ' + used.unit : '采集中', 10, 'bold', C.flow),
        ],
      },
      ...(used ? [{ type: 'image', src: historySvg(today.history, C.flow, 280, 46), width: 280, height: 46 }] : []),
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
        children: [
          t(avg ? '日均可用 ' + avg.number + ' ' + avg.unit : '今日数据采集中', 8, 'medium', C.sub, { minScale: 0.6 }),
          { type: 'spacer' },
          t(enough != null ? '预计够用 ' + enough + ' 天 ✓' : '', 8, 'semibold', C.green, { minScale: 0.6 }),
        ],
      },
    ],
  };
}

// 大号仪表盘版：账户条
function dashAccount(ds) {
  if (!ds.account || ds.account.balance == null) return null;
  const children = [
    { type: 'image', src: 'sf-symbol:yensign.circle.fill', width: 9, height: 9, color: C.fee },
    t('账户余额 ¥' + Number(ds.account.balance).toFixed(2), 8, 'semibold', C.sub, { minScale: 0.6 }),
    { type: 'spacer' },
  ];
  if (ds.account.monthCost != null) children.push(t('本月 ¥' + Number(ds.account.monthCost).toFixed(2), 8, 'medium', C.sub, { minScale: 0.6 }));
  children.push(ds.account.owed != null && Number(ds.account.owed) > 0
    ? t('欠费 ¥' + Number(ds.account.owed).toFixed(2), 8, 'semibold', C.fee)
    : t('无欠费', 8, 'medium', C.sub));
  return { type: 'stack', direction: 'row', alignItems: 'center', gap: 5, children };
}

function dashCards(ds, layout) {
  const p = ds.plan && ds.plan.percent != null ? ds.plan.percent : null;
  const remain = ds.plan && ds.plan.remain != null ? formatFlow(ds.plan.remain) : null;
  const today = todayFlowUsage(ds.history);
  const todayUsed = today.value == null ? null : formatFlow(today.value);
  const daysLeft = daysInMonthLeft();
  const remainRaw = ds.plan && ds.plan.remain != null ? ds.plan.remain : null;
  const dailyAllow = remainRaw != null ? remainRaw / daysLeft : null;
  const dailyPct = today.value && dailyAllow ? Math.max(0, Math.min(1, today.value / dailyAllow)) : null;
  const voiceRemainPct = ds.plan && ds.plan.voiceTotal
    ? Math.max(0, Math.min(1, (Number(ds.plan.voiceTotal) - Number(ds.plan.voiceUsed || 0)) / Number(ds.plan.voiceTotal)))
    : null;

  const size = {
    gaugeW: layout === 'large' ? 56 : (layout === 'small' ? 24 : 40),
    valueSize: layout === 'large' ? 18 : (layout === 'small' ? 11 : 13),
    unitSize: layout === 'large' ? 8 : (layout === 'small' ? 6.5 : 7),
    labelSize: layout === 'large' ? 9.5 : (layout === 'small' ? 6.8 : 7.5),
    pad: layout === 'large' ? [10, 4] : (layout === 'small' ? [4, 2] : [6, 3]),
  };

  const feeCard = altCard(Object.assign({}, size, {
    label: ds.fee.title || '剩余话费',
    icon: 'sf-symbol:yensign.circle.fill',
    color: C.fee,
    value: '¥' + ds.fee.number,
    pct: null,
    sub: '本月剩 ' + daysLeft + ' 天',
  }));
  const flowCard = altCard(Object.assign({}, size, {
    label: '剩余流量',
    icon: 'sf-symbol:wifi',
    color: C.flow,
    value: remain ? remain.number : (ds.flow && ds.flow.number ? ds.flow.number : '--'),
    unit: remain ? remain.unit : (ds.flow && ds.flow.number ? ds.flow.unit : ''),
    pct: p != null ? 1 - Math.max(0, Math.min(1, p)) : 0,
    sub: p != null ? Math.round((1 - Math.max(0, Math.min(1, p))) * 100) + '% 剩余' : '套餐用量',
  }));
  const dirCard = ds.directional && ds.directional.remain
    ? altCard(Object.assign({}, size, {
        label: '定向流量',
        icon: 'sf-symbol:arrow.triangle.branch',
        color: C.cyan,
        value: ds.directional.remain.number,
        unit: ds.directional.remain.unit,
        pct: ds.directionalPct != null ? ds.directionalPct : 0,
        sub: ds.directionalPct != null ? Math.round(ds.directionalPct * 100) + '% 剩余' : '剩余',
      }))
    : altCard(Object.assign({}, size, {
        label: '今日流量',
        icon: 'sf-symbol:chart.bar.fill',
        color: C.cyan,
        value: todayUsed ? todayUsed.number : '--',
        unit: todayUsed ? todayUsed.unit : '',
        pct: dailyPct != null ? dailyPct : 0,
        sub: dailyAllow != null
          ? '日均 ' + formatFlow(Math.round(dailyAllow)).number + ' ' + formatFlow(Math.round(dailyAllow)).unit
          : '今日已用',
      }));
  const voiceCard = altCard(Object.assign({}, size, {
    label: '剩余语音',
    icon: 'sf-symbol:phone.fill',
    color: C.green,
    value: ds.voice.number,
    unit: ds.voice.unit,
    pct: voiceRemainPct != null ? voiceRemainPct : 0,
    sub: ds.voice.number === '--' ? '暂无'
      : (Number(ds.voice.number) === 0 ? '未包含'
        : (voiceRemainPct != null ? Math.round(voiceRemainPct * 100) + '% 剩余' : '剩余')),
  }));
  return [feeCard, flowCard, dirCard, voiceCard];
}

function buildDash(family, title, ds) {
  const small = family === 'systemSmall';
  const large = family === 'systemLarge' || family === 'systemExtraLarge';
  const layout = small ? 'small' : (large ? 'large' : 'medium');
  const cards = dashCards(ds, layout);
  let body;
  if (small) {
    body = [
      { type: 'stack', direction: 'row', gap: 5, flex: 1, children: [cards[0], cards[1], cards[3]] },
      altStrip(ds, true),
    ];
  } else if (large) {
    const account = dashAccount(ds);
    body = [
      { type: 'stack', direction: 'row', gap: 7, flex: 1, children: cards },
      dashboardLower(ds),
      ...(account ? [account] : []),
    ];
  } else {
    body = [
      { type: 'stack', direction: 'row', gap: 6, children: cards },
      altStrip(ds, false),
    ];
  }
  return {
    type: 'widget',

    refreshAfter: nextRefreshAfter(ds),
    padding: small ? [11, 12] : (large ? [14, 16] : [13, 14]),
    gap: 7,
    backgroundColor: '#00000000',
    children: [altHeader(title, ds, 12, small), ...body],
  };
}

function iosRow(label, icon, color, value, unit, pctText, opt) {
  const o = opt || {};
  const col = (w, align, child) => ({
    type: 'stack', direction: 'column', alignItems: align, width: w,
    children: [child],
  });
  const children = [
    { type: 'image', src: icon, width: o.iconSize || 9, height: o.iconSize || 9, color },
    col(o.labelW || 46, 'start', t(label, o.labelSize || 8, 'medium', C.sub, { minScale: 0.6 })),
    { type: 'spacer' },
    col(o.valueW || 56, 'end', t(value, o.valueSize || 11, 'bold', C.txt, { minScale: 0.45, textAlign: 'right' })),
  ];
  if (unit) children.push(col(o.unitW || 18, 'start', t(unit, o.unitSize || 7, 'medium', C.sub)));
  if (pctText) children.push(col(o.pctW || 30, 'end', t(pctText, o.pctSize || 8, 'semibold', color, { minScale: 0.6, textAlign: 'right' })));
  return { type: 'stack', direction: 'row', alignItems: 'center', gap: 3, children };
}

function buildIos(family, title, ds) {
  const small = family === 'systemSmall';
  const large = family === 'systemLarge' || family === 'systemExtraLarge';
  const p = ds.plan && ds.plan.percent != null ? ds.plan.percent : null;
  const remainPct = p != null ? Math.max(0, Math.min(1, 1 - p)) : null;
  const voiceRemain = ds.plan && ds.plan.voiceRemain != null ? Number(ds.plan.voiceRemain) : null;
  const voiceTotal = ds.plan && ds.plan.voiceTotal != null ? Number(ds.plan.voiceTotal) : null;
  const voicePct = voiceRemain != null && voiceTotal ? Math.max(0, Math.min(1, voiceRemain / voiceTotal)) : null;

  const ringItems = [];
  const strokeMain = large ? 8 : (small ? 6 : 7);
  const strokeSub = large ? 6 : (small ? 5 : 6);
  if (remainPct != null) ringItems.push({ pct: remainPct, color: C.flow, stroke: strokeMain });
  if (ds.directional && ds.directional.remain) {
    ringItems.push({ pct: ds.directionalPct != null ? ds.directionalPct : 0, color: C.cyan, stroke: strokeSub });
  }
  if (voicePct != null) ringItems.push({ pct: voicePct, color: C.green, stroke: strokeSub });
  if (!ringItems.length) ringItems.push({ pct: 0, color: C.flow, stroke: strokeMain });

  const ringSize = small ? 56 : (large ? 72 : 68);

  const feeBlock = {
    type: 'stack', direction: 'column', alignItems: 'center', gap: 0,
    children: [
      t('剩余话费', 7, 'medium', C.sub, { minScale: 0.6 }),
      {
        type: 'stack', direction: 'row', alignItems: 'end', gap: 1,
        children: [
          t('¥' + ds.fee.number, 12, 'bold', C.txt, { minScale: 0.45 }),
          t('元', 6.5, 'medium', C.sub),
        ],
      },
    ],
  };

  const rowOpt = small
    ? { labelSize: 7, valueSize: 10, unitSize: 6.5, iconSize: 8, labelW: 32, valueW: 40, unitW: 14 }
    : (large
      ? { labelSize: 10, valueSize: 17, unitSize: 8.5, pctSize: 10, iconSize: 11, labelW: 50, valueW: 72, unitW: 20, pctW: 32 }
      : { labelSize: 9, valueSize: 13, unitSize: 7.5, pctSize: 9, iconSize: 10, labelW: 46, valueW: 64, unitW: 20, pctW: 34 });

  const rows = [
    iosRow('剩余话费', 'sf-symbol:yensign.circle.fill', C.fee, '¥' + ds.fee.number, '元', '', rowOpt),
  ];
  rows.push(iosRow('剩余流量', 'sf-symbol:wifi', C.flow, ds.flow.number, ds.flow.unit,
    (!small && remainPct != null) ? Math.round(remainPct * 100) + '%' : '', rowOpt));
  if (!small) {
    if (ds.directional && ds.directional.remain) {
      rows.push(iosRow('定向流量', 'sf-symbol:arrow.triangle.branch', C.cyan,
        ds.directional.remain.number, ds.directional.remain.unit,
        ds.directionalPct != null ? Math.round(ds.directionalPct * 100) + '%' : '', rowOpt));
    } else if (ds.otherUsedMB != null) {
      const other = formatFlow(Math.round(ds.otherUsedMB * 1024));
      rows.push(iosRow('其他流量', 'sf-symbol:chart.pie.fill', C.cyan, other.number, other.unit, '已用', rowOpt));
    }
  }
  rows.push(iosRow('剩余语音', 'sf-symbol:phone.fill', C.green, ds.voice.number, ds.voice.unit,
    (!small && voicePct != null) ? Math.round(voicePct * 100) + '%' : '', rowOpt));

  const ringCol = {
    type: 'stack', direction: 'column', alignItems: 'center', gap: 1,
    children: [
      { type: 'image', src: ringsSvg(ringItems, ringSize), width: ringSize, height: ringSize },
      ...(small ? [] : []),
    ],
  };

  const account = large ? dashAccount(ds) : null;
  const today = todayFlowUsage(ds.history);
  const todayUsed = today.value == null ? null : formatFlow(today.value);
  const remainRaw = ds.plan && ds.plan.remain != null ? ds.plan.remain : null;
  const enough = remainRaw != null && today.value ? Math.max(0, Math.floor(remainRaw / today.value)) : null;

  const smallRight = {
    type: 'stack', direction: 'column', gap: 3, flex: 1,
    children: [
      { type: 'image', src: historySvg(today.history, C.flow, 80, 18), width: 50, height: 14 },
      t('今日 ' + (todayUsed ? todayUsed.number + ' ' + todayUsed.unit : '—'), 7.5, 'medium', C.txt, { minScale: 0.5 }),
      t(enough != null ? '预计 ' + enough + ' 天 ✓' : '预计 —', 7.5, 'semibold', C.green, { minScale: 0.5 }),
    ],
  };

  const body = small
    ? [
        {
          type: 'stack', direction: 'row', alignItems: 'center', gap: 8,
          children: [ringCol, smallRight],
        },
        { type: 'stack', direction: 'column', gap: 3, children: rows },
      ]
    : [
        {
          type: 'stack',
          direction: 'row',
          alignItems: 'center',
          gap: large ? 14 : 10,
          ...(large ? { flex: 1 } : {}),
          children: [
            ringCol,
            { type: 'stack', direction: 'column', gap: large ? 10 : 7, flex: 1, children: rows },
          ],
        },
        ...(large ? [dashboardLower(ds)] : [altStrip(ds, false)]),
        ...(account ? [account] : []),
      ];

  return {
    type: 'widget',

    refreshAfter: nextRefreshAfter(ds),
    padding: small ? [9, 11] : (large ? [14, 16] : [12, 14]),
    gap: small ? 4 : 7,
    backgroundColor: '#00000000',
    children: [altHeader(title, ds, 12, small), ...body],
  };
}

async function handleManualRefresh(ctx) {
  try {
    await refreshNow(ctx, 'manual', { force: true, bypassThrottle: true });
    const ds = ctx.storage.getJSON(KEY + '.datasource') || null;
    if (typeof ctx.notify === 'function') {
      if (ds && ds.flow && ds.fee) {
        ctx.notify({
          title: '中国广电数据已刷新',
          body: '流量 ' + ds.flow.number + ' ' + ds.flow.unit + ' · 话费 ¥' + ds.fee.number,
          sound: false,
        });
      } else {
        ctx.notify({
          title: '中国广电刷新失败',
          body: '请打开中国广电 App 查询一次后再试',
          sound: false,
        });
      }
    }
  } catch (e) {
    console.log('[ChinaBroadnet-Hark] 手动刷新失败: ' + String((e && e.message) || e));
  }
}

async function handleWidget(ctx) {
  const result = await loadData(ctx, { reason: 'render' });

  if (!result.configured) {
    return buildError(
      '中国广电',
      '请打开中国广电 App 查询一次，等待自动捕获数据'
    );
  }

  if (!result.data) {
    return buildError(
      '中国广电',
      '查询失败，请重新打开 App 查询一次'
    );
  }

  // 渲染时也补一个采样点（saveHistory 内部 25 分钟去重）：命中小程序/本地缓存
  // 或没有 App 凭据时不会走网络请求，若不在这里记录，「今日流量」就永远停在旧值。
  try {
    const data = result.data;
    const remainForHistory = data.plan && data.plan.remain != null ? data.plan.remain : null;
    if (remainForHistory != null) {
      const hist = saveHistory(ctx, remainForHistory, Array.isArray(data.history) ? data.history : []);
      if (Array.isArray(hist)) data.history = hist;
    }
  } catch (e) {
    // 采样失败不影响渲染
  }

  const family = ctx.widgetFamily || 'systemSmall';

  if (family.startsWith('accessory')) {
    return buildLock('中国广电', result.data, family);
  }

  // 显示样式：classic = 当前样式，dash = 仪表盘版，ios = 圆环列表版
  const uiStyle = String((ctx.env && ctx.env.cbUiStyle) || 'classic').toLowerCase();
  if (uiStyle === 'dash' || uiStyle === 'ios') {
    const altWidget = uiStyle === 'dash'
      ? buildDash(family, '中国广电', result.data)
      : buildIos(family, '中国广电', result.data);
    return altWidget;
  }

  if (family === 'systemMedium') {
    return liquidGlassWidget(buildMedium('中国广电', result.data, result.fromCache));
  }

  if (family === 'systemLarge' || family === 'systemExtraLarge') {
    return liquidGlassWidget(buildLarge('中国广电', result.data, result.fromCache));
  }

  return liquidGlassWidget(buildSmall('中国广电', result.data, result.fromCache));
}

export default async function(ctx) {
  // 1. HTTP 抓包模式：自动捕获 access 与请求 payload
  if (ctx && ctx.request && ctx.request.url) {
    await capture(ctx);
    return;
  }

  // 2. 定时保活模式：支持 schedule (ctx.cron) 或环境变量开启
  if (ctx && (ctx.cron || (ctx.env && ctx.env.CB_KEEPALIVE === 'true'))) {
    return handleKeepAlive(ctx);
  }

  // 3. 手动运行（脚本列表里没有 widgetFamily）：强制查询一次并通知
  if (ctx && !ctx.widgetFamily) {
    await handleManualRefresh(ctx);
    return;
  }

  // 4. Generic Widget 模式：渲染小组件 UI
  try {
    const widget = await handleWidget(ctx || {});
    if (widget && widget.type === 'widget') return widget;
    return buildError('中国广电', '组件返回内容异常，请刷新模块');
  } catch (e) {
    return buildError('中国广电', '组件渲染异常：' + String(e && e.message ? e.message : e).slice(0, 80));
  }
}
/**
 * CF-Server-Monitor latency & traffic widget for Egern
 * (延迟流量版：基于 CF_Server_Monitor_Widget.js，原版保持不变)
 *
 * Data source: GET /api/servers of CF-Server-Monitor (the same API its dashboard uses)
 * Shows: ISP latency (电信 / 联通 / 移动 / BGP) with packet loss, a 2-hour latency
 *        chart when the dashboard has 三网详情 enabled, and monthly traffic used / limit
 * Sizes: small / medium / large / extra large / lock screen circular / rectangular / inline
 *
 * Required env:
 *   CFSM_URL: Dashboard root URL, e.g. https://monitor.example.com
 *
 * Optional env:
 *   POLICY: Egern policy or policy group for the requests, e.g. Proxy
 *   CFSM_TOKEN: Admin JWT for a private site (valid for 7 days)
 *   CFSM_USER / CFSM_PASS: Admin login for a private site; the token is cached and renewed
 *   SERVERS: Only show these servers (names or IDs, comma separated)
 *   SHOW_HIDDEN: Show servers hidden on the dashboard (needs login). Default: false
 *   TITLE: Widget title. Default: CF Monitor
 *   REFRESH_MINUTES: Refresh interval. Default: 15
 *   EXPIRE_WARN_DAYS: Warn when a server expires within this many days. Default: 14
 *   MAX_ROWS: Servers shown in the medium widget. Default: 4
 *
 * Module: egern/module/CF_Server_Monitor_Net_Widget.yaml
 * 本地脚本用法：可以直接改下面的 CONFIG（Env 优先）。仓库是公开的，令牌和密码只填在 Egern 的 Env 里，别写进这个文件。
 */

const CONFIG = {
  url: '',            // 必填：面板地址，如 https://monitor.example.com（根地址即可）
  policy: '',         // 请求走的 Egern 策略/策略组名，如 Proxy；*.workers.dev 国内直连不通时填
  token: '',          // 私有站点（二选一）：后台登录得到的 JWT，7 天有效
  username: '',       // 私有站点（二选一）：后台账号 + 密码，脚本自动登录并缓存令牌
  password: '',
  servers: '',        // 只显示部分服务器：名称或 ID，英文逗号分隔；留空显示全部
  showHidden: false,  // 显示后台设为「隐藏」的服务器（需要登录）
  title: 'CF Monitor',
  refreshMinutes: 15, // 期望刷新间隔（分钟），iOS 实际刷新可能更慢
  expireWarnDays: 14, // 剩余天数 ≤ 此值时提醒
  maxRows: 4,         // 中尺寸最多显示几台（建议 ≤ 5）
};

const ONLINE_MS = 300000;                  // 与面板一致：5 分钟无上报视为离线
const TOKEN_MAX_AGE_MS = 6 * 86400000;     // JWT 7 天有效，提前一天换
const REQUEST_TIMEOUT_MS = 10000;          // 最坏情况要连发 3 个请求（取数→登录→再取数），模块 timeout 设 30 秒
const CACHE_KEY = 'cfsm_net_widget_cache_v1';
const TOKEN_KEY = 'cfsm_widget_token_v1';
const UA = 'Egern-CFSM-Net-Widget/1.0';
const GB = 1024 * 1024 * 1024;
const CHART_W = 258, CHART_H = 26;         // 延迟曲线尺寸（按最窄的大号小组件留了余量）

const C = {
  bgTop: { light: '#FFFFFF', dark: '#161B22' },
  bgBottom: { light: '#EEF1F5', dark: '#0D1117' },
  card: { light: '#0000000A', dark: '#FFFFFF0F' },
  fg: { light: '#1F2328', dark: '#E6EDF3' },
  dim: { light: '#59636E', dark: '#8B949E' },
  faint: { light: '#818B98', dark: '#6E7681' },
  track: { light: '#0000001A', dark: '#FFFFFF24' },
  green: { light: '#1A7F37', dark: '#3FB950' },
  amber: { light: '#9A6700', dark: '#D29922' },
  red: { light: '#CF222E', dark: '#F85149' },
  blue: { light: '#0969DA', dark: '#58A6FF' },
  cyan: { light: '#1B7C83', dark: '#39D2C0' },
};
// 三网线路：图例颜色（小圆点、曲线）和锁屏用的单字简称。SVG 里不能写 #（data URI 会被截断），只用 rgb()
const ISP = {
  ct: { dsl: { light: '#0969DA', dark: '#58A6FF' }, svg: 'rgb(56,139,253)', short: '电' },
  cu: { dsl: { light: '#BC4C00', dark: '#F0883E' }, svg: 'rgb(240,136,62)', short: '联' },
  cm: { dsl: { light: '#1A7F37', dark: '#3FB950' }, svg: 'rgb(63,185,80)', short: '移' },
  bd: { dsl: { light: '#8250DF', dark: '#BC8CFF' }, svg: 'rgb(188,140,255)', short: 'B' },
};
const PING_KEYS = [['ct', '电信'], ['cu', '联通'], ['cm', '移动'], ['bd', 'BGP']];

const CYCLES = {
  month: { months: 1, label: '月' },
  quarter: { months: 3, label: '季' },
  half_year: { months: 6, label: '半年' },
  year: { months: 12, label: '年' },
  two_years: { months: 24, label: '2年' },
  three_years: { months: 36, label: '3年' },
  four_years: { months: 48, label: '4年' },
  five_years: { months: 60, label: '5年' },
};
const CYCLE_ALIASES = {
  '月': 'month', monthly: 'month', mo: 'month', '季': 'quarter', '季度': 'quarter', quarterly: 'quarter',
  '半年': 'half_year', halfyear: 'half_year', 'half-yearly': 'half_year', '年': 'year', '一年': 'year',
  yearly: 'year', annual: 'year', '两年': 'two_years', '二年': 'two_years', '2 years': 'two_years',
  '三年': 'three_years', '3 years': 'three_years', '四年': 'four_years', '4 years': 'four_years',
  '五年': 'five_years', '5 years': 'five_years',
};

// ───────────────────────────── 入口 ─────────────────────────────

export default async function (ctx) {
  const family = ctx.widgetFamily || 'systemMedium';
  const cfg = readConfig(ctx);
  const now = Date.now();
  let model;
  try {
    if (!cfg.base) {
      throw new WidgetError('config', '还没填面板地址', '模块 Env 填 CFSM_URL，或改脚本顶部 CONFIG.url');
    }
    const data = await loadServers(ctx, cfg);
    model = buildModel(data, cfg, now, now, false);
    saveCache(ctx, cfg, data, now);
  } catch (e) {
    const err = toWidgetError(e, cfg);
    const canUseCache = err.kind === 'network' || err.kind === 'http' || err.kind === 'format';
    const cached = canUseCache ? readCache(ctx, cfg) : null;
    if (!cached) return errorWidget(family, cfg, err);
    model = buildModel(cached.data, cfg, cached.at, now, true);
  }
  return render(family, model, cfg);
}

// ───────────────────────────── 配置 ─────────────────────────────

function readConfig(ctx) {
  const env = {};
  const rawEnv = ctx.env || {};
  Object.keys(rawEnv).forEach(function (k) { env[k.toLowerCase()] = rawEnv[k]; });
  function pick(keys, fallback) {
    for (let i = 0; i < keys.length; i++) {
      const v = env[keys[i].toLowerCase()];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return fallback;
  }
  return {
    base: normalizeBase(pick(['CFSM_URL', 'URL'], CONFIG.url)),
    policy: String(pick(['POLICY'], CONFIG.policy) || '').trim(),
    token: String(pick(['CFSM_TOKEN', 'TOKEN'], CONFIG.token) || '').trim(),
    username: String(pick(['CFSM_USER', 'CFSM_USERNAME'], CONFIG.username) || '').trim(),
    password: String(pick(['CFSM_PASS', 'CFSM_PASSWORD'], CONFIG.password) || ''),
    servers: splitList(pick(['SERVERS'], CONFIG.servers)),
    showHidden: toBool(pick(['SHOW_HIDDEN'], CONFIG.showHidden)),
    title: String(pick(['TITLE'], CONFIG.title) || 'CF Monitor'),
    refreshMinutes: clampNum(pick(['REFRESH_MINUTES'], CONFIG.refreshMinutes), 5, 720, 15),
    expireWarnDays: clampNum(pick(['EXPIRE_WARN_DAYS'], CONFIG.expireWarnDays), 0, 365, 14),
    maxRows: Math.round(clampNum(pick(['MAX_ROWS'], CONFIG.maxRows), 1, 6, 4)),
  };
}

function normalizeBase(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  s = s.replace(/[?#].*$/, '');
  s = s.replace(/\/(admin|api)(\/.*)?$/i, '');
  return s.replace(/\/+$/, '');
}

function splitList(v) {
  return String(v || '').split(/[,，\n|]/).map(function (x) { return x.trim(); }).filter(Boolean);
}

function toBool(v) {
  return v === true || /^(1|true|yes|on)$/i.test(String(v || '').trim());
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// ───────────────────────────── 网络 ─────────────────────────────

function WidgetError(kind, title, hint) {
  this.kind = kind;
  this.title = title;
  this.hint = hint || '';
  this.message = title;
}

function toWidgetError(e, cfg) {
  if (e instanceof WidgetError) return e;
  const msg = String((e && e.message) || e || '未知错误').slice(0, 80);
  const hint = cfg.policy
    ? '检查策略「' + cfg.policy + '」是否可用。' + msg
    : '国内直连 *.workers.dev 不通：绑自定义域名，或在 POLICY 填代理策略。' + msg;
  return new WidgetError('network', '连不上面板', hint);
}

function reqOptions(cfg, extra) {
  const o = { timeout: REQUEST_TIMEOUT_MS };
  Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
  if (cfg.policy) o.policy = cfg.policy;
  return o;
}

async function loadServers(ctx, cfg) {
  const hasCreds = !!(cfg.username && cfg.password);
  let token = cfg.token || storedToken(ctx, cfg);
  if (!token && hasCreds && cfg.showHidden) token = await login(ctx, cfg);

  let res = await getServers(ctx, cfg, token);
  if (res.status === 401) {
    clearStoredToken(ctx);
    if (!hasCreds) {
      throw new WidgetError('auth', token ? '登录令牌已失效' : '站点是私有的，需要登录',
        '填 CFSM_TOKEN，或填 CFSM_USER + CFSM_PASS 让脚本自动登录');
    }
    token = await login(ctx, cfg);
    res = await getServers(ctx, cfg, token);
    if (res.status === 401) throw new WidgetError('auth', '登录后仍被拒绝', '检查后台账号密码');
  }
  return parseServers(res);
}

async function getServers(ctx, cfg, token) {
  const headers = { Accept: 'application/json', 'User-Agent': UA };
  if (token) headers.Authorization = 'Bearer ' + token;
  const resp = await ctx.http.get(cfg.base + '/api/servers', reqOptions(cfg, { headers: headers }));
  return { status: resp.status, text: await resp.text() };
}

function parseServers(res) {
  if (res.status === 403) {
    throw new WidgetError('blocked', '请求被拦截 (403)',
      '后台关掉全局 Turnstile，或在 Cloudflare WAF 里放行 /api/servers');
  }
  if (res.status >= 400) throw new WidgetError('http', 'HTTP ' + res.status, briefError(res.text));
  let data;
  try {
    data = JSON.parse(res.text);
  } catch (e) {
    throw new WidgetError('format', '返回的不是 JSON', '地址可能填错，或请求被 Cloudflare 质询页拦截');
  }
  if (!data || !Array.isArray(data.servers)) {
    throw new WidgetError('format', '接口格式不对', '确认填的是 CF-Server-Monitor 的地址');
  }
  return data;
}

async function login(ctx, cfg) {
  const resp = await ctx.http.post(cfg.base + '/admin/api', reqOptions(cfg, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
    body: { action: 'login', username: cfg.username, password: cfg.password },
  }));
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  if (resp.status === 403) {
    throw new WidgetError('auth', '自动登录被拦截', '后台开了登录 Turnstile，脚本过不了人机验证，改填 CFSM_TOKEN');
  }
  if (resp.status === 401) throw new WidgetError('auth', '账号或密码错误', '检查 CFSM_USER / CFSM_PASS');
  if (!data || !data.token) {
    throw new WidgetError('auth', '登录失败 (HTTP ' + resp.status + ')', briefError(text));
  }
  storeToken(ctx, cfg, data.token);
  return data.token;
}

function briefError(text) {
  try {
    const d = JSON.parse(text);
    if (d && (d.error || d.message)) return String(d.error || d.message).slice(0, 80);
  } catch (e) { /* 不是 JSON */ }
  return String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// ───────────────────────────── 存储 ─────────────────────────────

function storedToken(ctx, cfg) {
  try {
    const t = ctx.storage.getJSON(TOKEN_KEY);
    if (t && t.token && t.base === cfg.base && Date.now() - t.at < TOKEN_MAX_AGE_MS) return t.token;
  } catch (e) { /* 忽略 */ }
  return '';
}

function storeToken(ctx, cfg, token) {
  try { ctx.storage.setJSON(TOKEN_KEY, { token: token, base: cfg.base, at: Date.now() }); } catch (e) { /* 忽略 */ }
}

function clearStoredToken(ctx) {
  try { ctx.storage.delete(TOKEN_KEY); } catch (e) { /* 忽略 */ }
}

const SLIM_FIELDS = ['id', 'name', 'region', 'is_hidden', 'cpu', 'ram_used', 'ram_total', 'disk_used', 'disk_total',
  'net_in_speed', 'net_out_speed', 'net_rx_monthly', 'net_tx_monthly', 'traffic_limit', 'traffic_calc_type',
  'reset_day', 'expire_date', 'billing_cycle', 'auto_renewal', 'price', 'currency', 'boot_time', 'last_updated',
  'ping_ct', 'ping_cu', 'ping_cm', 'ping_bd', 'loss_ct', 'loss_cu', 'loss_cm', 'loss_bd', 'ping'];

function saveCache(ctx, cfg, data, at) {
  try {
    const servers = data.servers.map(function (s) {
      const o = {};
      SLIM_FIELDS.forEach(function (k) { if (s[k] !== undefined) o[k] = s[k]; });
      return o;
    });
    const sys = data.sysConfig || {};
    ctx.storage.setJSON(CACHE_KEY, {
      at: at,
      base: cfg.base,
      data: {
        servers: servers,
        sysConfig: {
          custom_ct_name: sys.custom_ct_name, custom_cu_name: sys.custom_cu_name,
          custom_cm_name: sys.custom_cm_name, custom_bd_name: sys.custom_bd_name,
        },
      },
    });
  } catch (e) { /* 忽略 */ }
}

function readCache(ctx, cfg) {
  try {
    const c = ctx.storage.getJSON(CACHE_KEY);
    if (c && c.base === cfg.base && c.data && Array.isArray(c.data.servers)) return c;
  } catch (e) { /* 忽略 */ }
  return null;
}

// ───────────────────────────── 数据整理 ─────────────────────────────

function buildModel(data, cfg, fetchedAt, now, stale) {
  const sys = data.sysConfig || {};
  const names = {
    ct: sys.custom_ct_name || '电信', cu: sys.custom_cu_name || '联通',
    cm: sys.custom_cm_name || '移动', bd: sys.custom_bd_name || 'BGP',
  };
  let list = data.servers.filter(function (s) { return s && (cfg.showHidden || !isFlag(s.is_hidden)); });
  if (cfg.servers.length) {
    const want = cfg.servers.map(function (x) { return x.toLowerCase(); });
    list = list.filter(function (s) {
      return want.indexOf(String(s.id || '').toLowerCase()) >= 0 || want.indexOf(String(s.name || '').toLowerCase()) >= 0;
    });
  }
  const servers = list.map(function (s) { return normalizeServer(s, cfg, fetchedAt, now); });
  const online = servers.filter(function (s) { return s.online; });
  const limited = servers.filter(function (s) { return s.limitBytes > 0; });
  const stats = {
    total: servers.length,
    online: online.length,
    offline: servers.length - online.length,
    speedIn: sum(online, 'speedIn'),
    speedOut: sum(online, 'speedOut'),
    used: sum(servers, 'usedBytes'),
    maxTrafficPct: limited.length ? Math.max.apply(null, limited.map(function (s) { return s.trafficPct; })) : null,
  };
  const expiring = servers
    .filter(function (s) { return s.expiry && s.expiry.days <= cfg.expireWarnDays; })
    .sort(function (a, b) { return a.expiry.days - b.expiry.days; });
  return {
    servers: servers,
    stats: stats,
    names: names,
    expiring: expiring,
    offlineList: servers.filter(function (s) { return !s.online; }),
    fetchedAt: fetchedAt,
    stale: stale,
  };
}

function normalizeServer(s, cfg, fetchedAt, now) {
  const last = toMs(s.last_updated);
  const online = last > 0 && fetchedAt - last < ONLINE_MS;
  const usedBytes = trafficUsed(s);
  const limitBytes = parseLimit(s.traffic_limit);
  const pings = pingMap(s);
  const keys = Object.keys(pings);
  const ms = keys.map(function (k) { return pings[k].ms; }).filter(function (v) { return v !== null; });
  const losses = keys.map(function (k) { return pings[k].loss; }).filter(function (v) { return v !== null; });
  return {
    id: String(s.id || ''),
    name: String(s.name || s.id || '未命名'),
    region: regionCode(s.region),
    online: online,
    offlineFor: last > 0 ? Math.max(0, fetchedAt - last) : null,
    cpu: pctValue(s.cpu),
    mem: ratioPct(s.ram_used, s.ram_total),
    usedBytes: usedBytes,
    rx: num(s.net_rx_monthly),
    tx: num(s.net_tx_monthly),
    limitBytes: limitBytes,
    limitText: limitLabel(s.traffic_limit),
    trafficPct: limitBytes > 0 ? (usedBytes / limitBytes) * 100 : null,
    forecast: trafficForecast(usedBytes, limitBytes, s.reset_day, now),
    speedIn: num(s.net_in_speed),
    speedOut: num(s.net_out_speed),
    pings: pings,
    pingKeys: PING_KEYS.map(function (p) { return p[0]; }).filter(function (k) { return pings[k]; }),
    avgPing: ms.length ? ms.reduce(function (a, b) { return a + b; }, 0) / ms.length : null,
    maxLoss: losses.length ? Math.max.apply(null, losses) : null,
    history: Array.isArray(s.ping) ? s.ping.slice(-40) : [],
    expiry: expiryInfo(s, now),
    url: cfg.base + '/#/server/' + encodeURIComponent(String(s.id || '')),
  };
}

// ping_*：数字=延迟 ms，null=本轮超时，false/缺失=没配这条线路
function pingMap(s) {
  const out = {};
  PING_KEYS.forEach(function (pair) {
    const k = pair[0];
    const v = s['ping_' + k];
    if (v === undefined || v === false || v === 'false' || v === '') return;
    const lr = s['loss_' + k];
    const ln = lr === null || lr === undefined || lr === false || lr === '' ? NaN : Number(lr);
    const loss = isFinite(ln) ? Math.max(0, ln) : null;
    if (v === null) { out[k] = { ms: null, loss: loss }; return; }
    const n = Number(v);
    if (isFinite(n) && n > 0) out[k] = { ms: n, loss: loss };
  });
  return out;
}

function sum(list, key) {
  return list.reduce(function (a, s) { return a + (Number(s[key]) || 0); }, 0);
}

function num(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : 0;
}

function isFlag(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function toMs(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 0;
  return n < 10000000000 ? n * 1000 : n;
}

function pctValue(v) {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && isFinite(n) ? Math.max(0, n) : null;
}

function ratioPct(used, total) {
  const u = Number(used), t = Number(total);
  return isFinite(u) && isFinite(t) && t > 0 ? Math.max(0, (u / t) * 100) : null;
}

function regionCode(v) {
  const s = String(v || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) && s !== 'XX' ? s : '';
}

function trafficUsed(s) {
  const rx = Number(s.net_rx_monthly) || 0;
  const tx = Number(s.net_tx_monthly) || 0;
  switch (s.traffic_calc_type) {
    case 'dl': return rx;
    case 'ul': return tx;
    case 'max': return Math.max(rx, tx);
    default: return rx + tx;
  }
}

// 后台按 GB 填数字；兼容旧数据里的 "1TB" / "500GB" 写法
function parseLimit(v) {
  const raw = String(v === undefined || v === null ? '' : v).trim().toUpperCase();
  const n = parseFloat(raw);
  if (!isFinite(n) || n <= 0) return 0;
  if (/T/.test(raw)) return n * 1024 * GB;
  if (/M/.test(raw)) return (n * GB) / 1024;
  return n * GB;
}

// 限额按后台填的数字显示：1000 → 1T，1500 → 1.5T，500 → 500G
function limitLabel(v) {
  const raw = String(v === undefined || v === null ? '' : v).trim().toUpperCase();
  const n = parseFloat(raw);
  if (!isFinite(n) || n <= 0) return '';
  if (/T/.test(raw)) return trim1(n) + 'T';
  const gb = /M/.test(raw) ? n / 1024 : n;
  return gb >= 1000 ? trim1(gb / 1000) + 'T' : trim1(gb) + 'G';
}

function trim1(x) { return String(Math.round(x * 10) / 10); }

// 按本周期日均用量估算：在下次重置前用完才返回提醒
function trafficForecast(used, limit, resetDay, now) {
  if (!(limit > 0) || !(used > 0)) return null;
  if (used >= limit) return { exhausted: true };
  const rd = Math.round(Number(resetDay) || 0);
  if (rd <= 0) return null;
  const d = new Date(now);
  const dayIn = function (y, m) { return Math.min(rd, new Date(y, m + 1, 0).getDate()); };
  let start = new Date(d.getFullYear(), d.getMonth(), dayIn(d.getFullYear(), d.getMonth()));
  if (start.getTime() > now) start = new Date(d.getFullYear(), d.getMonth() - 1, dayIn(d.getFullYear(), d.getMonth() - 1));
  const next = new Date(start.getFullYear(), start.getMonth() + 1, dayIn(start.getFullYear(), start.getMonth() + 1));
  const elapsedDays = (now - start.getTime()) / 86400000;
  if (elapsedDays < 2) return null; // 周期刚开始，样本太少不预测
  const daysLeft = (limit - used) / (used / elapsedDays);
  const daysToReset = (next.getTime() - now) / 86400000;
  return daysLeft < daysToReset ? { days: Math.max(0, Math.floor(daysLeft)) } : null;
}

function normalizeCycle(v) {
  const raw = String(v || '').trim();
  if (CYCLES[raw]) return raw;
  return CYCLE_ALIASES[raw.toLowerCase()] || 'month';
}

function expiryInfo(s, now) {
  let d = String(s.expire_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (isFlag(s.auto_renewal)) {
    const months = CYCLES[normalizeCycle(s.billing_cycle)].months;
    const t = new Date(now);
    const today = isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    let guard = 0;
    while (d <= today && guard < 1200) { d = addMonths(d, months); guard++; }
  }
  const p = d.split('-').map(Number);
  const ts = Date.UTC(p[0], p[1] - 1, p[2]);
  if (!isFinite(ts)) return null;
  return { date: d, days: Math.ceil((ts - now) / 86400000) };
}

function addMonths(dateStr, months) {
  const p = dateStr.split('-').map(Number);
  const zm = p[1] - 1 + months;
  const y = p[0] + Math.floor(zm / 12);
  const m = ((zm % 12) + 12) % 12 + 1;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return isoDate(y, m, Math.min(p[2], dim));
}

function isoDate(y, m, d) {
  return String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// ───────────────────────────── 文本格式 ─────────────────────────────

function fmtBytes(n) {
  let v = Math.max(0, Number(n) || 0);
  const units = ['B', 'K', 'M', 'G', 'T', 'P'];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const s = v >= 100 || i === 0 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '');
  return s + units[i];
}

function fmtDuration(ms) {
  const m = Math.max(0, ms) / 60000;
  if (m >= 1440) return Math.floor(m / 1440) + '天';
  if (m >= 60) return Math.floor(m / 60) + '小时';
  return Math.max(1, Math.floor(m)) + '分钟';
}

function fmtPct(p) { return Math.round(p) + '%'; }

function fmtLoss(l) { return (l < 10 ? String(Math.round(l * 10) / 10) : String(Math.round(l))) + '%'; }

function hhmm(ts) {
  const d = new Date(ts);
  const p2 = function (n) { return String(n).padStart(2, '0'); };
  const t = p2(d.getHours()) + ':' + p2(d.getMinutes());
  return Date.now() - ts > 20 * 3600000 ? p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + t : t;
}

function timeLabel(m) { return (m.stale ? '缓存 ' : '') + hhmm(m.fetchedAt); }

function offlineText(s) { return s.offlineFor === null ? '未上报' : '离线 ' + fmtDuration(s.offlineFor); }

function expiryText(days) {
  if (days < 0) return '已过期';
  if (days === 0) return '今天到期';
  return days + '天后到期';
}

function expiryColor(days, cfg) {
  if (days <= 3) return C.red;
  if (days <= cfg.expireWarnDays) return C.amber;
  return C.dim;
}

function usageColor(p) {
  if (p === null || p === undefined) return C.faint;
  return p < 60 ? C.green : p < 85 ? C.amber : C.red;
}

// 延迟颜色：<100ms 绿，<200ms 黄，其余红；有丢包至少标黄，丢包 ≥5% 标红
function latColor(ms, loss) {
  if (ms === null) return C.red;
  let c = ms < 100 ? C.green : ms < 200 ? C.amber : C.red;
  if (loss !== null && loss >= 5) c = C.red;
  else if (loss !== null && loss > 0 && c === C.green) c = C.amber;
  return c;
}

function msText(ms) { return ms === null ? '超时' : String(Math.round(ms)); }

function avgText(s) {
  if (!s.pingKeys.length) return '—';
  return s.avgPing === null ? '超时' : Math.round(s.avgPing) + 'ms';
}

function avgColor(s) {
  if (!s.pingKeys.length) return C.faint;
  return latColor(s.avgPing, s.maxLoss);
}

function statusKey(st) {
  if (!st.total) return 'dim';
  if (!st.offline) return 'green';
  return st.online ? 'amber' : 'red';
}

function trafficSummary(st) {
  let t = '本月 ' + fmtBytes(st.used);
  if (st.maxTrafficPct !== null) t += ' · 最高 ' + fmtPct(st.maxTrafficPct);
  return t;
}

function trafficShort(s) {
  if (s.limitBytes > 0) return fmtBytes(s.usedBytes) + '/' + s.limitText + ' ' + fmtPct(s.trafficPct);
  return '本月 ' + fmtBytes(s.usedBytes);
}

function shortIsp(m, k) {
  const name = m.names[k];
  const def = PING_KEYS.filter(function (p) { return p[0] === k; })[0][1];
  return name === def ? ISP[k].short : String(name).slice(0, 1);
}

// 某几台服务器里实际上报过的线路（按 电信/联通/移动/BGP 顺序）
function pickKeys(list, max) {
  return PING_KEYS.map(function (p) { return p[0]; })
    .filter(function (k) { return list.some(function (s) { return s.pings[k]; }); })
    .slice(0, max);
}

// ───────────────────────────── DSL 小工具 ─────────────────────────────

function F(size, weight) { return weight ? { size: size, weight: weight } : { size: size }; }

function T(str, font, color, extra) {
  const el = { type: 'text', text: String(str), font: font, maxLines: 1 };
  if (color) el.textColor = color;
  return Object.assign(el, extra || {});
}

function row(children, extra) {
  return Object.assign({ type: 'stack', direction: 'row', alignItems: 'center', children: children }, extra || {});
}

function col(children, extra) {
  return Object.assign({ type: 'stack', direction: 'column', alignItems: 'start', children: children }, extra || {});
}

function spacer(length) { return length === undefined ? { type: 'spacer' } : { type: 'spacer', length: length }; }

function icon(name, size, color) {
  const el = { type: 'image', src: 'sf-symbol:' + name, width: size, height: size };
  if (color) el.color = color;
  return el;
}

function dot(color, size) { return icon('circle.fill', size || 7, color); }

// 固定宽度的单元格，文字靠右
function cell(el, width) {
  return { type: 'stack', direction: 'row', width: width, children: [spacer(), el] };
}

// 进度条：外层是轨道，里面两段按 flex 比例分（不依赖屏幕宽度）
function bar(pct, color, opts) {
  const h = (opts && opts.height) || 4;
  const p = Math.min(1, Math.max(0, (Number(pct) || 0) / 100));
  const fill = Math.round(p * 1000);
  const children = [];
  if (fill > 0) children.push({ type: 'stack', flex: fill >= 1000 ? 1 : fill, height: h, backgroundColor: color, borderRadius: h / 2, children: [] });
  if (fill < 1000) children.push({ type: 'stack', flex: fill <= 0 ? 1 : 1000 - fill, height: h, children: [] });
  const el = { type: 'stack', direction: 'row', height: h, backgroundColor: C.track, borderRadius: h / 2, children: children };
  if (opts && opts.width) el.width = opts.width; else el.flex = 1;
  return el;
}

// 圆环（SVG），起点在 12 点方向
function ringSvg(ratio, color, track, stroke) {
  const r = 40;
  const p = Math.min(1, Math.max(0, ratio));
  let arc = '';
  if (p >= 0.999) {
    arc = "<circle cx='50' cy='50' r='40' fill='none' stroke='" + color + "' stroke-width='" + stroke + "'/>";
  } else if (p > 0.001) {
    const a = 2 * Math.PI * p;
    const x = (50 + r * Math.sin(a)).toFixed(2);
    const y = (50 - r * Math.cos(a)).toFixed(2);
    arc = "<path d='M 50 10 A 40 40 0 " + (p > 0.5 ? 1 : 0) + " 1 " + x + ' ' + y + "' fill='none' stroke='" + color +
      "' stroke-width='" + stroke + "' stroke-linecap='round'/>";
  }
  return "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
    "<circle cx='50' cy='50' r='40' fill='none' stroke='" + track + "' stroke-width='" + stroke + "'/>" + arc + '</svg>';
}

// 近 2 小时延迟曲线（面板开了「三网详情」才有数据）；每条线路一种颜色，断点处断开
function latencyChartSvg(points, keys, w, h) {
  if (!points || points.length < 2 || !keys.length) return null;
  const series = keys.map(function (k) {
    return points.map(function (p) { return p && typeof p[k] === 'number' && p[k] > 0 ? p[k] : null; });
  });
  const all = [];
  series.forEach(function (vals) { vals.forEach(function (v) { if (v !== null) all.push(v); }); });
  if (all.length < 2) return null;
  let lo = Math.min.apply(null, all);
  let hi = Math.max.apply(null, all);
  if (hi - lo < 10) { const mid = (hi + lo) / 2; lo = mid - 5; hi = mid + 5; }
  const pad = 3;
  const n = points.length;
  const x = function (i) { return (1 + (i / (n - 1)) * (w - 2)).toFixed(1); };
  const y = function (v) { return (pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad)).toFixed(1); };
  let body = "<line x1='0' y1='" + (h - 0.5) + "' x2='" + w + "' y2='" + (h - 0.5) + "' stroke='rgba(139,148,158,0.35)' stroke-width='1'/>";
  series.forEach(function (vals, si) {
    const color = ISP[keys[si]].svg;
    let seg = [];
    const flush = function () {
      if (seg.length >= 2) {
        body += "<polyline points='" + seg.join(' ') + "' fill='none' stroke='" + color +
          "' stroke-width='1.6' stroke-linejoin='round' stroke-linecap='round'/>";
      } else if (seg.length === 1) {
        const xy = seg[0].split(',');
        body += "<circle cx='" + xy[0] + "' cy='" + xy[1] + "' r='1.5' fill='" + color + "'/>";
      }
      seg = [];
    };
    vals.forEach(function (v, i) { if (v === null) flush(); else seg.push(x(i) + ',' + y(v)); });
    flush();
  });
  return "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + w + ' ' + h + "'>" + body + '</svg>';
}

function refreshAt(minutes) { return new Date(Date.now() + minutes * 60000).toISOString(); }

function systemRoot(children, cfg, layout, refreshIso) {
  const w = {
    type: 'widget',
    backgroundGradient: { type: 'linear', colors: [C.bgTop, C.bgBottom], startPoint: { x: 0, y: 0 }, endPoint: { x: 0, y: 1 } },
    padding: layout.padding,
    gap: layout.gap,
    refreshAfter: refreshIso || refreshAt(cfg.refreshMinutes),
    children: children,
  };
  if (cfg.base) w.url = cfg.base;
  return w;
}

function accessoryRoot(children, cfg, extra, refreshIso) {
  const w = Object.assign({ type: 'widget', refreshAfter: refreshIso || refreshAt(cfg.refreshMinutes), children: children }, extra || {});
  if (cfg.base) w.url = cfg.base;
  return w;
}

// ───────────────────────────── 渲染 ─────────────────────────────

function render(family, m, cfg) {
  switch (family) {
    case 'accessoryInline': return inlineWidget(m, cfg);
    case 'accessoryCircular': return circularWidget(m, cfg);
    case 'accessoryRectangular': return rectangularWidget(m, cfg);
    case 'systemSmall': return smallWidget(m, cfg);
    case 'systemLarge':
    case 'systemExtraLarge': return largeWidget(m, cfg);
    default: return mediumWidget(m, cfg);
  }
}

function headerRow(m, cfg, big) {
  const st = m.stats;
  return row([
    icon('server.rack', big ? 13 : 11, C.blue),
    T(cfg.title, F(big ? 15 : 13, 'bold'), C.fg, { minScale: 0.7 }),
    T(st.online + '/' + st.total, F(big ? 13 : 12, 'bold'), C[statusKey(st)]),
    T('在线', F(big ? 11 : 10, 'medium'), C.dim),
    spacer(),
    T(timeLabel(m), F(big ? 10 : 9, 'medium'), m.stale ? C.amber : C.faint),
  ], { gap: 4 });
}

function smallHeader(m, cfg, extra) {
  const items = [
    icon('server.rack', 11, C.blue),
    T(cfg.title, F(12, 'bold'), C.fg, { minScale: 0.6 }),
    spacer(),
  ];
  if (extra) items.push(T(extra, F(9, 'semibold'), C.dim));
  items.push(T(timeLabel(m), F(9, 'medium'), m.stale ? C.amber : C.faint));
  return row(items, { gap: 4 });
}

function alertText(m, cfg) {
  if (!m.stats.total) return { text: '没有匹配的服务器', color: C.dim };
  if (m.offlineList.length) {
    const n = m.offlineList.length;
    return { text: '✕ ' + (n === 1 ? m.offlineList[0].name + ' 离线' : n + ' 台离线'), color: C.red };
  }
  if (m.expiring.length) {
    const e = m.expiring[0];
    const text = m.expiring.length === 1 ? e.name + ' ' + expiryText(e.expiry.days) : m.expiring.length + ' 台 ' + cfg.expireWarnDays + ' 天内到期';
    return { text: '⚠ ' + text, color: e.expiry.days <= 3 ? C.red : C.amber };
  }
  return { text: '✓ 全部在线', color: C.green };
}

function footerText(m, cfg, shown, includeExpiry) {
  const parts = [];
  if (includeExpiry && m.expiring.length) {
    parts.push('⚠ ' + m.expiring.slice(0, 2).map(function (s) { return s.name + ' ' + expiryText(s.expiry.days); }).join('，'));
  }
  if (m.servers.length > shown) parts.push('另有 ' + (m.servers.length - shown) + ' 台');
  if (!parts.length) return null;
  const color = includeExpiry && m.expiring.length ? (m.expiring[0].expiry.days <= 3 ? C.red : C.amber) : C.faint;
  return T(parts.join(' · '), F(9, 'medium'), color, { minScale: 0.7 });
}

// ── 表格行（中号、服务器多时的大号）：名称 | 各线路延迟 | 本月流量 ──
const W_LAT = 26, W_TRF = 84;

function tableLabels(m, keys) {
  const items = [spacer()];
  if (keys.length) {
    keys.forEach(function (k) { items.push(cell(T(m.names[k], F(9, 'medium'), C.faint, { minScale: 0.6 }), W_LAT)); });
  } else {
    items.push(cell(T('延迟', F(9, 'medium'), C.faint), W_LAT));
  }
  items.push(cell(T('本月流量', F(9, 'medium'), C.faint), W_TRF));
  return row(items, { gap: 5 });
}

function latCell(s, k) {
  const p = s.pings[k];
  if (!s.online || !p) return cell(T('—', F(10), C.faint), W_LAT);
  return cell(T(msText(p.ms), F(11, 'semibold'), latColor(p.ms, p.loss), { minScale: 0.7 }), W_LAT);
}

function trafficCell(s) {
  if (s.limitBytes > 0) {
    const p = s.trafficPct;
    return row([
      bar(p, usageColor(p), { width: 20, height: 4 }),
      spacer(),
      T(fmtBytes(s.usedBytes) + '/' + s.limitText, F(10, 'medium'), C.fg, { minScale: 0.7 }),
    ], { width: W_TRF, gap: 4 });
  }
  return cell(T(fmtBytes(s.usedBytes), F(10, 'medium'), C.dim), W_TRF);
}

function tableRow(s, keys) {
  const items = [
    dot(s.online ? C.green : C.red, 6),
    T(s.name, F(12, 'semibold'), s.online ? C.fg : C.dim, { minScale: 0.7 }),
    spacer(),
  ];
  if (keys.length) keys.forEach(function (k) { items.push(latCell(s, k)); });
  else items.push(cell(T('—', F(10), C.faint), W_LAT));
  items.push(trafficCell(s));
  return row(items, { gap: 5, url: s.url });
}

function mediumWidget(m, cfg) {
  const children = [headerRow(m, cfg, false)];
  if (!m.servers.length) {
    children.push(T('没有匹配的服务器，检查 SERVERS 设置', F(12), C.dim, { maxLines: 2 }));
  } else {
    const shown = m.servers.slice(0, cfg.maxRows);
    const keys = pickKeys(shown, 3);
    children.push(tableLabels(m, keys));
    shown.forEach(function (s) { children.push(tableRow(s, keys)); });
    children.push(spacer());
    const f = footerText(m, cfg, shown.length, true);
    if (f) children.push(f);
  }
  return systemRoot(children, cfg, { padding: [12, 14, 12, 14], gap: 4 });
}

// ── 大号卡片：名称/负载 | 各线路延迟 + 丢包 | (延迟曲线) | 流量条 ──

function latencyChip(m, s, k) {
  const p = s.pings[k];
  const items = [dot(ISP[k].dsl, 5), T(m.names[k], F(9, 'medium'), C.dim, { minScale: 0.7 })];
  if (!s.online) {
    items.push(T('—', F(10), C.faint));
  } else {
    items.push(T(p.ms === null ? '超时' : Math.round(p.ms) + 'ms', F(10, 'semibold'), latColor(p.ms, p.loss)));
    if (p.loss !== null && p.loss > 0) items.push(T('丢' + fmtLoss(p.loss), F(9, 'semibold'), p.loss >= 5 ? C.red : C.amber));
  }
  return row(items, { gap: 3 });
}

function latencyLine(m, s) {
  if (!s.pingKeys.length) return row([T('没有三网延迟数据', F(10), C.faint), spacer()]);
  const items = s.pingKeys.map(function (k) { return latencyChip(m, s, k); });
  items.push(spacer());
  return row(items, { gap: 10 });
}

function trafficLine(s) {
  if (s.limitBytes > 0) {
    const p = s.trafficPct;
    const items = [
      T('流量', F(9, 'medium'), C.dim),
      bar(p, usageColor(p), { height: 5 }),
      T(fmtBytes(s.usedBytes) + ' / ' + s.limitText, F(10, 'medium'), C.fg),
      T(fmtPct(p), F(10, 'semibold'), usageColor(p)),
    ];
    if (s.forecast) {
      items.push(T(s.forecast.exhausted ? '已超额' : '约' + s.forecast.days + '天用完', F(9, 'semibold'), s.forecast.exhausted ? C.red : C.amber));
    }
    return row(items, { gap: 6 });
  }
  return row([
    T('流量', F(9, 'medium'), C.dim),
    T('本月 ' + fmtBytes(s.usedBytes) + '  ↓' + fmtBytes(s.rx) + ' ↑' + fmtBytes(s.tx), F(10, 'medium'), C.fg, { minScale: 0.7 }),
    spacer(),
  ], { gap: 6 });
}

function loadText(s) {
  const p = function (v) { return v === null ? '—' : fmtPct(v); };
  return 'CPU ' + p(s.cpu) + ' · 内存 ' + p(s.mem);
}

function netCard(m, s, cfg, withChart) {
  const head = [dot(s.online ? C.green : C.red, 7), T(s.name, F(13, 'semibold'), s.online ? C.fg : C.dim, { minScale: 0.7 })];
  if (s.region) head.push(T(s.region, F(9, 'semibold'), C.faint));
  head.push(spacer());
  if (s.expiry && s.expiry.days <= cfg.expireWarnDays) {
    head.push(T(expiryText(s.expiry.days), F(9, 'semibold'), expiryColor(s.expiry.days, cfg)));
  }
  head.push(s.online ? T(loadText(s), F(9, 'medium'), C.dim, { minScale: 0.7 }) : T(offlineText(s), F(10, 'semibold'), C.red));

  const lines = [row(head, { gap: 5 }), latencyLine(m, s)];
  if (withChart && s.online) {
    const svg = latencyChartSvg(s.history, s.pingKeys, CHART_W, CHART_H);
    if (svg) lines.push({ type: 'image', src: svg, width: CHART_W, height: CHART_H });
  }
  lines.push(trafficLine(s));
  return col(lines, { gap: 4, padding: [5, 10, 5, 10], backgroundColor: C.card, borderRadius: 12, url: s.url });
}

function largeWidget(m, cfg) {
  const n = m.servers.length;
  const a = alertText(m, cfg);
  const children = [
    headerRow(m, cfg, true),
    row([
      T(trafficSummary(m.stats), F(11, 'medium'), C.dim, { minScale: 0.7 }),
      spacer(),
      T(a.text, F(10, 'semibold'), a.color, { minScale: 0.7 }),
    ], { gap: 6 }),
  ];
  let shown = n;
  if (!n) {
    children.push(T('没有匹配的服务器，检查 SERVERS 设置', F(12), C.dim, { maxLines: 2 }));
  } else if (n <= 2) {
    m.servers.forEach(function (s) { children.push(netCard(m, s, cfg, true)); });
  } else if (n <= 4) {
    m.servers.forEach(function (s) { children.push(netCard(m, s, cfg, false)); });
  } else {
    shown = Math.min(n, 11);
    const list = m.servers.slice(0, shown);
    const keys = pickKeys(list, 4);
    children.push(tableLabels(m, keys));
    list.forEach(function (s) { children.push(tableRow(s, keys)); });
  }
  children.push(spacer());
  const f = footerText(m, cfg, shown, n > 4);
  if (f) children.push(f);
  return systemRoot(children, cfg, { padding: 14, gap: 5 });
}

// ── 小号：一台时显示各线路延迟 + 流量条；多台时每台一个迷你块 ──

function miniBlock(s) {
  const top = row([
    dot(s.online ? C.green : C.red, 6),
    T(s.name, F(11, 'semibold'), s.online ? C.fg : C.dim, { minScale: 0.6 }),
    spacer(),
    s.online ? T(avgText(s), F(11, 'semibold'), avgColor(s)) : T('离线', F(10, 'semibold'), C.red),
  ], { gap: 4 });
  let bottom;
  if (s.limitBytes > 0) {
    const p = s.trafficPct;
    bottom = row([bar(p, usageColor(p), { height: 4 }), T(fmtPct(p), F(9, 'semibold'), usageColor(p))], { gap: 4 });
  } else {
    bottom = row([T('本月 ' + fmtBytes(s.usedBytes), F(9, 'medium'), C.dim), spacer()]);
  }
  return col([top, bottom], { gap: 3, url: s.url });
}

function smallSingle(m, s, cfg) {
  const children = [
    smallHeader(m, cfg, ''),
    row([dot(s.online ? C.green : C.red, 7), T(s.name, F(13, 'bold'), s.online ? C.fg : C.dim, { minScale: 0.6 })], { gap: 5 }),
  ];
  const keys = s.pingKeys.slice(0, 3);
  if (!keys.length) children.push(T('没有三网延迟数据', F(10), C.faint));
  keys.forEach(function (k) {
    const p = s.pings[k];
    children.push(row([
      dot(ISP[k].dsl, 5),
      T(m.names[k], F(10, 'medium'), C.dim, { minScale: 0.7 }),
      spacer(),
      s.online ? T(p.ms === null ? '超时' : Math.round(p.ms) + 'ms', F(12, 'semibold'), latColor(p.ms, p.loss)) : T('—', F(11), C.faint),
    ], { gap: 4 }));
  });
  children.push(spacer());
  if (s.limitBytes > 0) {
    const p = s.trafficPct;
    children.push(row([
      T(fmtBytes(s.usedBytes) + ' / ' + s.limitText, F(10, 'medium'), C.fg, { minScale: 0.7 }),
      spacer(),
      T(fmtPct(p), F(10, 'semibold'), usageColor(p)),
    ]));
    children.push(row([bar(p, usageColor(p), { height: 5 })]));
  } else {
    children.push(T('本月 ' + fmtBytes(s.usedBytes), F(10, 'medium'), C.dim));
  }
  return systemRoot(children, cfg, { padding: [12, 13, 12, 13], gap: 4 });
}

function smallWidget(m, cfg) {
  const n = m.servers.length;
  if (n === 1) return smallSingle(m, m.servers[0], cfg);
  const children = [smallHeader(m, cfg, n > 3 ? '+' + (n - 3) : '')];
  if (!n) {
    children.push(T('没有匹配的服务器', F(11), C.dim, { maxLines: 2 }));
  } else {
    m.servers.slice(0, 3).forEach(function (s) { children.push(miniBlock(s)); });
  }
  children.push(spacer());
  return systemRoot(children, cfg, { padding: [12, 13, 12, 13], gap: 6 });
}

// ── 锁屏 ──

function circularWidget(m, cfg) {
  const st = m.stats;
  const limited = m.servers.filter(function (s) { return s.limitBytes > 0; });
  let ratio, big, label;
  if (limited.length) {
    // 用量最高的那台（只看一台时就是它）
    const s = limited.reduce(function (a, b) { return b.trafficPct > a.trafficPct ? b : a; });
    ratio = s.trafficPct / 100;
    big = fmtPct(s.trafficPct);
    label = '流量';
  } else {
    ratio = st.total ? st.online / st.total : 0;
    big = st.online + '/' + st.total;
    label = '在线';
  }
  return accessoryRoot([{
    type: 'stack', direction: 'column', alignItems: 'center', flex: 1,
    backgroundImage: ringSvg(ratio, 'rgb(255,255,255)', 'rgba(255,255,255,0.3)', 10),
    children: [
      spacer(),
      row([spacer(), T(big, F(big.length > 4 ? 12 : 15, 'bold'), null, { minScale: 0.6 }), spacer()]),
      row([spacer(), T(label, F(8, 'medium'), null), spacer()]),
      spacer(),
    ],
  }], cfg, { padding: 0 });
}

function rectangularWidget(m, cfg) {
  const list = m.servers;
  if (!list.length) return accessoryRoot([T(cfg.title, F(13, 'bold'), null), T('没有匹配的服务器', F(12), null)], cfg, { gap: 1 });
  if (list.length === 1) {
    const s = list[0];
    const lat = s.pingKeys.length
      ? s.pingKeys.map(function (k) { return shortIsp(m, k) + (s.online ? msText(s.pings[k].ms) : '—'); }).join(' ')
      : '没有三网延迟';
    return accessoryRoot([
      T(s.name + (s.online ? '' : ' 离线'), F(13, 'bold'), null, { minScale: 0.7 }),
      T(lat + (s.pingKeys.length ? ' ms' : ''), F(12, 'medium'), null, { minScale: 0.6 }),
      T(trafficShort(s), F(12), null, { minScale: 0.7 }),
    ], cfg, { gap: 1 });
  }
  return accessoryRoot(list.slice(0, 3).map(function (s, i) {
    return T(s.name + ' ' + (s.online ? avgText(s) : '离线') + ' · ' + trafficShort(s), F(12, i === 0 ? 'semibold' : 'regular'), null, { minScale: 0.6 });
  }), cfg, { gap: 1 });
}

function inlineWidget(m, cfg) {
  const s = m.servers[0];
  if (!s) return accessoryRoot([T('没有匹配的服务器', F(12), null)], cfg);
  let t = s.name + ' ' + (s.online ? avgText(s) : '离线') + ' · ' +
    (s.limitBytes > 0 ? '流量 ' + fmtPct(s.trafficPct) : '本月 ' + fmtBytes(s.usedBytes));
  if (m.servers.length > 1) t += ' +' + (m.servers.length - 1);
  return accessoryRoot([T(t, F(12), null)], cfg);
}

function errorWidget(family, cfg, err) {
  const retry = refreshAt(Math.min(cfg.refreshMinutes, 10));
  if (family === 'accessoryInline') return accessoryRoot([T('CFSM ' + err.title, F(12), null)], cfg, null, retry);
  if (family === 'accessoryCircular') {
    return accessoryRoot([
      spacer(),
      row([spacer(), icon('exclamationmark.triangle', 22, null), spacer()]),
      spacer(),
    ], cfg, { padding: 0 }, retry);
  }
  if (family === 'accessoryRectangular') {
    return accessoryRoot([
      T(cfg.title, F(13, 'bold'), null),
      T(err.title, F(12), null, { maxLines: 2, minScale: 0.7 }),
    ], cfg, { gap: 2 }, retry);
  }
  return systemRoot([
    row([icon('exclamationmark.triangle.fill', 13, C.amber), T(cfg.title, F(13, 'bold'), C.fg)], { gap: 5 }),
    T(err.title, F(13, 'semibold'), C.red, { maxLines: 2, minScale: 0.8 }),
    T(err.hint, F(11), C.dim, { maxLines: family === 'systemSmall' ? 5 : 4, minScale: 0.8 }),
    spacer(),
  ], cfg, { padding: 14, gap: 6 }, retry);
}

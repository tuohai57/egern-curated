// 环境变量（在小组件配置里按需填写，留空 = 默认档）：
//
//   GROUP     —— 策略组名称（留空 = DIRECT）
//   THEME     —— 浅色 = 使用浅色配色（留空 = 深色）
//   STYLE     —— 透明 = 透明背景（需配合主屏透明风格使用，且只在主屏页面生效）
//   IP        —— 隐藏 = 隐藏 IP 中段信息；测试 = IP 用 255.255.255.255 占位（看最宽地址的排版）
//   EGG       —— 开 = 彩蛋（锁屏方形档显示图标）

const __TM_URL = 'http://www.gstatic.com/generate_204';
const __TM_TIMEOUT = 3000;

const __SCORE_URL = 'https://my.ippure.com/v1/info';
const __SCORE_TIMEOUT = 6000;

const __ASN_URL = 'https://stat.ripe.net/data/as-overview/data.json?resource=AS';
const __ASN_TTL = 30 * 24 * 3600000;
const __ASN_KEY = 'ippure_asn';
const __ASN_MAX = 32;

const __D_V4 = 'https://1.1.1.1/cdn-cgi/trace';
const __D_V6 = 'https://[2606:4700:4700::1111]/cdn-cgi/trace';
const __DUAL_OK_TTL = 24 * 3600000;
const __DUAL_BAD_TTL = 20 * 60 * 1000;
const __DUAL_KEY = 'ippure_dual';
const __DUAL_MAX = 8;

const __DBG_URL = '';
const __DBG_TAG = 'linkprobe';

const __CHART_KEY = 'ippure_chart';
const __CHART_MAX = 40;
const __CHART_CAP = 400;
const __CHART_GAP_SOLID = 8;
const __CHART_MIN_H = 3;
const __CHART_R_SOLID = 3;
const __CHART_DUAL_MIN_DIFF = 20;
const __CHART_BACK_OP = 0.2;
const __CHART_BAR = {
  dark: { bottom: '#0B5F45', top: '#00F0A0' },
  light: { bottom: '#0066CC', top: '#64B5FF' }
};

const __CHART_W_SM = 134;
const __CHART_H_SM = 69.5;
const __CHART_H_SM_V6 = 67.5;
const __CHART_W_MID = 316;
const __CHART_W_LARGE = 316;
const __CHART_W_XL = 687.5;
const __CHART_H_MID = 66;
const __CHART_H_MID_V6 = 76;
const __CHART_H_LARGE = 80;
const __CHART_H_XL = 71;

const __ISP_MAX = { large: 275, rect: 150, inline: 200 };
const __RISK_CUTS = [15, 25, 40, 50, 70];
const __RISK_COLORS = {
  dark: ['#22C55E', '#84CC16', '#EAB308', '#F59E0B', '#F97316', '#DC2626'],
  light: ['#0066CC', '#1D7FD1', '#EAB308', '#F59E0B', '#F97316', '#DC2626']
};
const __RISK_KEYS = ['house', 'sparkles', 'neutral', 'thinking', 'warning', 'poop'];

const __THEME = {
  dark: { bgTop: '#0C0D0F', bgBottom: '#141619', text: '#F8FAFC', secondary: '#94A3B8', muted: '#64748B' },
  light: { bgTop: '#FFFFFE', bgBottom: '#FFFFFE', text: '#181a20', secondary: '#707a8a', muted: '#929aa5' }
};
const __SEM = {
  dark: { good: '#34D399', warn: '#FACC15' },
  light: { good: '#0071E3', warn: '#E78B09' }
};
const __MONO_TEXT = '#FFFFFF';
const __MONO = { hi: 1, mid: 0.72, weak: 0.5, faint: 0.34 };

const __WT = { light: 'light', med: 'medium', semi: 'semibold', bold: 'bold' };
const __SZ = {
  smBadge: 8,
  smDot: 2,
  dotPair: 5,
  midDot: 4,
  midBadge: 10,
  rectIp: 16,
  rectSub: 12
};

const __DASH = '--';

function __finiteScore(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function __usableMeta(body) {
  if (!body || typeof body !== 'object') return false;
  const ip = body.ip;
  return typeof ip === 'string' && /[.:]/.test(ip) && ip.trim().length >= 3;
}

function __riskTier(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  for (let i = 0; i < __RISK_CUTS.length; i++) {
    if (score <= __RISK_CUTS[i]) return i;
  }
  return __RISK_CUTS.length;
}

function __riskIcon(score) {
  const tier = __riskTier(score);
  return tier === null ? 'sf-symbol:questionmark' : __RISK_ICONS[__RISK_KEYS[tier]];
}

function __asnFromHolder(holder) {
  let t = String(holder || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const i = t.indexOf(' - ');
  if (i >= 0) return t.slice(i + 3).trim();
  const sp = t.indexOf(' ');
  if (sp > 0) {
    const head = t.slice(0, sp).replace(/-[A-Z0-9]+$/, '');
    const rest = t.slice(sp + 1);
    const norm = (v) => String(v || '').toLowerCase().replace(/[^0-9a-z]+/g, '');
    const nh = norm(head);
    if (nh && norm(rest).indexOf(nh) >= 0) return rest;
  }
  return t;
}

async function __fetchAsnName(ctx, asn, policy) {
  const num = String(asn === undefined || asn === null ? '' : asn).trim().replace(/^as\s*/i, '');
  if (!/^\d+$/.test(num)) return undefined;
  try {
    const r = await ctx.http.get(__ASN_URL + num, { policy: policy, timeout: 4000 });
    if (!r || r.status !== 200) return undefined;
    const j = await r.json();
    const holder = j && j.data && j.data.holder ? String(j.data.holder) : '';
    return { name: holder ? __asnFromHolder(holder) : '', raw: holder };
  } catch (_) {
    return undefined;
  }
}

function __txtW(s, size) {
  let w = 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const c = str.charCodeAt(i);
    if (ch === ' ') w += 0.30;
    else if (c > 0x2e80) w += 1.00;
    else if (ch >= 'A' && ch <= 'Z') w += 0.72;
    else if (ch >= '0' && ch <= '9') w += 0.62;
    else if (ch >= 'a' && ch <= 'z') w += 0.55;
    else w += 0.42;
  }
  return w * size;
}

function __ispText(asn, org, slot, px) {
  const num = String(asn === undefined || asn === null ? '' : asn).trim().replace(/^as\s*/i, '');
  let name = String(org || '').replace(/\s+/g, ' ').trim();
  const bare = /^(?:as\s*)?(\d+)$/i.exec(name);
  if (bare && num && bare[1] === num) name = '';
  if (slot === 'mid' || slot === 'net') return (num ? 'AS' + num : name) || null;
  const text = name || (num ? 'AS' + num : '');
  if (!text) return null;
  const size = px || (slot === 'inline' ? 17 : 12);
  const max = __ISP_MAX[slot] || __ISP_MAX.large;
  if (__txtW(text, size) <= max) return text;
  let cut = text;
  while (cut.length > 1) {
    cut = cut.slice(0, -1);
    if (__txtW(cut + '…', size) <= max) break;
  }
  const sp = cut.lastIndexOf(' ');
  const head = sp > cut.length * 0.85 ? cut.slice(0, sp) : cut;
  return head.replace(/[\s,.;:(\-]+$/, '') + '…';
}

function __locTail(region, city) {
  const r = String(region == null ? '' : region).trim();
  const c = String(city == null ? '' : city).trim();
  if (!r) return c;
  if (!c) return r;
  const norm = (v) => v.toLowerCase().replace(/[^0-9a-z\u4e00-\u9fa5]/g, '');
  const nr = norm(r);
  const nc = norm(c);
  if (!nr || !nc) return r + ' · ' + c;
  if (nr === nc) return r.length >= c.length ? r : c;
  if (nc.indexOf(nr) === 0 || nr.indexOf(nc) === 0) return r.length >= c.length ? r : c;
  return r + ' · ' + c;
}

function __wantHideIp(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  return /^hide$/i.test(s) || s === '隐藏' || s === '脱敏';
}

function __maskIp(ip) {
  const s = String(ip === undefined || ip === null ? '' : ip).trim();
  if (!s) return '';
  if (s.indexOf(':') >= 0) {
    const g = s.split(':');
    if (g.length < 3) return s;
    return g[0] + ':****:' + g[g.length - 1];
  }
  const p = s.split('.');
  if (p.length === 4) return p[0] + '.*.*.' + p[3];
  return s;
}

function __r2(n) {
  return String(Math.round(n * 100) / 100);
}

const __RISK_ICONS = {
  house: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0NCA0NCI+CiAgPHBhdGggZD0iTTEuNzksMjIuNjlBMi42NSwyLjY1LDAsMCwxLC41NCwyMi40YTEsMSwwLDAsMS0uNTQtMSwxLjgsMS44LDAsMCwxLC42NS0xLjMyTDE4Ljk0LDJBNy43NCw3Ljc0LDAsMCwxLDIwLjUxLjcyYTMsMywwLDAsMSwzLDBBNy43NCw3Ljc0LDAsMCwxLDI1LjA2LDJMNDMuMzUsMjAuMDhBMS44LDEuOCwwLDAsMSw0NCwyMS40YTEuMDYsMS4wNiwwLDAsMS0uNTMsMSwyLjY2LDIuNjYsMCwwLDEtMS4yNi4yOUgzOC4wNkwyMiw2Ljg1LDUuOTQsMjIuNjlabS43My0xLjYzSDUuMjVMMjIsNC41LDM4Ljc1LDIxLjA2aDIuNzNhLjE3LjE3LDAsMCwwLC4xOS0uMTQuMzQuMzQsMCwwLDAtLjEzLS4yOUwyMy45LDMuMTlhOCw4LDAsMCwwLTEuMTItMSwxLjM0LDEuMzQsMCwwLDAtMS41NiwwLDgsOCwwLDAsMC0xLjEyLDFMMi40NiwyMC42M2EuMzQuMzQsMCwwLDAtLjEzLjI5QS4xNy4xNywwLDAsMCwyLjUyLDIxLjA2Wk05LjgzLDQwLjQ0Yy0uNCwwLS43OSwwLTEuMTYsMGwtMS4wNywwQTguMiw4LjIsMCwwLDEsNC42OCw0MCwxLjI2LDEuMjYsMCwwLDEsNCwzOC43N2E0LjU1LDQuNTUsMCwwLDEsMS0zLjA2LDMsMywwLDAsMSwyLjQyLTEuMTUsMy4xOCwzLjE4LDAsMCwxLDEuMzIuMjRBMi43LDIuNywwLDAsMCw5LjgzLDM1LDIuNjMsMi42MywwLDAsMCwxMSwzNC44MWEzLjIxLDMuMjEsMCwwLDEsMS4zMS0uMjMsNS4xOSw1LjE5LDAsMCwxLDEuOS40LDYsNiwwLDAsMSwxLjY2LDEsMS40OCwxLjQ4LDAsMCwxLC42OSwxdjMuNDZabTUsMy4yM1Y0MC4zOGguMzJWMzguNUg0LjQ2VjIxLjc1bDEuNjYtMS4yN3YxNi40SDM3Ljg3VjIwLjQ4bDEuNjcsMS4yN1YzOC41SDI4LjgxdjEuODhoLjMydjMuMjlaTTYuODEsMTUuMjdWNi43N0g2LjE5VjIuNjNsNS4yMSwwVjYuNzdoLS42M3Y0LjM4Wk04LjU2LDI3LjM1VjI1YS44Mi44MiwwLDAsMSwuODEtLjgxaDIuMzJ2My4xMlptLjgxLDQuNTlhLjgyLjgyLDAsMCwxLS44MS0uODFWMjguODFoMy4xM3YzLjEzWm0zLjczLTQuNTlWMjQuMjNoMi4zMmEuODIuODIsMCwwLDEsLjgxLjgxdjIuMzFabTAsNC41OVYyOC44MWgzLjEzdjIuMzJhLjgyLjgyLDAsMCwxLS44MS44MVpNMTYuNTQsNDJIMjcuNDZWNDAuODVIMTYuNTRabS4zMS0yLjM5aDEwLjNWMzguNUgxNi44NVptMS4yNS0yLjM2VjI2YTMuMjYsMy4yNiwwLDAsMSwxLjE5LTIuNTMsNCw0LDAsMCwxLDUuNDMsMEEzLjI5LDMuMjksMCwwLDEsMjUuOSwyNlYzNy4yOVptNi4xMS02LjQ2YS43MS43MSwwLDAsMCwuNTMtLjIyLjczLjczLDAsMCwwLC4yMi0uNTMuNzcuNzcsMCwwLDAtLjIyLS41My43NS43NSwwLDAsMC0uNTMtLjIyLjc1Ljc1LDAsMCwwLS43NS43NS43NS43NSwwLDAsMCwuNzUuNzVabTMuMjUsOS42MVYzN2ExLjQ4LDEuNDgsMCwwLDEsLjY5LTEsNiw2LDAsMCwxLDEuNjctMSw1LjE4LDUuMTgsMCwwLDEsMS44OS0uNCwzLjIxLDMuMjEsMCwwLDEsMS4zMS4yMywyLjYzLDIuNjMsMCwwLDAsMS4xNS4yMywyLjcyLDIuNzIsMCwwLDAsMS4xNy0uMjQsMy4wOCwzLjA4LDAsMCwxLDEuMy0uMjQsMywzLDAsMCwxLDIuNDQsMS4xNSw0LjYsNC42LDAsMCwxLDEsMy4wNkExLjI1LDEuMjUsMCwwLDEsMzkuMzMsNDBhOC4yMiw4LjIyLDAsMCwxLTIuOTQuMzRsLTEuMDYsMGMtLjM3LDAtLjc2LDAtMS4xNiwwWm0uMzEtMTMuMDlWMjVhLjgyLjgyLDAsMCwxLC44MS0uODFIMzAuOXYzLjEyWm0uODEsNC41OWEuODIuODIsMCwwLDEtLjgxLS44MVYyOC44MUgzMC45djMuMTNabTMuNzMtNC41OVYyNC4yM2gyLjMyYS44Mi44MiwwLDAsMSwuODEuODF2Mi4zMVptMCw0LjU5VjI4LjgxaDMuMTN2Mi4zMmEuODIuODIsMCwwLDEtLjgxLjgxWiIgZmlsbD0iI2ZmZiIvPgo8L3N2Zz4K',
  sparkles: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0NCA0NCI+CiAgPHBhdGggZD0iTTcuMzUsNDEuMDdsLS42LTNBMjAuODcsMjAuODcsMCwwLDAsNiwzNS4yMiwzLjcxLDMuNzEsMCwwLDAsNC45LDMzLjZhNS40LDUuNCwwLDAsMC0yLS45MUwwLDMxLjkyVjMwLjIxbDIuOS0uNzhhNS45Miw1LjkyLDAsMCwwLDItLjkzQTMuNzMsMy43MywwLDAsMCw2LDI2Ljg5LDE5LjkxLDE5LjkxLDAsMCwwLDYuNzUsMjRsLjYtM0g5LjJsLjU5LDNhMTguNjcsMTguNjcsMCwwLDAsLjc2LDIuODcsMy41OCwzLjU4LDAsMCwwLDEuMSwxLjYxLDUuODksNS44OSwwLDAsMCwyLC45M2wyLjg4Ljc4djEuNzFsLTIuODguNzdhNS4zOCw1LjM4LDAsMCwwLTIsLjkxLDMuNTYsMy41NiwwLDAsMC0xLjEsMS42MiwxOS41NCwxOS41NCwwLDAsMC0uNzYsMi45bC0uNTksM1pNOC4yMSwzOUEyNy40LDI3LjQsMCwwLDEsOSwzNS40NGE2LjQsNi40LDAsMCwxLDEuMDktMi4yNyw0LjQyLDQuNDIsMCwwLDEsMS44LTEuMzVBMTMuNDQsMTMuNDQsMCwwLDEsMTQuNzYsMzF2LjExYTE0LjA5LDE0LjA5LDAsMCwxLTIuOTEtLjgxQTQuNTgsNC41OCwwLDAsMSwxMC4wNSwyOSw2LjMyLDYuMzIsMCwwLDEsOSwyNi42OWEyNy4yLDI3LjIsMCwwLDEtLjc1LTMuNTVoLjExYTI5LjQsMjkuNCwwLDAsMS0uNzMsMy41NUE2LjQ5LDYuNDksMCwwLDEsNi41MSwyOSw0LjYyLDQuNjIsMCwwLDEsNC43LDMwLjNhMTQuMTYsMTQuMTYsMCwwLDEtMi45LjgxVjMxYTEzLjUsMTMuNSwwLDAsMSwyLjkuODIsNC40NSw0LjQ1LDAsMCwxLDEuODEsMS4zNSw2LjU3LDYuNTcsMCwwLDEsMS4wOCwyLjI3QTI5LjYxLDI5LjYxLDAsMCwxLDguMzIsMzlabTIuMTEtMjAuNDUtLjQ0LTIuMzJhOS41LDkuNSwwLDAsMC0uNjktMi4zN0EyLjY2LDIuNjYsMCwwLDAsOCwxMi42MmE5LjI1LDkuMjUsMCwwLDAtMi4yMy0uNzJsLTEuNDMtLjMxVjkuOWwxLjQzLS4zM0E5LjYsOS42LDAsMCwwLDgsOC44MywyLjY4LDIuNjgsMCwwLDAsOS4xOSw3LjZhOS4yMSw5LjIxLDAsMCwwLC42OS0yLjM0bC40NC0yLjMzaDEuNzZsLjQ2LDIuMzNhMTAuNTYsMTAuNTYsMCwwLDAsLjcsMi4zNEEyLjU1LDIuNTUsMCwwLDAsMTQuNCw4LjgyYTEwLDEwLDAsMCwwLDIuMjMuNzVMMTgsOS45djEuNjlsLTEuNDEuMzFhOC43OCw4Ljc4LDAsMCwwLTIuMjMuNzMsMi42MywyLjYzLDAsMCwwLTEuMTYsMS4yNCwxMC42MSwxMC42MSwwLDAsMC0uNywyLjM2bC0uNDYsMi4zMlptLjgxLTEuODNhMTkuNTIsMTkuNTIsMCwwLDEsLjY0LTIuOCw0LjQ0LDQuNDQsMCwwLDEsLjktMS42NSwzLjgsMy44LDAsMCwxLDEuNDUtLjk0LDE0LjY4LDE0LjY4LDAsMCwxLDIuMjktLjY0di4xMWExOC43NywxOC43NywwLDAsMS0yLjI5LS42NSwzLjYsMy42LDAsMCwxLTEuNDUtMSw0LjQxLDQuNDEsMCwwLDEtLjktMS42NiwxOSwxOSwwLDAsMS0uNjQtMi43OWguMTVhMTguODYsMTguODYsMCwwLDEtLjY1LDIuNzlBNC41NSw0LjU1LDAsMCwxLDkuNzQsOS4yYTMuNTYsMy41NiwwLDAsMS0xLjQ0LDFBMTguMjYsMTguMjYsMCwwLDEsNiwxMC44di0uMTFhMTQuMzcsMTQuMzcsMCwwLDEsMi4yOS42NCwzLjc2LDMuNzYsMCwwLDEsMS40NC45NCw0LjU4LDQuNTgsMCwwLDEsLjg5LDEuNjUsMTkuMzUsMTkuMzUsMCwwLDEsLjY1LDIuOFpNMjcuNTcsNDEuMDdsLS43My01Yy0uMjktMi0uNi0zLjYzLS45My01YTEyLjQsMTIuNCwwLDAsMC0xLjIxLTMuMjcsNi4xMSw2LjExLDAsMCwwLTEuODUtMi4wNSwxMCwxMCwwLDAsMC0yLjgtMS4yOWMtMS4xMi0uMzUtMi40OS0uNjgtNC4xLTFsLTMtLjYzdi0xLjdsMy0uNjJjMS42MS0uMzMsMy0uNjcsNC4xLTFhMTAuMjYsMTAuMjYsMCwwLDAsMi44LTEuMyw2LjE3LDYuMTcsMCwwLDAsMS44NS0yLDEyLjE5LDEyLjE5LDAsMCwwLDEuMjEtMy4yNmMuMzMtMS4zNC42NC0zLC45My01bC43My01aDEuOGwuNzEsNWMuMjksMiwuNTksMy42My45MSw1YTEyLjc1LDEyLjc1LDAsMCwwLDEuMjIsMy4yNyw2LjI0LDYuMjQsMCwwLDAsMS44NiwyLjA1LDEwLDEwLDAsMCwwLDIuODEsMS4yOWMxLjEyLjMzLDIuNDguNjcsNC4xLDFsMywuNjJ2MS43bC0zLC42M2MtMS42Mi4zMy0zLC42Ni00LjEsMWExMCwxMCwwLDAsMC0yLjgxLDEuMjksNi4yNCw2LjI0LDAsMCwwLTEuODYsMi4wNUExMi43NSwxMi43NSwwLDAsMCwzMSwzMS4wOWMtLjMyLDEuMzQtLjYyLDMtLjkxLDVsLS43MSw1Wm0uODMtMy41MnEuNDItMy4xMi44NS01LjM2YTIzLjUsMjMuNSwwLDAsMSwxLTMuNzgsOC41Miw4LjUyLDAsMCwxLDEuNDUtMi41Nyw3LjI5LDcuMjksMCwwLDEsMi4xMi0xLjdBMTYuMywxNi4zLDAsMCwxLDM2LjksMjNjMS4xOS0uMzQsMi42LS42OCw0LjI0LTF2LjE0Yy0xLjY0LS4zNS0zLS43LTQuMjQtMWExNS42NiwxNS42NiwwLDAsMS0zLjA2LTEuMTgsNy4yOSw3LjI5LDAsMCwxLTIuMTItMS43LDguNTIsOC41MiwwLDAsMS0xLjQ1LTIuNTcsMjMuNSwyMy41LDAsMCwxLTEtMy43OHEtLjQzLTIuMjQtLjg1LTUuMzZoLjEzcS0uNDIsMy4xMi0uODYsNS4zNmEyMi41OCwyMi41OCwwLDAsMS0xLDMuNzgsOC43Myw4LjczLDAsMCwxLTEuNDUsMi41Nyw3LjQyLDcuNDIsMCwwLDEtMi4xMiwxLjcsMTUuNDQsMTUuNDQsMCwwLDEtMywxLjE4Yy0xLjE5LjMzLTIuNjEuNjgtNC4yNSwxdi0uMTRjMS42NC4zNCwzLjA2LjY4LDQuMjUsMWExNC44MywxNC44MywwLDAsMSwzLDEuMTksNy4yMyw3LjIzLDAsMCwxLDIuMTIsMS42OSw4Ljg2LDguODYsMCwwLDEsMS40NSwyLjU3LDIyLjU4LDIyLjU4LDAsMCwxLDEsMy43OHEuNDMsMi4yNS44Niw1LjM4WiIgZmlsbD0iI2ZmZiIvPgo8L3N2Zz4K',
  neutral: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0NCA0NCI+CiAgPHBhdGggZD0iTTIyLDQ0YTIxLjY1LDIxLjY1LDAsMCwxLTguNTYtMS43QTIyLjE4LDIyLjE4LDAsMCwxLDEuNywzMC41NiwyMS42NSwyMS42NSwwLDAsMSwwLDIyYTIxLjY1LDIxLjY1LDAsMCwxLDEuNy04LjU2QTIyLjE4LDIyLjE4LDAsMCwxLDEzLjQ0LDEuNywyMS42NSwyMS42NSwwLDAsMSwyMiwwYTIxLjYzLDIxLjYzLDAsMCwxLDguNTQsMS43LDIyLjI0LDIyLjI0LDAsMCwxLDcsNC43MywyMi42MSwyMi42MSwwLDAsMSw0Ljc0LDdBMjEuNDksMjEuNDksMCwwLDEsNDQsMjJhMjEuNDksMjEuNDksMCwwLDEtMS43MSw4LjU2LDIyLjQ5LDIyLjQ5LDAsMCwxLTQuNzQsNywyMi4yNCwyMi4yNCwwLDAsMS03LDQuNzNBMjEuNjMsMjEuNjMsMCwwLDEsMjIsNDRabTAtMS42OWExOS44MiwxOS44MiwwLDAsMCw3Ljg5LTEuNThBMjAuNTMsMjAuNTMsMCwwLDAsNDAuNzMsMjkuODksMTkuODIsMTkuODIsMCwwLDAsNDIuMzEsMjJhMTkuODIsMTkuODIsMCwwLDAtMS41OC03Ljg5QTIwLjUzLDIwLjUzLDAsMCwwLDI5Ljg5LDMuMjcsMTkuODIsMTkuODIsMCwwLDAsMjIsMS42OWExOS44MiwxOS44MiwwLDAsMC03Ljg5LDEuNThBMjAuNTMsMjAuNTMsMCwwLDAsMy4yNywxNC4xMSwxOS44MiwxOS44MiwwLDAsMCwxLjY5LDIyYTE5LjgyLDE5LjgyLDAsMCwwLDEuNTgsNy44OUEyMC41MywyMC41MywwLDAsMCwxNC4xMSw0MC43MywxOS44MiwxOS44MiwwLDAsMCwyMiw0Mi4zMVpNMTQuNTUsMjIuNDJhMi4zNSwyLjM1LDAsMCwxLTEuODYtLjk0LDMuNTksMy41OSwwLDAsMSwwLTQuNDcsMi4zNCwyLjM0LDAsMCwxLDMuNzMsMCwzLjU5LDMuNTksMCwwLDEsMCw0LjQ3QTIuMzcsMi4zNywwLDAsMSwxNC41NSwyMi40MlptLTIuMzcsOC40NlYyOS4xOUgzMS44MnYxLjY5Wm0xNy4yNy04LjQ2YTIuMzcsMi4zNywwLDAsMS0xLjg3LS45NCwzLjU5LDMuNTksMCwwLDEsMC00LjQ3LDIuMzksMi4zOSwwLDAsMSwxLjg3LS45MywyLjM2LDIuMzYsMCwwLDEsMS44Ni45MywzLjU5LDMuNTksMCwwLDEsMCw0LjQ3QTIuMzQsMi4zNCwwLDAsMSwyOS40NSwyMi40MloiIGZpbGw9IiNmZmYiLz4KPC9zdmc+Cg==',
  thinking: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0NCA0NCI+CiAgPHBhdGggZD0iTTkuNDgsNDRhOCw4LDAsMCwxLTYtMi4xLDcuODIsNy44MiwwLDAsMS0yLTUuNzEsOS4yMSw5LjIxLDAsMCwxLC4xOC0xLjg1LDcuMjgsNy4yOCwwLDAsMCwuMTktMS41OCw0LjY3LDQuNjcsMCwwLDAtLjI5LTEuNjZjLS4xOS0uNS0uNC0xLS42Mi0xLjQ0YTEzLjc4LDEzLjc4LDAsMCwxLS41Ny0xLjM0QTMuOTEsMy45MSwwLDAsMSwuMTIsMjdhMi40NiwyLjQ2LDAsMCwxLC43MS0xLjgyLDIuNTksMi41OSwwLDAsMSwxLjk0LS43LDQsNCwwLDAsMSwyLjMzLjc0LDUsNSwwLDAsMSwxLjYzLDJsLjE3LjM2YTcuNDcsNy40NywwLDAsMCwuNjcsMS4yMy44My44MywwLDAsMCwuNjkuMzQsMi40NCwyLjQ0LDAsMCwwLC44My0uMTksOC44Niw4Ljg2LDAsMCwwLDEuMTYtLjU4LDIyLjk0LDIyLjk0LDAsMCwxLDIuMjMtMS4wNiwxNy42MiwxNy42MiwwLDAsMSwzLjExLTEsMTcuODMsMTcuODMsMCwwLDEsMy44Ny0uNCw1LjI0LDUuMjQsMCwwLDEsMi42Ny41NywxLjg2LDEuODYsMCwwLDEsMSwxLjcxLDIuMDYsMi4wNiwwLDAsMS0uMzUsMS4yLDMuMjYsMy4yNiwwLDAsMS0xLjMyLDEsMjIuMjgsMjIuMjgsMCwwLDEtMi44MywxbC0uNDkuMTRhMTUuODEsMTUuODEsMCwwLDAtMi41NCwxLDE0LjQ0LDE0LjQ0LDAsMCwwLTIuNzksMS45M2wtLjg1LTFBMTUuNTMsMTUuNTMsMCwwLDEsMTUsMzEuMTlhMTMuNTgsMTMuNTgsMCwwLDEsMi43LTEuMDVsLjQtLjFhMTksMTksMCwwLDAsMi43LS44NnEuODEtLjM2LjgxLS44NGEuNzcuNzcsMCwwLDAtLjU1LS43Myw0LjI2LDQuMjYsMCwwLDAtMS42NC0uMjQsMTUuNiwxNS42LDAsMCwwLTQuODUuNzEsMjQuODYsMjQuODYsMCwwLDAtMy42OCwxLjUyLDEzLjg3LDEzLjg3LDAsMCwxLTEuNjQuNzUsMy43MywzLjczLDAsMCwxLTEuMTkuMjIsMS44NCwxLjg0LDAsMCwxLTEuMy0uNSw2LjU5LDYuNTksMCwwLDEtMS4yLTEuOTNsLS4xNy0uMzZBMy41MiwzLjUyLDAsMCwwLDQuMzcsMjYuNGEyLjM2LDIuMzYsMCwwLDAtMS40NC0uNTIsMS40NiwxLjQ2LDAsMCwwLTEsLjMzLDEuMjIsMS4yMiwwLDAsMC0uMzksMSwyLjYzLDIuNjMsMCwwLDAsLjIsMSwxMC42MywxMC42MywwLDAsMCwuNDYsMS4wNmMuMjUuNTEuNDksMS4wNi43MSwxLjY1YTUuMjEsNS4yMSwwLDAsMSwuMzQsMS45QTcuODIsNy44MiwwLDAsMSwzLjEsMzQuNWE3LjE2LDcuMTYsMCwwLDAtLjE5LDEuNzMsNi4yOCw2LjI4LDAsMCwwLDEuNyw0LjYsNi41Miw2LjUyLDAsMCwwLDQuODcsMS43MiwxMy44NCwxMy44NCwwLDAsMCwzLS4zM0ExMC42NywxMC42NywwLDAsMCwxNSw0MS4zNmMuNjgtLjM2LDEtLjc1LDEtMS4xNmEyLjUyLDIuNTIsMCwwLDAsMC0uNDMsMS40MywxLjQzLDAsMCwwLS4yMS0uNDRsLjkzLTEuMDlhMi42OCwyLjY4LDAsMCwxLC43NiwyLDIuMTQsMi4xNCwwLDAsMS0uNjgsMS41NkE1Ljc1LDUuNzUsMCwwLDEsMTQuOTEsNDNhMTIuMzksMTIuMzksMCwwLDEtMi41Ni43N0ExNS4xLDE1LjEsMCwwLDEsOS40OCw0NFptMTIuOTEtMWEyMSwyMSwwLDAsMS02LjcxLTEuMDhsLjkzLTEuNDJhMjAsMjAsMCwwLDAsNS43OC44NSwxOS41MSwxOS41MSwwLDAsMCw3LjcxLTEuNTQsMjAuMSwyMC4xLDAsMCwwLDYuMzItNC4yNywxOS43OSwxOS43OSwwLDAsMCw0LjI2LTYuMzIsMTkuMzQsMTkuMzQsMCwwLDAsMS41NC03LjcxLDE5LjI5LDE5LjI5LDAsMCwwLTEuNTQtNy43LDE5Ljc5LDE5Ljc5LDAsMCwwLTQuMjYtNi4zMkEyMC4xLDIwLjEsMCwwLDAsMzAuMSwzLjE5YTE5LjUxLDE5LjUxLDAsMCwwLTcuNzEtMS41NCwxOS40MywxOS40MywwLDAsMC03LjcsMS41NEEyMC4wNywyMC4wNywwLDAsMCw0LjEsMTMuNzhhMTkuMjksMTkuMjksMCwwLDAtMS41NCw3LjdBMjAuNzgsMjAuNzgsMCwwLDAsMywyNS41N0wxLjM4LDI2Yy0uMTUtLjczLS4yNy0xLjQ3LS4zNS0yLjIyYTIxLjUzLDIxLjUzLDAsMCwxLS4xMi0yLjI5LDIxLDIxLDAsMCwxLDEuNjYtOC4zNUEyMS42NSwyMS42NSwwLDAsMSwxNCwxLjY2LDIxLDIxLDAsMCwxLDIyLjM5LDBhMjEsMjEsMCwwLDEsOC4zNCwxLjY2QTIxLjY1LDIxLjY1LDAsMCwxLDQyLjIsMTMuMTNhMjAuODMsMjAuODMsMCwwLDEsMS42OCw4LjM1LDIwLjg4LDIwLjg4LDAsMCwxLTEuNjgsOC4zNiwyMS43MywyMS43MywwLDAsMS00LjYyLDYuODUsMjEuNDgsMjEuNDgsMCwwLDEtNi44NSw0LjYxQTIxLDIxLDAsMCwxLDIyLjM5LDQzWk0xNS44MiwxMi44MUEyLjMzLDIuMzMsMCwwLDEsMTQsMTEuOWEzLjMsMy4zLDAsMCwxLS43Ni0yLjE5QTMuMzMsMy4zMywwLDAsMSwxNCw3LjUxYTIuMywyLjMsMCwwLDEsMy42OCwwLDMuMzMsMy4zMywwLDAsMSwuNzcsMi4yLDMuMzQsMy4zNCwwLDAsMS0uNzYsMi4xOEEyLjMxLDIuMzEsMCwwLDEsMTUuODIsMTIuODFaTTIwLjksNS4yM2ExMC40MSwxMC40MSwwLDAsMC0zLjQ2LTIuNDIsMTAuOSwxMC45LDAsMCwwLTQuMS0uN1YuNDVhMTIuNTksMTIuNTksMCwwLDEsNC43Ni44NCwxMiwxMiwwLDAsMSw0LDIuNzhaTTEzLjYxLDM3LjQ5bC0uMi0xLjI0YTMuOCwzLjgsMCwwLDAsMS43OC0uNjUsMS4zLDEuMywwLDAsMCwuNTktMSwxLjI3LDEuMjcsMCwwLDAtLjM4LS45MywyLjE3LDIuMTcsMCwwLDAtMS4xMS0uNTJsLjMxLTEuMjRhMi45LDIuOSwwLDAsMSwxLjc5Ljg5LDIuNTEsMi41MSwwLDAsMSwuNzMsMS44LDIuNDIsMi40MiwwLDAsMS0uOSwxLjkxQTUsNSwwLDAsMSwxMy42MSwzNy40OVpNMjcuNDMsMjQuMzFBMTAuNDYsMTAuNDYsMCwwLDAsMjAsMjFhMTMuNTQsMTMuNTQsMCwwLDAtNS42OCwxLjM4bC0uNy0xLjQ4QTE1LjE0LDE1LjE0LDAsMCwxLDIwLDE5LjM2YTEyLjA4LDEyLjA4LDAsMCwxLDguNjIsMy43NlpNMTQuMDcsNDAuMiwxMy44OCwzOWMxLjQ3LS4yOSwyLjIxLS44NCwyLjIxLTEuNjVhMS40MywxLjQzLDAsMCwwLS4zOS0xbC43LTEuMTdhMi40NCwyLjQ0LDAsMCwxLC43NS45NSwzLDMsMCwwLDEsLjI4LDEuMjYsMi4zOCwyLjM4LDAsMCwxLS44NCwxLjg3QTUuMTYsNS4xNiwwLDAsMSwxNC4wNyw0MC4yWk0zMy4zNCw4LjkyYTEwLjg1LDEwLjg1LDAsMCwwLTUuNDUtMS41LDEyLjEzLDEyLjEzLDAsMCwwLTEuMzguMDcsOS44Nyw5Ljg3LDAsMCwwLTEuMjUuMjJsLS4zNy0xLjYyYTEyLjgzLDEyLjgzLDAsMCwxLDEuNDktLjI0LDEyLjYyLDEyLjYyLDAsMCwxLDEuNTEtLjA5QTEyLjI4LDEyLjI4LDAsMCwxLDM0LjE3LDcuNVptLTQuNSw3LjRBMi4zMSwyLjMxLDAsMCwxLDI3LDE1LjQxYTMuMjksMy4yOSwwLDAsMS0uNzctMi4xOUEzLjMzLDMuMzMsMCwwLDEsMjcsMTFhMi4zLDIuMywwLDAsMSwzLjY4LDAsMy4zMywzLjMzLDAsMCwxLC43NiwyLjIsMy4zNCwzLjM0LDAsMCwxLS43NSwyLjE4QTIuMzMsMi4zMywwLDAsMSwyOC44NCwxNi4zMloiIGZpbGw9IiNmZmYiLz4KPC9zdmc+Cg==',
  warning: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0NCA0NCI+CiAgPHBhdGggZD0iTTMuNzksNDRBMy40OSwzLjQ5LDAsMCwxLC4yMSw0MC40MmE0LjkyLDQuOTIsMCwwLDEsLjUzLTIuMTNMMTguNDksMi40M2EzLjc1LDMuNzUsMCwwLDEsNywwTDQzLjI2LDM4LjI5YTQuOTIsNC45MiwwLDAsMSwuNTMsMi4xMywzLjQ4LDMuNDgsMCwwLDEtMSwyLjU2LDMuNDQsMy40NCwwLDAsMS0yLjU3LDFabTAtMS42OUg0MC4yMWExLjksMS45LDAsMCwwLDEuMzgtLjUsMS43OSwxLjc5LDAsMCwwLC41MS0xLjM0LDMsMywwLDAsMC0uMzYtMS40MkwyNCwzLjE3YTIuMjEsMi4yMSwwLDAsMC0yLTEuNDgsMi4yNCwyLjI0LDAsMCwwLTIsMS41TDIuMjYsMzlhMy4yLDMuMiwwLDAsMC0uMzYsMS40NCwxLjgsMS44LDAsMCwwLC41MiwxLjMzQTEuODcsMS44NywwLDAsMCwzLjc5LDQyLjMxWk0yMiwzMmExLDEsMCwwLDEtLjcyLS4yNywxLDEsMCwwLDEtLjM0LS42NkwxOS42MywxNC45MWEyLjksMi45LDAsMCwxLC41Ny0yLjE0LDIuMzUsMi4zNSwwLDAsMSwzLjYxLDAsMi45NCwyLjk0LDAsMCwxLC41NiwyLjEzTDIzLjA2LDMxLjFhLjk0Ljk0LDAsMCwxLS4zMy42NkExLjA2LDEuMDYsMCwwLDEsMjIsMzJabTAsNS43N2ExLjc3LDEuNzcsMCwwLDEtMS4zLS41NCwxLjg0LDEuODQsMCwxLDEsMi42LDBBMS43NywxLjc3LDAsMCwxLDIyLDM3LjhaIiBmaWxsPSIjZmZmIi8+Cjwvc3ZnPgo=',
  poop: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0NCA0NCI+CiAgPHBhdGggZD0iTTIyLDQ0YTMzLjA5LDMzLjA5LDAsMCwxLTguNjQtMS4wNiwyMywyMywwLDAsMS02Ljg0LTNBMTQuNDksMTQuNDksMCwwLDEsMiwzNS40NGExMC44LDEwLjgsMCwwLDEtMS42LTUuNzIsNy42Myw3LjYzLDAsMCwxLDEuNzQtNS4xM0ExMC43MywxMC43MywwLDAsMSw3LDIxLjQ5YTEyLjMsMTIuMywwLDAsMS0uMTUtMS44OCw4LjM3LDguMzcsMCwwLDEsMS41MS01LjA5LDguMDcsOC4wNywwLDAsMSw0LjM1LTIuODl2LS40YTEzLjExLDEzLjExLDAsMCwxLC44NC01LDguMTIsOC4xMiwwLDAsMSwyLjg2LTMuNDlBMjIuNzEsMjIuNzEsMCwwLDEsMjIsMGExNi42OSwxNi42OSwwLDAsMCwuMzMsMy43MywzLjY0LDMuNjQsMCwwLDAsMS4xOCwyLjA4LDUuNTksNS41OSwwLDAsMCwyLjQyLDFMMjcsN0ExMS4yMywxMS4yMywwLDAsMSwzMi40LDkuMjRhNS4yOCw1LjI4LDAsMCwxLDEuNjYsNC4wOSw2LDYsMCwwLDEtLjEsMS4wNSwxMC4xNywxMC4xNywwLDAsMS0uMjQsMS4xNSw3LDcsMCwwLDEsMy4yLDIuMzgsNy4xLDcuMSwwLDAsMSwxLjI2LDMuOTQsMTAsMTAsMCwwLDEsNCwzLjI4LDcuODgsNy44OCwwLDAsMSwxLjQzLDQuNTlBMTAuOCwxMC44LDAsMCwxLDQyLDM1LjQ0LDE0LjYzLDE0LjYzLDAsMCwxLDM3LjQ3LDQwYTIzLDIzLDAsMCwxLTYuODUsM0EzMywzMywwLDAsMSwyMiw0NFpNMTYsMjguNzVhNC41LDQuNSwwLDAsMCwyLjM4LS42NSw0Ljk0LDQuOTQsMCwwLDAsMS43MS0xLjcyLDQuNjYsNC42NiwwLDAsMCwwLTQuNzUsNSw1LDAsMCwwLTEuNzEtMS43MSw0LjY2LDQuNjYsMCwwLDAtNC43NSwwLDQuOTQsNC45NCwwLDAsMC0xLjcyLDEuNzEsNC42Niw0LjY2LDAsMCwwLDAsNC43NUE0Ljg5LDQuODksMCwwLDAsMTMuNiwyOC4xLDQuNTQsNC41NCwwLDAsMCwxNiwyOC43NVptMC0yLjU0YTIuMiwyLjIsMCwwLDEsMC00LjQsMi4xNiwyLjE2LDAsMCwxLDEuNTYuNjQsMi4yMSwyLjIxLDAsMCwxLDAsMy4xMkEyLjE5LDIuMTksMCwwLDEsMTYsMjYuMjFabTYsMTIuMzVBOC44NSw4Ljg1LDAsMCwwLDI1LDM4LjA1YTkuODcsOS44NywwLDAsMCwyLjYxLTEuMzksNy4yLDcuMiwwLDAsMCwxLjg1LTEuOTQsMy45LDMuOSwwLDAsMCwuNjktMi4xNCwxLjQ3LDEuNDcsMCwwLDAtLjI2LS45MS44OS44OSwwLDAsMC0uODgtLjI2Yy0xLjQ1LjE5LTIuNjkuMzItMy43Mi40MXMtMi4xMS4xMi0zLjI0LjEyLTIuMTksMC0zLjIzLS4xMi0yLjI4LS4yMi0zLjczLS40MWEuODkuODksMCwwLDAtLjg4LjI2LDEuNDcsMS40NywwLDAsMC0uMjYuOTEsMy45LDMuOSwwLDAsMCwuNjksMi4xNCw3LjIsNy4yLDAsMCwwLDEuODUsMS45NCw5Ljg3LDkuODcsMCwwLDAsMi42MSwxLjM5QTguODUsOC44NSwwLDAsMCwyMiwzOC41NlptNi05LjgxYTQuNTMsNC41MywwLDAsMCwyLjM4LS42NSw0Ljk0LDQuOTQsMCwwLDAsMS43MS0xLjcyLDQuNjYsNC42NiwwLDAsMCwwLTQuNzUsNSw1LDAsMCwwLTEuNzEtMS43MSw0LjY2LDQuNjYsMCwwLDAtNC43NSwwLDQuOTQsNC45NCwwLDAsMC0xLjcyLDEuNzEsNC42Niw0LjY2LDAsMCwwLDAsNC43NSw0Ljg5LDQuODksMCwwLDAsMS43MiwxLjcyQTQuNTQsNC41NCwwLDAsMCwyOCwyOC43NVptMC0yLjU0YTIuMTksMi4xOSwwLDAsMS0xLjU1LS42NCwyLjIsMi4yLDAsMSwxLDEuNTUuNjRaIiBmaWxsPSIjZmZmIi8+Cjwvc3ZnPgo='
};


async function __render(ctx, diag) {
  const strategyGroup = ctx.env.GROUP || 'DIRECT';
  const widgetFamily = ctx.widgetFamily || 'systemLarge';
  const hideIp = __wantHideIp(ctx.env.IP);
  const ipWide = String(ctx.env.IP || '').trim() === '测试';
  if (!diag || typeof diag !== 'object') diag = {};
  let ipStatus = 0;
  let ipMs = null;

  const eggRaw = String(ctx.env.EGG || '').trim().toLowerCase();
  const egg = ['开', 'on', 'true', '1'].indexOf(eggRaw) >= 0;

  const themeRaw = String(ctx.env.THEME || '').trim().toLowerCase();
  const isLight = themeRaw === 'light' || themeRaw === 'paper' || themeRaw === '浅色' || themeRaw === '纸白';

  const styleRaw = String(ctx.env.STYLE || '').trim().toLowerCase();
  const isGlass = styleRaw === 'glass' || styleRaw === '透明';

  const C = __THEME[isLight ? 'light' : 'dark'];
  const G = __SEM[isLight ? 'light' : 'dark'].good;
  const W = __SEM[isLight ? 'light' : 'dark'].warn;
  const bg = isGlass ? {} : (isLight
    ? { backgroundColor: C.bgTop }
    : { backgroundGradient: { type: 'linear', colors: [C.bgTop, C.bgBottom], startPoint: { x: 0.5, y: 0 }, endPoint: { x: 0.5, y: 1 } } });

  const now = Date.now();
  const kvGet = (k) => { try { return ctx.storage.getJSON(k); } catch (_) { return null; } };
  const kvSet = (k, v) => { try { ctx.storage.setJSON(k, v); } catch (_) {} };
  const kvDel = (k) => { try { ctx.storage.delete(k); } catch (_) {} };

  const kvSave = (k, m, cap) => {
    const keys = Object.keys(m).sort((a, b) => ((m[b] && m[b].ts) || 0) - ((m[a] && m[a].ts) || 0));
    const out = {};
    for (let i = 0; i < keys.length && i < cap; i++) out[keys[i]] = m[keys[i]];
    if (!Object.keys(out).length) kvDel(k);
    else kvSet(k, { v: 2, m: out });
    return out;
  };

  const kvRead = (k, cap, valid) => {
    const raw = kvGet(k);
    const src = (raw && typeof raw === 'object' && raw.m && typeof raw.m === 'object') ? raw.m : {};
    const keep = {};
    let dirty = false;
    Object.keys(src).forEach((key) => {
      const e = src[key];
      if (e && typeof e === 'object' && typeof e.ts === 'number' && valid(e)) keep[key] = e;
      else dirty = true;
    });
    if (!dirty && Object.keys(keep).length === Object.keys(src).length) return keep;
    return kvSave(k, keep, cap);
  };

  const kvPut = (k, key, entry, cap, valid) => {
    const m = kvRead(k, cap, valid);
    m[key] = entry;
    kvSave(k, m, cap);
  };

  async function probeOnce(url, policy, timeout, isHead) {
    const t0 = Date.now();
    try {
      const opts = { policy: policy, timeout: timeout, redirect: 'manual' };
      const r = (isHead === true && typeof ctx.http.head === 'function')
        ? await ctx.http.head(url, opts)
        : await ctx.http.get(url, opts);
      const ok = !!(r && r.status > 0);
      let text = '';
      if (isHead !== true && ok && r.text) { try { text = await r.text(); } catch (_) {} }
      return { ms: Date.now() - t0, ok: ok, status: (r && r.status) || 0, text: text };
    } catch (_) {
      return { ms: Date.now() - t0, ok: false, status: 0, text: '' };
    }
  }

  async function fetchScore() {
    const t0 = Date.now();
    try {
      const r = await ctx.http.get(__SCORE_URL, { policy: strategyGroup, timeout: __SCORE_TIMEOUT });
      ipStatus = (r && r.status) || 0;
      ipMs = Date.now() - t0;
      if (!r || r.status !== 200) return null;
      const body = await r.json();
      if (!__usableMeta(body)) return null;
      const s = __finiteScore(body.fraudScore);
      body.fraudScore = (s === null ? null : Math.max(0, Math.min(100, s)));
      return body;
    } catch (_) {
      ipMs = Date.now() - t0;
      return null;
    }
  }

  const drawChart = widgetFamily === 'systemSmall' || widgetFamily === 'systemMedium' || widgetFamily === 'systemLarge' || widgetFamily === 'systemExtraLarge';

  const scoreTask = fetchScore();

  let chartMs = null;
  let chartHi = null;
  if (drawChart) {
    const p2 = await probeOnce(__TM_URL, strategyGroup, __TM_TIMEOUT, true);
    const p3 = await probeOnce(__TM_URL, strategyGroup, __TM_TIMEOUT, true);
    const ok = [p2, p3].filter((p) => p.ok && p.ms > 0).map((p) => p.ms);
    if (ok.length) {
      chartMs = Math.min.apply(null, ok);
      chartHi = Math.max.apply(null, ok);
    }
  }

  const data = await scoreTask;
  const dead = !data;

  const isV6 = !!(data && typeof data.ip === 'string' && data.ip.indexOf(':') >= 0);
  let dual = false;
  let dualHit = null;
  let dualAge = null;
  let dv4 = null;
  let dv6 = null;
  if (isV6 && !dead && data && data.ip) {
    const dualOk = (e) => typeof e.d === 'boolean' && (now - e.ts) < (e.d === true ? __DUAL_OK_TTL : __DUAL_BAD_TTL);
    const hit = kvRead(__DUAL_KEY, __DUAL_MAX, dualOk)[data.ip];
    if (hit) {
      dual = hit.d;
      dualHit = true;
      dualAge = now - hit.ts;
    } else {
      dualHit = false;
      const pair = await Promise.all([
        probeOnce(__D_V4, strategyGroup, __TM_TIMEOUT),
        probeOnce(__D_V6, strategyGroup, __TM_TIMEOUT)
      ]);
      dv4 = { ok: !!(pair[0] && pair[0].ok), s: (pair[0] && pair[0].status) || 0, ms: (pair[0] && pair[0].ms) || 0 };
      dv6 = { ok: !!(pair[1] && pair[1].ok), s: (pair[1] && pair[1].status) || 0, ms: (pair[1] && pair[1].ms) || 0 };
      dual = !!(dv4.ok && dv6.ok);
      kvPut(__DUAL_KEY, data.ip, { d: dual, ts: now }, __DUAL_MAX, dualOk);
    }
  }

  const chartBar = isLight ? __CHART_BAR.light : __CHART_BAR.dark;
  const sample = (chartMs === null) ? null : { lo: Math.round(chartMs), hi: Math.round(chartHi === null ? chartMs : chartHi) };

  let pts = [];
  if (drawChart) {
    const ring = kvGet(__CHART_KEY);
    pts = (ring && Array.isArray(ring.pts) ? ring.pts : [])
      .filter((p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && isFinite(p[0]))
      .map((p) => {
        const lo = (typeof p[1] === 'number' && isFinite(p[1]) && p[1] >= 0) ? p[1] : null;
        const hi = (typeof p[2] === 'number' && isFinite(p[2]) && p[2] >= 0) ? p[2] : lo;
        return [p[0], lo, hi];
      });
    pts.push([now, sample ? sample.lo : null, sample ? sample.hi : null]);
    while (pts.length > __CHART_MAX) pts.shift();
    kvSet(__CHART_KEY, { v: 1, pts: pts });
  }

  function chartSVG(values, w, h) {
    const pitch = w / values.length;
    const bar = pitch - __CHART_GAP_SOLID;
    const back = [];
    const body = [];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!v) continue;
      const x = __r2(i * pitch + __CHART_GAP_SOLID / 2);
      const hi = (typeof v.hi === 'number' && v.hi > v.lo) ? v.hi : v.lo;
      if (hi - v.lo >= __CHART_DUAL_MIN_DIFF) {
        const hh = Math.max(__CHART_MIN_H, Math.max(0, Math.min(1, hi / __CHART_CAP)) * h);
        back.push("<rect x='" + x + "' y='" + __r2(h - hh) + "' width='" + __r2(bar) + "' height='" + __r2(hh)
          + "' rx='" + __r2(Math.min(__CHART_R_SOLID, hh / 2)) + "' fill='" + chartBar.top + "'/>");
      }
      const bh = Math.max(__CHART_MIN_H, Math.max(0, Math.min(1, v.lo / __CHART_CAP)) * h);
      body.push("<rect x='" + x + "' y='" + __r2(h - bh) + "' width='" + __r2(bar) + "' height='" + __r2(bh)
        + "' rx='" + __r2(Math.min(__CHART_R_SOLID, bh / 2)) + "' fill='url(#g)'/>");
    }
    const backLayer = back.length ? "<g opacity='" + __CHART_BACK_OP + "'>" + back.join('') + "</g>" : '';
    return "<svg xmlns='http://www.w3.org/2000/svg' width='" + __r2(w) + "' height='" + __r2(h) + "' viewBox='0 0 " + __r2(w) + " " + __r2(h) + "'>"
      + "<defs><linearGradient id='g' x1='0' y1='1' x2='0' y2='0'>"
      + "<stop offset='0' stop-color='" + chartBar.bottom + "'/>"
      + "<stop offset='1' stop-color='" + chartBar.top + "'/>"
      + "</linearGradient></defs>"
      + backLayer + body.join('') + '</svg>';
  }

  function miniBadge(text, color) {
    const node = {
      type: 'stack',
      direction: 'row',
      padding: [2, 6, 2, 6],
      borderRadius: 999,
      children: [
        { type: 'text', text: text, font: { size: __SZ.midBadge, weight: __WT.med }, textColor: color }
      ]
    };
    if (/^#[0-9A-Fa-f]{6}$/.test(String(color))) node.backgroundColor = String(color) + '1F';
    return node;
  }

  function chartRow(slots, h, w, noFlex) {
    const tail = pts.slice(-slots);
    const values = [];
    for (let i = 0; i < slots - tail.length; i++) values.push(null);
    for (let i = 0; i < tail.length; i++) {
      const lo = tail[i][1];
      const hi = tail[i][2];
      values.push(lo === null ? null : { lo: lo, hi: (typeof hi === 'number' ? hi : lo) });
    }
    const row = {
      type: 'stack',
      direction: 'row',
      alignItems: 'end',
      children: [
        { type: 'spacer' },
        {
          type: 'image',
          src: 'data:image/svg+xml,' + encodeURIComponent(chartSVG(values, w, h)),
          width: w,
          height: h,
          resizeMode: 'contain'
        },
        { type: 'spacer' }
      ]
    };
    if (!noFlex) row.flex = 1;
    return row;
  }

  let asnName = null;
  let asnRaw = null;
  let asnHit = null;
  if (data && data.asn !== undefined && data.asn !== null) {
    const asnId = String(data.asn).trim().replace(/^as\s*/i, '');
    const asnOk = (e) => (now - e.ts) < __ASN_TTL;
    const hit = asnId ? kvRead(__ASN_KEY, __ASN_MAX, asnOk)[asnId] : null;
    if (hit) {
      asnName = __asnFromHolder(hit.n) || null;
      asnHit = true;
    } else {
      asnHit = false;
      const got = await __fetchAsnName(ctx, data.asn, strategyGroup);
      if (got !== undefined) {
        asnName = got.name || null;
        asnRaw = got.raw || null;
        if (asnId) kvPut(__ASN_KEY, asnId, { n: got.name, ts: now }, __ASN_MAX, asnOk);
      }
    }
  }

  const riskScore = data ? __finiteScore(data.fraudScore) : null;
  const riskTier = __riskTier(riskScore);
  const riskColor = riskTier === null ? null : __RISK_COLORS[isLight ? 'light' : 'dark'][riskTier];

  const d = new Date();
  const stamp = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

  function header(iconSize, size) {
    return {
      type: 'stack',
      direction: 'row',
      children: [
        {
          type: 'stack',
          direction: 'row',
          gap: 6,
          children: [
            { type: 'image', src: 'sf-symbol:airplane', width: iconSize, height: iconSize, color: G },
            { type: 'text', text: strategyGroup, font: { size: size || 'headline', weight: __WT.bold }, textColor: C.text }
          ]
        },
        { type: 'spacer' },
        { type: 'text', text: stamp, font: { size: 'caption1', weight: __WT.med }, textColor: C.muted }
      ]
    };
  }

  function row(label, value, valueColor) {
    return {
      type: 'stack',
      direction: 'row',
      children: [
        { type: 'text', text: label, font: { size: 'caption1', weight: __WT.semi }, textColor: C.muted },
        { type: 'spacer' },
        {
          type: 'text',
          text: value,
          font: { size: 'caption1', weight: __WT.semi },
          textColor: valueColor || (value === __DASH ? gray : C.secondary),
          textAlign: 'right',
          maxLines: 1,
          minScale: 0.8
        }
      ]
    };
  }

  function badge(text, color) {
    const node = {
      type: 'stack',
      direction: 'row',
      padding: [2, 6, 2, 6],
      borderRadius: 999,
      children: [
        { type: 'text', text: text, font: { size: 'caption2', weight: __WT.bold }, textColor: color }
      ]
    };
    if (/^#[0-9A-Fa-f]{6}$/.test(String(color))) node.backgroundColor = String(color) + '1F';
    return node;
  }

  function smPill(text) {
    return {
      type: 'stack',
      direction: 'row',
      padding: [2, 4, 2, 4],
      borderRadius: 999,
      backgroundColor: G + '1F',
      children: [{ type: 'text', text: text, font: { size: __SZ.smBadge, weight: __WT.bold }, textColor: G }]
    };
  }

  function smBadge(text, color) {
    const node = {
      type: 'stack',
      direction: 'row',
      padding: [2, 4, 2, 4],
      borderRadius: 999,
      children: [
        { type: 'text', text: text, font: { size: __SZ.smBadge, weight: __WT.bold }, textColor: color }
      ]
    };
    if (/^#[0-9A-Fa-f]{6}$/.test(String(color))) node.backgroundColor = String(color) + '1F';
    return node;
  }

  function barRow(node) {
    return { type: 'stack', direction: 'row', children: [{ type: 'spacer' }, node] };
  }

  function midRow(node) {
    return { type: 'stack', direction: 'row', children: [{ type: 'spacer' }, node, { type: 'spacer' }] };
  }

  function monoT(text, size, weight, op, extra) {
    const node = { type: 'text', text: text, textColor: __MONO_TEXT, opacity: op };
    if (size) node.font = { size: size, weight: weight || 'regular' };
    return Object.assign(node, extra || {});
  }

  const gray = C.muted;

  const resKnown = !!(data && typeof data.isResidential === 'boolean');
  const bcastKnown = !!(data && typeof data.isBroadcast === 'boolean');

  const networkText = resKnown ? (data.isResidential === true ? '住宅IP' : '机房IP') : __DASH;
  const networkColor = resKnown ? (data.isResidential === true ? G : W) : gray;

  const bcastText = bcastKnown ? (data.isBroadcast === true ? '广播IP' : '原生IP') : __DASH;
  const bcastColor = bcastKnown ? (data.isBroadcast === true ? W : G) : gray;


  const metaDead = dead || !data;
  const scoreDead = metaDead || riskScore === null;
  const netDead = metaDead || !resKnown;
  const bcastDead = metaDead || !bcastKnown;

  const tScore = scoreDead ? __DASH : String(riskScore);
  const cScore = scoreDead ? gray : riskColor;
  const shownIp = data ? (hideIp ? __maskIp(data.ip) : data.ip) : null;
  const tIp = metaDead ? __DASH : (ipWide ? '255.255.255.255' : (shownIp || 'N/A'));
  const tCountry = metaDead ? __DASH : (data.country || 'Unknown');
  const tCity = metaDead ? __DASH : (data.city || 'Unknown');
  const ispFor = (slot, px) => metaDead ? __DASH : (__ispText(data.asn, asnName || data.asOrganization, slot, px) || __DASH);
  const tBcast = bcastDead ? __DASH : bcastText;
  const cBcast = bcastDead ? gray : bcastColor;
  const tLoc = metaDead ? __DASH : (__locTail(data.country, __locTail(data.region, data.city)) || 'Unknown');
  const tNet = netDead ? __DASH : networkText;
  const cNet = netDead ? gray : networkColor;
  const tNetPair = tNet + ' · ' + (bcastDead ? __DASH : bcastText);
  const tCityCity = metaDead
    ? __DASH
    : ((data.countryCode || data.country || __DASH) + (data.city ? ' · ' + data.city : ''));

  diag.f = widgetFamily;
  diag.g = strategyGroup;
  diag.ip = (data && data.ip) ? String(data.ip) : '';
  diag.ipOk = !dead;
  diag.ipStatus = ipStatus;
  diag.ipMs = ipMs;
  diag.score = riskScore;
  diag.res = (data && typeof data.isResidential === 'boolean') ? data.isResidential : null;
  diag.bc = (data && typeof data.isBroadcast === 'boolean') ? data.isBroadcast : null;
  diag.asn = (data && data.asn !== undefined) ? data.asn : null;
  diag.org = (data && data.asOrganization) ? String(data.asOrganization) : '';
  diag.asnName = asnName;
  diag.asnRaw = asnRaw;
  diag.asnHit = asnHit;
  diag.keys = data ? Object.keys(data).join(',') : '';
  diag.dual = dual;
  diag.dualHit = dualHit;
  diag.dualAge = dualAge;
  diag.v4 = dv4;
  diag.v6 = dv6;
  diag.v6exit = isV6;

  function dualBadge() {
    return {
      type: 'stack',
      direction: 'row',
      gap: 4,
      children: [badge('IPv4', G), badge('IPv6', G)]
    };
  }

  function netRow() {
    const kids = [];
    if (isV6) {
      kids.push(dual ? dualBadge() : badge('IPv6 Network', G));
    } else {
      kids.push({
        type: 'stack',
        direction: 'row',
        gap: 4,
        children: [badge(tNet, cNet), badge(tBcast, cBcast)]
      });
    }
    kids.push({ type: 'spacer' });
    kids.push({
      type: 'text',
      text: ispFor('net'),
      font: { size: 'caption2', weight: __WT.semi },
      textColor: metaDead ? gray : C.muted,
      textAlign: 'right',
      maxLines: 1,
      minScale: 0.8
    });
    return { type: 'stack', direction: 'row', gap: 8, children: kids };
  }

  function statusRow() {
    return {
      type: 'stack',
      direction: 'row',
      gap: 6,
      children: [
        { type: 'image', src: 'sf-symbol:checkmark.circle.fill', width: 12, height: 12, color: dead ? gray : G },
        { type: 'text', text: dead ? __DASH : 'Connection Active', font: { size: 'caption2' }, textColor: dead ? gray : C.secondary }
      ]
    };
  }

  function detailBody(head, ipSize, slots, chartH, chartW) {
    return {
      type: 'widget',
      ...bg,
      padding: 12,
      gap: 12,
      children: [
        head,
        { type: 'text', text: 'CURRENT IP', font: { size: 'caption1', weight: __WT.bold }, textColor: C.muted },
        {
          type: 'text',
          text: tIp,
          font: { size: ipSize, weight: __WT.bold },
          textColor: metaDead ? gray : C.text,
          maxLines: 1,
          minScale: 0.6
        },
        netRow(),
        row('运营商', ispFor('large'), metaDead ? gray : C.text),
        row('位置', tLoc, metaDead ? gray : C.text),
        row('风险系数', isV6 ? 'IPv4 Only' : tScore, isV6 ? C.muted : cScore),
        chartRow(slots, chartH, chartW),
        statusRow()
      ]
    };
  }

  if (widgetFamily === 'accessoryCircular') {
    if (egg) {
      const iconNode = { type: 'image', src: __riskIcon(scoreDead ? null : riskScore), width: 40, height: 40 };
      if (scoreDead) iconNode.color = gray;
      return iconNode;
    }
    if (isV6) return { type: 'image', src: __RISK_ICONS.thinking, width: 40, height: 40 };
    return {
      type: 'widget',
      padding: 4,
      gap: 0,
      children: [
        midRow(monoT(tScore, 32, __WT.bold, scoreDead ? __MONO.faint : __MONO.hi, { textAlign: 'center' })),
        midRow(monoT(tNet, 8, __WT.med, netDead ? __MONO.faint : __MONO.weak, { textAlign: 'center', maxLines: 1 }))
      ]
    };
  }

  if (widgetFamily === 'accessoryRectangular') {
    const kids = [];
    const line = (txt, size, weight, op) => monoT(txt, size, weight, op, { maxLines: 1, minScale: 0.75 });
    if (isV6) {
      if (dual) {
        kids.push(line(tCityCity, 16, __WT.bold, metaDead ? __MONO.faint : __MONO.hi));
        kids.push(line(ispFor('rect', 12), 12, __WT.bold, metaDead ? __MONO.faint : __MONO.mid));
        kids.push(line('IPv4 / IPv6', 10, __WT.med, __MONO.weak));
      } else {
        kids.push(line('IPv6 Network', 16, __WT.bold, metaDead ? __MONO.faint : __MONO.hi));
        kids.push(line(tCityCity, 12, __WT.bold, metaDead ? __MONO.faint : __MONO.mid));
        kids.push(line(ispFor('rect'), 10, __WT.med, __MONO.weak));
      }
    } else {
      kids.push(line(tIp, 16, __WT.bold, metaDead ? __MONO.faint : __MONO.hi));
      kids.push(line(tCityCity, 12, __WT.bold, metaDead ? __MONO.faint : __MONO.mid));
      kids.push(line(ispFor('rect', 10), 10, __WT.med, metaDead ? __MONO.faint : __MONO.weak));
      kids.push(line(tNetPair, 10, __WT.med, (netDead || bcastDead) ? __MONO.faint : __MONO.weak));
    }
    return { type: 'widget', padding: [4, 4, 4, 4], gap: 0, children: kids };
  }

  if (widgetFamily === 'accessoryInline') {
    return {
      type: 'widget',
      children: [
        monoT(ispFor('inline'), null, null, metaDead ? __MONO.faint : __MONO.hi, { maxLines: 1 })
      ]
    };
  }

  if (widgetFamily === 'systemSmall') {
    const smV6 = String(tIp).indexOf(':') >= 0;
    const smH = smV6 ? __CHART_H_SM_V6 : __CHART_H_SM;
    const kids = [
      header(14, 12),
      { type: 'spacer' },
      chartRow(6, smH, __CHART_W_SM, true),
      { type: 'spacer' }
    ];
    if (smV6) {
      const smRowF = (node) => ({ type: 'stack', direction: 'row', children: [node, { type: 'spacer' }] });
      const smGroups = String(tIp).split(':').filter(function (g) { return g !== ''; });
      const smIpCut = smGroups.length > 4
        ? smGroups.slice(0, 2).join(':') + ' \u00b7 \u00b7 \u00b7 ' + smGroups.slice(-2).join(':')
        : String(tIp);
      const smIp = (String(tIp).length > 26 || __txtW(tIp, 12) > 132) ? smIpCut : String(tIp);
      kids.push(smRowF({ type: 'text', text: smIp, font: { size: 12, weight: __WT.bold }, textColor: metaDead ? gray : C.text, maxLines: 1 }));
      kids.push(smRowF({ type: 'text', text: tCountry, font: { size: 10, weight: __WT.med }, textColor: metaDead ? gray : C.text, maxLines: 1, minScale: 0.75 }));
      const smPillW = (__txtW('IPv4', __SZ.smBadge) + 8) * (dual ? 2 : 1) + (dual ? 4 : 0);
      const smCityMax = 140 - smPillW - 6;
      const smCityFit = smCityMax / 0.75;
      let smCity = String(tCity);
      if (__txtW(smCity, 10) > smCityFit) {
        while (smCity.length > 1 && __txtW(smCity + '...', 10) > smCityFit) smCity = smCity.slice(0, -1);
        smCity = smCity + '...';
      }
      kids.push({
        type: 'stack',
        direction: 'row',
        gap: 6,
        children: [
          { type: 'text', text: smCity, font: { size: 10, weight: __WT.med }, textColor: metaDead ? gray : C.text, maxLines: 1, minScale: 0.75 },
          { type: 'spacer' },
          { type: 'stack', direction: 'row', gap: 4, children: dual ? [smPill('IPv4'), smPill('IPv6')] : [smPill('IPv6')] }
        ]
      });
    } else {
      const smLeft = Math.max(84, Math.min(100, Math.round(140 - 8 - __txtW(tScore, 32))));
      const smRow = (node) => ({ type: 'stack', direction: 'row', width: smLeft, children: [node, { type: 'spacer' }] });
      kids.push({
        type: 'stack',
        direction: 'row',
        alignItems: 'end',
        gap: 8,
        children: [
          {
            type: 'stack',
            direction: 'column',
            width: smLeft,
            gap: 0,
            children: [
              smRow({ type: 'text', text: tIp, font: { size: 12, weight: __WT.bold }, textColor: metaDead ? gray : C.text, maxLines: 1, minScale: 0.6 }),
              smRow({ type: 'text', text: tCountry, font: { size: 10, weight: __WT.med }, textColor: metaDead ? gray : C.text, maxLines: 1, minScale: 0.75 }),
              smRow({
                type: 'stack',
                direction: 'row',
                padding: [2, 0, 0, 0],
                children: [{
                  type: 'stack',
                  direction: 'row',
                  gap: 4,
                  children: [smBadge(tNet, cNet), smBadge(tBcast, cBcast)]
                }]
              })
            ]
          },
          { type: 'spacer' },
          { type: 'text', text: tScore, font: { size: 32, weight: __WT.light }, textColor: cScore, maxLines: 1, minScale: 0.7 }
        ]
      });
    }
    return { type: 'widget', ...bg, padding: 12, gap: 2, children: kids };
  }

  if (widgetFamily === 'systemMedium') {
    const midV6 = String(tIp).indexOf(':') >= 0;
    const midH = midV6 ? __CHART_H_MID_V6 : __CHART_H_MID;
    const midHeader = header(16, 14);
    const midLoc = {
      type: 'text',
      text: tLoc,
      font: { size: 10, weight: __WT.med },
      textColor: metaDead ? gray : C.text,
      maxLines: 1,
      minScale: 0.8
    };

    if (midV6) {
      const midPill = (t) => ({
        type: 'stack',
        direction: 'row',
        padding: [2, 8, 2, 8],
        borderRadius: 999,
        backgroundColor: G + '1F',
        children: [{ type: 'text', text: t, font: { size: 10, weight: __WT.bold }, textColor: G }]
      });
      const midDual = {
        type: 'stack',
        direction: 'row',
        gap: 4,
        children: [midPill('IPv4'), midPill('IPv6')]
      };
      const midNet = midPill('IPv6 Network');
      return {
        type: 'widget',
        ...bg,
        padding: [12, 12, 12, 12],
        gap: 2,
        children: [
          midHeader,
          { type: 'spacer' },
          chartRow(12, midH, __CHART_W_MID, true),
          { type: 'spacer' },
          {
            type: 'stack',
            direction: 'row',
            children: [{
              type: 'text',
              text: tIp,
              font: { size: 16, weight: __WT.bold },
              textColor: metaDead ? gray : C.text,
              maxLines: 1,
              minScale: 0.9
            }]
          },
          { type: 'stack', direction: 'row', children: [midLoc, { type: 'spacer' }, dual ? midDual : midNet] }
        ]
      };
    }

    return {
      type: 'widget',
      ...bg,
      padding: [12, 12, 12, 12],
      gap: 2,
      children: [
        midHeader,
        { type: 'spacer' },
        chartRow(12, midH, __CHART_W_MID, true),
        { type: 'spacer' },
        {
          type: 'stack',
          direction: 'row',
          children: [
            {
              type: 'text',
              text: tIp,
              font: { size: 24, weight: __WT.bold },
              textColor: metaDead ? gray : C.text,
              maxLines: 1,
              minScale: 0.7
            },
            { type: 'spacer' },
            { type: 'text', text: tScore, font: { size: 20, weight: __WT.bold }, textColor: cScore }
          ]
        },
        {
          type: 'stack',
          direction: 'row',
          gap: 8,
          children: [
            midLoc,
            { type: 'spacer' },
            {
              type: 'stack',
              direction: 'row',
              gap: 4,
              children: [miniBadge(tNet, cNet), miniBadge(tBcast, cBcast)]
            }
          ]
        }
      ]
    };
  }

  if (widgetFamily === 'systemExtraLarge') {
    return detailBody(header(20), 36, 24, __CHART_H_XL, __CHART_W_XL);
  }

  return detailBody(header(18, 16), 32, 12, __CHART_H_LARGE, __CHART_W_LARGE);
}

async function __pushDbg(ctx, payload) {
  if (!__DBG_URL) return;
  try {
    const url = __DBG_URL + '?tag=' + __DBG_TAG + '&t=' + Date.now() + '&d=' + encodeURIComponent(JSON.stringify(payload));
    await ctx.http.get(url, { policy: 'DIRECT', timeout: 2000 });
  } catch (_) {}
}

export default async function (ctx) {
  const diag = {};
  const tree = await __render(ctx, diag);
  await __pushDbg(ctx, diag);
  return tree;
}

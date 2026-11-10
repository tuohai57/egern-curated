// NetSpeed 10s 小组件
// 持续测速 10 秒：每秒记录一次速度，结束后显示平均值与逐秒数据
// 节点显示：整合 IPPure（国家城市 / 运营商 / 住宅原生 / IP 风险评分）

export default async function(ctx) {
  const TEST_SECONDS = 10;
  const CHUNK_MB = 1;
  const CHUNK_BYTES = CHUNK_MB * 1024 * 1024;
  const SPEED_TEST_URL = `https://speed.cloudflare.com/__down?bytes=${CHUNK_BYTES}`;
  const IPPURE_URL = 'https://my.ippure.com/v1/info';
  const IPPURE_CACHE_KEY = 'netspeed_ippure_cache';
  const CACHE_KEY = 'netspeed_10s_cache';

  function clean(value) {
    return String(value === undefined || value === null ? '' : value).trim();
  }

  // ---- 先读缓存，测速失败或进行中时展示上次结果 ----
  let result = { avgMbps: 0, mBs: 0, duration: 0, samples: [], node: null, timestamp: 0 };
  try {
    const cached = ctx.storage.getJSON(CACHE_KEY);
    if (cached && cached.samples) result = cached;
  } catch(e) {}

  // ---- IPPure 节点信息 ----
  // 可通过环境变量 GROUP 指定策略；默认先按规则路由，失败后强制走 Proxy 策略重试
  const IPPURE_POLICY = clean((ctx.env && ctx.env.GROUP) || '') || 'Proxy';
  let pure = null;
  const attempts = [null, IPPURE_POLICY];
  for (let i = 0; i < attempts.length && !pure; i++) {
    try {
      const opts = {
        headers: { 'Cache-Control': 'no-cache' },
        timeout: 8000
      };
      if (attempts[i]) opts.policy = attempts[i];
      const resp = await ctx.http.get(IPPURE_URL, opts);
      if (resp.status === 200) {
        pure = await resp.json();
        if (pure && typeof pure.fraudScore !== 'undefined') {
          let s = Number(pure.fraudScore);
          pure.fraudScore = Number.isFinite(s) ? Math.max(0, Math.min(100, s)) : 99;
        }
        try { ctx.storage.setJSON(IPPURE_CACHE_KEY, { data: pure, ts: Date.now() }); } catch(e) {}
      }
    } catch(e) {}
  }

  // 主请求失败时读缓存
  if (!pure) {
    try {
      const cached = ctx.storage.getJSON(IPPURE_CACHE_KEY);
      if (cached && cached.data) pure = cached.data;
    } catch(e) {}
  }

  // 风险评分 → 文案与颜色（IPPure 6 档）
  let riskText = '';
  let riskColor = '#DC2626';
  const riskScore = pure && Number.isFinite(Number(pure.fraudScore))
    ? Math.max(0, Math.min(100, Number(pure.fraudScore)))
    : null;
  if (riskScore !== null) {
    if (riskScore <= 15) { riskText = '优质'; riskColor = '#22C55E'; }
    else if (riskScore <= 25) { riskText = '良好'; riskColor = '#84CC16'; }
    else if (riskScore <= 40) { riskText = '普通'; riskColor = '#EAB308'; }
    else if (riskScore <= 50) { riskText = '低危'; riskColor = '#F59E0B'; }
    else if (riskScore <= 70) { riskText = '中危'; riskColor = '#F97316'; }
    else { riskText = '高危'; riskColor = '#DC2626'; }
  }

  // 住宅/机房判定
  const resText = pure
    ? (pure.isResidential === true ? '住宅原生' : '机房网络')
    : '';
  const resColor = pure && pure.isResidential === true ? '#34D399' : '#FACC15';

  const node = pure ? {
    country: clean(pure.country),
    city: clean(pure.city),
    isp: clean(pure.asOrganization),
    resText: resText,
    resColor: resColor,
    riskText: riskText,
    riskColor: riskColor
  } : null;
  if (node) result.node = node;

  // ---- 10 秒测速 ----
  const start = Date.now();
  const endAt = start + TEST_SECONDS * 1000;
  let totalBytes = 0;
  const samples = [];
  let lastMark = start;
  let lastBytes = 0;

  // 循环下载 1MB 数据块，直到满 10 秒
  while (Date.now() < endAt) {
    try {
      await ctx.http.get(SPEED_TEST_URL, {
        headers: { 'Cache-Control': 'no-cache' },
        timeout: 10000
      });
      totalBytes += CHUNK_BYTES;
    } catch(e) {
      break;
    }
    // 每跨过 1 秒边界，记录该秒的速度
    const now = Date.now();
    while (now - lastMark >= 1000 && samples.length < TEST_SECONDS) {
      lastMark += 1000;
      const mbps = ((totalBytes - lastBytes) * 8) / 1e6;
      samples.push(parseFloat(mbps.toFixed(1)));
      lastBytes = totalBytes;
    }
  }

  const duration = (Date.now() - start) / 1000;
  // 网络过慢导致不足 10 条时，缺的秒补 0
  while (samples.length < TEST_SECONDS) samples.push(0.0);

  // 测速成功才覆盖缓存（平均值 = 逐秒数据的平均）
  if (totalBytes > 0) {
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const totalMB = totalBytes / 1e6;
    result = {
      avgMbps: parseFloat(avg.toFixed(1)),
      mBs: parseFloat((avg / 8).toFixed(2)),
      duration: parseFloat(duration.toFixed(1)),
      totalMB: parseFloat(totalMB.toFixed(2)),
      unit: totalMB >= 1000 ? 'GB' : 'MB',
      samples: samples,
      node: node,
      timestamp: Date.now()
    };
    try { ctx.storage.setJSON(CACHE_KEY, result); } catch(e) {}
  }

  let icon = 'tortoise';
  let color = '#FF9500';

  if (result.avgMbps >= 50) {
    icon = 'bolt.fill';
    color = '#34C759';
  } else if (result.avgMbps >= 10) {
    icon = 'hare.fill';
    color = '#007AFF';
  }

  let barWidth = 30;
  if (result.avgMbps >= 80) barWidth = 140;
  else if (result.avgMbps >= 50) barWidth = 110;
  else if (result.avgMbps >= 20) barWidth = 80;
  else if (result.avgMbps >= 10) barWidth = 55;

  const now = new Date(result.timestamp || Date.now());
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const family = ctx.widgetFamily || 'systemMedium';
  const isSmall = family === 'systemSmall';
  // 逐秒列表的标题仅在大尺寸显示，中号省下空间防溢出
  const showSampleLabel = family === 'systemLarge' || family === 'systemExtraLarge';

  // 节点显示文本：国家 · 城市（与 IPPure 原版一致）
  const n = result.node || {};
  const addrText = [n.country, n.city].filter(Boolean).join(' · ') || '未知';

  // 总量与均值统一使用比特单位（Mb / Gb 自动切换）
  const totalMb = (result.totalMB || 0) * 8;
  const unit = totalMb >= 1000 ? 'Gb' : 'Mb';
  const totalVal = totalMb >= 1000 ? (totalMb / 1000).toFixed(2) : totalMb.toFixed(1);
  const avgVal = totalMb >= 1000 ? (result.avgMbps / 1000).toFixed(2) : result.avgMbps.toFixed(1);

  // 逐秒数据按每行 5 个排成两行
  function sampleRow(values, offset) {
    const children = [{ type: 'spacer' }];
    values.forEach((v, idx) => {
      children.push({
        type: 'text',
        text: `${offset + idx + 1}s ${Number(v).toFixed(1)}`,
        font: { size: 'caption2' },
        textColor: { light: '#6B6B6B', dark: '#A1A1A6' }
      });
      children.push({ type: 'spacer' });
    });
    return {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      children: children
    };
  }

  const rows = [];
  for (let i = 0; i < result.samples.length; i += 5) {
    rows.push(sampleRow(result.samples.slice(i, i + 5), i));
  }

  const sampleSection = [];
  if (showSampleLabel) {
    sampleSection.push({
      type: 'text',
      text: '每秒测速 (Mbps)',
      font: { size: 'caption2', weight: 'semibold' },
      textColor: { light: '#8E8E93', dark: '#8E8E93' }
    });
  }
  sampleSection.push(...rows);

  // 节点行：地址在左，住宅/机房 + 风险评级在右
  const nodeRowChildren = [
    {
      type: 'image',
      src: 'sf-symbol:mappin.and.ellipse',
      width: isSmall ? 11 : 12,
      height: isSmall ? 11 : 12,
      color: color
    },
    {
      type: 'text',
      text: ` ${addrText}`,
      font: { size: 'caption2', weight: 'medium' },
      textColor: { light: '#3A3A3C', dark: '#C7C7CC' },
      lineLimit: 1
    },
    { type: 'spacer' }
  ];
  if (!isSmall && n.resText) {
    nodeRowChildren.push({
      type: 'text',
      text: n.resText,
      font: { size: 'caption2', weight: 'bold' },
      textColor: n.resColor
    });
    nodeRowChildren.push({
      type: 'text',
      text: '  ',
      font: { size: 'caption2' }
    });
  }
  if (n.riskText) {
    nodeRowChildren.push({
      type: 'text',
      text: n.riskText,
      font: { size: 'caption2', weight: 'bold' },
      textColor: n.riskColor
    });
  }

  return {
    type: 'widget',
    padding: isSmall ? 10 : 10,
    gap: isSmall ? 5 : 3,

    backgroundColor: {
      light: '#FFFFFF',
      dark: '#2C2C2E'
    },

    children: [

      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        children: [
          {
            type: 'image',
            src: `sf-symbol:${icon}`,
            width: isSmall ? 13 : 14,
            height: isSmall ? 13 : 14,
            color: color
          },
          {
            type: 'text',
            text: ' NetSpeed 10s',
            font: { size: 'caption2', weight: 'semibold' },
            textColor: color
          },
          { type: 'spacer' },
          {
            type: 'text',
            text: `↻ ${timeStr}`,
            font: { size: 'caption2' },
            textColor: { light: '#8E8E93', dark: '#8E8E93' }
          }
        ]
      },

      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        children: [
          { type: 'spacer' },
          {
            type: 'text',
            text: `${result.avgMbps} Mbps`,
            font: { size: isSmall ? 22 : 26, weight: 'bold' },
            textColor: color
          },
          { type: 'spacer' }
        ]
      },

      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        children: nodeRowChildren
      },

      {
        type: 'stack',
        direction: 'row',
        children: [
          { type: 'spacer' },
          {
            type: 'stack',
            width: barWidth,
            height: 3,
            backgroundColor: color,
            cornerRadius: 1.5
          },
          { type: 'spacer' }
        ]
      }
    ]
    .concat(isSmall ? [] : sampleSection)
    .concat([
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        children: [
          {
            type: 'text',
            text: '总量 ',
            font: { size: 'caption2' },
            textColor: { light: '#6B6B6B', dark: '#A1A1A6' }
          },
          {
            type: 'text',
            text: `${totalVal} ${unit}`,
            font: { size: 'caption2', weight: 'bold' },
            textColor: color
          },
          {
            type: 'text',
            text: '  均值 ',
            font: { size: 'caption2' },
            textColor: { light: '#6B6B6B', dark: '#A1A1A6' }
          },
          {
            type: 'text',
            text: `${avgVal} ${unit}ps`,
            font: { size: 'caption2', weight: 'bold' },
            textColor: color
          },
          { type: 'spacer' },
          {
            type: 'text',
            text: `耗时 ${result.duration}s`,
            font: { size: 'caption2' },
            textColor: { light: '#6B6B6B', dark: '#A1A1A6' }
          }
        ]
      }
    ])
  };
}

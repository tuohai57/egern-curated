/**
 * 机场订阅流量监控小组件 - 中号尺寸优化版
 * 
 * 📝 使用说明：
 * 
 * 1️⃣ 添加环境变量（在 Egern 中进入"编辑环境变量"）：
 * 
 *    格式：名称（大写）= 值
 * 
 *    NAME1 = 翻墙                    # 机场名称（自定义）
 *    URL1 = https://xxx.com/sub...   # 订阅地址（必填）
 *    RESET1 = 1                      # 重置日（可选，每月1日重置）
 * 
 *    NAME2 = 机场B
 *    URL2 = https://yyy.com/sub...
 *    RESET2 = 15                     # 每月15日重置
 * 
 *    ... 最多支持 5 个机场（NAME1-5, URL1-5, RESET1-5）
 * 
 * 2️⃣ 参数说明：
 *    - NAME1-5：机场名称，显示在卡片上（必填，否则显示"机场订阅"）
 *    - URL1-5：订阅地址，从机场后台复制（必填）
 *    - RESET1-5：流量重置日，1-28 的数字（可选）
 * 
 * 3️⃣ 示例：
 *    NAME1 = 翻墙
 *    URL1 = https://example.com/sub?token=abc123
 *    RESET1 = 1
 * 
 *    NAME2 = 备用机场
 *    URL2 = https://example2.com/sub?token=def456
 * 
 * 4️⃣ 注意事项：
 *    - 环境变量名称必须大写（NAME1、URL1 等）
 *    - 至少需要配置 URL1 才能显示
 *    - 订阅地址需要包含完整的 token
 *    - 小组件每4小时自动刷新
 *    - 自动适配系统深色/浅色模式（无需配置）
 *    - 本版本针对中号小组件（Medium）优化，3个机场显示效果最佳
 * 
 * @author 机场订阅监控
 * @version 3.4.0
 */

export default async function (ctx) {
  const MAX = 5;
  const slots = [];

  for (let i = 1; i <= MAX; i++) {
    const url = (ctx.env[`URL${i}`] || "").trim();
    if (!url) continue;
    slots.push({
      name: (ctx.env[`NAME${i}`] || "").trim() || inferName(url),
      url,
      resetDay: parseInt(ctx.env[`RESET${i}`] || "", 10) || null,
    });
  }

  // 刷新间隔：4小时
  const refreshTime = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  // ✅ Egern 原生深浅色配置（自动切换）
  const colors = {
    bgCard: { light: "#FFFFFF", dark: "#2C2C2E" },
    bgCardBorder: { light: "#E5E5E7", dark: "#3A3A3C" },
    textPrimary: { light: "#1D1D1F", dark: "#FFFFFF" },
    textSecondary: { light: "#666666", dark: "#EBEBF5" },
    textTertiary: { light: "#999999", dark: "#AEAEB2" },
    textMuted: { light: "#CCCCCC", dark: "#636366" },
    iconPrimary: { light: "#5856D6", dark: "#5856D6" },
    iconSecondary: { light: "#8E8E93", dark: "#8E8E93" },
    iconMuted: { light: "#D1D1D6", dark: "#48484A" },
    error: { light: "#FF3B30", dark: "#FF453A" },
    warning: { light: "#FF9500", dark: "#FF9F0A" },
    success: { light: "#34C759", dark: "#30D158" },
    progressBg: { light: "#E5E5EA", dark: "#3A3A3C" },
  };

  const bgGradient = {
    type: "linear",
    colors: [
      { light: "#F5F5F7", dark: "#1C1C1E" },
      { light: "#FFFFFF", dark: "#2C2C2E" },
      { light: "#F8F8FA", dark: "#1C1C1E" },
      { light: "#FFFFFF", dark: "#2C2C2E" },
    ],
    stops: [0, 0.35, 0.7, 1],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 0.8, y: 1 },
  };

  if (!slots.length) {
    return {
      type: "widget",
      padding: 8,
      gap: 1,
      backgroundGradient: bgGradient,
      refreshAfter: refreshTime,
      children: [
        {
          type: "stack",
          direction: "row",
          alignItems: "center",
          gap: 2,
          children: [
            {
              type: "image",
              src: "sf-symbol:chart.bar.fill",
              width: 8,
              height: 2,
              color: colors.iconPrimary,
            },
            {
              type: "text",
              text: "订阅流量",
              font: { size: "caption1", weight: "semibold" },
              textColor: colors.textSecondary,
            },
          ],
        },
        { type: "spacer" },
        {
          type: "text",
          text: "请配置 URL1 环境变量",
          font: { size: "caption1" },
          textColor: colors.error,
          textAlign: "center",
        },
      ],
    };
  }

  // 获取所有订阅信息
  const results = await Promise.all(slots.map((s) => fetchInfo(ctx, s)));

  // 计算总流量统计（仅统计成功获取且总量>0的订阅）
  const validResults = results.filter(r => !r.error && r.totalBytes && r.totalBytes > 0);
  let summary = null;
  if (validResults.length > 0) {
    const totalUsed = validResults.reduce((sum, r) => sum + r.used, 0);
    const totalTotal = validResults.reduce((sum, r) => sum + r.totalBytes, 0);
    const totalPercent = totalTotal > 0 ? (totalUsed / totalTotal) * 100 : 0;
    const totalRemain = totalTotal - totalUsed;
    summary = {
      used: totalUsed,
      total: totalTotal,
      percent: totalPercent,
      remain: totalRemain,
      count: validResults.length,
    };
  }

  // 构建卡片列表
  const cards = results.map((r) => buildCard(r, slots.length, colors));

  // 汇总卡片（如果有有效数据）
  const summaryCard = summary ? buildSummary(summary, colors) : null;

  // 组装最终视图（中号优化：减小整体padding和间距）
  const children = [
    // 顶部标题栏（高度保持不变，但整体padding已缩小）
    {
      type: "stack",
      direction: "row",
      alignItems: "center",
      gap: 3,
      children: [
        {
          type: "image",
          src: "sf-symbol:chart.bar.fill",
          width: 8,
          height: 8,
          color: colors.iconPrimary,
        },
        {
          type: "text",
          text: "订阅流量",
          font: { size: "caption1", weight: "semibold" },
          textColor: colors.textSecondary,
        },
        { type: "spacer" },
        {
          type: "image",
          src: "sf-symbol:clock",
          width: 11,
          height: 8,
          color: colors.iconMuted,
        },
        {
          type: "text",
          text: timeStr,
          font: { size: "caption2" },
          textColor: colors.textTertiary,
        },
      ],
    },
  ];

  // 插入汇总卡片（如果存在）
  if (summaryCard) {
    children.push(summaryCard);
  }

  // 插入卡片列表，添加紧凑间距
  children.push({
    type: "stack",
    direction: "column",
    gap: slots.length === 1 ? 0 : 3,   // 从4减至3
    children: cards,
  });

  children.push({ type: "spacer" });

  return {
    type: "widget",
    padding: [10, 12, 8, 12],           // 上下左右均缩小
    backgroundGradient: bgGradient,
    refreshAfter: refreshTime,
    children,
  };
}

// ─── 汇总卡片构建（纯文字，无进度条） ──────────────────────────

function buildSummary(summary, colors) {
  const { used, total, percent, remain } = summary;
  const usageColor =
    percent >= 90
      ? colors.error
      : percent >= 70
      ? colors.warning
      : colors.success;

  return {
    type: "stack",
    direction: "row",
    alignItems: "center",
    padding: [5, 10, 5, 10],
    backgroundColor: colors.bgCard,
    borderRadius: 11,
    borderWidth: 0.5,
    borderColor: colors.bgCardBorder,
    children: [
      {
        type: "text",
        text: "📊 总流量",
        font: { size: "caption1", weight: "semibold" },
        textColor: colors.textPrimary,
      },
      { type: "spacer" },
      {
        type: "stack",
        direction: "row",
        gap: 6,
        alignItems: "center",
        children: [
          {
            type: "text",
            text: `${bytesToSize(used)} / ${bytesToSize(total)}`,
            font: { size: "caption2", weight: "medium" },
            textColor: colors.textSecondary,
          },
          {
            type: "text",
            text: `${percent.toFixed(1)}%`,
            font: { size: "caption2", weight: "semibold" },
            textColor: usageColor,
          },
          {
            type: "text",
            text: `剩余 ${bytesToSize(remain)}`,
            font: { size: "caption2" },
            textColor: colors.textMuted,
          },
        ],
      },
    ],
  };
}

// ─── 单个卡片构建（连续进度条，紧凑版） ──────────────────────

function buildCard(result, total, colors) {
  const { name, error, used, totalBytes, percent, expire, remainDays } = result;

  const usageColor =
    error
      ? colors.error
      : percent >= 90
      ? colors.error
      : percent >= 70
      ? colors.warning
      : colors.success;

  // 错误卡片
  if (error) {
    return {
      type: "stack",
      direction: "row",
      alignItems: "center",
      gap: 6,
      padding: [7, 10, 7, 10],        // 与正常卡片一致
      backgroundColor: colors.bgCard,
      borderRadius: 11,
      borderWidth: 0.5,
      borderColor: { light: colors.error.light + "40", dark: colors.error.dark + "40" },
      children: [
        {
          type: "image",
          src: "sf-symbol:exclamationmark.circle.fill",
          width: 12,
          height: 12,
          color: colors.error,
        },
        {
          type: "text",
          text: name,
          font: { size: "caption1", weight: "semibold" },
          textColor: colors.textPrimary,
          maxLines: 1,
          minScale: 0.8,
          flex: 1,
        },
        {
          type: "text",
          text: "获取失败",
          font: { size: "caption2" },
          textColor: colors.error,
        },
      ],
    };
  }

  // 到期文字
  let expireText = "";
  let expireColor = colors.textMuted;
  if (expire) {
    const daysLeft = Math.ceil((expire * 1000 - Date.now()) / 86400000);
    if (daysLeft < 0) {
      expireText = "已到期";
      expireColor = colors.error;
    } else if (daysLeft <= 7) {
      expireText = `${daysLeft}天后到期`;
      expireColor = colors.warning;
    } else {
      expireText = formatDate(expire);
    }
  } else if (remainDays !== null) {
    expireText = `${remainDays}天重置`;
    expireColor = remainDays <= 3 ? colors.warning : colors.textMuted;
  }

  const isSingle = total === 1;
  const clampedPercent = Math.min(Math.max(percent, 0), 100);
  // 更细的进度条
  const barHeight = isSingle ? 4 : 3;

  return {
    type: "stack",
    direction: "column",
    gap: 0,
    padding: isSingle ? [9, 12, 9, 12] : [7, 10, 7, 10],   // 进一步压缩
    backgroundColor: colors.bgCard,
    borderRadius: 11,
    borderWidth: 0.5,
    borderColor: colors.bgCardBorder,
    children: [
      // ── 第一行：名称 + 到期 ──
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 5,
        children: [
          {
            type: "image",
            src: "sf-symbol:dot.radiowaves.left.and.right",
            width: 12,
            height: 12,
            color: usageColor,
          },
          {
            type: "text",
            text: name,
            font: { size: "caption1", weight: "semibold" },
            textColor: colors.textPrimary,
            maxLines: 1,
            minScale: 0.75,
            flex: 1,
          },
          ...(expireText
            ? [
                {
                  type: "text",
                  text: expireText,
                  font: { size: "caption2" },
                  textColor: expireColor,
                },
              ]
            : []),
        ],
      },

      // ── 间距（缩小） ──
      {
        type: "stack",
        direction: "row",
        height: 6,                     // 原10
        children: [],
      },

      // ── 第二行：连续进度条 ──
      {
        type: "stack",
        direction: "row",
        gap: 0,
        alignItems: "center",
        children: [
          ...(clampedPercent > 0
            ? [
                {
                  type: "stack",
                  flex: clampedPercent,
                  height: barHeight,
                  backgroundColor: usageColor,
                  borderRadius: 99,
                  children: [],
                },
              ]
            : []),
          ...(clampedPercent < 100
            ? [
                {
                  type: "stack",
                  flex: 100 - clampedPercent,
                  height: barHeight,
                  backgroundColor: colors.progressBg,
                  borderRadius: 99,
                  children: [],
                },
              ]
            : []),
        ],
      },

      // ── 间距（缩小） ──
      {
        type: "stack",
        direction: "row",
        height: 3,                     // 原5
        children: [],
      },

      // ── 第三行：用量 + 百分比 ──
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: [
          {
            type: "text",
            text: `${bytesToSize(used)} / ${bytesToSize(totalBytes)}`,
            font: { size: "caption2", weight: "medium" },
            textColor: colors.textSecondary,
          },
          { type: "spacer" },
          {
            type: "text",
            text: `${percent.toFixed(1)}%`,
            font: { size: "caption2", weight: "semibold" },
            textColor: usageColor,
          },
        ],
      },
    ],
  };
}

// ─── 网络请求 ─────────────────────────────────────────────────

const UA_LIST = [
  { "User-Agent": "Quantumult%20X/1.5.2" },
  { "User-Agent": "clash-verge-rev/2.3.1", Accept: "application/x-yaml,text/plain,*/*" },
  { "User-Agent": "mihomo/1.19.3", Accept: "application/x-yaml,text/plain,*/*" },
];

async function fetchInfo(ctx, slot) {
  const urls = buildVariants(slot.url);

  for (const method of ["head", "get"]) {
    for (const url of urls) {
      for (const headers of UA_LIST) {
        try {
          const resp = await ctx.http[method](url, { headers, timeout: 9000 });
          const raw = resp.headers.get("subscription-userinfo") || "";
          const info = parseUserInfo(raw);
          if (info) {
            const used = (info.upload || 0) + (info.download || 0);
            const totalBytes = info.total || 0;
            const percent = totalBytes > 0 ? (used / totalBytes) * 100 : 0;
            return {
              name: slot.name,
              error: null,
              used,
              totalBytes,
              percent,
              expire: info.expire || null,
              remainDays: slot.resetDay ? getRemainingDays(slot.resetDay) : null,
            };
          }
        } catch (_) {}
      }
    }
  }

  return { name: slot.name, error: true };
}

function buildVariants(url) {
  const seen = new Set();
  const out = [];
  const add = (u) => {
    if (u && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  };
  add(url);
  add(withParam(url, "flag", "clash"));
  add(withParam(url, "flag", "meta"));
  add(withParam(url, "target", "clash"));
  return out;
}

function withParam(url, key, value) {
  return `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

function parseUserInfo(header) {
  if (!header) return null;
  const pairs = header.match(/\w+=[\d.eE+-]+/g) || [];
  if (!pairs.length) return null;
  return Object.fromEntries(
    pairs.map((p) => {
      const [k, v] = p.split("=");
      return [k, Number(v)];
    })
  );
}

// ─── 工具函数 ─────────────────────────────────────────────────

function bytesToSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function formatDate(ts) {
  const d = new Date(ts > 1e12 ? ts : ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getRemainingDays(resetDay) {
  const now = new Date();
  const day = now.getDate();
  let next = new Date(now.getFullYear(), now.getMonth(), resetDay);
  if (day >= resetDay) next = new Date(now.getFullYear(), now.getMonth() + 1, resetDay);
  return Math.max(0, Math.ceil((next - now) / 86400000));
}

function inferName(url) {
  return "机场订阅";
}
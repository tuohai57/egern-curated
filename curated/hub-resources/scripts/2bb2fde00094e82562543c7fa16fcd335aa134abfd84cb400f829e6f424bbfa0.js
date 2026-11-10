// 1) author: 𝕏Panda 首要显示：国际黄金（人民币/克）当日价 + 近30日均价
// 2) 展示金店：周大福 / 六福珠宝 / 周生生
// 3) 展示现货：国际黄金 / 国际白银 / 上海黄金 / 上海白银
// 4) 统一人民币单价（元/克），不展示盎司价格
// 5) 2026-03-12 23:21:46

const PAGE_URL = "https://www.ip138.com/gold/";
const SHOPS = ["周大福", "六福珠宝", "周生生"];
const MARKETS = [
  "国际黄金现货",
  "国际白银现货",
  "上海黄金现货",
  "上海白银现货",
];

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function avg(arr) {
  if (!arr || arr.length === 0) return null;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function pctText(v) {
  if (v === null || !Number.isFinite(v)) return "--";
  const x = round2(v);
  return (x >= 0 ? "+" : "") + x + "%";
}

function priceText(v) {
  return v === null || !Number.isFinite(v) ? "--" : "¥" + round2(v);
}

async function readText(resp) {
  try {
    if (!resp) return "";
    if (typeof resp === "string") return resp;
    if (typeof resp.text === "function") {
      const t = await resp.text();
      if (typeof t === "string") return t;
    }
    if (typeof resp.body === "string") return resp.body;
    if (resp.body && typeof resp.body.text === "function") {
      const t2 = await resp.body.text();
      if (typeof t2 === "string") return t2;
    }
    if (typeof resp.data === "string") return resp.data;
  } catch (e) {
    console.log("【贵金属】readText失败: " + (e && e.message ? e.message : e));
  }
  return "";
}

function parseShopRealtime(html) {
  const out = {};

  // 按目标金店逐个匹配，避免被表头/其他 span 干扰
  for (let i = 0; i < SHOPS.length; i++) {
    const name = SHOPS[i];
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      "<span>\\s*" +
        safe +
        '\\s*<\\/span>[\\s\\S]{0,1200}?<td[^>]*data-value=\\"([\\d.]+)\\"',
    );
    const m = html.match(re);
    if (m && m[1] !== undefined) {
      const p = toNum(m[1]);
      if (p !== null) out[name] = p;
    }
  }

  return out;
}

function parseShopAvg30(html) {
  const out = {};

  for (let i = 0; i < SHOPS.length; i++) {
    const name = SHOPS[i];
    const encoded = name
      .split("")
      .map((ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"))
      .join("");

    const re = new RegExp(
      '"name":"' + encoded + '","series":\\[([\\s\\S]*?)\\]\\}',
    );
    const mm = html.match(re);
    if (!mm || !mm[1]) continue;

    const vals = [];
    const vr = /"value":(null|[\d.]+)/g;
    let vm;
    while ((vm = vr.exec(mm[1])) !== null) {
      const v = toNum(vm[1]);
      if (v !== null) vals.push(v);
    }
    const a = avg(vals);
    if (a !== null) out[name] = round2(a);
  }

  return out;
}

function parseMarketsCnyPerGram(html) {
  const out = {};
  for (let i = 0; i < MARKETS.length; i++) {
    const n = MARKETS[i];
    const re = new RegExp(
      "<td>\\s*" +
        n +
        '\\s*<\\/td>[\\s\\S]{0,500}?<span class="value">([\\d.]+)<\\/span>[\\s\\S]{0,260}?<span class="value">([\\d.]+)<\\/span>',
    );
    const m = html.match(re);
    if (m) {
      out[n] = {
        tradeRaw: toNum(m[1]),
        cnyPerGram: toNum(m[2]),
      };
    }
  }
  return out;
}

function parseUpdate(html) {
  const m = html.match(
    /<span>\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*<\/span>/,
  );
  return m ? m[1] : "";
}

async function fetchUsdCnh(ctx) {
  try {
    const u =
      "https://push2.eastmoney.com/api/qt/stock/get?secid=133.USDCNH&fields=f43";
    const r = await ctx.http.get(u, { timeout: 10000 });
    const t = await readText(r);
    const j = JSON.parse(t);
    const raw = j && j.data ? toNum(j.data.f43) : null;
    if (raw === null) return null;
    return raw / 10000;
  } catch (e) {
    console.log("【贵金属】汇率获取失败");
    return null;
  }
}

async function fetchIntlGoldAvg30Cny(ctx, usdcnh) {
  try {
    if (usdcnh === null) return null;
    const url =
      "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=122.XAU&klt=101&fqt=0&lmt=30&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58";
    const r = await ctx.http.get(url, { timeout: 12000 });
    const t = await readText(r);
    const j = JSON.parse(t);
    const lines = j && j.data && j.data.klines ? j.data.klines : null;
    if (!lines || lines.length === 0) return null;

    const vals = [];
    for (let i = 0; i < lines.length; i++) {
      const p = String(lines[i]).split(",");
      if (p.length < 3) continue;
      const closeUsdPerOz = toNum(p[2]);
      if (closeUsdPerOz === null) continue;
      const cnyPerGram = (closeUsdPerOz * usdcnh) / 31.1034768;
      vals.push(cnyPerGram);
    }
    const a = avg(vals);
    return a === null ? null : round2(a);
  } catch (e) {
    console.log("【贵金属】国际黄金30日均价获取失败");
    return null;
  }
}

function buildData(html) {
  const shopRt = parseShopRealtime(html);
  const shopAvg = parseShopAvg30(html);
  const markets = parseMarketsCnyPerGram(html);

  const shops = [];
  for (let i = 0; i < SHOPS.length; i++) {
    const name = SHOPS[i];
    const p = shopRt[name] !== undefined ? shopRt[name] : null;
    const a = shopAvg[name] !== undefined ? shopAvg[name] : null;
    let diff = null;
    if (p !== null && a !== null && a > 0) diff = ((p - a) / a) * 100;
    shops.push({ name, price: p, avg30: a, diffPct: diff });
  }

  return {
    shops,
    markets,
    update: parseUpdate(html),
  };
}

function errorWidget(msg) {
  return {
    type: "widget",
    padding: 14,
    backgroundColor: "#1A1A2E",
    children: [
      { type: "spacer" },
      {
        type: "image",
        src: "sf-symbol:exclamationmark.triangle.fill",
        width: 22,
        height: 22,
        color: "#FF453A",
      },
      { type: "spacer", length: 6 },
      {
        type: "text",
        text: "贵金属数据暂不可用",
        font: { size: 13, weight: "semibold" },
        textColor: "#FFFFFF",
      },
      {
        type: "text",
        text: msg || "请稍后刷新",
        font: { size: 11 },
        textColor: "#FFFFFF99",
      },
      { type: "spacer" },
    ],
    refreshAfter: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };
}

function marketShortName(n) {
  if (n === "国际黄金现货") return "国际黄金";
  if (n === "国际白银现货") return "国际白银";
  if (n === "上海黄金现货") return "上海黄金";
  if (n === "上海白银现货") return "上海白银";
  return n;
}

function buildSmall(data, intlGoldToday, intlGoldAvg30) {
  const diff =
    intlGoldToday !== null && intlGoldAvg30 !== null && intlGoldAvg30 > 0
      ? ((intlGoldToday - intlGoldAvg30) / intlGoldAvg30) * 100
      : null;
  const diffColor =
    diff === null ? "#FFFFFF99" : diff >= 0 ? "#34C759" : "#FF453A";

  const s1 = data.shops[0];
  const s2 = data.shops[1];
  const s3 = data.shops[2];
  const m1 = data.markets["国际白银现货"];
  const m2 = data.markets["上海黄金现货"];
  const m3 = data.markets["上海白银现货"];

  return {
    type: "widget",
    direction: "column",
    alignItems: "start",
    justifyContent: "start",
    padding: [0, 8, 3, 8],
    gap: 0,
    backgroundGradient: {
      type: "linear",
      colors: ["#111329", "#1A1F45", "#252B5C"],
      stops: [0, 0.55, 1],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 },
    },
    refreshAfter: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    children: [
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: [
          {
            type: "image",
            src: "sf-symbol:chart.line.uptrend.xyaxis",
            width: 11,
            height: 11,
            color: "#FFD60A",
          },
          { type: "spacer", length: 2 },
          {
            type: "text",
            text: "金银看板（人民币/克）",
            font: { size: 15, weight: "semibold" },
            textColor: "#FFFFFF",
            lineLimit: 1,
          },
        ],
      },
      {
        type: "text",
        text: "国际黄金",
        font: { size: 9.2, weight: "medium" },
        textColor: "#FFFFFFC7",
        lineLimit: 1,
      },
      {
        type: "stack",
        direction: "row",
        alignItems: "end",
        children: [
          {
            type: "text",
            text: priceText(intlGoldToday),
            font: { size: 17, weight: "bold" },
            textColor: "#FFD60A",
            minScale: 0.72,
            lineLimit: 1,
          },
          { type: "spacer" },
          {
            type: "text",
            text: "30日均 " + priceText(intlGoldAvg30),
            font: { size: 8.8 },
            textColor: "#FFFFFFB3",
            lineLimit: 1,
            minScale: 0.8,
          },
        ],
      },
      {
        type: "text",
        text: "较30日均价 " + pctText(diff),
        font: { size: 9.5, weight: "medium" },
        textColor: diffColor,
        lineLimit: 1,
      },
      { type: "spacer", length: 1 },
      {
        type: "text",
        text:
          "周大福" +
          priceText(s1 ? s1.price : null) +
          "  六福" +
          priceText(s2 ? s2.price : null) +
          "  周生生" +
          priceText(s3 ? s3.price : null),
        font: { size: 7.8 },
        textColor: "#FFFFFFD0",
        lineLimit: 1,
        minScale: 0.82,
      },
      { type: "spacer", length: 1 },
      {
        type: "text",
        text:
          "银/沪金/沪银: " +
          priceText(m1 ? m1.cnyPerGram : null) +
          " / " +
          priceText(m2 ? m2.cnyPerGram : null) +
          " / " +
          priceText(m3 ? m3.cnyPerGram : null),
        font: { size: 7.8 },
        textColor: "#FFFFFFBC",
        lineLimit: 1,
        minScale: 0.82,
      },
      { type: "spacer" },
    ],
  };
}

function buildMedium(data, intlGoldToday, intlGoldAvg30) {
  const diff =
    intlGoldToday !== null && intlGoldAvg30 !== null && intlGoldAvg30 > 0
      ? ((intlGoldToday - intlGoldAvg30) / intlGoldAvg30) * 100
      : null;
  const diffColor =
    diff === null ? "#FFFFFF99" : diff >= 0 ? "#34C759" : "#FF453A";

  const shopRows = [];
  for (let i = 0; i < data.shops.length; i++) {
    const s = data.shops[i];
    shopRows.push({
      type: "stack",
      direction: "row",
      alignItems: "center",
      children: [
        {
          type: "text",
          text: s.name,
          font: { size: 10.5, weight: "medium" },
          textColor: "#FFFFFFE3",
          lineLimit: 1,
        },
        { type: "spacer" },
        {
          type: "text",
          text: priceText(s.price),
          font: { size: 10.8, weight: "semibold" },
          textColor: "#FFD60A",
          lineLimit: 1,
        },
      ],
    });
  }

  const marketRows = [];
  for (let i = 0; i < MARKETS.length; i++) {
    const n = MARKETS[i];
    const m = data.markets[n];
    marketRows.push({
      type: "stack",
      direction: "row",
      alignItems: "center",
      children: [
        {
          type: "text",
          text: marketShortName(n),
          font: { size: 10.3 },
          textColor: "#FFFFFFD0",
          lineLimit: 1,
        },
        { type: "spacer" },
        {
          type: "text",
          text: priceText(m ? m.cnyPerGram : null),
          font: { size: 10.3, weight: "semibold" },
          textColor: "#64D2FF",
          lineLimit: 1,
        },
      ],
    });
  }

  return {
    type: "widget",
    direction: "column",
    alignItems: "start",
    justifyContent: "start",
    padding: [0, 10, 4, 10],
    gap: 0,
    backgroundGradient: {
      type: "linear",
      colors: ["#111329", "#1A1F45", "#252B5C"],
      stops: [0, 0.55, 1],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 },
    },
    refreshAfter: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    children: [
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: [
          {
            type: "image",
            src: "sf-symbol:crown.fill",
            width: 12,
            height: 12,
            color: "#FFD60A",
          },
          { type: "spacer", length: 2 },
          {
            type: "text",
            text: "金银看板（人民币/克）",
            font: { size: 12, weight: "semibold" },
            textColor: "#FFFFFF",
            lineLimit: 1,
          },
          { type: "spacer" },
          {
            type: "text",
            text: data.update ? data.update.slice(11, 16) : "",
            font: { size: 9 },
            textColor: "#FFFFFF99",
          },
        ],
      },
      {
        type: "stack",
        direction: "row",
        alignItems: "end",
        children: [
          {
            type: "text",
            text: "国际黄金 " + priceText(intlGoldToday),
            font: { size: 17, weight: "bold" },
            textColor: "#FFD60A",
            lineLimit: 1,
            minScale: 0.72,
          },
          { type: "spacer" },
          {
            type: "text",
            text: "30日均价 " + priceText(intlGoldAvg30),
            font: { size: 10 },
            textColor: "#FFFFFFB3",
            lineLimit: 1,
          },
        ],
      },
      {
        type: "text",
        text: "较30日均价 " + pctText(diff),
        font: { size: 10.5, weight: "medium" },
        textColor: diffColor,
        lineLimit: 1,
      },
      {
        type: "stack",
        direction: "row",
        gap: 10,
        children: [
          {
            type: "stack",
            direction: "column",
            gap: 1,
            flex: 1,
            children: [
              {
                type: "text",
                text: "金店（当日）",
                font: { size: 10 },
                textColor: "#FFFFFF9A",
                lineLimit: 1,
              },
              {
                type: "stack",
                direction: "column",
                gap: 1,
                children: shopRows,
              },
            ],
          },
          {
            type: "stack",
            direction: "column",
            gap: 1,
            flex: 1,
            children: [
              {
                type: "text",
                text: "现货（当日）",
                font: { size: 10 },
                textColor: "#FFFFFF9A",
                lineLimit: 1,
              },
              {
                type: "stack",
                direction: "column",
                gap: 1,
                children: marketRows,
              },
            ],
          },
        ],
      },
      { type: "spacer" },
    ],
  };
}

function buildInline(data, intlGoldToday) {
  const s1 = data.shops[0];
  const p = s1 ? priceText(s1.price) : "--";
  return {
    type: "widget",
    refreshAfter: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    children: [
      {
        type: "text",
        text: "国际金 " + priceText(intlGoldToday) + " | 周大福 " + p,
        font: { size: 12 },
      },
    ],
  };
}

export default async function (ctx) {
  const family = ctx.widgetFamily || "systemMedium";
  console.log("【贵金属】family=" + family);

  try {
    const resp = await ctx.http.get(PAGE_URL, {
      timeout: 12000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        Referer: "https://www.ip138.com/",
      },
    });

    const html = await readText(resp);
    console.log("【贵金属】html长度=" + (html ? html.length : 0));
    if (!html || html.length < 500) return errorWidget("页面内容为空");

    const data = buildData(html);

    // 国际黄金当日人民币/克：优先取表格换算价
    const ig = data.markets["国际黄金现货"];
    const intlGoldToday = ig && ig.cnyPerGram !== null ? ig.cnyPerGram : null;

    // 国际黄金30日均价（人民币/克）
    const fx = await fetchUsdCnh(ctx);
    const intlGoldAvg30 = await fetchIntlGoldAvg30Cny(ctx, fx);

    console.log(
      "【贵金属】国际黄金当日=" +
        intlGoldToday +
        " 30日均=" +
        intlGoldAvg30 +
        " fx=" +
        fx,
    );

    if (family === "systemSmall")
      return buildSmall(data, intlGoldToday, intlGoldAvg30);
    if (family === "accessoryInline") return buildInline(data, intlGoldToday);

    // 默认中号为主
    return buildMedium(data, intlGoldToday, intlGoldAvg30);
  } catch (e) {
    console.log("【贵金属】异常: " + (e && e.message ? e.message : e));
    return errorWidget("网络或解析异常");
  }
}

// Independent Egern connectivity diagnostics. Author: tuohai57. License: MIT.
// A successful probe does not establish account, regional or paid-service access.
export const services = [
  {name: '苹果智能', policy: 'Apple智能', url: 'https://apple-relay.apple.com/'},
  {name: '聊天助手', policy: 'ChatGPT', url: 'https://chatgpt.com/'},
  {name: '克劳德', policy: 'Claude', url: 'https://claude.ai/'},
  {name: '双子座', policy: 'Gemini', url: 'https://gemini.google.com/'},
  {name: '格罗克', policy: 'Grok', url: 'https://grok.com/'},
  {name: '谷歌国际', policy: 'Google 国外', url: 'https://www.google.com/generate_204'},
  {name: '油管', policy: 'YouTube', url: 'https://www.youtube.com/generate_204'},
  {name: '奈飞', policy: 'Netflix', url: 'https://www.netflix.com/'}
];

export function classify(status, error = false) {
  if (error) return {text: '连接失败', color: '#EF4444'};
  if (!Number.isInteger(status) || status < 100 || status > 599)
    return {text: '无有效响应', color: '#F59E0B'};
  if (status === 401 || status === 403 || status === 429)
    return {text: `受限或验证 ${status}`, color: '#F59E0B'};
  if (status >= 500) return {text: `服务异常 ${status}`, color: '#EF4444'};
  if (status >= 400) return {text: `接口响应 ${status}`, color: '#F59E0B'};
  if (status >= 300) return {text: `重定向 ${status}`, color: '#F59E0B'};
  if (status >= 200) return {text: `可达 ${status}`, color: '#22C55E'};
  return {text: `临时响应 ${status}`, color: '#F59E0B'};
}

export async function probe(ctx, service) {
  const start = Date.now();
  try {
    const response = await ctx.http.get(service.url, {
      policy: service.policy, timeout: 7000, redirect: 'manual',
      credentials: 'omit', insecureTls: false,
      headers: {'Cache-Control': 'no-cache'}
    });
    return {...service, ...classify(response?.status), elapsed: Date.now() - start};
  } catch {
    return {...service, ...classify(null, true), elapsed: Date.now() - start};
  }
}

export default async function(ctx) {
  const result = await Promise.all(services.map(service => probe(ctx, service)));
  const small = String(ctx.widgetFamily || '').toLowerCase().includes('small');
  const rows = result.slice(0, small ? 4 : result.length);
  return {
    type: 'widget', backgroundColor: {light: '#F8FAFC', dark: '#0F172A'},
    padding: [12, 12, 12, 12], gap: small ? 5 : 7,
    children: [
      {type: 'text', text: '服务分流自检', font: {size: 15, weight: 'bold'},
       textColor: {light: '#0F172A', dark: '#F1F5F9'}},
      {type: 'text', text: '分别经过各自策略组', font: {size: 9}, textColor: '#94A3B8'},
      ...rows.map(row => ({
        type: 'stack', direction: 'row', alignItems: 'center', gap: 5,
        children: [
          {type: 'text', text: row.name, font: {size: small ? 10 : 11},
           textColor: {light: '#334155', dark: '#E2E8F0'}, maxLines: 1},
          {type: 'spacer'},
          {type: 'text', text: `${row.text} · ${row.elapsed}毫秒`,
           font: {size: small ? 8 : 10}, textColor: row.color, maxLines: 1}
        ]
      })),
      {type: 'text', text: '可达不等于地区或账户可用', font: {size: 8}, textColor: '#94A3B8'}
    ]
  };
}

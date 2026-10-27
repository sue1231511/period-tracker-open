// 所有环境变量在这里集中读取，别的模块只从这里拿配置。
import { logWarn } from './logger.js';

function env(name, fallback = '') {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function resolveTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch (error) {
    logWarn('config.resolveTimeZone', `TIMEZONE=${tz} 不是有效的时区名，改用 Asia/Shanghai`, { error: String(error) });
    return 'Asia/Shanghai';
  }
}

export const config = {
  port: Number(env('PORT', '3000')),
  supabaseUrl: env('SUPABASE_URL'),
  // 必须是服务端密钥（sb_secret_ 或旧版 service_role）。浏览器永远拿不到它。
  supabaseKey: env('SUPABASE_SERVICE_KEY'),
  // 访问密钥：MCP 的 Bearer 密钥、OAuth 授权页的密码、网页登录密码，都是它。没配就拒绝一切请求。
  proxySecret: env('MCP_PROXY_SECRET'),
  publicBaseUrl: env('PUBLIC_BASE_URL').replace(/\/$/, ''),
  // OAuth 令牌和网页会话存在 mcp_oauth_store 表里，用这个字段跟同一张表里的其他服务分开
  oauthServiceName: env('OAUTH_SERVICE_NAME', 'period-mcp'),
  appTitle: env('APP_TITLE', '月相'),
  appSubtitle: env('APP_SUBTITLE', '经期与排卵期记录'),
  // 写进 MCP 工具描述里的称呼，比如「帮小红记一次经期」。不填就用中性说法。
  ownerName: env('OWNER_NAME'),
  // 判断「今天」用的时区。服务器一般跑在 UTC，不设的话国内早上 8 点前会差一天。
  timeZone: resolveTimeZone(env('TIMEZONE', 'Asia/Shanghai')),
};

export function todayStr() {
  // en-CA 的日期格式正好是 YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

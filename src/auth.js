// 鉴权：MCP 接口（Bearer 密钥或 OAuth 令牌）和网页（cookie 会话）。
// 一律 fail-closed：MCP_PROXY_SECRET 没配就拒绝所有请求，不放行。
import crypto from 'node:crypto';
import { config } from './config.js';
import { isAccessTokenValid, isSessionValid, SESSION_TTL_SECONDS } from './oauth.js';
import { logError, logWarn } from './logger.js';

export const SESSION_COOKIE = 'pt_session';

// 定长比较，防止靠响应时间一位一位猜出密钥
export function secretMatches(input) {
  if (!config.proxySecret || typeof input !== 'string' || !input) return false;
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(config.proxySecret).digest();
  return crypto.timingSafeEqual(a, b);
}

// ── 密码试错限流：同一 IP 15 分钟内错 10 次就先锁住 ──
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_LIMIT = 10;
const failures = new Map();

function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

export function isLockedOut(req) {
  const rec = failures.get(clientIp(req));
  if (!rec) return false;
  if (Date.now() > rec.resetAt) {
    failures.delete(clientIp(req));
    return false;
  }
  return rec.count >= FAIL_LIMIT;
}

export function recordFailure(req, location) {
  const ip = clientIp(req);
  const now = Date.now();
  const rec = failures.get(ip);
  if (!rec || now > rec.resetAt) {
    failures.set(ip, { count: 1, resetAt: now + FAIL_WINDOW_MS });
  } else {
    rec.count += 1;
  }
  logWarn(location, '密钥错误', { ip, count: failures.get(ip).count });
  // 防止 Map 无限增长：顺手清掉过期的记录
  if (failures.size > 5000) {
    for (const [k, v] of failures) if (now > v.resetAt) failures.delete(k);
  }
}

export function clearFailures(req) {
  failures.delete(clientIp(req));
}

// ── MCP 接口鉴权 ──
function rejectMcp(res, status, message) {
  res.status(status).json({ jsonrpc: '2.0', error: { code: -32001, message }, id: null });
}

export async function checkMcpAuth(req, res) {
  if (!config.proxySecret) {
    logError('auth.checkMcpAuth', 'MCP_PROXY_SECRET 未配置，拒绝所有请求(fail-closed)', new Error('MCP_PROXY_SECRET missing'));
    rejectMcp(res, 503, '服务器还没配置访问密钥，暂时拒绝所有请求。');
    return false;
  }
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!bearer) {
    rejectMcp(res, 401, '鉴权失败：请在请求头里带 Authorization: Bearer <访问密钥>，或通过 OAuth 授权获取令牌。');
    return false;
  }
  // 方式一：支持自定义请求头的客户端直接带访问密钥原文。试错被锁时不再比对密钥，防止暴力猜。
  const locked = isLockedOut(req);
  if (!locked && secretMatches(bearer)) return true;
  // 方式二：claude.ai 等走 OAuth 拿到的令牌。令牌是 256 位随机数猜不出来，锁定期间照常放行，
  // 避免同一出口 IP 上别人乱试把正常客户端连带锁住。
  if (await isAccessTokenValid(bearer)) return true;
  recordFailure(req, 'auth.checkMcpAuth');
  if (locked) {
    rejectMcp(res, 429, '错误次数太多，请 15 分钟后再试。');
    return false;
  }
  rejectMcp(res, 401, '鉴权失败：密钥或令牌无效。');
  return false;
}

// ── 网页 cookie 会话 ──
export function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch (error) {
        logWarn('auth.readCookie', 'cookie 解码失败', { name, error: String(error) });
        return '';
      }
    }
  }
  return '';
}

function isHttps(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

export function setSessionCookie(req, res, token) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req, res) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export async function hasValidSession(req) {
  if (!config.proxySecret) return false;
  return isSessionValid(readCookie(req, SESSION_COOKIE));
}

// 网页数据接口用的中间件
export async function requireSession(req, res, next) {
  try {
    if (await hasValidSession(req)) return next();
    res.status(401).json({ error: '请先登录' });
  } catch (error) {
    logError('auth.requireSession', '校验会话出错', error, { path: req.path });
    res.status(500).json({ error: '服务器内部错误' });
  }
}

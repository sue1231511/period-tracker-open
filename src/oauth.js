/**
 * OAuth 2.1 (PKCE) 授权服务器 + 网页登录会话，持久化在 Supabase 的 mcp_oauth_store 表。
 *
 * 照搬自作者另一个自建 MCP 的实现：service 字段区分是哪个服务的记录（默认 period-mcp），
 * record_type 区分 client / auth_code / access_token / refresh_token / ui_session。
 * 表开 RLS 且不配任何规则，只有服务端密钥能读写，建表语句见 sql/schema.sql。
 *
 * 存在数据库而不是内存里，是为了重启或重新部署后 claude.ai 拿到的令牌不失效。
 *
 * 日志约定：授权码、令牌、会话一律不写进日志。
 */
import crypto from 'node:crypto';
import { getSupabase } from './supabase.js';
import { config } from './config.js';
import { logInfo, logWarn, logError } from './logger.js';

const TABLE_NAME = 'mcp_oauth_store';

const AUTH_CODE_TTL_SECONDS = 5 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 天
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 年
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 网页登录 30 天

function service() {
  return config.oauthServiceName;
}

function randomToken(prefix) {
  return `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
}

function futureIso(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function isExpired(iso) {
  return !iso || Date.now() > new Date(iso).getTime();
}

export async function registerClient({ client_name, redirect_uris }) {
  if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    throw new Error('redirect_uris 不能为空');
  }
  for (const uri of redirect_uris) {
    try {
      // 只校验是合法 URL；不限制协议，部分桌面客户端用自定义协议回调，安全靠 PKCE 保证
      new URL(uri);
    } catch (error) {
      logWarn('oauth.registerClient', 'redirect_uri 不合法', { uri: String(uri), reason: error.message });
      throw new Error(`redirect_uri 不合法: ${error.message}`);
    }
  }
  const client_id = randomToken('client');
  const client_name_final = (typeof client_name === 'string' && client_name.slice(0, 100)) || 'unnamed-mcp-client';
  try {
    const { error } = await getSupabase().from(TABLE_NAME).insert({
      service: service(),
      record_type: 'client',
      key: client_id,
      client_id,
      client_name: client_name_final,
      redirect_uris,
    });
    if (error) throw error;
    logInfo('oauth.registerClient', '新客户端注册', { client_id, client_name: client_name_final });
    return {
      client_id,
      client_name: client_name_final,
      redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
  } catch (error) {
    logError('oauth.registerClient', '写入 Supabase 失败', error, { client_name: client_name_final });
    throw error;
  }
}

// 查询失败（数据库异常）时往上抛，不吞掉：调用方要区分「client 不存在」和「存储出故障」。
export async function getClient(client_id) {
  try {
    const { data, error } = await getSupabase()
      .from(TABLE_NAME)
      .select('client_id, client_name, redirect_uris')
      .eq('service', service())
      .eq('record_type', 'client')
      .eq('key', String(client_id || ''))
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return null;
    return {
      client_id: data[0].client_id,
      client_name: data[0].client_name,
      redirect_uris: Array.isArray(data[0].redirect_uris) ? data[0].redirect_uris : [],
    };
  } catch (error) {
    logError('oauth.getClient', '查询 Supabase 失败', error, { client_id });
    throw error;
  }
}

export async function createAuthCode({ client_id, redirect_uri, code_challenge, code_challenge_method, scope }) {
  const code = randomToken('code');
  try {
    const { error } = await getSupabase().from(TABLE_NAME).insert({
      service: service(),
      record_type: 'auth_code',
      key: code,
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      scope,
      expires_at: futureIso(AUTH_CODE_TTL_SECONDS),
    });
    if (error) throw error;
    return code;
  } catch (error) {
    logError('oauth.createAuthCode', '写入 Supabase 失败', error, { client_id, redirect_uri });
    throw error;
  }
}

// 原子消费：DELETE 后链 .select() 带回被删的行，避免「先查后删」之间的竞态。
// DELETE 默认不返回数据，不加 .select() 拿不到行，务必保留。
export async function consumeAuthCode(code) {
  try {
    const { data, error } = await getSupabase()
      .from(TABLE_NAME)
      .delete()
      .eq('service', service())
      .eq('record_type', 'auth_code')
      .eq('key', String(code || ''))
      .select();
    if (error) throw error;
    if (!data || data.length === 0) return null;
    const row = data[0];
    if (isExpired(row.expires_at)) {
      logWarn('oauth.consumeAuthCode', '授权码已过期', { client_id: row.client_id });
      return null;
    }
    return {
      client_id: row.client_id,
      redirect_uri: row.redirect_uri,
      code_challenge: row.code_challenge,
      code_challenge_method: row.code_challenge_method,
      scope: row.scope,
    };
  } catch (error) {
    logError('oauth.consumeAuthCode', '操作 Supabase 失败', error, { hasCode: Boolean(code) });
    throw error;
  }
}

export function verifyPkceOrThrow(codeVerifier, codeChallenge, method) {
  if (method !== 'S256' || typeof codeVerifier !== 'string' || !codeVerifier) {
    throw new Error('PKCE 校验失败: 缺少 code_verifier 或方法不是 S256');
  }
  const computed = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(String(codeChallenge || ''));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('PKCE 校验失败: code_verifier 和 code_challenge 对不上');
  }
}

export async function issueTokens() {
  const access_token = randomToken('at');
  const refresh_token = randomToken('rt');
  try {
    const { error } = await getSupabase().from(TABLE_NAME).insert([
      { service: service(), record_type: 'access_token', key: access_token, expires_at: futureIso(ACCESS_TOKEN_TTL_SECONDS) },
      { service: service(), record_type: 'refresh_token', key: refresh_token, expires_at: futureIso(REFRESH_TOKEN_TTL_SECONDS) },
    ]);
    if (error) throw error;
    return { access_token, refresh_token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS };
  } catch (error) {
    logError('oauth.issueTokens', '写入 Supabase 失败', error);
    throw error;
  }
}

export async function rotateRefreshToken(refresh_token) {
  try {
    const { data, error } = await getSupabase()
      .from(TABLE_NAME)
      .delete()
      .eq('service', service())
      .eq('record_type', 'refresh_token')
      .eq('key', String(refresh_token || ''))
      .select();
    if (error) throw error;
    if (!data || data.length === 0) return null;
    if (isExpired(data[0].expires_at)) return null;
    return await issueTokens();
  } catch (error) {
    logError('oauth.rotateRefreshToken', '操作 Supabase 失败', error, { hasRefreshToken: Boolean(refresh_token) });
    throw error;
  }
}

// 鉴权高频路径：fail-closed，查库出错一律按「无效」处理（拒绝比放行安全），但异常必须完整记日志。
async function isRecordValid(recordType, token, location) {
  if (typeof token !== 'string' || !token) return false;
  try {
    const { data, error } = await getSupabase()
      .from(TABLE_NAME)
      .select('expires_at')
      .eq('service', service())
      .eq('record_type', recordType)
      .eq('key', token)
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return false;
    return !isExpired(data[0].expires_at);
  } catch (error) {
    logError(location, '查询 Supabase 异常，按无效处理', error);
    return false;
  }
}

export function isAccessTokenValid(token) {
  return isRecordValid('access_token', token, 'oauth.isAccessTokenValid');
}

// ── 网页登录会话（跟 MCP 令牌分开存，网页的 cookie 不能拿去调 /mcp）──

export async function createSession() {
  const token = randomToken('ps');
  try {
    const { error } = await getSupabase().from(TABLE_NAME).insert({
      service: service(),
      record_type: 'ui_session',
      key: token,
      expires_at: futureIso(SESSION_TTL_SECONDS),
    });
    if (error) throw error;
    return token;
  } catch (error) {
    logError('oauth.createSession', '写入 Supabase 失败', error);
    throw error;
  }
}

export function isSessionValid(token) {
  return isRecordValid('ui_session', token, 'oauth.isSessionValid');
}

export async function deleteSession(token) {
  if (typeof token !== 'string' || !token) return;
  try {
    const { error } = await getSupabase()
      .from(TABLE_NAME)
      .delete()
      .eq('service', service())
      .eq('record_type', 'ui_session')
      .eq('key', token);
    if (error) throw error;
  } catch (error) {
    logError('oauth.deleteSession', '删除会话失败', error);
    throw error;
  }
}

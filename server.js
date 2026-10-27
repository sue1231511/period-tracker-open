import express from 'express';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { config } from './src/config.js';
import { registerAllTools } from './src/tools.js';
import { logError, logInfo, logWarn } from './src/logger.js';
import {
  registerClient,
  getClient,
  createAuthCode,
  consumeAuthCode,
  verifyPkceOrThrow,
  issueTokens,
  rotateRefreshToken,
  createSession,
  deleteSession,
} from './src/oauth.js';
import {
  checkMcpAuth,
  secretMatches,
  isLockedOut,
  recordFailure,
  clearFailures,
  hasValidSession,
  requireSession,
  setSessionCookie,
  clearSessionCookie,
  readCookie,
  SESSION_COOKIE,
} from './src/auth.js';
import {
  renderLoginPage,
  renderAuthorizePage,
  renderAppPage,
  manifestJson,
  PUBLIC_DIR,
} from './src/pages.js';
import { APP_ICON_SVG } from './public/icons.js';
import {
  listPeriods,
  listOvulations,
  savePeriod,
  markDay,
  deletePeriod,
  addOvulation,
  deleteOvulation,
  assertDate,
  InputError,
} from './src/records.js';

function getBaseUrl(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function createMcpServer() {
  const server = new McpServer({ name: 'period-tracker-mcp', version: '2.0.0' }, { capabilities: {} });
  registerAllTools(server);
  return server;
}

const app = express();
// 部署在反向代理（Coolify/Traefik 等）后面，信任一层代理，req.ip 和 req.secure 才准
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

// 网页页面的安全头。只允许本站脚本，样式和字体放行 Google Fonts。
const CSP_BASE = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
];

// OAuth 授权页提交后要重定向回客户端（比如 claude.ai），Chrome 会把 form-action 也套到重定向目标上，
// 所以授权页不能加 form-action 'self'，其他页面加上。
function pageHeaders(res, { allowExternalFormRedirect = false } = {}) {
  const csp = allowExternalFormRedirect ? CSP_BASE : [...CSP_BASE, "form-action 'self'"];
  res.setHeader('Content-Security-Policy', csp.join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'period-tracker-mcp',
    secret_configured: Boolean(config.proxySecret),
    database_configured: Boolean(config.supabaseUrl && config.supabaseKey),
  });
});

// ─────────────── 网页 ───────────────

app.get('/', async (req, res) => {
  pageHeaders(res);
  try {
    if (!config.proxySecret) {
      return res.status(503).type('html').send(renderLoginPage({ errorMessage: '服务器还没配置访问密钥（MCP_PROXY_SECRET），暂时无法登录。' }));
    }
    if (!(await hasValidSession(req))) return res.redirect('/login');
    res.type('html').send(renderAppPage());
  } catch (error) {
    logError('server.get./', '渲染主页失败', error);
    res.status(500).send('服务器内部错误');
  }
});

app.get('/login', async (req, res) => {
  pageHeaders(res);
  try {
    if (await hasValidSession(req)) return res.redirect('/');
    res.type('html').send(renderLoginPage());
  } catch (error) {
    logError('server.get./login', '渲染登录页失败', error);
    res.status(500).send('服务器内部错误');
  }
});

app.post('/login', async (req, res) => {
  pageHeaders(res);
  if (!config.proxySecret) {
    logWarn('server.post./login', 'MCP_PROXY_SECRET 未配置，拒绝登录');
    return res.status(503).type('html').send(renderLoginPage({ errorMessage: '服务器还没配置访问密钥，暂时无法登录。' }));
  }
  if (isLockedOut(req)) {
    return res.status(429).type('html').send(renderLoginPage({ errorMessage: '错误次数太多，请 15 分钟后再试。' }));
  }
  const key = req.body && typeof req.body.key === 'string' ? req.body.key : '';
  if (!secretMatches(key)) {
    recordFailure(req, 'server.post./login');
    return res.status(401).type('html').send(renderLoginPage({ errorMessage: '密钥不对，请重新输入。' }));
  }
  try {
    clearFailures(req);
    const token = await createSession();
    setSessionCookie(req, res, token);
    logInfo('server.post./login', '网页登录成功');
    res.redirect(303, '/');
  } catch (error) {
    logError('server.post./login', '创建会话失败', error);
    res.status(500).type('html').send(renderLoginPage({ errorMessage: '服务器出错了，请稍后再试。' }));
  }
});

app.post('/logout', async (req, res) => {
  try {
    await deleteSession(readCookie(req, SESSION_COOKIE));
  } catch (error) {
    // 删库失败也照样清掉浏览器里的 cookie，异常已在 deleteSession 里记录，这里补上位置
    logError('server.post./logout', '删除会话失败，仍清除 cookie', error);
  }
  clearSessionCookie(req, res);
  res.redirect(303, '/login');
});

app.get('/manifest.json', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('application/manifest+json').send(JSON.stringify(manifestJson()));
});

app.get('/icon.svg', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('image/svg+xml').send(APP_ICON_SVG);
});

// 前端静态脚本和样式（不含 app.html，它只能经过登录后由 / 渲染）
const STATIC_FILES = new Set(['app.js', 'app.css', 'cycle.js', 'icons.js']);
app.get('/static/:file', (req, res) => {
  const file = req.params.file;
  if (!STATIC_FILES.has(file)) return res.status(404).end();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, file), (error) => {
    if (error) {
      logError('server.get./static', '发送静态文件失败', error, { file });
      if (!res.headersSent) res.status(500).end();
    }
  });
});

// ─────────────── 网页数据接口（需要登录） ───────────────

function sendApiError(res, location, error, context) {
  if (error instanceof InputError) {
    return res.status(400).json({ error: error.message });
  }
  logError(location, '接口处理失败', error, context);
  res.status(500).json({ error: '服务器内部错误' });
}

// 写操作只接受 JSON：跨站表单发不了 application/json，配合 SameSite=Strict 防 CSRF
function requireJson(req, res, next) {
  if (!req.is('application/json')) return res.status(415).json({ error: '只接受 application/json' });
  next();
}

const api = express.Router();
api.use(requireSession);
api.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

api.get('/records', async (_req, res) => {
  try {
    const [periods, ovulations] = await Promise.all([listPeriods(), listOvulations()]);
    res.json({ periods, ovulations });
  } catch (error) {
    sendApiError(res, 'api.get./records', error);
  }
});

// 保存某一天：kind = period（经期开始）| ovulation（排卵期）| mark（仅标记）| clear（清除这天所有记录）
api.post('/day', requireJson, async (req, res) => {
  const { date, kind, duration } = req.body || {};
  try {
    assertDate(date);
    if (kind === 'period') {
      await savePeriod({ start_date: date, duration });
    } else if (kind === 'ovulation') {
      await addOvulation({ ovulation_date: date });
    } else if (kind === 'mark') {
      await markDay({ date });
    } else if (kind === 'clear') {
      await deletePeriod({ start_date: date });
      await deleteOvulation({ ovulation_date: date });
    } else {
      throw new InputError('kind 只能是 period / ovulation / mark / clear');
    }
    const [periods, ovulations] = await Promise.all([listPeriods(), listOvulations()]);
    res.json({ periods, ovulations });
  } catch (error) {
    sendApiError(res, 'api.post./day', error, { date, kind });
  }
});

api.delete('/periods/:date', async (req, res) => {
  try {
    const n = await deletePeriod({ start_date: req.params.date });
    res.json({ deleted: n });
  } catch (error) {
    sendApiError(res, 'api.delete./periods', error, { date: req.params.date });
  }
});

api.delete('/ovulations/:date', async (req, res) => {
  try {
    const n = await deleteOvulation({ ovulation_date: req.params.date });
    res.json({ deleted: n });
  } catch (error) {
    sendApiError(res, 'api.delete./ovulations', error, { date: req.params.date });
  }
});

app.use('/api', api);

// ─────────────── OAuth（给 claude.ai 等客户端连 MCP 用） ───────────────

app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const base = getBaseUrl(req);
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  });
});

app.get('/.well-known/oauth-protected-resource', (req, res) => {
  const base = getBaseUrl(req);
  res.json({ resource: `${base}/mcp`, authorization_servers: [base] });
});

app.post('/register', async (req, res) => {
  try {
    const { client_name, redirect_uris } = req.body || {};
    const client = await registerClient({ client_name, redirect_uris });
    res.status(201).json(client);
  } catch (error) {
    logError('server.post./register', '客户端注册失败', error, { client_name: req.body && req.body.client_name });
    res.status(400).json({ error: 'invalid_client_metadata', error_description: error.message });
  }
});

function pickOauthParams(src) {
  const { response_type, client_id, redirect_uri, code_challenge, code_challenge_method, state, scope } = src || {};
  return { response_type, client_id, redirect_uri, code_challenge, code_challenge_method, state, scope };
}

async function validateAuthorizeRequest(p) {
  if (p.response_type !== 'code') return '只支持 response_type=code';
  const client = await getClient(p.client_id);
  if (!client) return '未知的 client_id，请先完成动态客户端注册';
  if (!client.redirect_uris.includes(p.redirect_uri)) return 'redirect_uri 和注册时的不一致';
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return '缺少 PKCE 参数，或 code_challenge_method 不是 S256';
  return null;
}

app.get('/authorize', async (req, res) => {
  pageHeaders(res, { allowExternalFormRedirect: true });
  const p = pickOauthParams(req.query);
  try {
    const problem = await validateAuthorizeRequest(p);
    if (problem) return res.status(400).send(problem);
    res.type('html').send(renderAuthorizePage({ oauthParams: p }));
  } catch (error) {
    logError('server.get./authorize', '校验授权请求失败', error, { client_id: p.client_id });
    res.status(500).send('服务器内部错误：授权存储暂时不可用，请稍后重试');
  }
});

app.post('/authorize', async (req, res) => {
  pageHeaders(res, { allowExternalFormRedirect: true });
  const p = pickOauthParams(req.body);
  const key = req.body && typeof req.body.key === 'string' ? req.body.key : '';

  if (!config.proxySecret) {
    logWarn('server.post./authorize', 'MCP_PROXY_SECRET 未配置，拒绝所有授权请求');
    return res.status(500).type('html').send(
      renderAuthorizePage({ oauthParams: p, errorMessage: '服务器还没配置访问密钥，无法完成授权。' })
    );
  }
  if (isLockedOut(req)) {
    return res.status(429).type('html').send(
      renderAuthorizePage({ oauthParams: p, errorMessage: '错误次数太多，请 15 分钟后再试。' })
    );
  }
  if (!secretMatches(key)) {
    recordFailure(req, 'server.post./authorize');
    return res.status(401).type('html').send(
      renderAuthorizePage({ oauthParams: p, errorMessage: '密钥不对，请重新输入。' })
    );
  }

  try {
    clearFailures(req);
    const problem = await validateAuthorizeRequest(p);
    if (problem) return res.status(400).send(problem);
    const code = await createAuthCode(p);
    const redirectUrl = new URL(p.redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (p.state) redirectUrl.searchParams.set('state', p.state);
    logInfo('server.post./authorize', '授权成功，重定向回客户端', { client_id: p.client_id });
    res.redirect(redirectUrl.toString());
  } catch (error) {
    logError('server.post./authorize', '生成授权码失败', error, { client_id: p.client_id });
    res.status(500).send('服务器内部错误');
  }
});

app.post('/token', async (req, res) => {
  const { grant_type } = req.body || {};
  try {
    if (grant_type === 'authorization_code') {
      const { code, redirect_uri, client_id, code_verifier } = req.body;
      const record = await consumeAuthCode(code);
      if (!record) {
        return res.status(400).json({ error: 'invalid_grant', error_description: '授权码无效或已过期' });
      }
      if (record.client_id !== client_id || record.redirect_uri !== redirect_uri) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'client_id 或 redirect_uri 不匹配' });
      }
      verifyPkceOrThrow(code_verifier, record.code_challenge, record.code_challenge_method);
      const tokens = await issueTokens();
      logInfo('server.post./token', '颁发新令牌', { client_id, grant_type });
      return res.json(tokens);
    }
    if (grant_type === 'refresh_token') {
      const tokens = await rotateRefreshToken(req.body.refresh_token);
      if (!tokens) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh_token 无效或已过期' });
      }
      logInfo('server.post./token', '刷新令牌成功', { grant_type });
      return res.json(tokens);
    }
    return res.status(400).json({ error: 'unsupported_grant_type', error_description: `不支持的 grant_type: ${grant_type}` });
  } catch (error) {
    logError('server.post./token', '颁发令牌失败', error, { grant_type });
    return res.status(400).json({ error: 'invalid_grant', error_description: error.message });
  }
});

// ─────────────── MCP ───────────────

app.post('/mcp', async (req, res) => {
  if (!(await checkMcpAuth(req, res))) return;
  let server;
  let transport;
  res.on('close', () => {
    try {
      if (transport) transport.close();
      if (server) server.close();
    } catch (closeError) {
      logError('server./mcp', '关闭 transport/server 时出错', closeError);
    }
  });
  try {
    server = createMcpServer();
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logError('server./mcp', '处理 MCP 请求失败', error, { hasBody: Boolean(req.body) });
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: '服务器内部错误' }, id: null });
    }
  }
});

app.get('/mcp', (_req, res) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed，这个服务是无状态的，只接受 POST。' }, id: null });
});

app.delete('/mcp', (_req, res) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed。' }, id: null });
});

// 旧版 SSE 传输，兼容只支持 SSE 的客户端。建连和发消息两步都要鉴权。
const sseSessions = new Map();

app.get('/sse', async (req, res) => {
  if (!(await checkMcpAuth(req, res))) return;
  try {
    const server = createMcpServer();
    const transport = new SSEServerTransport('/messages', res);
    sseSessions.set(transport.sessionId, { transport, server });
    res.on('close', () => {
      sseSessions.delete(transport.sessionId);
      try {
        server.close();
      } catch (closeError) {
        logError('server./sse', '关闭 SSE server 时出错', closeError);
      }
    });
    await server.connect(transport);
  } catch (error) {
    logError('server./sse', '建立 SSE 连接失败', error);
    if (!res.headersSent) res.status(500).end();
  }
});

app.post('/messages', async (req, res) => {
  if (!(await checkMcpAuth(req, res))) return;
  const session = sseSessions.get(String(req.query.sessionId || ''));
  if (!session) return res.status(400).json({ error: 'Unknown session' });
  try {
    await session.transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    logError('server./messages', '处理 SSE 消息失败', error);
    if (!res.headersSent) res.status(500).end();
  }
});

// 兜底错误处理（比如请求体 JSON 解析失败）
app.use((error, req, res, _next) => {
  logError('server.errorHandler', '未处理的请求错误', error, { path: req.path, method: req.method });
  if (res.headersSent) return;
  const status = error.status || error.statusCode || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: status === 400 ? '请求格式不对' : '服务器内部错误' });
});

app.listen(config.port, () => {
  logInfo('server.listen', `period-tracker-mcp 已启动，监听端口 ${config.port}`, { timeZone: config.timeZone });
  if (!config.supabaseUrl || !config.supabaseKey) {
    logWarn('server.listen', 'SUPABASE_URL / SUPABASE_SERVICE_KEY 还没配置，所有读写都会失败');
  }
  if (!config.proxySecret) {
    logWarn('server.listen', 'MCP_PROXY_SECRET 还没配置，网页、OAuth 授权和 /mcp 现在会拒绝所有请求');
  }
  if (!config.publicBaseUrl) {
    logWarn('server.listen', 'PUBLIC_BASE_URL 没配置，OAuth 元数据会从请求头拼地址，不完全可靠，建议显式配置成本服务的域名');
  }
});

process.on('unhandledRejection', (reason) => {
  logError('process.unhandledRejection', '未处理的 Promise 拒绝', reason instanceof Error ? reason : new Error(String(reason)));
});

process.on('SIGINT', () => {
  logInfo('server.shutdown', '收到 SIGINT，正在关闭');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logInfo('server.shutdown', '收到 SIGTERM，正在关闭');
  process.exit(0);
});

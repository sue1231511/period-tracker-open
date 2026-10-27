// 服务器渲染的页面：网页登录、OAuth 授权、主页面外壳、PWA 清单。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config.js';
import { ICONS, APP_ICON_SVG } from '../public/icons.js';
import { logError } from './logger.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const APP_ICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(APP_ICON_SVG)}`;

const CARD_STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif;
    background: linear-gradient(160deg, #0d1b3e 0%, #162548 50%, #0f1e3a 100%); color: #e8f0ff; padding: 16px; }
  .card { width: 100%; max-width: 360px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 20px; padding: 28px 24px; }
  .icon { width: 36px; height: 36px; color: #e8c7cf; margin-bottom: 14px; }
  .icon svg { width: 100%; height: 100%; display: block; }
  h1 { font-size: 18px; font-weight: 400; letter-spacing: 1px; margin: 0 0 6px; }
  p { font-size: 13px; color: #8099b8; margin: 0 0 20px; line-height: 1.7; }
  input[type="password"] { width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.05); color: #e8f0ff; font-size: 15px; margin-bottom: 12px; }
  input[type="password"]:focus { outline: none; border-color: rgba(212,120,138,0.7); }
  button { width: 100%; padding: 12px; border: none; border-radius: 12px; background: #c4546a; color: #fff; font-size: 15px; cursor: pointer; }
  .error { color: #f0a0ae; font-size: 13px; margin-bottom: 12px; }
`;

function shell({ title, body }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(title)}</title>
<link rel="icon" href="${APP_ICON_DATA_URI}" />
<style>${CARD_STYLE}</style>
</head>
<body>
  <div class="card">
    <div class="icon">${ICONS.moon}</div>
    ${body}
  </div>
</body>
</html>`;
}

export function renderLoginPage({ errorMessage } = {}) {
  return shell({
    title: `登录 · ${config.appTitle}`,
    body: `
    <h1>${escapeHtml(config.appTitle)}</h1>
    <p>输入访问密钥打开记录。</p>
    ${errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : ''}
    <form method="POST" action="/login">
      <input type="password" name="key" placeholder="访问密钥" autocomplete="current-password" autofocus required />
      <button type="submit">进入</button>
    </form>`,
  });
}

export function renderAuthorizePage({ oauthParams, errorMessage }) {
  const hiddenFields = Object.entries(oauthParams)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value || '')}" />`)
    .join('\n      ');
  return shell({
    title: `授权 · ${config.appTitle}`,
    body: `
    <h1>授权访问${escapeHtml(config.appTitle)}</h1>
    <p>一个客户端想读写你的经期记录。输入访问密钥同意授权。</p>
    ${errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : ''}
    <form method="POST" action="/authorize">
      ${hiddenFields}
      <input type="password" name="key" placeholder="访问密钥" autocomplete="current-password" autofocus required />
      <button type="submit">授权</button>
    </form>`,
  });
}

let _appTemplate = null;
function appTemplate() {
  if (_appTemplate) return _appTemplate;
  try {
    _appTemplate = readFileSync(path.join(PUBLIC_DIR, 'app.html'), 'utf8');
    return _appTemplate;
  } catch (error) {
    logError('pages.appTemplate', '读取 app.html 失败', error, { dir: PUBLIC_DIR });
    throw error;
  }
}

// 用 split/join 替换占位符：String.replace 的替换串会把 $& $$ 这类当特殊语法，标题里有 $ 会出错
function fill(template, key, value) {
  return template.split(`{{${key}}}`).join(value);
}

export function renderAppPage() {
  let html = appTemplate();
  html = fill(html, 'APP_TITLE', escapeHtml(config.appTitle));
  html = fill(html, 'APP_SUBTITLE', escapeHtml(config.appSubtitle));
  html = fill(html, 'APP_ICON', APP_ICON_DATA_URI);
  return html;
}

export function manifestJson() {
  return {
    name: config.appTitle,
    short_name: config.appTitle,
    description: config.appSubtitle,
    start_url: '/',
    display: 'standalone',
    background_color: '#0d1b3e',
    theme_color: '#0d1b3e',
    orientation: 'portrait',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}

export { PUBLIC_DIR };

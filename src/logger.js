// 统一日志模块。所有 try-catch 捕获到异常后，必须调用这里的 logError，
// 禁止空 catch、禁止裸 console.log 打日志。
// 格式: [时间][级别][位置] 消息 | 关键变量 | 异常堆栈

// 这些字段名的值一律不进日志（令牌、授权码、密钥、经期备注）
const SENSITIVE_KEYS = new Set([
  'key',
  'token',
  'code_verifier',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  'secret',
  'password',
  'notes',
]);

// 这些格式的字符串一律不进日志：Supabase 密钥、本服务签发的令牌/授权码/会话
const SENSITIVE_VALUE_PATTERNS = [
  /^sb_(secret|publishable)_[A-Za-z0-9_-]+/,
  /^eyJ[A-Za-z0-9_-]{10,}\./,
  /^(at|rt|code|ps)_[A-Za-z0-9_-]{20,}/,
];

function timestamp() {
  return new Date().toISOString();
}

function serializeContext(context) {
  if (!context || Object.keys(context).length === 0) return '';
  try {
    return JSON.stringify(context, (key, value) => {
      if (key && SENSITIVE_KEYS.has(String(key).toLowerCase())) {
        return '[REDACTED]';
      }
      if (typeof value === 'string' && SENSITIVE_VALUE_PATTERNS.some((re) => re.test(value))) {
        return '[REDACTED]';
      }
      return value;
    });
  } catch (serializeError) {
    return `[无法序列化的 context: ${String(serializeError)}]`;
  }
}

export function logInfo(location, message, context = {}) {
  console.log(`[${timestamp()}][INFO][${location}] ${message} | ${serializeContext(context)}`);
}

export function logWarn(location, message, context = {}) {
  console.warn(`[${timestamp()}][WARN][${location}] ${message} | ${serializeContext(context)}`);
}

// error 必须传入捕获到的异常对象，用于打印堆栈
export function logError(location, message, error, context = {}) {
  const stack = error && error.stack ? error.stack : String(error);
  console.error(
    `[${timestamp()}][ERROR][${location}] ${message} | ${serializeContext(context)} | 异常堆栈: ${stack}`
  );
}

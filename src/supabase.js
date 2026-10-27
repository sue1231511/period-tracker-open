import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { logError, logInfo } from './logger.js';

let _client = null;

// 服务端专用客户端，用服务端密钥，绕过 RLS。数据表本身不开放任何匿名规则。
export function getSupabase() {
  if (_client) return _client;
  if (!config.supabaseUrl || !config.supabaseKey) {
    const err = new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY 未配置，无法访问数据库，请在环境变量里配置');
    logError('supabase.getSupabase', '初始化失败', err);
    throw err;
  }
  try {
    _client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    logInfo('supabase.getSupabase', 'Supabase 客户端初始化成功');
    return _client;
  } catch (error) {
    logError('supabase.getSupabase', '创建 Supabase 客户端异常', error);
    throw error;
  }
}

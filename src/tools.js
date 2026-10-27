import * as z from 'zod/v4';
import { config, todayStr } from './config.js';
import { logError, logInfo } from './logger.js';
import {
  listPeriods,
  listOvulations,
  savePeriod,
  deletePeriod,
  addOvulation,
  deleteOvulation,
  InputError,
} from './records.js';
import {
  cycleStatus,
  cycleLengths,
  isRealPeriod,
  durationOf,
  daysBetween,
  MIN_DURATION,
  MAX_DURATION,
} from '../public/cycle.js';

const PHASE_NAMES = { period: '经期', follicular: '卵泡期', ovulation: '排卵期', luteal: '黄体期' };

function who() {
  return config.ownerName ? `帮${config.ownerName}` : '';
}

function md(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${Number(m)}月${Number(d)}日`;
}

function ok(text) {
  return { content: [{ type: 'text', text }] };
}

function fail(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

// 统一包装：try-catch + 日志 + 转成 MCP 返回格式。输入不合法给出人话提示，其他异常记完整堆栈。
function wrapHandler(toolName, handler) {
  return async (params, extra) => {
    try {
      logInfo(`tool:${toolName}`, '开始执行', { params });
      return ok(await handler(params || {}, extra));
    } catch (error) {
      if (error instanceof InputError) {
        logInfo(`tool:${toolName}`, '输入不合法', { params, reason: error.message });
        return fail(error.message);
      }
      logError(`tool:${toolName}`, '工具执行失败', error, { params });
      return fail(`${toolName} 执行失败：${error.message}`);
    }
  };
}

function predictionLine(records, today) {
  const st = cycleStatus(records, today);
  if (!st.latest) return '';
  if (cycleLengths(records).length === 0) return '再记一次就能算周期了。';
  return `平均周期 ${st.avgCycle} 天，下一次大概在 ${md(st.nextPredicted)} 左右。`;
}

function statusText(days) {
  if (days < 0) return `已经晚了 ${-days} 天，可能已经来了，或者快来了`;
  if (days === 0) return '预计就是今天';
  if (days <= 5) return `还有 ${days} 天，可以提前备好止痛药和暖宝宝`;
  return `还有 ${days} 天`;
}

// 有本周期内（最近一次经期之后）的排卵期记录就按实际记录判断，否则按平均周期推算
function currentPhaseName(st, ovulations, today) {
  if (!st.latest || st.daysInCycle < 0) return null;
  if (st.daysInCycle < durationOf(st.latest)) return '经期';
  const ov = (ovulations || []).find((o) => o.ovulation_date >= st.latest.start_date);
  if (ov) {
    const since = daysBetween(ov.ovulation_date, today);
    if (since < 0) return '卵泡期';
    if (since <= 1) return '排卵日附近';
    if (since <= 3) return '排卵期';
    return '黄体期';
  }
  return st.phase ? PHASE_NAMES[st.phase] : null;
}

const dateField = (desc) => z.string().describe(desc);
const notesField = z.string().max(200).optional();
const limitField = z.number().int().min(1).max(100).optional().describe('返回条数，默认 10，最多 100');

export function registerAllTools(server) {
  server.registerTool(
    'add_period',
    {
      description: `${who()}记一次经期开始。同一天已经记过就更新天数和备注。`,
      inputSchema: {
        start_date: dateField('经期开始日期，格式 YYYY-MM-DD，如 2026-04-11'),
        duration: z.number().int().min(MIN_DURATION).max(MAX_DURATION).optional().describe('经期天数，默认 5'),
        notes: notesField.describe('备注，可选，比如当天的身体感受'),
      },
    },
    wrapHandler('add_period', async ({ start_date, duration, notes }) => {
      const { created } = await savePeriod({ start_date, duration, notes });
      const records = await listPeriods();
      const head = created ? `记好了，${md(start_date)} 这次经期已记录。` : `${md(start_date)} 本来就有记录，已更新。`;
      return `${head}\n${predictionLine(records, todayStr())}`.trim();
    })
  );

  server.registerTool(
    'list_periods',
    {
      description: `看看${config.ownerName || ''}之前的经期记录，附带每次周期长度和平均周期。`,
      inputSchema: { limit: limitField },
    },
    wrapHandler('list_periods', async ({ limit }) => {
      const all = await listPeriods();
      if (!all.length) return '还没有记录过经期。';
      const shown = all.slice(0, limit || 10);
      const lines = shown.map((r, i) => {
        const mark = isRealPeriod(r) ? `，持续 ${durationOf(r)} 天` : '（仅标记，不算周期）';
        const note = isRealPeriod(r) && r.notes ? `，备注：${r.notes}` : '';
        return `${i + 1}. ${r.start_date}${mark}${note}`;
      });
      const lens = cycleLengths(all);
      let tail = '';
      if (lens.length) {
        const st = cycleStatus(all, todayStr());
        tail = `\n\n周期长度（新到旧）：${lens.join('、')} 天\n平均周期：${st.avgCycle} 天`;
      }
      return lines.join('\n') + tail;
    })
  );

  server.registerTool(
    'get_cycle_status',
    {
      description: `看看${config.ownerName || ''}现在处在周期的哪个阶段，预测下次经期什么时候来，方便提前准备。`,
      inputSchema: {},
    },
    wrapHandler('get_cycle_status', async () => {
      const today = todayStr();
      const [records, ovulations] = await Promise.all([listPeriods(), listOvulations({ limit: 10 })]);
      const st = cycleStatus(records, today);
      if (!st.latest) return '还没有记录过经期，没法预测。';
      const lines = [
        `上次经期：${md(st.latest.start_date)}${st.latest.notes ? `（${st.latest.notes}）` : ''}`,
        `今天是这次周期的第 ${st.daysInCycle + 1} 天`,
      ];
      if (cycleLengths(records).length === 0) {
        lines.push('只有一次有效记录，还没法算周期，再记一次就能预测了。');
      } else {
        lines.push(`平均周期：${st.avgCycle} 天`);
        lines.push(`预测下次：${md(st.nextPredicted)}`);
        lines.push(`状态：${statusText(st.daysUntilNext)}`);
      }
      const latestOv = ovulations[0];
      if (latestOv) {
        lines.push(
          `最近排卵期记录：${md(latestOv.ovulation_date)}（${daysBetween(latestOv.ovulation_date, today)} 天前）`
        );
      }
      const phase = currentPhaseName(st, ovulations, today);
      if (phase) lines.push(`当前阶段：${phase}`);
      return lines.join('\n');
    })
  );

  server.registerTool(
    'delete_period',
    {
      description: '删掉一条记错了的经期记录。',
      inputSchema: { start_date: dateField('要删除的日期，格式 YYYY-MM-DD') },
    },
    wrapHandler('delete_period', async ({ start_date }) => {
      const n = await deletePeriod({ start_date });
      return n ? `${start_date} 的记录已删除。` : `${start_date} 没有经期记录，不用删。`;
    })
  );

  server.registerTool(
    'add_ovulation',
    {
      description: `${who()}记一次排卵期。`,
      inputSchema: {
        ovulation_date: dateField('排卵期日期，格式 YYYY-MM-DD'),
        notes: notesField.describe('备注，可选，比如当天的身体感受'),
      },
    },
    wrapHandler('add_ovulation', async ({ ovulation_date, notes }) => {
      const { created } = await addOvulation({ ovulation_date, notes });
      return created ? `记好了，${md(ovulation_date)} 这次排卵期已记录。` : `${md(ovulation_date)} 已经记过排卵期了。`;
    })
  );

  server.registerTool(
    'list_ovulations',
    {
      description: `看看${config.ownerName || ''}之前的排卵期记录。`,
      inputSchema: { limit: limitField },
    },
    wrapHandler('list_ovulations', async ({ limit }) => {
      const rows = await listOvulations({ limit: limit || 10 });
      if (!rows.length) return '还没有记录过排卵期。';
      return rows.map((r, i) => `${i + 1}. ${r.ovulation_date}${r.notes ? `，备注：${r.notes}` : ''}`).join('\n');
    })
  );

  server.registerTool(
    'delete_ovulation',
    {
      description: '删掉一条记错了的排卵期记录。',
      inputSchema: { ovulation_date: dateField('要删除的日期，格式 YYYY-MM-DD') },
    },
    wrapHandler('delete_ovulation', async ({ ovulation_date }) => {
      const n = await deleteOvulation({ ovulation_date });
      return n ? `${ovulation_date} 的排卵期记录已删除。` : `${ovulation_date} 没有排卵期记录，不用删。`;
    })
  );
}

// 经期 / 排卵期记录的读写。MCP 工具和网页接口都走这里，规则只写一遍。
import { getSupabase } from './supabase.js';
import { logError } from './logger.js';
import {
  isValidDateStr,
  MARK_NOTE,
  MIN_DURATION,
  MAX_DURATION,
  DEFAULT_DURATION,
} from '../public/cycle.js';

const PERIODS = 'period_records';
const OVULATIONS = 'ovulation_records';
const NOTES_MAX = 200;

// 业务校验失败用这个，接口层据此返回 400，而不是 500
export class InputError extends Error {}

export function assertDate(s, label = '日期') {
  if (!isValidDateStr(s)) {
    throw new InputError(`${label}格式不对，要用 YYYY-MM-DD，比如 2026-04-11`);
  }
}

function cleanNotes(notes) {
  if (notes === undefined || notes === null) return '';
  if (typeof notes !== 'string') throw new InputError('备注必须是文字');
  const t = notes.trim();
  if (t === MARK_NOTE) throw new InputError(`备注不能是保留字 ${MARK_NOTE}`);
  if (t.length > NOTES_MAX) throw new InputError(`备注最多 ${NOTES_MAX} 个字`);
  return t;
}

function cleanDuration(d) {
  if (d === undefined || d === null || d === '') return DEFAULT_DURATION;
  const n = Number(d);
  if (!Number.isInteger(n) || n < MIN_DURATION || n > MAX_DURATION) {
    throw new InputError(`经期天数要是 ${MIN_DURATION} 到 ${MAX_DURATION} 之间的整数`);
  }
  return n;
}

async function run(location, context, fn) {
  try {
    const { data, error } = await fn(getSupabase());
    if (error) throw error;
    return data;
  } catch (error) {
    logError(location, '数据库操作失败', error, context);
    throw error;
  }
}

export async function listPeriods({ limit } = {}) {
  return run('records.listPeriods', { limit }, (db) => {
    let q = db.from(PERIODS).select('id,start_date,notes,duration').order('start_date', { ascending: false });
    if (limit) q = q.limit(limit);
    return q;
  });
}

export async function listOvulations({ limit } = {}) {
  return run('records.listOvulations', { limit }, (db) => {
    let q = db.from(OVULATIONS).select('id,ovulation_date,notes').order('ovulation_date', { ascending: false });
    if (limit) q = q.limit(limit);
    return q;
  });
}

async function findPeriod(start_date) {
  const rows = await run('records.findPeriod', { start_date }, (db) =>
    db.from(PERIODS).select('id,start_date,notes,duration').eq('start_date', start_date).limit(1)
  );
  return rows && rows.length ? rows[0] : null;
}

// 记一次经期开始。同一天已有记录（包括「仅标记」）就改成经期并更新天数和备注。
export async function savePeriod({ start_date, duration, notes }) {
  assertDate(start_date, '经期开始日期');
  const dur = cleanDuration(duration);
  const note = cleanNotes(notes);
  const existing = await findPeriod(start_date);
  if (existing) {
    await run('records.savePeriod.update', { start_date }, (db) =>
      db.from(PERIODS).update({ duration: dur, notes: note }).eq('start_date', start_date)
    );
    return { created: false };
  }
  await run('records.savePeriod.insert', { start_date }, (db) =>
    db.from(PERIODS).insert({ start_date, duration: dur, notes: note })
  );
  return { created: true };
}

// 「仅标记」：标注这一天，不参与周期计算
export async function markDay({ date }) {
  assertDate(date);
  const existing = await findPeriod(date);
  if (existing) {
    await run('records.markDay.update', { date }, (db) =>
      db.from(PERIODS).update({ notes: MARK_NOTE, duration: 1 }).eq('start_date', date)
    );
    return { created: false };
  }
  await run('records.markDay.insert', { date }, (db) =>
    db.from(PERIODS).insert({ start_date: date, notes: MARK_NOTE, duration: 1 })
  );
  return { created: true };
}

export async function deletePeriod({ start_date }) {
  assertDate(start_date);
  const rows = await run('records.deletePeriod', { start_date }, (db) =>
    db.from(PERIODS).delete().eq('start_date', start_date).select('id')
  );
  return (rows || []).length;
}

export async function addOvulation({ ovulation_date, notes }) {
  assertDate(ovulation_date, '排卵期日期');
  const note = cleanNotes(notes);
  const rows = await run('records.addOvulation.find', { ovulation_date }, (db) =>
    db.from(OVULATIONS).select('id').eq('ovulation_date', ovulation_date).limit(1)
  );
  if (rows && rows.length) return { created: false };
  await run('records.addOvulation.insert', { ovulation_date }, (db) =>
    db.from(OVULATIONS).insert({ ovulation_date, notes: note })
  );
  return { created: true };
}

export async function deleteOvulation({ ovulation_date }) {
  assertDate(ovulation_date);
  const rows = await run('records.deleteOvulation', { ovulation_date }, (db) =>
    db.from(OVULATIONS).delete().eq('ovulation_date', ovulation_date).select('id')
  );
  return (rows || []).length;
}

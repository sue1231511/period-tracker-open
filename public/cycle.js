// 周期计算：服务器（MCP 工具）和网页共用这一份，保证两边算出来的结果一致。
// 只处理 'YYYY-MM-DD' 日期字符串，统一按 UTC 零点换算天数，避免时区和夏令时导致差一天。

export const DEFAULT_CYCLE = 28;
export const DEFAULT_DURATION = 5;
export const MIN_CYCLE = 15; // 两次经期间隔小于这个天数，视为记录异常，不参与平均周期
export const MAX_CYCLE = 65; // 大于这个天数，视为中间漏记，不参与平均周期
export const MIN_DURATION = 1;
export const MAX_DURATION = 10;
export const MARK_NOTE = 'marked'; // 「仅标记」的记录，不参与周期计算

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

export function isValidDateStr(s) {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function toUtcMs(s) {
  const m = DATE_RE.exec(s);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function daysBetween(fromStr, toStr) {
  return Math.round((toUtcMs(toStr) - toUtcMs(fromStr)) / DAY_MS);
}

export function addDays(s, n) {
  const t = new Date(toUtcMs(s) + n * DAY_MS);
  const y = t.getUTCFullYear();
  const mo = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

export function isRealPeriod(r) {
  return r && r.notes !== MARK_NOTE;
}

export function durationOf(r) {
  const n = Number(r && r.duration);
  if (Number.isInteger(n) && n >= MIN_DURATION && n <= MAX_DURATION) return n;
  return DEFAULT_DURATION;
}

// 真实经期记录，按开始日期从新到旧
export function sortedRealPeriods(records) {
  return (records || [])
    .filter(isRealPeriod)
    .filter((r) => isValidDateStr(r.start_date))
    .sort((a, b) => (a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : 0));
}

// 相邻两次经期的间隔（天），只保留 MIN_CYCLE~MAX_CYCLE 之间的
export function cycleLengths(records) {
  const sorted = sortedRealPeriods(records);
  const out = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const diff = daysBetween(sorted[i + 1].start_date, sorted[i].start_date);
    if (diff >= MIN_CYCLE && diff <= MAX_CYCLE) out.push(diff);
  }
  return out;
}

export function averageCycle(records) {
  const lens = cycleLengths(records);
  if (!lens.length) return DEFAULT_CYCLE;
  return Math.round(lens.reduce((a, b) => a + b, 0) / lens.length);
}

// 周期第 day 天（从 0 开始）处于哪个阶段。排卵日按「下次经期前 14 天」估算，前后各一天算排卵期。
export function phaseOfDay(day, cycle, duration) {
  const ovulDay = cycle - 14;
  if (day < duration) return 'period';
  if (day < ovulDay - 1) return 'follicular';
  if (day <= ovulDay + 1) return 'ovulation';
  return 'luteal';
}

export function cycleStatus(records, todayStr) {
  const sorted = sortedRealPeriods(records);
  if (!sorted.length) {
    return { avgCycle: DEFAULT_CYCLE, latest: null, nextPredicted: null, daysInCycle: 0, daysUntilNext: null, phase: null };
  }
  const cycle = averageCycle(records);
  const latest = sorted[0];
  const daysIn = daysBetween(latest.start_date, todayStr);
  const nextPredicted = addDays(latest.start_date, cycle);
  const daysUntilNext = daysBetween(todayStr, nextPredicted);
  let phase = null;
  if (daysIn >= 0 && daysIn < cycle) phase = phaseOfDay(daysIn, cycle, durationOf(latest));
  return { avgCycle: cycle, latest, nextPredicted, daysInCycle: daysIn, daysUntilNext, phase };
}

// 日历上某一天的阶段：落在已记录周期内用实际记录；落在下一次预测周期内标为 pred-*
export function phaseForDate(records, dateStr, cycle) {
  const sorted = sortedRealPeriods(records);
  if (!sorted.length || !isValidDateStr(dateStr)) return null;
  for (const r of sorted) {
    const day = daysBetween(r.start_date, dateStr);
    if (day >= 0 && day < cycle) {
      return { phase: phaseOfDay(day, cycle, durationOf(r)), isStart: day === 0 };
    }
  }
  const nextStart = addDays(sorted[0].start_date, cycle);
  const day = daysBetween(nextStart, dateStr);
  if (day >= 0 && day < cycle) {
    return { phase: 'pred-' + phaseOfDay(day, cycle, DEFAULT_DURATION), isStart: day === 0 };
  }
  return null;
}

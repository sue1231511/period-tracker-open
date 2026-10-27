// 运行：npm test（用 Node 自带的 node:test，不需要装别的依赖）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidDateStr,
  daysBetween,
  addDays,
  averageCycle,
  cycleLengths,
  cycleStatus,
  phaseForDate,
  phaseOfDay,
  DEFAULT_CYCLE,
} from '../public/cycle.js';

const P = (start_date, extra = {}) => ({ start_date, notes: '', duration: 5, ...extra });

test('日期校验：格式和真实日期都要对', () => {
  assert.equal(isValidDateStr('2026-02-28'), true);
  assert.equal(isValidDateStr('2026-02-30'), false);
  assert.equal(isValidDateStr('2024-02-29'), true);
  assert.equal(isValidDateStr('2026-2-1'), false);
  assert.equal(isValidDateStr('2026-04-11T00:00'), false);
  assert.equal(isValidDateStr(null), false);
});

test('天数计算跨月跨年不差一天', () => {
  assert.equal(daysBetween('2026-01-31', '2026-03-01'), 29);
  assert.equal(daysBetween('2025-12-20', '2026-01-17'), 28);
  assert.equal(addDays('2026-12-20', 28), '2027-01-17');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('平均周期：仅标记的记录和离谱的间隔不参与', () => {
  const records = [
    P('2026-01-01'),
    P('2026-01-29'), // 28
    P('2026-02-10', { notes: 'marked', duration: 1 }), // 仅标记，跳过
    P('2026-02-28'), // 30
    P('2026-06-01'), // 93，大于 65，视为漏记，跳过
  ];
  assert.deepEqual(cycleLengths(records), [30, 28]); // 新到旧
  assert.equal(averageCycle(records), 29);
  assert.equal(averageCycle([]), DEFAULT_CYCLE);
  assert.equal(averageCycle([P('2026-01-01')]), DEFAULT_CYCLE);
});

test('当前状态：第几天、预测、阶段', () => {
  const records = [P('2026-01-01'), P('2026-01-29')];
  const st = cycleStatus(records, '2026-02-02');
  assert.equal(st.avgCycle, 28);
  assert.equal(st.latest.start_date, '2026-01-29');
  assert.equal(st.daysInCycle, 4);
  assert.equal(st.nextPredicted, '2026-02-26');
  assert.equal(st.daysUntilNext, 24);
  assert.equal(st.phase, 'period');
  assert.equal(cycleStatus(records, '2026-02-03').phase, 'follicular');
});

test('经期天数按记录走，不固定 5 天', () => {
  const records = [P('2026-01-01', { duration: 7 })];
  assert.equal(cycleStatus(records, '2026-01-07').phase, 'period'); // 第 7 天
  assert.equal(cycleStatus(records, '2026-01-08').phase, 'follicular');
});

test('阶段划分：28 天周期第 14–16 天是排卵期', () => {
  // day 从 0 开始数：第 14 天（day=13）到第 16 天（day=15）
  assert.equal(phaseOfDay(12, 28, 5), 'follicular');
  assert.equal(phaseOfDay(13, 28, 5), 'ovulation');
  assert.equal(phaseOfDay(15, 28, 5), 'ovulation');
  assert.equal(phaseOfDay(16, 28, 5), 'luteal');
});

test('日历：已记录周期用实际阶段，之后一个周期标为预测', () => {
  const records = [P('2026-01-01'), P('2026-01-29')];
  assert.equal(phaseForDate(records, '2026-01-29', 28).phase, 'period');
  assert.equal(phaseForDate(records, '2026-01-29', 28).isStart, true);
  assert.equal(phaseForDate(records, '2026-02-26', 28).phase, 'pred-period');
  assert.equal(phaseForDate(records, '2025-12-01', 28), null);
  assert.equal(phaseForDate(records, '2026-02-30', 28), null);
});

test('还没有记录时不报错', () => {
  const st = cycleStatus([], '2026-01-01');
  assert.equal(st.latest, null);
  assert.equal(st.phase, null);
});

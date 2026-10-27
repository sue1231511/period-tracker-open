import {
  cycleStatus,
  phaseForDate,
  sortedRealPeriods,
  durationOf,
  isRealPeriod,
  DEFAULT_DURATION,
  MIN_DURATION,
  MAX_DURATION,
} from './cycle.js';
import { ICONS } from './icons.js';

// ── 浏览器端日志：格式和服务器一致，出错位置 + 关键变量 + 堆栈 ──
function logError(location, message, error, context = {}) {
  const stack = error && error.stack ? error.stack : String(error);
  console.error(`[${new Date().toISOString()}][ERROR][${location}] ${message} | ${JSON.stringify(context)} | 异常堆栈: ${stack}`);
}

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayLocal() {
  return fmt(new Date());
}
function md(s) {
  const [, m, d] = s.split('-');
  return `${Number(m)}月${Number(d)}日`;
}
function dateLabel(s) {
  const [y, m, d] = s.split('-').map(Number);
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  return `${m}月${d}日 · 周${days[new Date(y, m - 1, d).getDay()]}`;
}

let toastTimer = null;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ── 状态 ──
let periods = [];
let ovulations = [];
let avgCycle = 28;
const now = new Date();
let curYear = now.getFullYear();
let curMonth = now.getMonth();
let selectedDate = null;
let selectedOpt = 'period';
let duration = DEFAULT_DURATION;
let currentTab = 0;

// ── 接口 ──
class AuthError extends Error {}

async function api(method, url, body) {
  const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401) throw new AuthError('登录已过期');
  let data = null;
  try {
    data = await res.json();
  } catch (parseError) {
    logError('app.api', '响应不是 JSON', parseError, { method, url, status: res.status });
    throw new Error(`服务器返回异常（${res.status}）`);
  }
  if (!res.ok) throw new Error((data && data.error) || `请求失败（${res.status}）`);
  return data;
}

function handleError(location, error, context, userMsg) {
  if (error instanceof AuthError) {
    window.location.href = '/login';
    return;
  }
  logError(location, userMsg, error, context);
  showToast(`${userMsg}：${error.message}`);
}

function applyRecords(data) {
  periods = Array.isArray(data.periods) ? data.periods : [];
  ovulations = Array.isArray(data.ovulations) ? data.ovulations : [];
  avgCycle = cycleStatus(periods, todayLocal()).avgCycle;
}

// ── 状态页 ──
const PHASE_INFO = {
  period: { name: '月经期', color: 'var(--period)', desc: '注意保暖，多喝热水，避免剧烈运动，可以热敷缓解不适' },
  follicular: { name: '卵泡期', color: 'var(--follicular)', desc: '雌激素升高，精力比较充沛，适合运动和开始新计划' },
  ovulation: { name: '排卵期', color: 'var(--ovulation)', desc: '估算的排卵日前后，体温可能微升' },
  luteal: { name: '黄体期', color: 'var(--luteal)', desc: '孕酮升高，容易疲惫、情绪敏感，对自己温柔一点' },
};

function phaseSections(ac) {
  const ovulDay = ac - 14;
  return [
    { key: 'period', name: '月经期', range: '第 1–5 天', desc: '保暖休息，热敷缓解', color: 'var(--period)' },
    { key: 'follicular', name: '卵泡期', range: `第 6–${ovulDay - 1} 天`, desc: '精力旺盛，适合运动', color: 'var(--follicular)' },
    { key: 'ovulation', name: '排卵期', range: `第 ${ovulDay}–${ovulDay + 2} 天`, desc: '估算的排卵日前后', color: 'var(--ovulation)' },
    { key: 'luteal', name: '黄体期', range: `第 ${ovulDay + 3}–${ac} 天`, desc: '孕酮升高，情绪敏感', color: 'var(--luteal)' },
  ];
}

function ringSvg(ac, dayIndex, periodLen) {
  const r = 42;
  const c = 52;
  const circ = 2 * Math.PI * r;
  const ovulDay = ac - 14;
  const fracs = [
    [periodLen / ac, 'var(--period)'],
    [Math.max(0, ovulDay - 1 - periodLen) / ac, 'var(--follicular)'],
    [3 / ac, 'var(--ovulation)'],
    [Math.max(0, ac - ovulDay - 2) / ac, 'var(--luteal)'],
  ];
  let start = 0;
  const arcs = fracs
    .map(([len, color]) => {
      const off = circ * (1 - start) + circ * 0.25;
      start += len;
      return `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-dasharray="${circ * len} ${circ * (1 - len)}" stroke-dashoffset="${off}"/>`;
    })
    .join('');
  const angle = (Math.min(dayIndex, ac - 1) / ac) * 360 - 90;
  const mx = c + r * Math.cos((angle * Math.PI) / 180);
  const my = c + r * Math.sin((angle * Math.PI) / 180);
  return `<svg viewBox="0 0 104 104" aria-hidden="true">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="7"/>
    ${arcs}
    <circle cx="${mx}" cy="${my}" r="4.5" fill="white" opacity=".9"/>
  </svg>`;
}

function renderStatus() {
  const st = cycleStatus(periods, todayLocal());
  const sec = $('status-section');
  if (!st.latest) {
    sec.innerHTML = `<div class="empty-state"><span class="ico">${ICONS.moon}</span><div>还没有记录，去日历页点一天添加第一条吧</div></div>`;
    $('stats-grid').hidden = true;
    renderHistory();
    return;
  }
  const ac = st.avgCycle;
  const ph = st.phase ? PHASE_INFO[st.phase] : null;
  const inCycle = st.daysInCycle >= 0 && st.daysInCycle < ac;
  const dayText = st.daysInCycle >= 0 ? st.daysInCycle + 1 : '—';
  sec.innerHTML = `
    <div class="ring-row">
      <div class="ring-wrap">
        ${ringSvg(ac, Math.max(0, st.daysInCycle), durationOf(st.latest))}
        <div class="ring-center"><div class="ring-day serif">${dayText}</div><div class="ring-day-label">周期第 ${dayText} 天</div></div>
      </div>
      <div class="ring-info">
        <div class="phase-name serif" style="color:${ph ? ph.color : 'var(--text-mid)'}">${ph ? ph.name : inCycle ? '—' : '已超过预测'}</div>
        <div class="phase-desc">${ph ? ph.desc : '这次周期比平均长，可能快来了，也可能是漏记了上一次。'}</div>
        ${st.daysUntilNext >= 0 ? `<div class="phase-next">距下次经期 · ${st.daysUntilNext} 天</div>` : `<div class="phase-next">比预测晚了 ${-st.daysUntilNext} 天</div>`}
      </div>
    </div>
    <div class="sep"></div>
    <div class="timeline">${phaseSections(ac)
      .map((s) => {
        const cur = s.key === st.phase;
        return `<div class="tl-row${cur ? ' curr' : ''}">
          <div class="tl-left"><div class="tl-dot" style="background:${s.color}"></div><div class="tl-line"></div></div>
          <div class="tl-right"><div class="tl-name serif">${s.name}<span class="tl-range">${s.range}</span></div><div class="tl-desc">${s.desc}</div></div>
        </div>`;
      })
      .join('')}</div>`;
  $('stats-grid').hidden = false;
  $('stat-last').textContent = md(st.latest.start_date);
  $('stat-cycle').textContent = `${ac} 天`;
  $('stat-next').textContent = st.nextPredicted ? md(st.nextPredicted) : '—';
  renderHistory();
}

function renderHistory() {
  const real = sortedRealPeriods(periods);
  const sortedOv = [...ovulations].sort((a, b) => (a.ovulation_date < b.ovulation_date ? 1 : -1));
  const sec = $('history-section');
  if (!real.length && !sortedOv.length) {
    sec.hidden = true;
    return;
  }
  sec.hidden = false;
  const rows = [
    ...real.map(
      (r) => `<div class="hist-item">
        <div class="hist-dot c-period"></div>
        <div class="hist-date serif">${escapeHtml(md(r.start_date))}</div>
        <div class="hist-meta">经期 · 持续 ${durationOf(r)} 天</div>
        <button type="button" class="hist-del" data-del="period" data-date="${escapeHtml(r.start_date)}">删除</button>
      </div>`
    ),
    ...sortedOv.map(
      (r) => `<div class="hist-item">
        <div class="hist-dot c-ovulation"></div>
        <div class="hist-date serif">${escapeHtml(md(r.ovulation_date))}</div>
        <div class="hist-meta">排卵期</div>
        <button type="button" class="hist-del" data-del="ovulation" data-date="${escapeHtml(r.ovulation_date)}">删除</button>
      </div>`
    ),
  ];
  $('history-list').innerHTML = rows.join('');
}

// ── 日历页 ──
const MONTH_NAMES = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const MONTH_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function renderCalendar() {
  $('cal-month-title').textContent = MONTH_NAMES[curMonth];
  $('cal-year-title').textContent = `${MONTH_EN[curMonth]} ${curYear}`;
  const today = todayLocal();
  const startDay = new Date(curYear, curMonth, 1).getDay();
  const lastDate = new Date(curYear, curMonth + 1, 0).getDate();
  const ovSet = new Set(ovulations.map((o) => o.ovulation_date));
  const markSet = new Set(periods.filter((p) => !isRealPeriod(p)).map((p) => p.start_date));
  let html = '';
  for (let i = 0; i < startDay; i++) html += '<div class="day empty"></div>';
  for (let d = 1; d <= lastDate; d++) {
    const ds = `${curYear}-${String(curMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const info = phaseForDate(periods, ds, avgCycle);
    let cls = 'day';
    if (info) cls += ` phase-${info.phase}`;
    if (markSet.has(ds)) cls += ' is-marked';
    if (ds === today) cls += ' is-today';
    if (ds === selectedDate) cls += ' selected';
    const flower = ovSet.has(ds) ? `<span class="day-flower">${ICONS.flower}</span>` : '';
    html += `<div class="${cls}" data-date="${ds}" role="button" tabindex="0" aria-label="${dateLabel(ds)}">${flower}<div class="day-num">${d}</div><div class="day-dot"></div></div>`;
  }
  $('days-grid').innerHTML = html;
  renderPhaseStrip();
}

function renderPhaseStrip() {
  const st = cycleStatus(periods, todayLocal());
  $('phase-strip').innerHTML = phaseSections(st.avgCycle)
    .map((it) => {
      const cur = it.key === st.phase;
      return `<div class="phase-strip-item${cur ? ' curr' : ''}">
        <div class="ps-dot" style="background:${it.color}"></div>
        <div class="ps-info"><div class="ps-name serif">${it.name} · ${it.range}</div><div class="ps-tip">${it.desc}</div></div>
        ${cur ? '<div class="ps-tag">当前</div>' : ''}
      </div>`;
    })
    .join('');
}

function renderAll() {
  renderStatus();
  renderCalendar();
}

// ── 记录弹层 ──
function selectOpt(opt) {
  selectedOpt = opt;
  document.querySelectorAll('.sheet-opt').forEach((el) => {
    const on = el.dataset.opt === opt;
    el.classList.toggle('active', on);
    el.querySelector('.sheet-check').innerHTML = on ? ICONS.check : '';
  });
  $('duration-row').hidden = opt !== 'period';
}

function openSheet(ds) {
  selectedDate = ds;
  $('sheet-date').textContent = dateLabel(ds);
  const existing = periods.find((r) => r.start_date === ds);
  const hasOv = ovulations.some((r) => r.ovulation_date === ds);
  duration = existing && isRealPeriod(existing) ? durationOf(existing) : DEFAULT_DURATION;
  $('dur-val').textContent = duration;
  // 这天已有经期或排卵期记录，默认选「清除」；只是「仅标记」或空白，默认选「月经期开始」
  selectOpt((existing && isRealPeriod(existing)) || hasOv ? 'clear' : 'period');
  renderCalendar();
  $('sheet-overlay').classList.add('open');
}

function closeSheet() {
  $('sheet-overlay').classList.remove('open');
  selectedDate = null;
  renderCalendar();
}

function changeDur(delta) {
  duration = Math.max(MIN_DURATION, Math.min(MAX_DURATION, duration + delta));
  $('dur-val').textContent = duration;
}

const SAVE_TOAST = { period: '已记录月经期开始', ovulation: '已记录排卵期', mark: '已标记', clear: '已清除记录' };

async function saveRecord() {
  if (!selectedDate) return;
  const btn = $('btn-save');
  btn.disabled = true;
  const date = selectedDate;
  try {
    const body = { date, kind: selectedOpt };
    if (selectedOpt === 'period') body.duration = duration;
    applyRecords(await api('POST', '/api/day', body));
    showToast(SAVE_TOAST[selectedOpt]);
    closeSheet();
    renderStatus();
  } catch (error) {
    handleError('app.saveRecord', error, { date, kind: selectedOpt }, '保存失败');
  } finally {
    btn.disabled = false;
  }
}

// ── 删除确认 ──
let pendingDelete = null;

function askDelete(kind, date) {
  pendingDelete = { kind, date };
  $('confirm-text').textContent = `确认删除 ${md(date)} 的${kind === 'ovulation' ? '排卵期' : '经期'}记录？`;
  $('confirm-overlay').hidden = false;
}

async function confirmDelete() {
  const job = pendingDelete;
  $('confirm-overlay').hidden = true;
  pendingDelete = null;
  if (!job) return;
  try {
    const url = job.kind === 'ovulation' ? `/api/ovulations/${job.date}` : `/api/periods/${job.date}`;
    await api('DELETE', url);
    applyRecords(await api('GET', '/api/records'));
    showToast('已删除');
    renderAll();
  } catch (error) {
    handleError('app.confirmDelete', error, job, '删除失败');
  }
}

// ── 标签页 + 左右滑动 ──
function switchTab(idx, animate = true) {
  currentTab = idx;
  const wrapper = $('swipe-wrapper');
  if (!animate) wrapper.style.transition = 'none';
  wrapper.style.transform = `translateX(-${idx * 100}%)`;
  if (!animate) requestAnimationFrame(() => (wrapper.style.transition = ''));
  [0, 1].forEach((i) => $(`tab-${i}`).classList.toggle('active', i === idx));
  const t = $(`tab-${idx}`);
  const line = $('tab-line');
  line.style.left = `${t.offsetLeft}px`;
  line.style.width = `${t.offsetWidth}px`;
}

function bindSwipe() {
  const container = $('swipe-container');
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let horiz = null;
  container.addEventListener(
    'touchstart',
    (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dragging = true;
      horiz = null;
    },
    { passive: true }
  );
  container.addEventListener(
    'touchmove',
    (e) => {
      if (!dragging) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (horiz === null) horiz = Math.abs(dx) > Math.abs(dy);
      if (!horiz) return;
      e.preventDefault();
      const wrapper = $('swipe-wrapper');
      wrapper.style.transition = 'none';
      wrapper.style.transform = `translateX(${-currentTab * 100 + (dx / container.offsetWidth) * 100}%)`;
    },
    { passive: false }
  );
  container.addEventListener('touchend', (e) => {
    if (!dragging || !horiz) {
      dragging = false;
      return;
    }
    dragging = false;
    const dx = e.changedTouches[0].clientX - startX;
    $('swipe-wrapper').style.transition = '';
    if (dx < -50 && currentTab < 1) switchTab(1);
    else if (dx > 50 && currentTab > 0) switchTab(0);
    else switchTab(currentTab);
  });
}

// ── 事件绑定（页面开了 CSP，不能写内联 onclick）──
function bindEvents() {
  $('logout-btn').innerHTML = ICONS.logout;
  $('cal-prev').innerHTML = ICONS.chevronLeft;
  $('cal-next').innerHTML = ICONS.chevronRight;
  $('dur-minus').innerHTML = ICONS.minus;
  $('dur-plus').innerHTML = ICONS.plus;

  document.querySelectorAll('.tab').forEach((el) => el.addEventListener('click', () => switchTab(Number(el.dataset.tab))));
  $('cal-prev').addEventListener('click', () => {
    curMonth -= 1;
    if (curMonth < 0) {
      curMonth = 11;
      curYear -= 1;
    }
    renderCalendar();
  });
  $('cal-next').addEventListener('click', () => {
    curMonth += 1;
    if (curMonth > 11) {
      curMonth = 0;
      curYear += 1;
    }
    renderCalendar();
  });
  $('cal-today').addEventListener('click', () => {
    const n = new Date();
    curYear = n.getFullYear();
    curMonth = n.getMonth();
    renderCalendar();
  });

  const grid = $('days-grid');
  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.day[data-date]');
    if (cell) openSheet(cell.dataset.date);
  });
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const cell = e.target.closest('.day[data-date]');
    if (cell) {
      e.preventDefault();
      openSheet(cell.dataset.date);
    }
  });

  document.querySelectorAll('.sheet-opt').forEach((el) => el.addEventListener('click', () => selectOpt(el.dataset.opt)));
  $('sheet-overlay').addEventListener('click', (e) => {
    if (e.target === $('sheet-overlay')) closeSheet();
  });
  $('btn-cancel').addEventListener('click', closeSheet);
  $('btn-save').addEventListener('click', saveRecord);
  $('dur-minus').addEventListener('click', () => changeDur(-1));
  $('dur-plus').addEventListener('click', () => changeDur(1));

  $('history-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del]');
    if (btn) askDelete(btn.dataset.del, btn.dataset.date);
  });
  $('confirm-no').addEventListener('click', () => {
    $('confirm-overlay').hidden = true;
    pendingDelete = null;
  });
  $('confirm-yes').addEventListener('click', confirmDelete);

  window.addEventListener('resize', () => switchTab(currentTab, false));
  bindSwipe();
}

async function init() {
  bindEvents();
  try {
    applyRecords(await api('GET', '/api/records'));
    renderAll();
  } catch (error) {
    if (error instanceof AuthError) {
      window.location.href = '/login';
      return;
    }
    logError('app.init', '加载记录失败', error);
    $('status-section').innerHTML = `<div class="loading-state error">加载失败：${escapeHtml(error.message)}</div>`;
    renderCalendar();
  }
  requestAnimationFrame(() => switchTab(0, false));
}

init();

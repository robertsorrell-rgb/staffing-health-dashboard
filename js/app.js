import { heatmapBandClass } from './heatmap-bands.js';
import { mergeCombinedByGroupRows } from './vto-canonical-sales-group.js';

/** Short weekday (Intl en-US in Chicago) → compact abbrev (shared: OT early warning + VTO week range). */
const OT_WARN_WEEKDAY_ABBREV = {
  Sun: 'Su',
  Mon: 'M',
  Tue: 'Tu',
  Wed: 'We',
  Thu: 'Th',
  Fri: 'Fr',
  Sat: 'Sa',
};

/** YYYY-MM-DD → "M, 5/6" / "Sa, 5/9" (Chicago weekday + M/D, no leading zeros). */
function fmtOtWarnDayCt(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || '—';
  const parts = ymd.split('-');
  const year = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const da = parseInt(parts[2], 10);
  const ms = Date.UTC(year, mo - 1, da, 18, 0, 0);
  const shortWd = new Date(ms).toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'America/Chicago',
  });
  const abbr = OT_WARN_WEEKDAY_ABBREV[shortWd] || shortWd;
  return `${abbr}, ${mo}/${da}`;
}

const REFRESH_MS = parseInt(
  typeof window.__REFRESH_MS__ === 'number' ? window.__REFRESH_MS__ : 150000,
  10
);

const ENDPOINTS = [
  ['net-staffing', '/api/net-staffing'],
  ['idle-hourly-log', '/api/idle-hourly-log'],
  ['adherence', '/api/adherence'],
  ['targeted-vto', '/api/targeted-vto'],
  ['auto-vto', '/api/auto-vto'],
  ['bobbot', '/api/bobbot'],
  ['callout', '/api/callout'],
  ['ot-fill-rate', '/api/ot-fill-rate'],
];

/** Prefer human-readable columns; skip internal-id headers where possible. */
const PREVIEW_AUTO_VTO = {
  preferred: ['date requested', 'timestamp', 'rep', 'agent', 'name', 'decision', 'hours', 'queue', 'manager'],
  skip: [],
  maxCols: 6,
};
/** PTO table: Name · Sales group · Status · Manager only (see pickBobbotPtoIndices). */
const PREVIEW_BOBBOT = {
  pick: 'bobbot-pto',
  skip: [/request.?key/i, /^pid[:|]/i, /employee.?key/i],
};

/** Bobbot `queue` / sales-group strings → CS_Hourly_Log group keys for `groups_by_day` averaging. */
const BOBBOT_QUEUE_IDLE_RULES = [
  {
    cohort: 'Adult Learning',
    groups: ['Core Test Group', 'Languages Test Group'],
    test: (q) => /adult learner/i.test(q),
  },
  {
    cohort: 'College / grad',
    groups: ['STEM College Test Group', 'Graduate Test Prep'],
    test: (q) => /college\s+and\s+grad|college.*grad\s+tp/i.test(q),
  },
  {
    cohort: 'Elementary / LD',
    groups: ['K-6 Test Group', 'Learning Differences Test Group'],
    test: (q) => /elementary\s+and\s+ld|elementary.*\s+ld/i.test(q),
  },
  {
    cohort: 'High school',
    groups: ['STEM High School Test Group', 'K12 Test Prep'],
    test: (q) => /high\s+school/i.test(q),
  },
];

/** Intraday PTO reach-out suggestions start at this hour (Central). */
const BOBBOT_REACHOUT_START_HOUR_CT = 11;

/** Recommend reach-out when blended idle % for mapped groups is at least this (full day, CT sheet date). */
const BOBBOT_REACHOUT_IDLE_MIN_PCT = 40;
const PREVIEW_CALLOUT = {
  preferred: ['timestamp', 'agent', 'name', 'manager', 'queue', 'reason', 'status', 'date'],
  skip: [],
  maxCols: 6,
};

/** Sheet group names → one dashboard row (simple mean of listed %); CSR omitted. */
const IDLE_MERGE_SPECS = [
  { label: 'Adult Learning', sources: ['Core Test Group', 'Languages Test Group'] },
  { label: 'High School', sources: ['STEM High School Test Group', 'K12 Test Prep'] },
  { label: 'ELD', sources: ['K-6 Test Group', 'Learning Differences Test Group'] },
  { label: 'College', sources: ['STEM College Test Group', 'Graduate Test Prep'] },
];

function normalizeIdleGroupName(name) {
  return String(name ?? '').trim().toLowerCase();
}

function averageIdlePercents(pcts) {
  const nums = pcts.filter((v) => v != null && !Number.isNaN(Number(v))).map((v) => Number(v));
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

/** @param {Record<string, number|null|undefined>} rawMap */
function mergeIdleGroupBreakdown(rawMap) {
  if (!rawMap || typeof rawMap !== 'object') return {};
  const src = { ...rawMap };
  const consumed = new Set();
  const out = {};

  for (const spec of IDLE_MERGE_SPECS) {
    const vals = spec.sources.map((key) => src[key]);
    const merged = averageIdlePercents(vals);
    if (merged != null) out[spec.label] = merged;
    for (const key of spec.sources) consumed.add(key);
  }

  for (const [name, pct] of Object.entries(src)) {
    if (consumed.has(name)) continue;
    if (normalizeIdleGroupName(name) === 'csr') continue;
    out[name] = pct == null || Number.isNaN(Number(pct)) ? null : Number(pct);
  }
  return out;
}

function sortedIdleGroupEntries(rawMap) {
  const merged = mergeIdleGroupBreakdown(rawMap);
  return Object.entries(merged).sort((a, b) => (b[1] || 0) - (a[1] || 0));
}

function currentCTHourBrowser() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const h = parts.find((p) => p.type === 'hour');
  return h ? parseInt(h.value, 10) : 0;
}

function averageIdlePercentsFromMap(groupsByDay, groupKeys) {
  const vals = groupKeys
    .map((k) => groupsByDay[k])
    .filter((v) => v != null && !Number.isNaN(Number(v)))
    .map((v) => Number(v));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

/** Map Bobbot queue label → weighted idle % from idle API `groups_by_day` (raw keys, not merged labels). */
function bobbotQueueDayIdlePct(queue, groupsByDay) {
  if (!groupsByDay || typeof groupsByDay !== 'object') {
    return { pct: null, cohort: null };
  }
  const q = String(queue || '').trim();
  if (!q) return { pct: null, cohort: null };
  for (const rule of BOBBOT_QUEUE_IDLE_RULES) {
    if (rule.test(q)) {
      const pct = averageIdlePercentsFromMap(groupsByDay, rule.groups);
      return { pct, cohort: rule.cohort };
    }
  }
  const direct = groupsByDay[q];
  if (direct != null && !Number.isNaN(Number(direct))) {
    return { pct: Number(direct), cohort: null };
  }
  const qLow = q.toLowerCase();
  for (const key of Object.keys(groupsByDay)) {
    if (key.trim().toLowerCase() === qLow) {
      const v = groupsByDay[key];
      if (v != null && !Number.isNaN(Number(v))) return { pct: Number(v), cohort: null };
    }
  }
  return { pct: null, cohort: null };
}

/** Idle emphasis: ≥30% yellow, ≥40% orange, ≥50% red (strongest band wins). */
function idlePctBandClassForValue(p) {
  if (p == null || p === '' || Number.isNaN(Number(p))) return '';
  const n = Number(p);
  if (n >= 50) return 'idle-pct-red';
  if (n >= 40) return 'idle-pct-orange';
  if (n >= 30) return 'idle-pct-yellow';
  return '';
}

/** OT fill %: below 70% red, 70–89.9% yellow, 90%+ green. */
function otFillPctBandClass(p) {
  if (p == null || p === '' || Number.isNaN(Number(p))) return '';
  const n = Number(p);
  if (n < 70) return 'ot-fill-pct-red';
  if (n < 90) return 'ot-fill-pct-yellow';
  return 'ot-fill-pct-green';
}

function formatTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', { timeZone: 'America/Chicago', hour12: true, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

/** Calendar YYYY-MM-DD in America/Chicago (matches backend `todayCTDateStr`). */
function todayISOChicago() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

function idleGroupListHtml(entries, heading) {
  if (!entries.length) return '';
  const lis = entries
    .map(([g, p]) => {
      const band = idlePctBandClassForValue(p);
      const cls = band ? ` class="${band}"` : '';
      return `<li${cls}>${escapeHtml(g)}: ${p != null ? p + '%' : '—'}</li>`;
    })
    .join('');
  return (
    `<div class="panel-sub" style="margin-top:10px;">${escapeHtml(heading)}</div>` + `<ul class="idle-group-list">${lis}</ul>`
  );
}

async function fetchJson(url) {
  // Avoid stale dashboard data: API handlers set Cache-Control max-age; default refresh would reuse it.
  const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Bad JSON from ${url}: ${text.slice(0, 120)}`);
  }
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

function renderHeatmap(container, payload) {
  container.innerHTML = '';
  if (!payload.ok || !payload.matrix || !payload.matrix.length) {
    container.innerHTML = `<p class="panel-muted" style="padding:16px;">${
      payload.note ||
      'No net staffing matrix for today CT (set ASSEMBLED_API_KEY and/or confirm Capacity Pull tab + CAPACITY_PULL_* env).'
    }</p>`;
    return;
  }
  const hours = payload.hours || [];
  const table = document.createElement('table');
  table.className = 'heatmap-table';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  const corner = document.createElement('th');
  corner.textContent = 'Sales group';
  corner.className = 'corner';
  trh.appendChild(corner);
  for (const h of hours) {
    const th = document.createElement('th');
    th.textContent = formatSparklineHour12(h);
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const row of payload.matrix) {
    const tr = document.createElement('tr');
    const td0 = document.createElement('td');
    td0.textContent = row.group;
    const isAggregate = /^aggregate$/i.test(String(row.group || '').trim());
    td0.className = isAggregate ? 'row-label row-label-aggregate' : 'row-label';
    tr.appendChild(td0);
    for (const h of hours) {
      const td = document.createElement('td');
      const d = row.hours[String(h)];
      if (d == null) {
        td.textContent = '—';
        td.className = 'hm-neutral';
      } else {
        td.textContent = `${d > 0 ? '+' : ''}${d}%`;
        td.className = heatmapBandClass(d);
        td.title = `Deviation ${d}%`;
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  const wrap = document.createElement('div');
  wrap.className = 'heatmap-table-wrap';
  wrap.appendChild(table);
  container.appendChild(wrap);
}

/** 0–23 → compact 12-hour label for sparkline axis (e.g. 7 AM, 12 PM, 9 PM). */
function formatSparklineHour12(h) {
  const n = Math.floor(Number(h));
  if (!Number.isFinite(n) || n < 0 || n > 23) return String(h);
  if (n === 0) return '12 AM';
  if (n === 12) return '12 PM';
  if (n < 12) return `${n} AM`;
  return `${n - 12} PM`;
}

/** RGB stops for idle sparkline: low % cool → amber → orange → red (continuous heat ramp). */
const IDLE_SPARK_RGB = {
  cool: [59, 143, 196],
  mild: [105, 168, 138],
  warn: [201, 162, 39],
  hot: [232, 148, 61],
  bad: [201, 48, 48],
  worse: [145, 28, 34],
};

function lerpChannel(a, b, t) {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

function rgbFloatToHex(r, g, b) {
  return (
    '#' +
    [r, g, b]
      .map((x) =>
        Math.max(0, Math.min(255, Math.round(x)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}

function lerpRgbTriple(c1, c2, t) {
  const u = Math.min(1, Math.max(0, t));
  return [
    lerpChannel(c1[0], c2[0], u),
    lerpChannel(c1[1], c2[1], u),
    lerpChannel(c1[2], c2[2], u),
  ];
}

/** Idle % (0–100) → hex stroke color; aligns loosely with 30/40/50 band semantics. */
function idleSparkColorHex(pct) {
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  const { cool, mild, warn, hot, bad, worse } = IDLE_SPARK_RGB;
  let rgb;
  if (p < 15) rgb = lerpRgbTriple(cool, mild, p / 15);
  else if (p < 30) rgb = lerpRgbTriple(mild, warn, (p - 15) / 15);
  else if (p < 40) rgb = lerpRgbTriple(warn, hot, (p - 30) / 10);
  else if (p < 50) rgb = lerpRgbTriple(hot, bad, (p - 40) / 10);
  else rgb = lerpRgbTriple(bad, worse, Math.min(1, (p - 50) / 40));
  return rgbFloatToHex(rgb[0], rgb[1], rgb[2]);
}

/** Which hours get a tick + label under the idle sparkline (start/end always included). */
function pickSparklineHourTicks(minH, maxH) {
  const lo = Math.min(minH, maxH);
  const hi = Math.max(minH, maxH);
  const range = hi - lo;
  const step = range <= 8 ? 1 : range <= 16 ? 2 : Math.max(1, Math.ceil(range / 8));
  const ticks = [];
  for (let h = lo; h <= hi; h += step) ticks.push(h);
  if (ticks[ticks.length - 1] !== hi) ticks.push(hi);
  return ticks;
}

function renderSparkline(container, spark) {
  container.innerHTML = '';
  if (!spark || !spark.length) return;
  const vals = spark.map((s) => (s.idle_pct == null ? null : s.idle_pct));
  const defined = vals.filter((v) => v != null);
  if (!defined.length) return;

  const w = 560;
  const chartH = 68;
  const axisH = 28;
  const padX = 12;
  /** Left gutter for % axis labels */
  const padYL = 36;
  const padTop = 10;
  const totalH = padTop + chartH + axisH;
  const plotRight = w - padX;
  const plotW = plotRight - padYL;

  const hoursPresent = spark.map((s) => s.hour).filter((h) => h != null && Number.isFinite(Number(h)));
  let minH;
  let maxH;
  let xPos;
  if (hoursPresent.length) {
    minH = Math.min(...hoursPresent);
    maxH = Math.max(...hoursPresent);
    const hourSpan = Math.max(maxH - minH, 1e-6);
    xPos = (hour) => padYL + ((hour - minH) / hourSpan) * plotW;
  } else {
    minH = 0;
    maxH = Math.max(spark.length - 1, 1);
    const idxSpan = Math.max(spark.length - 1, 1);
    xPos = (_hour, i = 0) => padYL + (i / idxSpan) * plotW;
  }

  /** Idle % is 0–100; fixed scale matches left axis. */
  const yAt = (v) => {
    const n = Number(v);
    const clamped = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
    return padTop + chartH - (clamped / 100) * chartH;
  };
  const yAtPct = (pct) => padTop + chartH - (pct / 100) * chartH;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${totalH}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.classList.add('sparkline-svg');
  const axisY = padTop + chartH;
  const tickHours = hoursPresent.length ? pickSparklineHourTicks(minH, maxH) : [];

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  svg.appendChild(defs);

  /** @type {{ x: number; y: number; v: number }[]} */
  const pts = [];
  spark.forEach((s, i) => {
    const v = s.idle_pct;
    if (v == null) return;
    const hour = s.hour != null && Number.isFinite(Number(s.hour)) ? Number(s.hour) : null;
    const x = hour != null ? xPos(hour) : xPos(null, i);
    const y = yAt(v);
    pts.push({ x, y, v: Number(v) });
  });

  if (pts.length >= 2) {
    for (let si = 0; si < pts.length - 1; si++) {
      const a = pts[si];
      const b = pts[si + 1];
      const gid = `idle-spark-seg-${si}`;
      const lg = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
      lg.setAttribute('id', gid);
      lg.setAttribute('gradientUnits', 'userSpaceOnUse');
      lg.setAttribute('x1', String(a.x));
      lg.setAttribute('y1', String(a.y));
      lg.setAttribute('x2', String(b.x));
      lg.setAttribute('y2', String(b.y));
      const stop0 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop0.setAttribute('offset', '0%');
      stop0.setAttribute('stop-color', idleSparkColorHex(a.v));
      const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop1.setAttribute('offset', '100%');
      stop1.setAttribute('stop-color', idleSparkColorHex(b.v));
      lg.appendChild(stop0);
      lg.appendChild(stop1);
      defs.appendChild(lg);
    }
  }

  const yPctTicks = [100, 50, 0];
  for (const p of yPctTicks) {
    const y = yAtPct(p);
    const hline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hline.setAttribute('x1', String(padYL));
    hline.setAttribute('y1', String(y));
    hline.setAttribute('x2', String(plotRight));
    hline.setAttribute('y2', String(y));
    hline.setAttribute('class', 'sparkline-grid-h');
    svg.appendChild(hline);
    const ylab = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    ylab.setAttribute('x', String(padYL - 6));
    ylab.setAttribute('y', String(y + 3));
    ylab.setAttribute('text-anchor', 'end');
    ylab.setAttribute('class', 'sparkline-y-label');
    ylab.textContent = `${p}%`;
    svg.appendChild(ylab);
  }

  for (const th of tickHours) {
    const x = xPos(th);
    const grid = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    grid.setAttribute('x1', String(x));
    grid.setAttribute('y1', String(padTop));
    grid.setAttribute('x2', String(x));
    grid.setAttribute('y2', String(axisY));
    grid.setAttribute('class', 'sparkline-grid');
    svg.appendChild(grid);
  }

  const strokeW = 2.35;
  if (pts.length >= 2) {
    for (let si = 0; si < pts.length - 1; si++) {
      const a = pts[si];
      const b = pts[si + 1];
      const seg = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      seg.setAttribute('x1', String(a.x));
      seg.setAttribute('y1', String(a.y));
      seg.setAttribute('x2', String(b.x));
      seg.setAttribute('y2', String(b.y));
      seg.setAttribute('stroke', `url(#idle-spark-seg-${si})`);
      seg.setAttribute('stroke-width', String(strokeW));
      seg.setAttribute('stroke-linecap', 'round');
      svg.appendChild(seg);
    }
  } else if (pts.length === 1) {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', String(pts[0].x));
    dot.setAttribute('cy', String(pts[0].y));
    dot.setAttribute('r', '3.25');
    dot.setAttribute('fill', idleSparkColorHex(pts[0].v));
    dot.setAttribute('stroke', '#fff');
    dot.setAttribute('stroke-width', '0.75');
    svg.appendChild(dot);
  }

  for (const th of tickHours) {
    const x = xPos(th);
    const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    tick.setAttribute('x1', String(x));
    tick.setAttribute('y1', String(axisY));
    tick.setAttribute('x2', String(x));
    tick.setAttribute('y2', String(axisY + 5));
    tick.setAttribute('class', 'sparkline-tick');
    svg.appendChild(tick);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(x));
    label.setAttribute('y', String(axisY + 14));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'sparkline-hour-label');
    label.textContent = formatSparklineHour12(th);
    svg.appendChild(label);
  }

  const hi = hoursPresent.length ? maxH : spark.length - 1;
  const lo = hoursPresent.length ? minH : 0;
  svg.setAttribute(
    'aria-label',
    hoursPresent.length
      ? `Idle percent from ${formatSparklineHour12(lo)} to ${formatSparklineHour12(hi)} Central; line color maps cool to warm by percentage`
      : 'Idle percent trend; line color maps cool to warm by percentage'
  );

  container.appendChild(svg);
  if (hoursPresent.length) {
    const cap = document.createElement('div');
    cap.className = 'sparkline-axis-caption';
    cap.textContent = 'Hour of day (Central)';
    container.appendChild(cap);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Safe double-quoted attribute value for titles / tooltips. */
function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/\s+/g, ' ')
    .trim();
}

function previewTableHtml(headers, colIndices, rows, headLabels = null) {
  if (!headers?.length || !colIndices?.length) return '<p class="panel-muted">No preview columns</p>';
  const th = colIndices
    .map((i, j) => `<th>${escapeHtml(String(headLabels?.[j] ?? headers[i] ?? ''))}</th>`)
    .join('');
  const body = rows
    .slice(0, 12)
    .map((r) => {
      const cells = colIndices
        .map((i) => {
          const raw = String(r[i] ?? '');
          return `<td title="${escapeAttr(raw)}">${escapeHtml(raw)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<div class="preview-table-wrap"><table class="preview-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function tablePreview(headers, rows, maxCols = 6) {
  if (!headers || !headers.length) return '<p class="panel-muted">No headers</p>';
  const n = Math.min(maxCols, headers.length);
  const idx = Array.from({ length: n }, (_, i) => i);
  return previewTableHtml(headers, idx, rows);
}

/**
 * Column indices for Bobbot_History rows (Name, Sales group / queue, Decision, Manager).
 * @returns {{ nameI: number, queueI: number, statusI: number, mgrI: number }}
 */
function resolveBobbotPtoColumns(headers) {
  const lower = headers.map((h) => String(h || '').trim().toLowerCase());
  const used = new Set();
  const skip = (h) =>
    /request.?key/i.test(h) ||
    /^pid[:|]/i.test(h) ||
    /employee.?key/i.test(h);

  const takeFirst = (pred) => {
    for (let i = 0; i < lower.length; i++) {
      if (used.has(i)) continue;
      const h = lower[i];
      if (skip(h)) continue;
      if (pred(h)) {
        used.add(i);
        return i;
      }
    }
    return -1;
  };

  let nameI = takeFirst(
    (h) =>
      h === 'payroll_name' ||
      h.includes('payroll_name') ||
      h === 'employee_name' ||
      (h.includes('employee') && h.includes('name') && !h.includes('email')) ||
      h === 'name' ||
      h === 'rep name'
  );
  if (nameI < 0) nameI = takeFirst((h) => h === 'employee_email');
  if (nameI < 0) nameI = takeFirst((h) => h.includes('payroll'));

  const queueI = takeFirst(
    (h) => h === 'queue' || h.includes('sales group') || h.includes('sales_group')
  );

  const statusI = takeFirst(
    (h) =>
      h === 'status' ||
      h.includes('status') ||
      h === 'decision' ||
      h.includes('decision') ||
      h === 'stage' ||
      h.includes('stage') ||
      h.includes('approval')
  );

  const mgrI = takeFirst((h) => h.includes('manager') || h.includes('supervisor'));

  return { nameI, queueI, statusI, mgrI };
}

/**
 * Bobbot / PTO preview: four columns with stable labels.
 * @returns {{ indices: number[], labels: string[] }}
 */
function pickBobbotPtoIndices(headers) {
  const { nameI, queueI, statusI, mgrI } = resolveBobbotPtoColumns(headers);

  const indices = [];
  const labels = [];
  const push = (i, label) => {
    if (i >= 0 && !indices.includes(i)) {
      indices.push(i);
      labels.push(label);
    }
  };
  push(nameI, 'Name');
  push(queueI, 'Sales group');
  push(statusI, 'Status');
  push(mgrI, 'Manager');

  return { indices, labels };
}

function pickPreviewIndices(headers, prefs) {
  if (!headers?.length) return [];
  const maxCols = Math.min(prefs?.maxCols ?? 6, headers.length);
  const preferred = prefs?.preferred || [];
  const skipRes = prefs?.skip || [];
  const lower = headers.map((h) => String(h || '').trim().toLowerCase());
  const picked = [];
  const used = new Set();
  const skipped = (h) => skipRes.some((re) => re.test(h));

  for (const p of preferred) {
    const pl = String(p).toLowerCase();
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      const h = lower[i];
      if (skipped(h)) continue;
      if (h === pl || h.includes(pl)) {
        picked.push(i);
        used.add(i);
        break;
      }
    }
  }
  for (let i = 0; i < headers.length && picked.length < maxCols; i++) {
    if (used.has(i)) continue;
    const h = lower[i];
    if (skipped(h)) continue;
    picked.push(i);
    used.add(i);
  }

  if (!picked.length) {
    const softSkip = [/offer.?id/i, /deficit.?id/i, /request.?key/i, /employee.?key/i, /^rvto_/i];
    for (let i = 0; i < headers.length && picked.length < maxCols; i++) {
      const h = lower[i];
      if (softSkip.some((re) => re.test(h))) continue;
      picked.push(i);
    }
  }

  if (!picked.length) {
    return Array.from({ length: maxCols }, (_, i) => i).filter((i) => i < headers.length);
  }
  return picked.slice(0, maxCols);
}

function tablePreviewPick(headers, rows, prefs) {
  if (!headers?.length) return '<p class="panel-muted">No headers</p>';
  if (prefs?.pick === 'bobbot-pto') {
    const { indices, labels } = pickBobbotPtoIndices(headers);
    if (!indices.length) return '<p class="panel-muted">No preview columns</p>';
    return previewTableHtml(headers, indices, rows, labels);
  }
  const idx = pickPreviewIndices(headers, prefs || {});
  return previewTableHtml(headers, idx, rows);
}

function formatHoursDisplay(h) {
  if (h === null || h === undefined || h === '') return '—';
  const num = Number(h);
  if (Number.isNaN(num)) return '—';
  const n = Math.round(num * 100) / 100;
  if (Number.isInteger(n)) return String(n);
  return String(n).replace(/\.?0+$/, '');
}

/** Whole hours, always rounded up (VTO approvals card). */
function formatHoursCeilUp(h) {
  if (h === null || h === undefined || h === '') return '—';
  const num = Number(h);
  if (Number.isNaN(num)) return '—';
  return String(Math.ceil(num));
}

function htmlVtoCombinedByGroupTable(mergedRows, captionText) {
  if (!mergedRows?.length) return '';
  let sumTh = 0;
  let sumAh = 0;
  for (const r of mergedRows) {
    sumTh += Number(r.targeted_hours) || 0;
    sumAh += Number(r.automated_hours) || 0;
  }
  const sumTotalCeil = Math.ceil(sumTh + sumAh);
  const h = `<thead><tr><th>Sales group</th><th class="num">Targeted h</th><th class="num">Automated h</th><th class="num">Total h</th></tr></thead>`;
  const b = mergedRows
    .map((r) => {
      const tip = escapeAttr(`Bucket: ${r.group}`);
      const th = Number(r.targeted_hours) || 0;
      const ah = Number(r.automated_hours) || 0;
      const totalCeil = Math.ceil(th + ah);
      return `<tr><td title="${tip}">${escapeHtml(r.group)}</td><td class="num">${formatHoursCeilUp(r.targeted_hours)}</td><td class="num">${formatHoursCeilUp(r.automated_hours)}</td><td class="num">${String(totalCeil)}</td></tr>`;
    })
    .join('');
  const foot = `<tfoot><tr class="rollup-sum-row"><td>Total</td><td class="num">${formatHoursCeilUp(sumTh)}</td><td class="num">${formatHoursCeilUp(sumAh)}</td><td class="num">${String(sumTotalCeil)}</td></tr></tfoot>`;
  const cap = captionText
    ? `<p class="rollup-table-caption">${escapeHtml(captionText)}</p>`
    : '';
  return `${cap}<div class="preview-table-wrap"><table class="preview-table rollup-table">${h}<tbody>${b}</tbody>${foot}</table></div>`;
}

/** Combined VTO = Offers(COMMITTED) + Requests_Submissions(Decision Approved). */
function targetedVtoPanel(data, errMsg, autoPanel = {}, autoPanelErr = null) {
  const rollup = data.rollup || {};
  const auto = data.automated_rollup || {};
  const combined = data.combined || {};
  const combinedWeek = data.combined_week || {};
  const sum = data.summary || {};
  const autoSummary = autoPanel.summary || {};

  const hoursTargeted = sum.hours_targeted_from_offers ?? rollup.total_hours ?? 0;
  const hoursAuto =
    sum.hours_auto_approved ?? auto.hours_approved_today ?? autoSummary.hours_approved_today ?? 0;
  const hoursCombined =
    sum.hours_combined_approved ??
    combined.hours_approved ??
    Math.round((Number(hoursTargeted || 0) + Number(hoursAuto || 0)) * 100) / 100;

  let body = '';
  if (!errMsg && data.configured !== false) {
    if (data.targeted_fetch_error) {
      body += `<p class="panel-error">Offers tab: ${escapeHtml(data.targeted_fetch_error)}</p>`;
    }
    if (data.auto_fetch_error) {
      body += `<p class="panel-error">Requests_Submissions tab: ${escapeHtml(data.auto_fetch_error)}</p>`;
    }
    if (autoPanelErr && !data.auto_fetch_error) {
      body += `<p class="panel-error">Automated panel fallback: ${escapeHtml(autoPanelErr)}</p>`;
    }

    body += `<div class="vto-split">`;

    body += `<section class="vto-scope vto-scope-today vto-split-col" aria-labelledby="vto-head-today">`;
    body += `<h3 class="vto-period-title" id="vto-head-today"><span class="vto-period-label">Today</span></h3>`;
    body += `<div class="rollup-total"><span class="rollup-total-label">Approved VTO hours</span> <strong class="rollup-total-value">${formatHoursCeilUp(hoursCombined)} h</strong></div>`;

    if (typeof rollup.rows_missing_hours === 'number' && rollup.rows_missing_hours > 0) {
      body += `<p class="panel-muted rollup-missing">${rollup.rows_missing_hours} COMMITTED offer row(s) missing hour value.</p>`;
    }

    body += htmlVtoCombinedByGroupTable(mergeCombinedByGroupRows(combined.by_group || []), 'By sales group');
    body += `</section>`;

    body += `<section class="vto-scope vto-scope-week vto-split-col" aria-labelledby="vto-head-week">`;
    const weekMetaLine =
      combinedWeek.week_start && combinedWeek.week_end
        ? `${fmtOtWarnDayCt(combinedWeek.week_start)} – ${fmtOtWarnDayCt(combinedWeek.week_end)} · Sun–Sat (CT)`
        : combinedWeek.label
          ? `${combinedWeek.label} · Sun–Sat (CT)`
          : 'Sun–Sat · Central Time';
    body += `<h3 class="vto-period-title" id="vto-head-week"><span class="vto-period-label">This week</span><span class="vto-period-meta">${escapeHtml(weekMetaLine)}</span></h3>`;
    if (combinedWeek.targeted_fetch_error) {
      body += `<p class="panel-error">Offers tab (week): ${escapeHtml(combinedWeek.targeted_fetch_error)}</p>`;
    }
    if (combinedWeek.auto_fetch_error) {
      body += `<p class="panel-error">Requests_Submissions tab (week): ${escapeHtml(combinedWeek.auto_fetch_error)}</p>`;
    }
    body += htmlVtoCombinedByGroupTable(mergeCombinedByGroupRows(combinedWeek.by_group || []), 'By sales group');
    body += `</section>`;

    body += `</div>`;
  }

  return `
    <div class="panel-card panel-exception" id="panel-targeted-vto-bot">
      <div class="panel-title">VTO approvals</div>
      ${errMsg ? `<p class="panel-error">${escapeHtml(errMsg)}</p>` : ''}
      ${data.configured === false && !errMsg ? `<p class="panel-muted">${data.note || 'Not configured'}</p>` : ''}
      ${body}
    </div>
  `;
}

function htmlBobbotReachoutsColumn(bobbotData, bobbotErr, idleData, idleErr) {
  if (currentCTHourBrowser() < BOBBOT_REACHOUT_START_HOUR_CT) {
    const hr = BOBBOT_REACHOUT_START_HOUR_CT;
    return `<div class="idle-split-col bobbot-reachouts-col"><div class="idle-split-heading">Intraday reach-outs</div><p class="panel-muted" style="font-size:12px;line-height:1.45;margin-top:4px;">Suggested manager touchpoints for denied PTO when the floor is loose enough to approve intraday.</p><p class="panel-muted" style="font-size:11px;margin-top:10px;line-height:1.4;"><strong>${hr}:00 AM CT</strong> or later — check back then (idle ≥${BOBBOT_REACHOUT_IDLE_MIN_PCT}% vs CS_Hourly_Log).</p></div>`;
  }

  if (bobbotErr || bobbotData?.configured === false) {
    return `<div class="idle-split-col bobbot-reachouts-col"><div class="idle-split-heading">Intraday reach-outs</div><p class="panel-muted">Bobbot data unavailable.</p></div>`;
  }

  if (idleErr) {
    return `<div class="idle-split-col bobbot-reachouts-col"><div class="idle-split-heading">Intraday reach-outs</div><p class="panel-muted">Idle data unavailable.</p></div>`;
  }

  if (idleData?.note) {
    return `<div class="idle-split-col bobbot-reachouts-col"><div class="idle-split-heading">Intraday reach-outs</div><p class="panel-muted">${escapeHtml(String(idleData.note))}</p></div>`;
  }

  const headers = bobbotData.headers || [];
  const rows = bobbotData.rows_preview || [];
  const { nameI, queueI, statusI, mgrI } = resolveBobbotPtoColumns(headers);
  const gd = idleData.groups_by_day || {};

  const suggestions = [];
  for (const row of rows) {
    const status = String(row[statusI] ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
    if (status !== 'DENIED') continue;
    const queue = String(row[queueI] ?? '').trim();
    const { pct, cohort } = bobbotQueueDayIdlePct(queue, gd);
    if (pct == null || pct < BOBBOT_REACHOUT_IDLE_MIN_PCT) continue;
    const name = String(row[nameI] ?? '').trim() || '—';
    const mgr = String(row[mgrI] ?? '').trim() || '—';
    suggestions.push({ name, mgr, queue, pct, cohort });
  }

  let body = '';
  if (!suggestions.length) {
    body = `<p class="panel-muted">No suggestions — no denied PTO with mapped full-day idle ≥${BOBBOT_REACHOUT_IDLE_MIN_PCT}%.</p>`;
  } else {
    const lis = suggestions
      .map((s) => {
        const cohortNote = s.cohort ? ` · ${escapeHtml(s.cohort)} blend` : '';
        const band = idlePctBandClassForValue(s.pct);
        const cls = band ? ` class="${band}"` : '';
        return `<li${cls}><strong>${escapeHtml(s.name)}</strong> · ${escapeHtml(s.queue)} · idle <strong>${s.pct}%</strong> (day${cohortNote}) — Tell <strong>${escapeHtml(s.mgr)}</strong> intraday PTO may be approvable.</li>`;
      })
      .join('');
    body = `<ul class="bobbot-reachout-list">${lis}</ul>`;
  }

  const sub = `Denied PTO only · full-day idle vs CS_Hourly_Log · ≥${BOBBOT_REACHOUT_IDLE_MIN_PCT}% · from ${BOBBOT_REACHOUT_START_HOUR_CT}:00 CT`;
  return `<div class="idle-split-col bobbot-reachouts-col"><div class="idle-split-heading">Intraday reach-outs</div><p class="panel-muted" style="font-size:11px;margin-bottom:8px;line-height:1.35;">${escapeHtml(sub)}</p>${body}</div>`;
}

/** Bobbot card: denied PTO table + idle-driven reach-out suggestions (split like Idle / VTO). */
function bobbotPtoPanel(data, errMsg, idleData, idleErr) {
  const id = 'panel-bobbot-pto';
  const hasPreviewRows = !!(data.rows_preview && data.rows_preview.length);
  const prev =
    data.headers && data.rows_preview && hasPreviewRows
      ? tablePreviewPick(data.headers, data.rows_preview, PREVIEW_BOBBOT)
      : '';
  const hint = data.today_hint
    ? `<p class="panel-muted" style="margin-top:6px;line-height:1.35;">${escapeHtml(data.today_hint)}</p>`
    : '';
  const emptyToday =
    data.configured !== false && !errMsg && !hasPreviewRows && !data.today_hint
      ? `<p class="panel-muted" style="margin-top:8px;">No sheet rows for today (CT) in this preview.</p>`
      : '';
  const cfgHint = data.configuration_hint
    ? `<p class="panel-muted" style="margin-top:6px;font-size:11px;color:var(--amber);font-weight:600;">${escapeHtml(data.configuration_hint)}</p>`
    : '';

  const leftBlock =
    (errMsg ? `<p class="panel-error">${escapeHtml(errMsg)}</p>` : '') +
    (data.configured === false && !errMsg ? `<p class="panel-muted">${escapeHtml(data.note || 'Not configured')}</p>` : '') +
    hint +
    emptyToday +
    prev;

  return `
    <div class="panel-card panel-exception" id="${id}">
      <div class="panel-title">PTO</div>
      ${cfgHint}
      <div class="idle-split bobbot-pto-split">
        <div class="idle-split-col">
          <div class="idle-split-heading">Today's decisions</div>
          ${leftBlock}
        </div>
        ${htmlBobbotReachoutsColumn(data, errMsg, idleData, idleErr)}
      </div>
    </div>
  `;
}

function otFillSortValue(entry) {
  if (entry && typeof entry === 'object' && entry.fill_pct != null) return Number(entry.fill_pct);
  if (typeof entry === 'number') return entry;
  return -1;
}

function fmtOtHours(x) {
  if (x == null || Number.isNaN(Number(x))) return '—';
  const n = Math.round(Number(x) * 10) / 10;
  return Number.isInteger(n) ? String(n) : String(n);
}

/** Head + table fragments for paired layout (hours-style symmetry). */
function htmlOtFillEarlyWarningParts(ot, warnArr, maxPct) {
  if (!Array.isArray(warnArr)) return null;
  const thresh = Number.isFinite(Number(maxPct)) ? Number(maxPct) : 75;

  let tbody = '';
  if (warnArr.length === 0) {
    const colspan = ot.units === 'hours' ? 4 : 3;
    tbody = `<tr><td colspan="${colspan}" class="panel-muted" style="font-style:italic;padding:10px 8px;">None — no upcoming rows below ${escapeHtml(String(thresh))}%.</td></tr>`;
  } else if (ot.units === 'hours') {
    tbody = warnArr
      .map((w) => {
        const band = otFillPctBandClass(w.fill_pct);
        const cls = band ? ` class="${band}"` : '';
        const pctStr = w.fill_pct != null ? `${escapeHtml(String(w.fill_pct))}%` : '—';
        return `<tr${cls}><td>${escapeHtml(fmtOtWarnDayCt(w.date))}</td><td>${escapeHtml(String(w.group))}</td><td class="num">${escapeHtml(fmtOtHours(w.hours_open))}</td><td class="num">${pctStr}</td></tr>`;
      })
      .join('');
  } else {
    tbody = warnArr
      .map((w) => {
        const band = otFillPctBandClass(w.fill_pct);
        const cls = band ? ` class="${band}"` : '';
        const pctStr = w.fill_pct != null ? `${escapeHtml(String(w.fill_pct))}%` : '—';
        return `<tr${cls}><td>${escapeHtml(fmtOtWarnDayCt(w.date))}</td><td>${escapeHtml(String(w.group))}</td><td class="num">${pctStr}</td></tr>`;
      })
      .join('');
  }

  const hoursWarn = ot.units === 'hours';
  const thead = hoursWarn
    ? '<tr><th>Date</th><th>Group</th><th class="num">Open (h)</th><th class="num">%</th></tr>'
    : '<tr><th>Date</th><th>Group</th><th class="num">%</th></tr>';

  const tblCls = hoursWarn
    ? 'preview-table ot-fill-table ot-fill-warn-table ot-fill-warn-table--hours'
    : 'preview-table ot-fill-table ot-fill-warn-table';

  const headHtml = `<div class="ot-fill-head-block ot-fill-warn-head-block"><div class="panel-sub ot-fill-warn-heading ot-fill-early-warn-subhead">Early warning (&lt;${escapeHtml(String(thresh))}%)</div></div>`;

  const tableInner = `<div class="preview-table-wrap ot-fill-warn-table-wrap"><table class="${tblCls}"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;

  const afterTable =
    ot.fill_warnings_omitted > 0
      ? `<p class="panel-muted ot-fill-warn-omit">+${escapeHtml(String(ot.fill_warnings_omitted))} more not shown.</p>`
      : '';

  return { headHtml, tableInner, afterTable };
}

/** Legacy: full warn column when not using paired hours layout. */
function htmlOtFillEarlyWarningColumn(ot, warnArr, maxPct) {
  const parts = htmlOtFillEarlyWarningParts(ot, warnArr, maxPct);
  if (!parts) return '';
  return `<div class="idle-split-col ot-fill-warn-col">${parts.headHtml}${parts.tableInner}${parts.afterTable}</div>`;
}

function htmlOtFillColumn(ot, otErr) {
  if (otErr) {
    return `<p class="panel-error">${escapeHtml(otErr)}</p>`;
  }
  if (!ot || ot.configured === false) {
    return `<p class="panel-muted">${escapeHtml(ot?.note || 'OT fill not configured — set OT_FILL_TAB on the Functions env.')}</p>`;
  }

  const warnArr = Array.isArray(ot.fill_warnings) ? ot.fill_warnings : null;
  const hasWarnPanel = warnArr != null;
  const warnMaxPct = ot.fill_warning_max_pct;

  const hasTodayGroups = !!(ot.by_group && Object.keys(ot.by_group).length);
  const hasFutureWarnRows = !!(warnArr && warnArr.length);
  if (ot.note && !hasTodayGroups && !hasFutureWarnRows) {
    return `<p class="panel-muted">${escapeHtml(String(ot.note))}</p>`;
  }

  const entries = Object.entries(ot.by_group || {}).sort(
    (a, b) => otFillSortValue(b[1]) - otFillSortValue(a[1])
  );
  if (!entries.length && !ot.note && !hasFutureWarnRows) {
    return `<p class="panel-muted">No OT fill rows for today (CT).</p>`;
  }

  const firstRow = entries[0]?.[1];
  const hoursShape =
    ot.units === 'hours' ||
    (firstRow && typeof firstRow === 'object' && firstRow.hours_open != null) ||
    !!(warnArr && warnArr.some((w) => w && w.hours_open != null));

  let floorBlock = '';
  if (hoursShape && ot.floor_hours_open != null && ot.floor_hours_filled != null) {
    const pct =
      ot.floor_fill_pct != null
        ? ` · ${escapeHtml(String(ot.floor_fill_pct))}% filled`
        : '';
    const fb = otFillPctBandClass(ot.floor_fill_pct);
    const fbCls = fb ? ` ot-fill-floor-line ${fb}` : '';
    floorBlock = `<div class="panel-sub${fbCls}" style="margin-top:4px;">Floor: <strong>${escapeHtml(fmtOtHours(ot.floor_hours_filled))}h</strong> filled · <strong>${escapeHtml(fmtOtHours(ot.floor_hours_open))}h</strong> open${pct}</div>`;
  } else if (ot.floor_fill_pct != null) {
    const fb = otFillPctBandClass(ot.floor_fill_pct);
    const fbCls = fb ? ` ot-fill-floor-line ${fb}` : '';
    floorBlock = `<div class="panel-sub${fbCls}" style="margin-top:4px;">Floor OT fill: <strong>${escapeHtml(String(ot.floor_fill_pct))}%</strong></div>`;
  }

  let body = '';
  if (hoursShape && entries.length) {
    const rows = entries
      .map(([g, row]) => {
        const o = row && typeof row === 'object' ? row : null;
        if (!o || o.hours_open == null) return '';
        const band = otFillPctBandClass(o.fill_pct);
        const cls = band ? ` class="${band}"` : '';
        const pctStr = o.fill_pct != null ? `${escapeHtml(String(o.fill_pct))}%` : '—';
        return `<tr${cls}><td>${escapeHtml(g)}</td><td class="num">${escapeHtml(fmtOtHours(o.hours_filled))}</td><td class="num">${escapeHtml(fmtOtHours(o.hours_open))}</td><td class="num">${pctStr}</td></tr>`;
      })
      .join('');
    body = `<div class="panel-sub ot-fill-paired-subhead ot-fill-today-subhead" style="margin-top:10px;">TODAY</div><div class="preview-table-wrap"><table class="preview-table ot-fill-table ot-fill-main-table--hours"><thead><tr><th>Group</th><th class="num">Filled (h)</th><th class="num">Open (h)</th><th class="num">%</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } else if (entries.length) {
    const lis = entries
      .map(([g, p]) => {
        const band = otFillPctBandClass(typeof p === 'number' ? p : null);
        const cls = band ? ` class="${band}"` : '';
        const disp = p != null && typeof p === 'number' ? escapeHtml(String(p)) + '%' : '—';
        return `<li${cls}>${escapeHtml(g)}: ${disp}</li>`;
      })
      .join('');
    body = `<div class="panel-sub ot-fill-paired-subhead ot-fill-today-subhead" style="margin-top:10px;">TODAY</div><ul class="idle-group-list ot-fill-group-list">${lis}</ul>`;
  }

  const noteAbove = ot.note && entries.length ? `<p class="panel-muted" style="font-size:11px;margin-bottom:6px;">${escapeHtml(String(ot.note))}</p>` : '';

  const usePairedHoursTables = hasWarnPanel && hoursShape;
  const todayStub =
    !entries.length && hasWarnPanel && !usePairedHoursTables
      ? `<p class="panel-muted" style="margin-top:2px;font-size:12px;">No OT rows for <strong>today</strong> (CT).</p>`
      : '';

  if (usePairedHoursTables) {
    const warnParts = htmlOtFillEarlyWarningParts(ot, warnArr, warnMaxPct);
    const rowHtml = entries.length
      ? entries
          .map(([g, row]) => {
            const o = row && typeof row === 'object' ? row : null;
            if (!o || o.hours_open == null) return '';
            const band = otFillPctBandClass(o.fill_pct);
            const cls = band ? ` class="${band}"` : '';
            const pctStr = o.fill_pct != null ? `${escapeHtml(String(o.fill_pct))}%` : '—';
            return `<tr${cls}><td>${escapeHtml(g)}</td><td class="num">${escapeHtml(fmtOtHours(o.hours_filled))}</td><td class="num">${escapeHtml(fmtOtHours(o.hours_open))}</td><td class="num">${pctStr}</td></tr>`;
          })
          .join('')
      : `<tr><td colspan="4" class="panel-muted" style="font-style:italic;padding:10px 8px;">No OT rows for <strong>today</strong> (CT).</td></tr>`;

    const mainSubhead = `<div class="ot-fill-head-block"><div class="panel-sub ot-fill-paired-subhead ot-fill-today-subhead">TODAY</div></div>`;
    const mainTable = `<div class="preview-table-wrap"><table class="preview-table ot-fill-table ot-fill-main-table--hours"><thead><tr><th>Group</th><th class="num">Filled (h)</th><th class="num">Open (h)</th><th class="num">%</th></tr></thead><tbody>${rowHtml}</tbody></table></div>`;

    const paired =
      warnParts != null
        ? `<div class="ot-fill-paired">
        <div class="idle-split ot-fill-paired-head">
          <div class="idle-split-col ot-fill-main-col">${mainSubhead}</div>
          <div class="idle-split-col ot-fill-warn-col">${warnParts.headHtml}</div>
        </div>
        <div class="idle-split ot-fill-inner-split ot-fill-inner-split--tables">
          <div class="idle-split-col ot-fill-main-col">${mainTable}${floorBlock}</div>
          <div class="idle-split-col ot-fill-warn-col">${warnParts.tableInner}${warnParts.afterTable}</div>
        </div>
      </div>`
        : '';

    return `${noteAbove}${todayStub}${paired || floorBlock}`;
  }

  const mainCol = `<div class="idle-split-col ot-fill-main-col">${noteAbove}${todayStub}${body}${floorBlock}</div>`;
  const earlyCol = hasWarnPanel ? htmlOtFillEarlyWarningColumn(ot, warnArr, warnMaxPct) : '';
  const inner =
    earlyCol !== ''
      ? `<div class="idle-split ot-fill-inner-split">${mainCol}${earlyCol}</div>`
      : `${noteAbove}${todayStub}${body}${floorBlock}`;

  return `${inner}`;
}

/** Full-width card: call-out (left) + Overtime Stats (right). */
function calloutOtSplitPanel(co, coErr, ot, otErr) {
  const hasPreviewRows = !!(co.call_out_main?.rows_preview?.length);
  const prev =
    co.call_out_main?.headers && hasPreviewRows
      ? tablePreviewPick(co.call_out_main.headers, co.call_out_main.rows_preview, PREVIEW_CALLOUT)
      : '';
  const coRows =
    (co.call_out_main?.rows_today ?? 0) + (co.attendance_notifications?.rows_today ?? 0);
  const n = co.configured === false && !coErr ? '—' : coRows;
  const emptyToday =
    co.configured !== false && !coErr && !hasPreviewRows && !co.today_hint
      ? `<p class="panel-muted" style="margin-top:8px;">No sheet rows for today (CT) in this preview.</p>`
      : '';

  const left =
    (coErr ? `<p class="panel-error">${escapeHtml(coErr)}</p>` : '') +
    `<div class="panel-sub">Today: <strong>${n}</strong></div>` +
    (co.configured === false && !coErr ? `<p class="panel-muted">${escapeHtml(co.note || 'Not configured')}</p>` : '') +
    emptyToday +
    prev;

  const right = htmlOtFillColumn(ot, otErr);

  return `
    <div class="panel-card panel-exception" id="panel-callout-ot">
      <div class="idle-split callout-ot-split">
        <div class="idle-split-col">
          <div class="exception-col-title">Call out and attendance</div>
          ${left}
        </div>
        <div class="idle-split-col">
          <div class="exception-col-title">Overtime stats</div>
          ${right}
        </div>
      </div>
    </div>
  `;
}

function exceptionPanel(name, data, errMsg, previewPrefs = null) {
  const id = name.replace(/[^a-z0-9]+/gi, '-');
  const hasPreviewRows = !!(data.rows_preview && data.rows_preview.length);
  const prev =
    data.headers && data.rows_preview && hasPreviewRows
      ? previewPrefs
        ? tablePreviewPick(data.headers, data.rows_preview, previewPrefs)
        : tablePreview(data.headers, data.rows_preview)
      : '';
  const n =
    data.configured === false && !errMsg ? '—' : data.summary?.rows_today ?? data.rows_today ?? '—';
  const hint = data.today_hint
    ? `<p class="panel-muted" style="margin-top:6px;line-height:1.35;">${escapeHtml(data.today_hint)}</p>`
    : '';
  const emptyToday =
    data.configured !== false && !errMsg && !hasPreviewRows && !data.today_hint
      ? `<p class="panel-muted" style="margin-top:8px;">No sheet rows for today (CT) in this preview.</p>`
      : '';
  const srcNote = data.sheet_source_note
    ? `<p class="panel-muted" style="margin-top:6px;font-size:11px;line-height:1.4;">${escapeHtml(data.sheet_source_note)}</p>`
    : '';
  const cfgHint = data.configuration_hint
    ? `<p class="panel-muted" style="margin-top:6px;font-size:11px;color:var(--amber);font-weight:600;">${escapeHtml(data.configuration_hint)}</p>`
    : '';
  return `
    <div class="panel-card panel-exception" id="panel-${id}">
      <div class="panel-title">${name}</div>
      ${errMsg ? `<p class="panel-error">${escapeHtml(errMsg)}</p>` : ''}
      <div class="panel-sub">Today: <strong>${n}</strong></div>
      ${srcNote}
      ${cfgHint}
      ${hint}
      ${data.configured === false && !errMsg ? `<p class="panel-muted">${data.note || 'Not configured'}</p>` : ''}
      ${emptyToday}
      ${prev}
    </div>
  `;
}

let lastFetched = {};

async function fetchLiveDashboard() {
  const results = {};
  const errors = {};
  await Promise.all(
    ENDPOINTS.map(async ([key, url]) => {
      try {
        results[key] = await fetchJson(url);
        lastFetched[key] = results[key].fetched_at || new Date().toISOString();
      } catch (e) {
        errors[key] = e.message || String(e);
        lastFetched[key] = null;
      }
    })
  );
  return { results, errors };
}

function applyDashboardData(results, errors) {
  const nsPayload = results['net-staffing'] || {
    ok: false,
    note: errors['net-staffing'] || 'No data',
  };
  renderHeatmap(document.getElementById('net-staffing-mount'), nsPayload);

  const idle = results['idle-hourly-log'];
  const idleHourKpi = document.getElementById('idle-hour-kpi');
  const idleHourGroups = document.getElementById('idle-hour-groups');
  const idleDayKpi = document.getElementById('idle-day-kpi');
  const idleDayGroups = document.getElementById('idle-day-groups');
  const idleSplit = document.getElementById('idle-split');
  const idleParseNote = document.getElementById('idle-parse-note');
  const idleErr = document.getElementById('idle-err');

  if (errors['idle-hourly-log']) {
    idleErr.hidden = false;
    idleErr.textContent = errors['idle-hourly-log'];
    idleParseNote.hidden = true;
    idleSplit.hidden = false;
    idleHourKpi.textContent = '—';
    idleHourKpi.className = 'panel-kpi idle-split-kpi';
    idleHourGroups.innerHTML = '';
    idleDayKpi.textContent = '—';
    idleDayKpi.className = 'panel-kpi idle-split-kpi';
    idleDayGroups.innerHTML = '';
  } else {
    idleErr.hidden = true;
    renderSparkline(document.getElementById('idle-spark'), idle?.sparkline_hours || []);

    if (idle?.note) {
      idleParseNote.hidden = false;
      idleParseNote.textContent = idle.note;
      idleSplit.hidden = true;
    } else {
      idleParseNote.hidden = true;
      idleSplit.hidden = false;

      const hv = idle?.current_hour_floor_idle;
      idleHourKpi.textContent = hv != null ? `${hv}%` : '—';
      idleHourKpi.className = ['panel-kpi', 'idle-split-kpi', idlePctBandClassForValue(hv)]
        .filter(Boolean)
        .join(' ');

      const gh = idle?.groups_by_hour;
      const ch = idle?.kpi_hour ?? idle?.ct_current_hour;
      if (gh && ch != null && gh[String(ch)]) {
        const entries = sortedIdleGroupEntries(gh[String(ch)]);
        idleHourGroups.innerHTML = idleGroupListHtml(entries, 'By group (this hour)');
      } else idleHourGroups.innerHTML = '';

      const dv = idle?.day_floor_idle_pct;
      idleDayKpi.textContent = dv != null ? `${dv}%` : '—';
      idleDayKpi.className = ['panel-kpi', 'idle-split-kpi', idlePctBandClassForValue(dv)]
        .filter(Boolean)
        .join(' ');

      const gd = idle?.groups_by_day;
      if (gd && Object.keys(gd).length) {
        const entries = sortedIdleGroupEntries(gd);
        idleDayGroups.innerHTML = idleGroupListHtml(entries, 'By group (full day)');
      } else idleDayGroups.innerHTML = '';
    }
  }

  const adh = results['adherence'];
  const adhErr = document.getElementById('adh-err');
  if (errors['adherence']) {
    adhErr.hidden = false;
    adhErr.textContent = errors['adherence'];
    const adhStats = document.getElementById('adh-stats');
    if (adhStats) {
      adhStats.textContent = '';
      adhStats.hidden = true;
    }
  } else {
    adhErr.hidden = true;
    const adhStats = document.getElementById('adh-stats');
    if (adhStats) {
      if (adh?.configured) {
        adhStats.textContent = '';
        adhStats.hidden = true;
      } else {
        adhStats.hidden = false;
        adhStats.textContent = adh?.note || 'Adherence source not configured';
      }
    }
    const tm = adh?.top_managers || [];
    document.getElementById('adh-managers').textContent =
      tm.length > 0 ? `Top managers by alerts: ${tm.map((m) => `${m.name} (${m.count})`).join(', ')}` : '';
    const link = document.getElementById('adh-digest');
    if (adh?.digest_url) {
      link.href = adh.digest_url;
      link.hidden = false;
    } else {
      link.hidden = true;
    }
  }

  const co = results['callout'] || {};
  document.getElementById('exceptions-grid').innerHTML =
    `<div class="exceptions-split-row">${[
      targetedVtoPanel(
        results['targeted-vto'] || {},
        errors['targeted-vto'],
        results['auto-vto'] || {},
        errors['auto-vto']
      ),
      bobbotPtoPanel(results['bobbot'] || {}, errors['bobbot'], idle, errors['idle-hourly-log']),
    ].join('')}</div>` +
    calloutOtSplitPanel(co, errors['callout'], results['ot-fill-rate'] || {}, errors['ot-fill-rate']);
}

async function loadDashboard() {
  const freshness = document.getElementById('freshness-strip');
  const inp = document.getElementById('dash-view-date');
  const dateStr = (inp && inp.value) || todayISOChicago();
  const todayCt = todayISOChicago();
  const histBadge = document.getElementById('dash-historical-badge');

  try {
    if (dateStr === todayCt) {
      if (histBadge) histBadge.hidden = true;
      const { results, errors } = await fetchLiveDashboard();
      freshness.innerHTML = ENDPOINTS.map(([key]) => {
        const t = lastFetched[key];
        return `<span class="freshness-item"><strong>${key}</strong>: ${t ? formatTime(t) : `<span style="color:var(--red)">${errors[key] || 'error'}</span>`}</span>`;
      }).join('');
      applyDashboardData(results, errors);
    } else {
      if (histBadge) histBadge.hidden = false;
      const r = await fetch(`/api/dashboard-snapshot?date=${encodeURIComponent(dateStr)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const text = await r.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text.slice(0, 120) };
      }
      if (!r.ok) {
        freshness.innerHTML = `<span class="freshness-item"><span style="color:var(--red)">Snapshot: ${escapeHtml(data.error || `HTTP ${r.status}`)} · ${escapeHtml(dateStr)}</span></span>`;
        const errMap = {};
        for (const [key] of ENDPOINTS) errMap[key] = data.error || 'No snapshot';
        applyDashboardData({}, errMap);
        return;
      }
      const cap = data.captured_at ? formatTime(data.captured_at) : '—';
      freshness.innerHTML = `<span class="freshness-item"><strong>Historical</strong>: ${escapeHtml(dateStr)} · captured ${escapeHtml(cap)} · read-only</span>`;
      applyDashboardData(data.results || {}, data.errors || {});
    }
  } catch (e) {
    freshness.innerHTML = `<span class="freshness-item"><span style="color:var(--red)">${escapeHtml(e.message || String(e))}</span></span>`;
  }
}

function initDashboardDatePicker() {
  const inp = document.getElementById('dash-view-date');
  if (!inp) return;
  const t = todayISOChicago();
  inp.max = t;
  if (!inp.value) inp.value = t;
  inp.addEventListener('change', () => {
    const v = inp.value;
    if (v > todayISOChicago()) {
      inp.value = todayISOChicago();
    }
    loadDashboard();
  });

  fetch('/api/dashboard-snapshot?list=1', { credentials: 'same-origin', cache: 'no-store' })
    .then((r) => r.json())
    .then((data) => {
      if (data && Array.isArray(data.dates) && data.dates.length) {
        inp.min = data.dates[0];
      }
    })
    .catch(() => {});
}

function tickClock() {
  const el = document.getElementById('header-clock');
  el.textContent = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

tickClock();
setInterval(tickClock, 1000);

document.getElementById('btn-refresh').addEventListener('click', () => loadDashboard());

initDashboardDatePicker();
loadDashboard();
setInterval(() => {
  const inp = document.getElementById('dash-view-date');
  const v = (inp && inp.value) || todayISOChicago();
  if (v === todayISOChicago()) loadDashboard();
}, REFRESH_MS);

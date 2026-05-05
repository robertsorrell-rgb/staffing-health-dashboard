import { heatmapBandClass } from './heatmap-bands.js';

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
];

/** Prefer human-readable columns; skip internal-id headers where possible. */
const PREVIEW_AUTO_VTO = {
  preferred: ['date requested', 'timestamp', 'rep', 'agent', 'name', 'decision', 'hours', 'queue', 'manager'],
  skip: [],
  maxCols: 6,
};
const PREVIEW_BOBBOT = {
  preferred: [
    'employee_email',
    'email',
    'payroll',
    'name',
    'manager',
    'queue',
    'decision',
    'saved',
    'request date',
    'hours',
    'type',
    'pto',
  ],
  skip: [/request.?key/i, /^pid[:|]/i, /employee.?key/i],
  maxCols: 6,
};
const PREVIEW_CALLOUT = {
  preferred: ['timestamp', 'agent', 'name', 'manager', 'queue', 'reason', 'status', 'date'],
  skip: [],
  maxCols: 6,
};

function formatTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', { timeZone: 'America/Chicago', hour12: true, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

async function fetchJson(url) {
  const r = await fetch(url, { credentials: 'same-origin' });
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

function netStaffingMetaHtml(payload, fetchError) {
  const meta = document.getElementById('net-staffing-meta');
  if (!meta) return;
  if (fetchError) {
    meta.textContent = '';
    return;
  }
  const src =
    payload?.source === 'assembled'
      ? 'Assembled API'
      : payload?.source === 'sheet'
        ? 'Capacity Pull sheet'
        : '';
  const ft = payload?.fetched_at ? formatTime(payload.fetched_at) : '';
  const bits = [];
  if (src) bits.push(`Source: ${src}`);
  if (ft) bits.push(`Fetched ${ft}`);
  meta.textContent = bits.join(' · ');
}

function renderHeatmap(container, payload, options = {}) {
  container.innerHTML = '';
  if (!payload.ok || !payload.matrix || !payload.matrix.length) {
    container.innerHTML = `<p class="panel-muted" style="padding:16px;">${
      payload.note ||
      'No net staffing matrix for today CT (set ASSEMBLED_API_KEY and/or confirm Capacity Pull tab + CAPACITY_PULL_* env).'
    }</p>`;
    return;
  }
  const allHours = payload.hours || [];
  let hours = allHours;
  if (!options.extendedHours && allHours.length) {
    const clipped = allHours.filter((h) => h >= 7 && h <= 19);
    if (clipped.length) hours = clipped;
  }
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
    th.textContent = `${String(h).padStart(2, '0')}:00`;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const row of payload.matrix) {
    const tr = document.createElement('tr');
    const td0 = document.createElement('td');
    td0.textContent = row.group;
    td0.className = 'row-label';
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
  wrap.style.padding = '12px 16px 16px';
  wrap.appendChild(table);
  container.appendChild(wrap);
}

function renderSparkline(container, spark) {
  container.innerHTML = '';
  if (!spark || !spark.length) return;
  const w = 320;
  const h = 56;
  const pad = 4;
  const vals = spark.map((s) => (s.idle_pct == null ? null : s.idle_pct));
  const defined = vals.filter((v) => v != null);
  if (!defined.length) return;
  const min = Math.min(...defined, 0);
  const max = Math.max(...defined, 100);
  const span = max - min || 1;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.classList.add('sparkline-svg');
  let d = '';
  let penUp = true;
  spark.forEach((s, i) => {
    const v = s.idle_pct;
    if (v == null) {
      penUp = true;
      return;
    }
    const x = pad + (i / Math.max(spark.length - 1, 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    d += `${penUp ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
    penUp = false;
  });
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d.trim());
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'var(--sky)');
  path.setAttribute('stroke-width', '2');
  svg.appendChild(path);
  container.appendChild(svg);
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

function previewTableHtml(headers, colIndices, rows) {
  if (!headers?.length || !colIndices?.length) return '<p class="panel-muted">No preview columns</p>';
  const th = colIndices.map((i) => `<th>${escapeHtml(String(headers[i] ?? ''))}</th>`).join('');
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
  const idx = pickPreviewIndices(headers, prefs || {});
  return previewTableHtml(headers, idx, rows);
}

function formatHoursDisplay(h) {
  if (h == null || Number.isNaN(Number(h))) return '—';
  const n = Math.round(Number(h) * 100) / 100;
  if (Number.isInteger(n)) return String(n);
  return String(n).replace(/\.?0+$/, '');
}

/** Targeted VTO: rollup totals, by-queue hours, chronological send times (CT). */
function targetedVtoPanel(data, errMsg) {
  const rollup = data.rollup || {};
  const n =
    data.configured === false && !errMsg ? '—' : data.summary?.rows_today ?? data.rows_today ?? '—';
  const totalHours = rollup.total_hours;
  const byQueue = rollup.by_queue || [];
  const timeline = rollup.timeline || [];
  const missing = rollup.rows_missing_hours ?? 0;
  const basis = rollup.hours_basis_note || '';

  let body = '';
  if (!errMsg && data.configured !== false) {
    body += `<div class="rollup-total"><span class="rollup-total-label">Hours in offers today</span> <strong class="rollup-total-value">${totalHours != null ? `${formatHoursDisplay(totalHours)} h` : '—'}</strong></div>`;
    if (basis) {
      body += `<p class="panel-muted rollup-basis">${escapeHtml(basis)}</p>`;
    }
    if (missing > 0) {
      body += `<p class="panel-muted rollup-missing">${missing} offer row(s) had no usable hour value (check Hold Hours or Start/End datetimes).</p>`;
    }

    if (byQueue.length) {
      body += `<div class="panel-sub rollup-section-title">By sales group (queue)</div>`;
      const qh = `<thead><tr><th>Queue</th><th class="num">Offers</th><th class="num">Hours</th></tr></thead>`;
      const qb = byQueue
        .map(
          (q) =>
            `<tr><td title="${escapeAttr(q.queue)}">${escapeHtml(q.queue)}</td><td class="num">${q.offers}</td><td class="num">${formatHoursDisplay(q.hours)} h</td></tr>`
        )
        .join('');
      body += `<div class="preview-table-wrap"><table class="preview-table rollup-table">${qh}<tbody>${qb}</tbody></table></div>`;
    }

    if (timeline.length) {
      body += `<div class="panel-sub rollup-section-title">When offers went out (Central)</div>`;
      const th = `<thead><tr><th>Sent (CT)</th><th>Queue</th><th class="num">Hours</th><th>Name</th></tr></thead>`;
      const tb = timeline
        .map((t) => {
          const hrs = t.hours != null ? `${formatHoursDisplay(t.hours)} h` : '—';
          return `<tr><td>${escapeHtml(t.sent_ct)}</td><td title="${escapeAttr(t.queue)}">${escapeHtml(t.queue)}</td><td class="num">${escapeHtml(hrs)}</td><td title="${escapeAttr(t.name)}">${escapeHtml(t.name)}</td></tr>`;
        })
        .join('');
      body += `<div class="preview-table-wrap"><table class="preview-table rollup-table">${th}<tbody>${tb}</tbody></table></div>`;
    }

    if (!byQueue.length && !timeline.length && n === 0) {
      body += `<p class="panel-muted">No offers logged for today (CT).</p>`;
    }
  }

  return `
    <div class="panel-card panel-exception" id="panel-targeted-vto-bot">
      <div class="panel-title">Targeted VTO Bot</div>
      ${errMsg ? `<p class="panel-error">${escapeHtml(errMsg)}</p>` : ''}
      <div class="panel-sub">Offers today: <strong>${n}</strong></div>
      ${data.configured === false && !errMsg ? `<p class="panel-muted">${data.note || 'Not configured'}</p>` : ''}
      ${body}
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
  return `
    <div class="panel-card panel-exception" id="panel-${id}">
      <div class="panel-title">${name}</div>
      ${errMsg ? `<p class="panel-error">${escapeHtml(errMsg)}</p>` : ''}
      <div class="panel-sub">Today: <strong>${n}</strong></div>
      ${hint}
      ${data.configured === false && !errMsg ? `<p class="panel-muted">${data.note || 'Not configured'}</p>` : ''}
      ${emptyToday}
      ${prev}
    </div>
  `;
}

function isHeatmapExtended() {
  const el = document.getElementById('heatmap-extended');
  return !!(el && el.checked);
}

let lastFetched = {};

async function loadAll() {
  const freshness = document.getElementById('freshness-strip');
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

  freshness.innerHTML = ENDPOINTS.map(([key]) => {
    const t = lastFetched[key];
    return `<span class="freshness-item"><strong>${key}</strong>: ${t ? formatTime(t) : `<span style="color:var(--red)">${errors[key] || 'error'}</span>`}</span>`;
  }).join('');

  const nsPayload = results['net-staffing'] || {
    ok: false,
    note: errors['net-staffing'] || 'No data',
  };
  netStaffingMetaHtml(nsPayload, errors['net-staffing']);
  renderHeatmap(document.getElementById('net-staffing-mount'), nsPayload, {
    extendedHours: isHeatmapExtended(),
  });

  const idle = results['idle-hourly-log'];
  const idleKpi = document.getElementById('idle-kpi');
  const idleSub = document.getElementById('idle-sub');
  const idleErr = document.getElementById('idle-err');
  const idleGroups = document.getElementById('idle-groups');
  if (errors['idle-hourly-log']) {
    idleErr.hidden = false;
    idleErr.textContent = errors['idle-hourly-log'];
    idleKpi.textContent = '—';
  } else {
    idleErr.hidden = true;
    const v = idle?.current_hour_floor_idle;
    idleKpi.textContent = v != null ? `${v}%` : '—';
    if (idle?.note) {
      idleSub.innerHTML = `<span class="panel-muted">${escapeHtml(idle.note)}</span>`;
    } else {
      const parts = [`Date ${idle?.date || '—'} (CT)`];
      if (idle?.ct_current_hour != null) parts.push(`now ${idle.ct_current_hour}:00`);
      if (
        idle?.kpi_hour != null &&
        idle?.ct_current_hour != null &&
        idle.kpi_hour !== idle.ct_current_hour
      ) {
        parts.push(`KPI hour ${idle.kpi_hour}:00`);
      }
      if (idle?.idle_source_tab) parts.push(`tab ${idle.idle_source_tab}`);
      idleSub.innerHTML =
        `<span>${escapeHtml(parts.join(' · '))}</span>` +
        (idle?.kpi_note ? `<br/><span class="panel-muted">${escapeHtml(idle.kpi_note)}</span>` : '');
    }
    renderSparkline(document.getElementById('idle-spark'), idle?.sparkline_hours || []);
    const gh = idle?.groups_by_hour;
    const ch = idle?.kpi_hour ?? idle?.ct_current_hour;
    if (gh && ch != null && gh[String(ch)]) {
      const entries = Object.entries(gh[String(ch)]).sort((a, b) => (b[1] || 0) - (a[1] || 0));
      idleGroups.innerHTML =
        `<div class="panel-sub" style="margin-top:10px;">By group (current hour)</div>` +
        `<ul style="margin:8px 0 0 16px;font-size:12px;">${entries.map(([g, p]) => `<li>${escapeHtml(g)}: ${p != null ? p + '%' : '—'}</li>`).join('')}</ul>`;
    } else idleGroups.innerHTML = '';
  }

  const adh = results['adherence'];
  const adhErr = document.getElementById('adh-err');
  if (errors['adherence']) {
    adhErr.hidden = false;
    adhErr.textContent = errors['adherence'];
  } else {
    adhErr.hidden = true;
    document.getElementById('adh-stats').textContent = adh?.configured
      ? `Ping 1 today: ${adh.ping1_today} · Ping 2 today: ${adh.ping2_today}`
      : adh?.note || 'Adherence source not configured';
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
  const coRows =
    (co.call_out_main?.rows_today ?? 0) + (co.attendance_notifications?.rows_today ?? 0);
  document.getElementById('exceptions-grid').innerHTML = [
    targetedVtoPanel(results['targeted-vto'] || {}, errors['targeted-vto']),
    exceptionPanel(
      'Automated VTO (Request Processor)',
      results['auto-vto'] || {},
      errors['auto-vto'],
      PREVIEW_AUTO_VTO
    ),
    exceptionPanel('Bobbot (PTO)', results['bobbot'] || {}, errors['bobbot'], PREVIEW_BOBBOT),
    exceptionPanel(
      'Call-out & attendance',
      {
        configured: co.configured,
        note: co.note,
        summary: { rows_today: coRows },
        headers: co.call_out_main?.headers,
        rows_preview: co.call_out_main?.rows_preview,
      },
      errors['callout'],
      PREVIEW_CALLOUT
    ),
  ].join('');
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

function initHeatmapToggle() {
  const cb = document.getElementById('heatmap-extended');
  if (!cb || cb.dataset.ready === '1') return;
  cb.dataset.ready = '1';
  try {
    cb.checked = localStorage.getItem('staffingHeatmapExtended') === '1';
  } catch {
    cb.checked = false;
  }
  cb.addEventListener('change', () => {
    try {
      localStorage.setItem('staffingHeatmapExtended', cb.checked ? '1' : '0');
    } catch {
      /* ignore quota / private mode */
    }
    loadAll();
  });
}

initHeatmapToggle();
document.getElementById('btn-refresh').addEventListener('click', loadAll);

loadAll();
setInterval(loadAll, REFRESH_MS);

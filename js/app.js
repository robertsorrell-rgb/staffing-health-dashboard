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
  spark.forEach((s, i) => {
    const v = s.idle_pct;
    if (v == null) return;
    const x = pad + (i / Math.max(spark.length - 1, 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    d += `${i === 0 || !d ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
  });
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d.trim());
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'var(--sky)');
  path.setAttribute('stroke-width', '2');
  svg.appendChild(path);
  container.appendChild(svg);
}

function tablePreview(headers, rows, maxCols = 8) {
  if (!headers || !headers.length) return '<p class="panel-muted">No headers</p>';
  const hc = headers.slice(0, maxCols);
  const th = hc.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows
    .slice(0, 12)
    .map((r) => {
      const cells = hc.map((_, i) => `<td>${escapeHtml(String(r[i] ?? ''))}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<table class="preview-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function exceptionPanel(name, data, errMsg) {
  const id = name.replace(/[^a-z0-9]+/gi, '-');
  const prev = data.headers && data.rows_preview ? tablePreview(data.headers, data.rows_preview) : '';
  const n = data.summary?.rows_today ?? data.rows_today ?? '—';
  return `
    <div class="panel-card" id="panel-${id}">
      <div class="panel-title">${name}</div>
      ${errMsg ? `<p class="panel-error">${escapeHtml(errMsg)}</p>` : ''}
      <div class="panel-sub">Rows today (date filter): <strong>${n}</strong></div>
      ${data.configured === false && !errMsg ? `<p class="panel-muted">${data.note || 'Not configured'}</p>` : ''}
      ${prev}
    </div>
  `;
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
  renderHeatmap(document.getElementById('net-staffing-mount'), nsPayload);

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
    idleSub.textContent = idle?.note
      ? idle.note
      : `Date ${idle?.date || '—'} · CT hour ${idle?.ct_current_hour ?? '—'}`;
    renderSparkline(document.getElementById('idle-spark'), idle?.sparkline_hours || []);
    const gh = idle?.groups_by_hour;
    const ch = idle?.ct_current_hour;
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
    exceptionPanel('Targeted VTO Bot', results['targeted-vto'] || {}, errors['targeted-vto']),
    exceptionPanel('Automated VTO (Request Processor)', results['auto-vto'] || {}, errors['auto-vto']),
    exceptionPanel('Bobbot (PTO)', results['bobbot'] || {}, errors['bobbot']),
    exceptionPanel(
      'Call-out & attendance',
      {
        configured: co.configured,
        note: co.note,
        summary: { rows_today: coRows },
        headers: co.call_out_main?.headers,
        rows_preview: co.call_out_main?.rows_preview,
      },
      errors['callout']
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

document.getElementById('btn-refresh').addEventListener('click', loadAll);

loadAll();
setInterval(loadAll, REFRESH_MS);

# Sheet contracts — Staffing Health Dashboard

Parsers MUST match these headers. When a bot owner changes row 1, update this document **before** changing code.

---

## CS_Hourly_Log (IDLE CONSUMER workbook)

**Spreadsheet ID:** `1MlHy2dB9JieEk4q72YhsEJLwvFFYJZ_fAI7s4M7mDLk` (`IDLE_CONSUMER_SPREADSHEET_ID`)

**Google access:** Share this workbook with the Sheets API service account (`client_email` in the GCP JSON credential Netlify uses). If the Idle Time card shows empty data but the tab has rows, verify sharing first.

**Parser tab:** Reads `CS_Hourly_Log` by default (`IDLE_CONSUMER_HOURLY_LOG_TAB`). `CS_Live_Dash` is **not** used unless that env explicitly overrides the tab name.

**Sheet URL:** `https://docs.google.com/spreadsheets/d/1MlHy2dB9JieEk4q72YhsEJLwvFFYJZ_fAI7s4M7mDLk/edit`

**Tab:** `CS_Hourly_Log`  
**Range:** `IDLE_CONSUMER_HOURLY_LOG_RANGE` default `'CS_Hourly_Log'!A1:ZZ50000`  
**Refresh cadence:** hourly (Apps Script trigger)  
**Suggested `Cache-Control` max-age:** 180–900 s (`IDLE_HOURLY_LOG_CACHE_SECONDS`)  
**API:** `GET /api/idle-hourly-log`

### Header row (row 1) — verified 2026-05-05

| Col | Letter | Header cell text |
|-----|--------|------------------|
| 1 | A | Hour Key |
| 2 | B | Date |
| 3 | C | Hour Label |
| 4 | D | Agent Name |
| 5 | E | Manager |
| 6 | F | Sales Group |
| 7 | G | Available Mins |
| 8 | H | On Call Mins |
| 9 | I | Total Productive Mins |
| 10 | J | Idle % |

### Column semantics

| Column | Meaning | Type notes |
|--------|---------|------------|
| Hour Key | Composite `YYYY-MM-DD HH` (CT hour bucket) | String; trailing token is CT hour-start 0–23 |
| Date | Calendar date | ISO `YYYY-MM-DD` or Sheets serial via API |
| Hour Label | Display slot, e.g. `6 AM–7 AM` | Use for hour parsing first |
| Agent Name | Consultant | Filter not applied in v1 rollup |
| Manager | Manager name | Available for future drill-down |
| Sales Group | Queue / test group | Drives per-group idle breakdown |
| Available Mins | Available minutes | Numeric; weighted idle numerator |
| On Call Mins | On-call / talk minutes | Numeric; weighted idle denominator term |
| Total Productive Mins | Avail + On Call (as written) | Cross-check only in v1 |
| Idle % | Row-level idle % | Informational; dashboard uses ΣAvail ÷ Σ(Avail+On Call) |

### Parser behavior (`idle-hourly-log.js`)

- Detects **Date**, **Hour Label** / **Hour Key** / generic **Hour**, **Sales Group** (optional), **Available Mins**, **On Call Mins**.
- **Hour:** prefers **Hour Label** (`parseHourHeader`); else **Hour Key** suffix `\\s(\\d{1,2})$`; else numeric hour column.
- Filters rows to **today** in **America/Chicago** using the **Date** column.
- Floor idle = **Σ Available Mins ÷ Σ (Available Mins + On Call Mins)** across all rows in scope (weighted, not avg of Idle %).

### Quirks

- **Hour Key** must not be used as the only hour source without parsing the suffix; labels use an en-dash in `AM–PM` ranges.
- Rows are **per agent per hour bucket**; multiple rows aggregate per hour + sales group.
- `valueRenderOption: UNFORMATTED_VALUE` may surface dates as serials — `normalizeDateCell` handles serials.

### Tabs in same workbook (reference)

`Roster`, `CS_Daily_Archive`, `CS_Live_Dash`, `CS_Hourly_Log`, `CS_Idle_Log`

---

## Reference — other spreadsheets this SA can already read

These are **not** wired into Staffing Health by default; they show up in other tooling (e.g. VCPU). Use them only if you deliberately point an env var here.

| Workbook (title) | Spreadsheet ID | Tabs observed |
|------------------|----------------|----------------|
| VCPU Historical Auto Write | `1N1TUdL114opFXj4ZWgflpWhf_zGKnnNpOcb1pfURWE8` | `Dashboard_Snapshots` |
| CC90s V2.csv | `18RJPIeClVQ6HLQK_7e-KdeqlHqqvLvYoqAkmciG4iJc` | `CC90s V2.csv`, `Historical CC90` |
| Intraday Leads 4 16.csv | `1clGnZjpQSJOhy65yH6Gx4V33UxyYa_eAHhDu15lrm-k` | `Intraday Leads 4 16.csv`, `Historical Leads` |

**Finding bot workbook IDs:** Open the sheet in Chrome → URL contains `/d/<SPREADSHEET_ID>/`. Alternatively enable **Google Drive API** on the GCP project backing this service account and list spreadsheets (Drive was disabled on `vcpu-dashboard` at last check).

---

## Net staffing — Assembled API + Capacity Pull sheet

### Primary: Assembled (`ASSEMBLED_API_KEY`)

Netlify function **`net-staffing.js`** calls Assembled **`GET /forecasted_vs_actuals`** with the same semantics as Apps Script `refreshCapacityPull()` (paginated `limit`/`offset`, site **Consumer Sales**, channel **phone**, interval **1800**, queues listed in `assembled-net-staffing.js`). Response payload matches the dashboard heatmap (`matrix`, `hours`).

Env: see [.env.example](../.env.example) (`ASSEMBLED_*`, `CAPACITY_PULL_SOURCE`).

### Sheet fallback: tab **Capacity Pull**

**Spreadsheet ID:** `1gU2f7IQdlpWojwWnsQbpRP1Vge79I0tr4n1AjI1K3uw` — Automated VTO bot workbook (`CAPACITY_PULL_SPREADSHEET_ID`)

**Sheet URL:** `https://docs.google.com/spreadsheets/d/1gU2f7IQdlpWojwWnsQbpRP1Vge79I0tr4n1AjI1K3uw/edit`

**Tab:** `Capacity Pull` (`CAPACITY_PULL_TAB`)

Apps Script writes a **two-row** header:

1. Row 1, col A: `Sales Group`; then repeated group labels (`Aggregate`, `ISC`, …) over blocks of date columns.
2. Row 2, col A: `Time/Date`; then calendar dates (**M/D/YYYY** CT-style) under each column.
3. Row 3+: col A = slot label (`7:00A`, `7:30A`, …); body cells = net staffing numbers.

Parser picks columns whose row-2 date equals **today CT** (`normalizeDateCell`) and builds hourly buckets via `parseHourHeader` on col A.

### Legacy sheet layout

Single header row with **≥3** hour columns (cols B+) and group names in column A is still supported.

### `normalizeDateCell` (Sheets serial datetimes)

Datetime serials must yield the calendar date in **America/Chicago** (not UTC midnight from `Math.floor(serial)`).

---

## Live Floor Adherence — alerts log

**Workbook:** Live Floor Adherence Reporting Bot  
**Spreadsheet ID:** `16OLaJrpyNHzh9Oqd5GV3JdSx0YJeyu8a4qD38WTpcgU` (`ADHERENCE_SPREADSHEET_ID`)

**Sheet URL:** `https://docs.google.com/spreadsheets/d/16OLaJrpyNHzh9Oqd5GV3JdSx0YJeyu8a4qD38WTpcgU/edit`

**Tab:** `ADHERENCE_ALERTS_TAB` (default `Adherence_Alert_Log`)

### Header row (row 1) — verified 2026-05-05

| Col | Letter | Header cell text |
|-----|--------|------------------|
| 1 | A | timestamp |
| 2 | B | agent_name |
| 3 | C | manager_name |
| 4 | D | alert_type |
| 5 | E | ooa_minutes |
| 6 | F | agent_events_this_week |
| 7 | G | manager_events_this_week |
| 8 | H | day_of_week |
| 9 | I | hour_of_day |
| 10 | J | daily_ping_count |
| 11 | K | daily_indicator |

### Expected columns (`adherence.js`)

- A **date** column (header contains `date`, `calendar`, `day`, or **`timestamp`**) — filters **today CT** via `normalizeDateCell`.
- Optional **manager** column (`manager_name`, or header contains `manager` / `supervisor` / `lead`).
- Optional **type** column (`alert_type`, or header matches ping / alert / tier / type / notification) — counts Ping 1 vs Ping 2 heuristically from **`alert_type`** text.

### Daily digest

`ADHERENCE_DIGEST_URL` — canonical URL for Kevin (Slack, Doc, wiki).

---

## Targeted VTO Bot — Offers tab

**Workbook:** Targeted VTO Bot  
**Spreadsheet ID:** `1znBYs9PemirPw_is3b8Blj74wEz7Hb6iGH88DH2qWmU` (`TARGETED_VTO_SPREADSHEET_ID`)

**Sheet URL:** `https://docs.google.com/spreadsheets/d/1znBYs9PemirPw_is3b8Blj74wEz7Hb6iGH88DH2qWmU/edit`

**Tab:** `TARGETED_VTO_TAB` (default `Offers`)

### Header row (row 1) — verified 2026-05-05

| Col | Letter | Header cell text |
|-----|--------|------------------|
| 1 | A | Offer ID |
| 2 | B | Deficit ID |
| 3 | C | Date |
| 4 | D | Start |
| 5 | E | End |
| 6 | F | Name |
| 7 | G | Email |
| 8 | H | Agent ID |
| 9 | I | Queue |
| 10 | J | Manager |
| 11 | K | Sent At |
| 12 | L | Expires At |
| … | … | _(Hold Hours through Notes; trailing merged note cells)_ |

### Parser (`targeted-vto.js`)

`GET /api/targeted-vto` reads **only** the Targeted VTO Bot workbook (`TARGETED_VTO_SPREADSHEET_ID`):

1. **`Offers`** — same rollup as below (drill-down tables on the dashboard).
2. **`VTO_Summary`** (default) — **label / value** rows for headline totals. Use **formulas**, **IMPORTRANGE**, **QUERY**, etc. here so TVTO + automated VTO roll up **in the sheet** (no second workbook in this function).

**Env:** `TARGETED_VTO_SUMMARY_TAB` (default `VTO_Summary`), `TARGETED_VTO_SUMMARY_RANGE` (default `A1:F25`).

#### VTO_Summary — column A label, column B value (exact labels, any row)

| Column A (label) | Column B (value) |
|------------------|------------------|
| `Combined approved hours` | Total approved VTO hours today (your formula). |
| `Targeted committed hours` | Subtotal from Targeted / Offers path (optional). |
| `Automated approved hours` | Subtotal from Request Processor / other workbook (optional). |

Aliases also accepted: **`Total approved VTO hours`**, **`Targeted VTO approved hours`**, **`Automated VTO approved hours`** (see `lib/vto-summary-sheet.js`).

#### Targeted Offers (`filter-today` + rollup)

- **`preferDateHeaders`:** **`Date`** (column **C**) — “today” = **calendar date in Central Time**, same as other dashboard panels.
- **Tab:** **`Offers`** (`TARGETED_VTO_TAB`).
- Range default reads **`A1:ZZ20000`**.
- **`rollup` (API response):**
  - **Approved offers** = rows where **`Status`** (column **N**) is **`COMMITTED`** (case-insensitive).
  - **`total_hours`:** summed **only for COMMITTED** rows (cross-check vs **Targeted committed hours** on `VTO_Summary`).
  - **Hours math:** **`End − Start`** using **`HH:MM`** text in columns **D/E** when present; otherwise full **datetime serial** subtraction; otherwise **`Hold Hours`** (column **M**).
  - **By queue:** **`Queue`** column **I** (sales group).
  - **Timeline:** **`Sent At`** (column **K**) formatted in **Central Time** when numeric serial.

---

## VTO Request Processor — Requests_Submissions (automated)

**Spreadsheet ID:** `1gU2f7IQdlpWojwWnsQbpRP1Vge79I0tr4n1AjI1K3uw` (`AUTO_VTO_SPREADSHEET_ID`)

**Sheet URL:** `https://docs.google.com/spreadsheets/d/1gU2f7IQdlpWojwWnsQbpRP1Vge79I0tr4n1AjI1K3uw/edit`

**Tab:** `Requests_Submissions` (`AUTO_VTO_TAB`)

### Header row (row 1) — verified 2026-05-05

| Col | Letter | Header cell text |
|-----|--------|------------------|
| 1 | A | Timestamp |
| 2 | B | SRD |
| 3 | C | RD |
| 4 | D | Rep Name |
| 5 | E | Role |
| 6 | F | Date Requested |
| … | … | _(intervening cols)_ |
| 9 | I | Hours |
| 10 | J | Decision |

**Today column (`readSheetFilterToday`):** prefer **`Date Requested`**, then **`Timestamp`** — “today” is the **Central** calendar date on that column.

**Dashboard:** raw rows today appear in the **Automated VTO** panel via **`GET /api/auto-vto`**. Combined headline totals should be **referenced into `VTO_Summary`** on the Targeted workbook, not merged in application code.

---

## Bobbot — Bobbot_History

**Spreadsheet ID:** `1gndsQQZdIJ5sr0XPP6aafRnQ95ZT4KXPQk5882To4F0` (`BOBBOT_SPREADSHEET_ID`)

**Sheet URL:** `https://docs.google.com/spreadsheets/d/1gndsQQZdIJ5sr0XPP6aafRnQ95ZT4KXPQk5882To4F0/edit`

**Tab:** `Bobbot_History` (`BOBBOT_TAB`)

### Header row (row 1) — verified 2026-05-05

| Col | Letter | Header cell text |
|-----|--------|------------------|
| 1 | A | request_key |
| 2 | B | employee_key |
| … | … | _(employee_email … saved_at)_ |

**Today column:** prefer **`request_date`**, then **`saved_at`**.

---

## Call Out Main Flow

**Spreadsheet ID:** `16O9z0bFmKO5cWHhY_KoYIkxsbGcBELdrNnUNUwsqR5Y` (`CALLOUT_SPREADSHEET_ID`)

**Sheet URL:** `https://docs.google.com/spreadsheets/d/16O9z0bFmKO5cWHhY_KoYIkxsbGcBELdrNnUNUwsqR5Y/edit`

**Main tab:** `CALLOUT_MAIN_TAB` (default `Sheet1`)  
**Optional second tab:** `CALLOUT_ATTENDANCE_TAB` — `Attendance Notification Log`

### Header row — Sheet1 (row 1) — verified 2026-05-05

| Col | Letter | Header cell text |
|-----|--------|------------------|
| 1 | A | Timestamp |
| 2 | B | Agent Name |
| 3 | C | Manager |
| 4 | D | Sales Group |
| 5 | E | Start of Absence |
| 6 | F | End of Absence |
| 7 | G | Reason |
| 8 | H | Dept |
| 9 | I | Assembled Updated? |

### Header row — Attendance Notification Log (row 1) — verified 2026-05-05

| Col | Letter | Header cell text |
|-----|--------|------------------|
| 1 | A | Timestamp |
| 2 | B | Rep Email |
| 3 | C | Stage |
| 4 | D | Stage Label |
| 5 | E | Missed Days (30d) |
| 6 | F | Callouts (7d) |
| 7 | G | To Recipients |
| 8 | H | CC Recipients |
| 9 | I | Status |
| 10 | J | Manager (raw) |
| 11 | K | Process Type |

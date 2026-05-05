# Staffing Health Dashboard

Static dashboard for Consumer Sales staffing health: net staffing heatmap (Assembled API and/or Capacity Pull sheet), idle time from `CS_Hourly_Log`, adherence pings, and bot logs (VTO, Bobbot, call-out). Deploy on **Netlify** from GitHub; APIs are **Netlify Functions** backed by **Google Sheets** (service account) and optionally **Assembled** for capacity.

Visual tokens align with the VCPU Dashboard (IBM Plex, navy / coral palette).

## Where we are vs “seeing the dash”

| Layer | Status |
|-------|--------|
| **Layout & visuals** | Done — header, net-staffing heatmap card (with source line), idle KPI + sparkline, adherence, exception panels. |
| **Frontend logic** | Done — polls all `/api/*` routes, renders errors inline. |
| **Backend functions** | Done — Sheets + optional Assembled for staffing; smoke scripts verify handlers. |
| **What you need to see live data** | Run **`npm run dev`** (`netlify dev`) so `/api/*` is routed to functions, **or** deploy to Netlify with env vars. Plain **`npm start`** only serves static files — APIs will fail and panels show errors (layout still visible). |

So you are **one working Netlify-style dev/prod URL** away from the full visual: the UI is essentially complete; the gap is almost always **running with functions + credentials**, not missing charts.

## Prerequisites

1. **Google Cloud service account** with Sheets API enabled.
2. Share every workbook this app reads with the SA email (**Viewer**). Typical reader:

   `vcpu-dashboard-reader@vcpu-dashboard.iam.gserviceaccount.com`

   _(Use the `client_email` from your own key JSON if different.)_

3. Batch-share these workbooks: IDLE CONSUMER, Automated VTO bot workbook (Capacity Pull + Requests tabs), Targeted VTO, Bobbot, Live Floor Adherence, Call Out Main Flow (+ attendance tab).

   Set **`ASSEMBLED_API_KEY`** (same Script Property as Capacity Pull refresh) so `/api/net-staffing` can pull live staffing without relying on the sheet. Sheet fallback uses tab **`Capacity Pull`** (two-row header layout).

   [.env.example](.env.example) lists IDs and tabs. Share each workbook with the reader SA (**Viewer**).

## Setup

```bash
cd Staffing-Health-Dashboard
npm install
```

Copy [.env.example](.env.example) for local reference only; **Netlify** stores `GOOGLE_SERVICE_ACCOUNT_JSON` as the **full JSON string**.

**Production Netlify env (important):** AWS Lambda limits **total environment size (~4 KB)** per deployment. `GOOGLE_SERVICE_ACCOUNT_JSON` is large, so **do not** import the full `.env` into Netlify if it pushes you over the limit.

Instead set **only**:

| Variable | Required? |
|----------|-----------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **Yes** — full service account JSON (one line). |
| `ASSEMBLED_API_KEY` | Optional — only if you use Assembled for net staffing. |
| `ADHERENCE_DIGEST_URL` | Optional — small URL string if you use it. |

Spreadsheet IDs, tabs, cache TTLs, and Assembled **non-secret** settings are **baked into** [`netlify/functions/lib/deploy-defaults.js`](netlify/functions/lib/deploy-defaults.js). Override any of them **locally** via `.env`; on Netlify add **only** overrides you truly need (each extra key costs bytes).

If you already imported dozens of vars and deploy fails with **“environment variables exceed the 4KB limit”**, delete the redundant keys in Netlify (keep `GOOGLE_SERVICE_ACCOUNT_JSON` + optional secrets above), redeploy, then push this repo update.

Document real sheet headers in [docs/sheet-contracts.md](docs/sheet-contracts.md) before relying on parsers.

## Local development

### Environment file

Never commit `.env`. Generate it from your **current** service-account JSON (after key rotation, point at the new file):

```bash
node scripts/bootstrap-local-env.js /path/to/your-service-account-key.json
```

This writes `GOOGLE_SERVICE_ACCOUNT_JSON`, IDLE CONSUMER defaults, and **merges every key from [.env.example](.env.example)** (`CAPACITY_PULL_SPREADSHEET_ID`, bot IDs, tab names, cache TTLs). Fill blank spreadsheet IDs as you wire each workbook (mirror values in Netlify → Environment variables).

### Git repository

`.gitignore` excludes **`.env`** (never commit secrets). Verify before pushing:

```bash
test -z "$(git ls-files -- .env)" && echo "OK: .env not tracked"
```

If **`git init` fails** with `.git/hooks: Operation not permitted` (Cursor / some sandboxes), use a Git metadata directory outside the project:

```bash
bash scripts/init-git-separate-dir.sh
git add -A && git status   # confirm .env absent
git commit -m "Your message"
```

### Deploy & ops checklist (Netlify + GitHub)

These steps require **your** browser login / GitHub access (not automatable from here):

1. **GitHub remote & push**

   ```bash
   bash scripts/add-remote-push.sh git@github.com:YOUR_ORG/staffing-health-dashboard.git
   ```

   _(HTTPS URLs work too.)_

2. **Netlify site + env**

   Ensure [.env](.env) exists locally (`bootstrap-local-env.js`). Then:

   ```bash
   bash scripts/netlify-setup.sh
   ```

   That runs `netlify login`, `netlify link`, **`netlify env:import .env`** (loads **GOOGLE_SERVICE_ACCOUNT_JSON**, spreadsheet IDs, optional **ASSEMBLED_API_KEY**, etc.), and a draft **`deploy --build`**.

   Production cutover:

   ```bash
   npx netlify-cli deploy --prod --build
   ```

   Optional CI token: set **`NETLIFY_AUTH_TOKEN`** (site-specific deploy token or personal access token per Netlify docs) for non-interactive deploys.

3. **Rotate service account key** (if the JSON was ever pasted into chat, logs, or a ticket)

   In **Google Cloud Console** → IAM & Admin → Service Accounts → your reader SA → **Keys** → **Add key** → JSON → download → **disable/delete** the old key.

   Then update **`GOOGLE_SERVICE_ACCOUNT_JSON`** in Netlify (env UI or `env:import` from refreshed `.env`) and regenerate local `.env` with `bootstrap-local-env.js`.

### Netlify CLI (`netlify dev`)

```bash
npm run dev
# same as: npx netlify dev
```

Open the printed local URL. Plain `npm start` serves static files only — `/api/*` will **not** resolve without Netlify routing.

If the CLI exits with **`EMFILE: too many open files, watch`**, raise the file-descriptor limit (macOS example: `ulimit -n 10240`) or exclude heavy trees from your file watcher; large `node_modules` trees can trigger this.

### Split dev server (sometimes survives EMFILE better)

Two terminals:

```bash
npm run dev:functions     # Terminal A — serves /.netlify/functions/* on :8889 (loads .env)
npm run dev:proxy         # Terminal B — static site on :8080, proxies /api/* → :8889
```

Open **http://127.0.0.1:8080**. If **both** commands still hit EMFILE on your Mac, use a **Netlify deploy preview** URL instead — that path needs no local watchers.

### Smoke test without Netlify

```bash
node scripts/smoke-idle.js           # today CT
node scripts/smoke-idle.js 2026-05-04
node scripts/smoke-endpoints.js      # adherence, targeted-vto, others (needs .env)
```

## Behavior

- **Polling:** UI refreshes about every **150s** (override with `window.__REFRESH_MS__` before loading `app.js` if needed).
- **Caches:** Each function sets `Cache-Control: private, max-age=…` (tunable per source via `*_CACHE_SECONDS`).
- **Time zone:** **America/Chicago** for “today” filtering and clocks.

## Repo layout

| Path | Purpose |
|------|---------|
| `index.html`, `css/styles.css`, `js/app.js` | Front end |
| `js/heatmap-bands.js` | Asymmetric heatmap threshold constants |
| `netlify/functions/*.js` | Sheet + Assembled-backed endpoints |
| `docs/sheet-contracts.md` | Column contracts |

## Endpoints

| Path | Function |
|------|----------|
| `/api/net-staffing` | Net staffing matrix (Assembled + sheet fallback) |
| `/api/idle-hourly-log` | Weighted idle % from hourly log |
| `/api/adherence` | Ping counts + digest link |
| `/api/targeted-vto` | Targeted VTO rows today |
| `/api/auto-vto` | Automated VTO rows today |
| `/api/bobbot` | Bobbot rows today |
| `/api/callout` | Call-out + optional attendance tab |

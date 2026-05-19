# Pitstop

Workforce management cockpit for contact center managers — fast schedule edits with capacity-aware auto-approval.

## Stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind, TanStack Query, React Router, Framer Motion
- **Backend:** Netlify Functions (TypeScript)
- **Auth & data:** Supabase (Google OAuth, Postgres + RLS)

## Local development

```bash
cd pitstop
cp .env.example .env
# Fill VITE_SUPABASE_* and SUPABASE_* (see checklist below)
npm install
npm run dev
```

Open **http://localhost:8888** (Netlify Dev proxies Vite on 5173 and functions on the same port).

For Vite-only UI work without functions:

```bash
npm run dev:vite
# http://localhost:5173 — API calls proxy to :8888 if Netlify Dev is also running
```

## Netlify deploy

1. Create a Netlify site linked to your GitHub repo.
2. Set **Base directory** to `pitstop`.
3. Build command: `npm run build` (default from `netlify.toml`).
4. Publish directory: `dist`.
5. Add environment variables from `.env.example` in the Netlify UI.

Preview deploys run on every PR; production on `main` when you push.

## Project layout

See repo root spec — `src/` for UI, `netlify/functions/` for API, `supabase/migrations/` for schema.

## v0.1 vertical slice

Dashboard → click green **Phone** block → move start (+30 min default) → `POST /api/schedule-change` → mock capacity engine → Supabase `change_requests` + `audit_log` → optimistic UI + success toast.

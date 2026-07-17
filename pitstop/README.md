# Pitstop

Managers submit **schedule changes for consultants** on their team — one-off edits, meeting adds, and permanent pattern updates — with capacity-aware auto-approval before writes hit Assembled.

**In scope:** schedule change requests managers file on behalf of consultants.  
**Out of scope:** VTO/OT offers, adherence monitoring, and other WFM-entered actions for reps.

## Change types

| Category | Examples |
|----------|----------|
| One-off | Move block start/end, change activity type, delete, add segment |
| Meeting | Add team meeting (Meeting Governor logic) |
| Permanent | Standing lunch, recurring block, template updates |

## Stack

React 18 · Vite · Netlify Functions · Supabase (auth + audit)

## Local development

```bash
cd pitstop
npm install
npm run dev:vite    # UI preview — http://localhost:5173 (no Supabase needed)
npm run dev         # Full stack with functions — http://localhost:8888
```

## Netlify

Base directory: **`pitstop`**. See `.env.example` for variables.

## Integrations (existing bots)

Pitstop wires to automation you already run in Apps Script:

| Change type | Existing bot | Doc |
|-------------|--------------|-----|
| `permanent_schedule_change` | Permanent Schedule Publisher (Schedule Changes tab) | `docs/INTEGRATIONS.md` |
| `add_meeting` | Meeting Governor | `docs/INTEGRATIONS.md` |
| One-off block edits | Assembled API directly | `netlify/functions/_shared/assembled-client.ts` |

Server adapters (stubs → port GAS logic): `permanent-schedule.ts`, `meeting-governor-bridge.ts`, `schedule-commit.ts`.

## Simulation mode (no Supabase / sheets)

With no `.env` (or `VITE_DEV_PREVIEW=true`), the app runs in **simulation mode**:

- Amber banner at top — toggle **Manager** vs **WFM** view, or **Reset demo data**
- Submissions stored in `localStorage` with three seeded examples
- Fake sheet logic: meetings at **1–3pm** → deny + alternatives; permanent → WFM review; large one-off moves → deny

```bash
cd pitstop && npm install && npm run dev:vite
# http://localhost:5173
```

Try: **Request → Add meeting** (default 2–3pm) → denied → **Submissions**. Switch to **WFM view** → approve Sam’s permanent change.

## v0.1 slice

Team view → click **Phone** block → move start → capacity check → submit (mocked locally without Supabase).

# Pitstop ↔ Sheet Logic (Backend Authority)

Pitstop is the **manager UI + audit log**. Your **Apps Script sheet logic** is the **approve/deny authority** — same rules as Meeting Governor and Schedule Changes today.

## Flow

```
Manager submits in Pitstop
        ↓
Supabase: change_requests (status=pending) + audit_log "submitted"
        ↓
POST → Apps Script web app (evaluate)
        Meeting Governor net-staffing / thresholds
        Permanent publisher pattern validation
        ↓
Supabase: update decision + audit_log "evaluated"
        ↓
┌─ approve + autoCommit ──► Apps Script commit (or TS fallback)
├─ deny ─────────────────► Manager sees reason + alternatives
└─ review ───────────────► WFM queue in Pitstop + Slack
                                    ↓
                            POST /api/wfm-approve
                                    ↓
                            Apps Script commit (Apply)
```

## Deploy sheet bridges

### Meeting Governor (`apps-script/meeting-governor.gs`)

The file includes `doPost` + `pitstopEvaluateMeeting_` at the bottom.

1. Open the Meeting Governor spreadsheet → Extensions → Apps Script
2. Ensure latest `meeting-governor.gs` is saved (includes Pitstop API section)
3. Script Properties: `PITSTOP_BRIDGE_SECRET` (same as Netlify)
4. Deploy → **New deployment** → Web app → Execute as: Me → Anyone
5. Copy URL → Netlify `PITSTOP_MEETING_LOGIC_URL`

**Evaluate** runs the same net-staffing path as `mgProcessRow_` without Slack DMs.  
**Commit** appends a Requests row and runs `mgProcessRow_` (full Governor commit).

### Permanent Schedule Publisher

1. Add `apps-script/pitstop-permanent-bridge.gs` to the **same** Apps Script project as the Permanent Schedule Publisher
2. Deploy web app (same steps as above)
3. Netlify `PITSTOP_PERMANENT_LOGIC_URL`

**Evaluate** validates Mon–Sun pattern (same parsers as Schedule Changes). Always returns `review` — permanent changes need WFM sign-off before Apply.  
**Commit** (after WFM approve in Pitstop) appends a Schedule Changes row with Apply?=TRUE and runs `menuApply_`.

## Netlify env

| Variable | Purpose |
|----------|---------|
| `PITSTOP_MEETING_LOGIC_URL` | Meeting Governor `/exec` |
| `PITSTOP_PERMANENT_LOGIC_URL` | Permanent publisher `/exec` |
| `PITSTOP_BRIDGE_SECRET` | Must match Apps Script property |
| `PITSTOP_WFM_SLACK_USER_ID` | Slack DM when decision=review |

## Audit trail (Supabase)

| Action | When |
|--------|------|
| `schedule_change.submitted` | Manager hits Submit |
| `schedule_change.evaluated` | Sheet logic returns decision |
| `schedule_change.committed` | Auto-approve or WFM approve |
| `wfm.approve` / `wfm.deny` | WFM action on review queue |

Meeting Governor **Audit** tab also gets `pitstopAudit_` rows on commit.

## API endpoints

| Endpoint | Role |
|----------|------|
| `POST /api/schedule-change` | Submit → evaluate → optional auto-commit |
| `POST /api/wfm-approve` | WFM only — approve/deny review queue |
| `GET /api/approvals` | List submissions |

## What Pitstop does NOT do

- VTO / OT offers (WFM-entered, not manager schedule submissions)
- Replace sheet logic with guesses — if bridge URL is unset, dev mock applies

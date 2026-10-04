# Feature parity — verified

Every capability from your current `code.gs` and front end, and what proves it.
Tests: **89 API + 13 guard + 33 browser**, run against the real `code.gs` on an
in-memory Sheets shim, driven by the real `index.html`.

## Accounts
- [x] Company signup, creates the tenant spreadsheet from your template
- [x] Login by email **or** username
- [x] Forgot password → emailed reset link
- [x] Reset password, updates every store
- [x] Multi-tenant registry maps login → company spreadsheet
- [x] Plan, expiry, days left, lapsed-service grace
- [x] **Tenants cannot see each other** — proven by test, both directions

## Tasks
- [x] Create with **multiple assignees at once** (one task each)
- [x] Title, description, due date, priority, KRA tag, job category
- [x] One Time / Daily / Weekdays / Weekly / Fortnightly / Monthly / Quarterly / Half-Yearly / Yearly
- [x] Manager approval routing when the assignee reports to someone else
- [x] Approve / reject
- [x] Pending → In Progress → For Review → Verified
- [x] Rework: send back **with a new deadline**, counter increments
- [x] Stop a recurring series (and verifying it then spawns nothing)
- [x] Next occurrence created on verify, checklist reset, no duplicate for a date
- [x] Edit task
- [x] Full audit trail with notes and deadline changes
- [x] Archive after 7 days closed; archive view
- [x] Search, filter by assignee, status, category, overdue
- [x] Checklists, dependencies (circular refused), delegation, WIP limits

## Team
- [x] Add / update / deactivate staff
- [x] Admin / HOD / Doer, enforced server-side
- [x] Job profile, department, phone, manager
- [x] Global user sync so staff can sign in
- [x] Job categories editable per company
- [x] **Deactivation forces reassignment** of open work

## Scoring & appraisals
- [x] Delegation score with a visible breakdown ("See why")
- [x] KRA master per job profile, editable, weights validated ≤100%
- [x] Appraisal: KRA ratings + behaviours + brownie points (capped at 5)
- [x] Final score = performance + delegation
- [x] Review history per month, with bands
- [x] Rework/accountability report
- [x] Performance report
- [x] **Leave does not count as lateness** (new)

## Notifications
- [x] Bell: overdue, awaiting approval, awaiting review, due today, team overdue
- [x] Email on assignment, approval request, review, send-back, verify
- [x] Email on signup, staff invite, password reset, payment receipt
- [x] All email HTML escaped (your current build interpolates raw)
- [~] **WhatsApp** — the channel is built (`whatsapp.gs`, sent earlier) but is a
      separate file and needs Meta business verification plus template approval.
      Not wired into `code.gs` because it cannot send until that is done.

## Commercial
- [x] Plan limits enforced server-side: users, tasks/month, reports, WhatsApp
- [x] Usage and warnings in the UI before the wall is hit
- [x] Razorpay checkout against a **real order**
- [x] Promo codes (now from Script Properties, not a literal in the source)
- [x] Contact sales / contact support
- [x] Lapsed plan → read-only after a week, data kept

## AI
- [x] Gemini insight, from **summary figures only** — never staff records

## Security, new in this build
- [x] Passwords salted, iterated, peppered; plaintext upgraded on first login
- [x] Signed session tokens; the server never trusts a client-supplied role
- [x] Tenant files created **PRIVATE**
- [x] Razorpay signature verified, then re-confirmed with Razorpay
- [x] Login throttle (8 per 15 minutes)
- [x] Reset tokens expire in an hour and are single-use
- [x] No secrets in source
- [x] Starting a task no longer counts as a rework

## Deliberately different
- **Delete is deactivate.** Removing a user row orphans every task they touched
  and silently rewrites history. They stop being able to sign in; the record stays.
- **The last Admin cannot remove themselves**, which is the only realistic way to
  lock a workspace out of its own account.

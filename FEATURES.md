# Feature parity — verified

Every capability from your current `code.gs` and front end, and what proves it.
Tests: **466 checks across fourteen suites**, run against the real `code.gs` on an
in-memory Sheets shim, driven by the real `index.html` in a real browser. See
`tests/README.md`.

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
- [x] Delegation score with a visible breakdown ("See why"), grouped by heading
- [x] KRA/KPI per person: target, unit, direction, how measured — target optional
- [x] KRA standard per job profile; rolling it out never overwrites a tailored set
- [x] Appraisal: KRA ratings + behaviours + brownie points (capped at 5)
- [x] Review history per month, with bands
- [x] Accountability report: rework and lateness, *and* approvals/reviews held
- [x] Performance report
- [x] **Leave does not count as lateness**
- [x] **Managers are measured too** — see below
- [x] **Projects: multi-stage work, a deadline per stage, score for meeting one** (new)

### How the final score is built

    Performance = KRA 75% + Behaviour 20% + Brownie (max 5)   → out of 100
    Delegation  = measured from the task record               → out of 100
    Final       = (Performance + Delegation) / 2

Somebody with no closed work is scored on performance alone rather than halved.
Delegation is re-measured on the server when an appraisal is saved, so a figure
the browser sent cannot decide anyone's rating.

Delegation itself is on-time delivery, first-pass quality and queue health,
weighted by priority — minus a responsiveness penalty.

### Project milestones — the doer's gain

A project is a run of stages sharing a Project ID. Each stage is an ordinary
task with its own owner and its own deadline, so delegation, rework, blockers,
approvals and reminders all work on it unchanged. On a sequential project a
stage is blocked by the one before it; signing that one off closes it, and a
closed blocker stops blocking, so the next stage releases itself and its owner
is emailed.

Meeting a stage deadline is scored in its own right, as **Project Milestones** —
a fourth weighted component, present only for people who actually run project
work:

    On-Time Delivery 35% · First-Pass Quality 25% · Queue Health 20% · Milestones 20%

It is weighted, not added on top, so nobody lifts their score by having their
work cut into more pieces. Hits are itemised in the breakdown alongside the
misses — a score that shows a person only what went wrong stops changing
anybody's behaviour after the first month.

**Nobody wears somebody else's slip.** If the stage before yours ran over, you
could not have started on time. A stage released after its own deadline gets
back the window the plan gave it — the gap between its date and the previous
stage's date, counted from the day it was actually released. You promised that
many days of work; you get that many days, and no more.

### Responsiveness — the manager's half

A doer is measured on delivering. Whoever has to approve or review is measured
on not sitting on it. Held time is counted **in working days from when the item
reached that person**, not from the task's deadline: work handed in early that
then waits a fortnight is counted properly.

| | |
|---|---|
| Expected turnaround | 2 working days |
| Beyond that | 2 points per day |
| Cap per item | 10 points |
| Cap overall | 20 points |
| Not counted | weekends, company holidays, that person's own approved leave |

A head of department who owns no tasks but has four people stuck is scored
purely on how fast they clear the queue — otherwise the least accountable
person in the workspace is the one person the system cannot measure.

Every deduction appears in the breakdown naming the item, the working days held
and the points lost. A number nobody can see the derivation of is a number they
will dispute, and they would be right to.

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

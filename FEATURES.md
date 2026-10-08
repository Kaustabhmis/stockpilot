# Feature parity — verified

Every capability from your current `code.gs` and front end, and what proves it.
Tests: **1,383 checks across thirty-seven suites**, run against the real
`dist/code.gs` on an in-memory Sheets shim, driven by the real
`dist/index.html` in a real browser. See `tests/README.md`.

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
- [x] **A repeat that ends by itself: on a date, or after N occurrences** (new)
- [x] Stop a recurring series by hand (and verifying it then spawns nothing)
- [x] Next occurrence created on verify, checklist reset, no duplicate for a date

### When a repeat stops

A repeat with no end is a standing instruction nobody owns — it outlives the
reason it was created, and the only way to end it was for a manager to notice
and stop it by hand. So the end is set at the moment the cadence is chosen,
which is the only moment anyone is actually thinking about it:

| Stop | Means |
|---|---|
| Never | Runs until someone stops it — the old behaviour, still available |
| On a date | No occurrence is created due after that date |
| After N times | Counts occurrences, not completions, and stops at N |

Both may be set together, and whichever arrives first wins. The series does not
simply stop producing work — the last occurrence is marked as no longer
repeating and its history records *why* it ended, so nobody is left wondering
whether the schedule finished or broke. Everywhere a cadence is shown, how far
through it is shown with it: `Monthly · 3 of 6`, `Weekly · until 2027-03-31`.

The count carried forward is not reset by editing the task, or "stop after
five" could be renewed indefinitely by editing it five times. Stopping by hand
clears the rule outright, so a restarted series does not begin part-spent.

The nightly scheduler reads the same two fields off the row and feeds them to
the same rules engine, so a series ends on the same occurrence whether it was
closed in the app or generated at 6am.
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
- [x] **Projects: multi-stage work, a deadline per stage, score for meeting one**
- [x] **Scoring credited against the load carried** (new) — ten jobs beats one easy one
- [x] **Cookie points**: day-to-day recognition, signed, with a reason, capped (new)
- [x] **Org chart built from who reports to whom** (new)

### Why ten jobs beats one easy one

This was the real flaw. Every component below is a **rate** — a percentage of
the work you took on — and a rate is blind to how much work that was. Somebody
who closed a single trivial task on time scored 100. Somebody who carried ten
and delivered seven on time scored 70. The system was quietly telling the
hardest workers in the company that they were the worst performers.

So the rate is credited against the load it was earned on:

    Score = how well you delivered × how much you delivered

Load is counted in the same priority weights as everything else (a High task is
worth three Lows), and it counts three things: work closed, work in hand at half
weight (three weeks into a large job is not idleness), and the approvals and
reviews you cleared for other people (a manager who spends the month unblocking
their team is not idle either).

The expectation is **per person**, taken from their WIP limit, so a part-time or
deliberately low-volume role is measured against its own bar and not against the
busiest desk in the building. Credit is capped at a full load, so carrying
double does not make a score of 200 — and cutting work into more pieces cannot
carry anyone past a complete score. A score earned on a sliver of work is
flagged *provisional* rather than presented as a verdict.

### Nobody starts above zero, nobody ends above a hundred

Every path through `delegationScore` ends at one clamp. A person with no record
scores 0 and is marked "no data", not graded a nought. A flawless record tops
out at exactly 100, and cookie points cannot push it past that.

### The leaderboard

Top of the month to bottom, under its own **Board** tab, for week, month,
quarter or year. It ranks the score the rest of the product already computes —
rate × load credit, 0 to 100 — so nobody can be first here and middling on
their own dashboard.

Three rules are built into the ordering rather than left to whoever reads it:

**Nobody is ranked on nothing.** A person who closed nothing is *unranked* and
listed apart from the table with the reason, never at the bottom of it.
Ranking an absence is how a leaderboard ends up punishing someone who was on
leave, or who joined last week.

**One easy task cannot win it.** The score it ranks by already carries load, so
ten jobs with seven on time beats one easy job done — and a month too thin to
read is marked `thin month` rather than quietly averaged in.

**The person who clicks Verify is not employee of the month.** Clearing other
people's approvals promptly is real work and the score counts it, so managers
stay in the ranking on the same scale as everyone else. But the crown needs
delivered work behind it, or an Admin who approves everything and delivers
nothing tops the board every single month. If the top of the table scored on
approvals, the card says so in words rather than quietly claiming first place.

Ties share a rank and skip the next, the way every sport does it. Movement
against the previous period is computed, not stored — a stored rank goes stale
the moment anything is back-dated, and people spot a wrong arrow faster than a
wrong score.

**Who sees it** is the Admin's call, set on the Board tab itself:

| Setting | A Doer sees |
|---|---|
| Everyone *(default)* | the whole board, top to bottom |
| Top 3 + own place | the podium, their own row, and "you are 9th of 24" |
| Managers only | nothing — the tab refuses, in words |

A person always sees their own row whatever the setting, because a ranking you
are in but cannot see is the worst of both worlds.

### Cookie points

Recognition on the day, not six months later at the appraisal. A manager awards
1–5 to someone who reports to them (an Admin can recognise anyone, including a
manager); nobody can award to themselves, and an award without a stated reason
is refused — an anonymous bonus with no cause is indistinguishable from
favouritism, and a team reads it that way. The recipient is emailed, sees it on
their score screen with the reason and the giver's name, and it is on the record
at their review. The score effect is capped at 10 a month: cookies are a
thank-you, not a back door.

### Org chart

Built from the "reports to" already set on each person, so it cannot drift out
of date the way a drawn chart does. Each node shows role, job profile, open
tasks and total headcount beneath. Someone with no manager is hung off the owner
with a "manager not set" marker and named in a note — an Admin approves their
work until that is fixed. A reporting loop is detected and named rather than
hanging the walk.

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

## Priority

- [x] **Priority levels a workspace names for itself** (new) — "Line Down",
      "Customer Hold", "Routine"; each with a weight that feeds the scoring
- [x] **A ranked list over a chosen horizon** (new) — today, this week, this
      month, this quarter, this year, everything

The list answers the question a board cannot: *what do I do first?* Priority
alone does not answer it either — a Low task due this afternoon beats a High one
due next month, and a task three people are waiting on beats both. So the order
is computed from the level, the date, and who is held up, and **every row says
which of those put it where it is**.

| Counts for | Why |
|---|---|
| Overdue | Nothing outranks work that is already late |
| Due today / this week | A near date beats a distant label |
| Others waiting on it | Finishing it releases somebody else |
| Already started | Finishing beats starting |
| Held for a decision | The same clock the responsiveness score runs on |

Three things are deliberately kept **out** of the running order and listed
separately, because nobody can act on them today: work **blocked** by something
else (naming what it waits on), work **handed in** and sitting with a reviewer,
and — at the very top, in its own band — the **decisions this person owes other
people**. That last one matters: the score charges a manager for sitting on
approvals, so a list that left them out would tell somebody to do one thing
while marking them down for another.

Levels are stored beside the job categories and cannot be deleted while open
work still carries them.

## Notifications
- [x] Bell: overdue, awaiting approval, awaiting review, due today, team overdue
- [x] Email on assignment, approval request, review, send-back, verify
- [x] Email on signup, staff invite, password reset, payment receipt
- [x] **Renewal reminders** at 14, 7, 3 and 1 days before expiry, on the day,
      and once after — never to a Free workspace (new)
- [x] **Every customer email leaves from info@biscsindia.com or is not sent** —
      no fallback to the script owner's address, ever (new)
- [x] All email HTML escaped (your current build interpolates raw)
- [~] **WhatsApp** — the channel is built (`whatsapp.gs`, sent earlier) but is a
      separate file and needs Meta business verification plus template approval.
      Not wired into `code.gs` because it cannot send until that is done.

## Commercial
- [x] Razorpay checkout, signature verified server-side, re-confirmed by API
- [x] Promo codes, receipts by email from info@biscsindia.com
- [x] Plan limits enforced on the SERVER — users, tasks, analytics, KRA, WhatsApp
- [x] **Priced by team size, every feature in every paid plan** (new)
- [x] **An invoice from BISCS India for every payment, automatically** (new)

### Invoices

A payment is not finished when the money moves — it is finished when the
customer has the document their accountant can file. So the invoice is written
inside the same locked write that grants the plan, and emailed from
`info@biscsindia.com` without anyone pressing a button.

| | |
|---|---|
| Number | `BISCS/26-27/0001`, restarting each financial year |
| Carries | supplier legal name, address, GSTIN, PAN; buyer name, address, GSTIN; SAC 998314; taxable value; tax split; total; amount in words; payment reference |
| Tax | CGST+SGST within the seller's state, IGST outside it, decided by the buyer's GSTIN |
| Before registration | no tax charged, no tax shown, and it says why |
| Never duplicated | idempotent on the payment id, so the browser path and the webhook produce one document |
| Never edited | `reissueInvoice()` supersedes and renumbers; both stay in the series |

The serial is derived under the registry lock from the rows already written,
not from a counter. A counter is faster and leaves a hole in the series the
first time a write fails after the bump — and a hole is the one thing in an
invoice series that cannot be explained away afterwards.

Details are asked for **before** the card, because an invoice cannot be
rewritten once it is issued. A customer who has given neither a GSTIN nor a
state sees one short form, once.

### Pricing

| Plan | Users | Monthly | Yearly (2 months free) | Per user/mo |
|---|---|---|---|---|
| Free | 5 | ₹0 | — | — |
| Starter | 15 | ₹2,499 | ₹24,990 | ₹167 |
| **Growth** | 50 | ₹5,999 | ₹59,990 | ₹120 |
| Scale | 150 | ₹12,999 | ₹1,29,990 | ₹87 |
| Enterprise | 150+ | Custom | Custom | — |

Every paid band carries the whole product. A plan that withholds the scoring and
the appraisals is selling a worse board, and it gives a buyer a reason to stay
small rather than a reason to grow. Price per user falls as the band rises, so
growing with us is rewarded and the bill still goes up. Extra seats beyond a
band are ₹149 per user a month, arranged by hand.

Prices exclude 18% GST, which is added at checkout and shown before the payment
sheet opens — while BISCS India is unregistered the rate is zero and the
checkout charges exactly the listed figure.

Yearly is exactly ten times monthly, enforced by a test. The old ladder had
Standard at ₹2,499/mo — ₹29,988 a year — sitting next to Pro at ₹19,999 a year
with fifteen times the users, so no informed buyer ever had a reason to pick it.

**Existing customers are honoured, not migrated.** `Monthly` and `Yearly` remain
live keys with the caps and prices they were sold at, and they gain the full
feature set, because nobody should lose capability for having bought early. They
are marked `offered:false` so no new buyer can land on them.

## Help
- [x] **The user manual, inside the app** (new) — press `?` anywhere

`MANUAL.md` is rendered into the page at build time, so the help a person reads
in Dome Box is the manual handed to their company, word for word. Every number
in it is held against the code by `tests/manual-test.js`, so the help cannot
drift from the product either.

- Opens on the section for the tab you are on — reopened from the same tab, it
  resumes where you were reading
- Searches as you type across every section, ranked by how much each mentions
  it, with the hits highlighted
- A Doer sees every section, with their own work first and how their managers
  are measured after it, labelled
- Every page ends at **Contact support**, with the subject already naming the
  section they were stuck on
- Linked from the places the questions get asked: the score breakdown opens on
  *how scoring works*, the leaderboard on *how the board is ranked*
- Refuses to open over a form with something typed in it, rather than throwing
  the half-written task away; `?` typed into a field is just a `?`
- On a phone, reachable from the account panel, and opening it never scrolls
  the way out off the screen

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

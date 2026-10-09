# Dome Box — user manual

Task and team management for Indian MSMEs · **www.domebox.in**

This is for the people who *use* Dome Box. If you are setting it up, you want
[`SETUP.md`](SETUP.md) instead.

| | |
|---|---|
| [Getting started](#getting-started) | signing in, the six tabs, your role |
| [Tasks](#tasks) | assigning, the lifecycle, checklists, blockers, handing over |
| [Repeating work](#repeating-work) | cadences, and making one stop by itself |
| [Priority](#priority) | what to do next, and why |
| [Projects](#projects) | multi-stage work that releases itself |
| [Scores](#scores) | **how the score is calculated** — read this before you use it |
| [Recognition](#recognition) | cookie points |
| [The leaderboard](#the-leaderboard) | top of the month to bottom |
| [Goals and values](#goals-and-values) | purpose, values, year and quarter goals, key numbers |
| [Meetings](#meetings) | the weekly review, and actions that become real work |
| [Team](#team) | adding people, managers, WIP limits, leave |
| [KRAs and appraisals](#kras-and-appraisals) | the formal review |
| [Reports](#reports) | what the numbers mean |
| [Billing](#billing) | plans, invoices, GST |
| [For managers](#for-managers) | the half of this that is about you |
| [Common questions](#common-questions) | |

---

## Getting started

### Signing in

Go to **www.domebox.in** and sign in with the email and password you were
given. Forgotten it? **Forgot password** emails you a link that works once and
expires in an hour.

Your first sign-in may be slower than the rest — your password is being
upgraded to a secure hash in the background.

### Getting help

Press **?** anywhere (or the **?** in the top bar; on a phone, **Help** in your
account panel). Help opens on the section for the tab you are on, searches as
you type, and every page ends with a way to reach a person.

### The eight tabs

| Tab | What it is for |
|---|---|
| **Tasks** | The board. Everything, by status. |
| **Priority** | One ranked list: what to do next, and why. |
| **Projects** | Multi-stage work where each stage releases the next. |
| **Team** | People, managers, leave, job categories. *(managers)* |
| **Reports** | Scores, trends, accountability, appraisals. *(managers)* |
| **Goals** | Purpose, values, year and quarter goals, key numbers. |
| **Meetings** | The weekly review. |
| **Board** | The leaderboard. |

### The three roles

| Role | Can |
|---|---|
| **Admin** | Everything. Assign to anyone, verify anything, manage billing and the team. |
| **HOD** | Assign to anyone, verify, see the team's scores, run appraisals. |
| **Doer** | Do their own work. Raise work **upward** — for their manager or a department head — but not sideways for a colleague. |

> **Why a Doer cannot assign to a colleague.** Work arriving from a peer with
> no manager involved is how a person ends up with eleven jobs and no way to
> say no. Raise it upward and your manager decides. If you genuinely need to
> hand something to a peer, use **Hand over** on the task itself — that routes
> through a manager too.

A Doer sees only the work that touches them: assigned to them, raised by them,
waiting on their approval, or offered to them in a hand-over.

---

## Tasks

### Assigning work

**Assign** (top right of the Tasks tab) opens the form.

| Field | Notes |
|---|---|
| **Task** | What needs doing. Specific enough to verify. |
| **Detail** | Context, and what "done" looks like. |
| **Assign to** | **Tick several people and each gets their own copy.** |
| **Due date** | Required. Everything about scoring hangs on this. |
| **Priority** | Critical / High / Medium / Low. Weights the score — see [Scores](#scores). |
| **Job category** | Your own list, editable under Team. |
| **Repeats** | See [Repeating work](#repeating-work). |
| **KRA tag** | Links this job to a responsibility area, for appraisals. |
| **Checklist** | One per line. The holder ticks them off. |

The form tells you before you send it whether anything needs a manager's
approval first.

### Where a new task lands

| Raised by | Goes |
|---|---|
| An Admin | Straight to the assignee |
| The assignee's own manager | Straight to the assignee |
| Yourself, for yourself | Straight to your list |
| A Doer, upward | The recipient accepts or declines it themselves — it is their time being asked for, so nobody else arbitrates |
| Anyone else | **Awaiting Approval** — the assignee's manager accepts or refuses the load |

### The lifecycle

```
Pending  →  In Progress  →  For Review  →  Verified
                   ↑              │
                   └── Send back ──┘   (a rework loop, counted)
```

| Status | Means | Who moves it |
|---|---|---|
| **Awaiting Approval** | Waiting on a manager to accept the load | That manager |
| **Pending** | Accepted, not started | The holder presses **Start work** |
| **In Progress** | Being done | The holder presses **Submit for review** |
| **For Review** | Handed in | The raiser, the approver or an Admin |
| **Verified** | Signed off. The only clean close. | — |
| **Rejected** | Never accepted | — |
| **Cancelled** | Withdrawn after acceptance | The raiser or an Admin |

**You cannot verify your own work.** If you raised it and you are doing it, an
Admin signs it off.

### Opening a task

Click any card. The drawer shows who it is on, the deadline, the checklist, the
blockers, and the **full history** — every status change, who made it, when,
with their note. Rework loops and new deadlines are marked.

That history is the point. A score you cannot see the working for is one people
quietly stop trusting.

### Checklists, blockers, hand-overs

- **Checklist** — tick items off as you go. The drawer shows `3/5`. You can
  still submit with items unticked; it is a prompt, not a gate.
- **Add blocker** — point this task at another. While that one is open, this
  one says *Blocked by…* and will not start. Circular blocks are refused.
- **Hand over** — propose passing it to someone else. Your manager decides. It
  does not simply vanish from your list.

### Finding things

Search by title, filter by person, status, category, or **Overdue only**.
**Archive** shows closed work — anything Verified, Rejected or Cancelled drops
off the active board **seven days** after it closed, so the board stays about
what is live.

---

## Repeating work

Set **Repeats** when you assign: One Time, Daily, Weekdays, Weekly,
Fortnightly, Monthly, Quarterly, Half-Yearly or Yearly.

Weekdays skips Saturday and Sunday. Monthly and longer clamp to the end of
short months, so a job set for the 31st lands on the 28th in February rather
than skidding into March.

### Making it stop

Choosing a cadence reveals **Stop repeating**:

| | |
|---|---|
| **Never** | Runs until somebody stops it by hand |
| **On a date** | No occurrence is created due after that date |
| **After a number of times** | Counts occurrences and stops at N |

Set both and whichever comes first wins. "Every Monday until March, but no more
than ten" is a reasonable thing to mean.

Everywhere a cadence appears, how far through it is appears with it:
`Monthly · 3 of 6`, `Weekly · until 2027-03-31`.

When a series ends, the last occurrence is marked as no longer repeating and
its history says *why* — so nobody has to work out whether the schedule
finished or broke.

**Stop repeating** on any occurrence ends the series by hand. That clears the
rule outright, so a restarted series does not begin part-spent.

> The next occurrence is created **on schedule**, not when somebody verifies
> the last one. A single unverified task used to end a series silently, which
> is exactly when the reminder matters most.

---

## Priority

A board shows everything at once, which is the wrong shape for the question
people actually ask on a Monday: **what do I do first?**

Priority alone does not answer it either. A Low task due this afternoon beats a
High one due next month, and a task three people are waiting on beats both.

So the list is ranked by what is actually pressing, and **every row says why it
is where it is**:

| Reason | Weight |
|---|---|
| Overdue | 40, plus 2 a day, capped at 20 more |
| Due today | 36 |
| Due tomorrow | 28 |
| Due this week | 16 |
| Someone is waiting on it | 8 each, capped at 24 |
| Already in progress | 6 — finishing beats starting |

All of it multiplied by the task's priority weight.

**Horizons** — Today, This week, This month, This quarter, This year,
Everything — filter by deadline. Overdue work appears in **every** horizon,
including Today, because it does not stop being your problem.

The list also separates:

- **Waiting** — blocked on someone else. Not your move.
- **Decisions** — things waiting on *you* to approve or review. Managers:
  this is the one that costs you points.
- **Handed in** — submitted, waiting on a verifier.

Managers can switch the person at the top right to see anyone's list.

---

## Projects

For work with stages that must happen in order — an audit, a new part
approval, a machine installation.

**Projects → New project.** Name it, then add stages: title, who, deadline,
priority. Minimum two; one stage on its own is just a task.

Each stage is a real task on the board. **Stage 1 is live; the rest are blocked
by the one before.** Verify stage 1 and stage 2 releases automatically and its
owner is emailed. Nobody has to remember to hand it on.

### The deadline rule worth knowing

If a stage is released **late**, its deadline moves by the same amount — the
owner gets back the window that was planned for them.

Stage 2 was given five days. Stage 1 ran four days over, so stage 2 was
released four days late. Stage 2 is now due five days from when it actually
reached you, not one day from now. **You are not marked late for somebody
else's delay.**

Meeting a stage deadline earns score in its own right — on a project, the
milestone component is worth 20% of your delivery score.

---

## Scores

**Everyone starts at 0. Nobody can go above 100.**

Your dashboard shows your score, and **See why** opens the full working, line by
line. Read this section once and the number stops being mysterious.

### The three things measured

| Component | Weight | What it measures |
|---|---|---|
| **On-time delivery** | 45% | Did you hand it in by the deadline |
| **First-pass quality** | 30% | Was it accepted without being sent back |
| **Queue health** | 25% | Is what you are still holding overdue |

*On a project, those become 35 / 25 / 20 with 20% for stage milestones.*

- A day late costs **10 points on that task**. Five days late is zero on it.
- Each rework loop costs **25 points on that task**.
- Every task is weighted by its priority, so a Critical job counts for more
  than a Low one.

### The thing that makes it fair

A rate on its own is blind to how much work it was. Somebody who closed one
trivial task on time would score 100, while somebody who carried ten and
delivered seven on time would score 70. The system would be telling your best
people to take on less.

So the rate is multiplied by **workload credit** — how much you carried against
what is expected of you (your WIP limit, 5 tasks by default, priority-weighted,
capped at a full load).

**Ten jobs with seven on time scores far above one easy job done.**

A month too thin to read is flagged **provisional** rather than treated as a
good one.

### Three things that will not count against you

1. **Approved leave and holidays.** Overdue days are not charged while you are
   on sanctioned leave.
2. **Your manager's slow review.** You are scored from when you pressed
   *Submit for review*, never from when somebody got round to verifying it.
3. **Work you cannot act on.** Anything sitting in *For Review* or *Awaiting
   Approval* is not counted against your queue health. It is not in your hands.

### Bands

| Band | Score | |
|---|---|---|
| **A** | 85+ | Top performer |
| **B** | 60–84 | Solid, needs sharpening |
| **C** | under 60 | Needs intervention |

### If you think your score is wrong

Open **See why**. Every component shows the tasks behind it and what each cost.
If a task is wrong — a deadline that moved verbally, a rework that was not
yours — the history is there to point at. Talk to your manager; the record is
designed to be argued with.

---

## Recognition

### Cookie points

Managers award **cookie points** for work the score cannot see: staying back to
clear a backlog, catching something nobody else noticed, helping someone else
finish.

- 1 to 5 points per award
- They lift a score by **at most 10 points**, however many are awarded
- Every award carries a written reason, and the person is emailed

The cap is deliberate. Cookies are a thank-you that nudges a number, not a way
to overwrite the record.

### The org chart

**Team → Org chart** draws the reporting line from the managers you have set.
Anyone with no manager hangs off the Admin, marked as such, so nobody is
invisible.

---

## The leaderboard

**Board** — top of the month to bottom, for a week, month, quarter or year.

It ranks the same score your dashboard shows, so you cannot be first here and
middling there. Three rules are built into the order:

**Nobody is ranked on nothing.** Closed nothing this month? You are *unranked*
and listed separately with the reason — never at the bottom of the table.
Ranking an absence punishes people who were on leave.

**One easy task cannot win it.** The score already carries workload. A month
too thin to read is marked, not averaged in.

**The person who clicks Verify is not employee of the month.** Clearing other
people's approvals promptly is real work and the score counts it — but the
crown needs delivered work behind it. If the top of the table scored on
approvals, the card says so.

Ties share a rank. Movement against last period is shown as ▲ / ▼.

### Who can see it

Your Admin chooses: **everyone** (the whole board), **top 3 + your own place**,
or **managers only**. You always see your own row and your real position,
whatever the setting.

---

## Goals and values

**Goals** — where the company is going, and the values it gets there by. Set
up once, then used every week.

### Purpose and values

An Admin sets them: **Goals → Edit purpose & values**.

- **Purpose** — one sentence: why the company exists.
- **Values** — up to twelve, each with a short code (one to three letters,
  the one people say out loud), its name, and what it looks like in practice.

Values are what a story in a weekly review is tagged to, and what a cookie
award can name — so they get used, not just printed.

### Year goals and quarter goals

| | |
|---|---|
| **Year goal** | What the company will achieve this financial year |
| **Quarter goal** | One of the three to seven things this quarter that moves a year goal |

Quarters follow the **Indian financial year**: Q1 is April to June, Q4 is
January to March. Each goal has an owner and a status:

| Status | Means |
|---|---|
| **On course** | Will be done by the end of the period |
| **At risk** | Might not be — and you must say why, in one line |
| **Done** | Done |
| **Dropped** | No longer being pursued |

The owner can change the status as well as managers — the person closest to a
goal is the one who knows it is at risk first.

### How progress is worked out

Not somebody's guess. A goal's progress is **the share of the work linked to
it that has been verified**. A year goal counts the work under its quarter
goals too. Cancelled and rejected work is left out, so dropping a task does not
make a goal look closer to done.

To link work, pick the goal under **Serves goal** when you assign a task or
build a project. Every stage of a project serves the project's goal, and every
repeat of a repeating job keeps its goal.

A goal with work linked to it cannot be deleted — mark it **Dropped** instead,
so the history still makes sense.

### Key numbers

The handful of weekly figures that say whether the week went well — despatches,
rejections, collections. Each has an owner, a target, and whether **at least**
or **at most** is good. Figures are filed by week (from Monday); entering this
week's again replaces it. A miss shows in red, and belongs in Roadblocks.

## Meetings

**Meetings → Start a weekly review.** Included in every paid plan. Any manager
can start one; only one can run at a time.

### The eight segments

| | |
|---|---|
| **Wins** | Who is here, and one good thing each |
| **Values in action** | A story of someone living one of the values — it must name the value |
| **Goal check** | Each quarter goal: on course, at risk or done. No discussion here |
| **Key numbers** | This week's figures against their targets |
| **Updates** | Anything everyone needs to know, one line each |
| **Roadblocks** | Problems and opportunities, worked one at a time |
| **Actions** | Last week's, done or not. This week's: who, what, by when |
| **Close** | Everyone rates the meeting from 1 to 10 |

When you start, you can drop segments or change their minutes. You cannot
reorder them: the order is the method. Close is always kept.

### Running it

The person who started it **chairs**: they take attendance, move from segment to
segment, keep the minutes, and end it. Everyone else in the meeting has the same
screen open and follows the chair within a few seconds. Each segment shows a
clock against its planned minutes, and turns red when it runs over.

Anyone in the room can share a win, a story, an update or a roadblock. A
manager telling a story about someone who reports to them can award cookie
points with it.

### Roadblocks carry over

A roadblock stays on the list — **Now** or **Later** — until somebody clears it,
from one meeting to the next. You can raise one between meetings too:
**Meetings → Raise a roadblock**.

### Actions are real tasks

**→ Action** on a roadblock, or **Add action** in Actions, creates a Dome Box
task: on the person's board, chased by the daily reminders, counted in their
score, due in seven days unless you say otherwise, and tied to the goal and the
meeting it came from. Next week's meeting opens Actions with every one still
open — which is the whole point of meeting weekly.

### Close

Ratings are **anonymous**: everyone sees how many have rated, nobody sees who
gave what. Rating again replaces your rating rather than adding a second.

**End meeting** emails a summary from `info@biscsindia.com` to everyone who was
there, with **their own actions at the top**, then the numbers and the
minutes. **Cancel** sends nothing and keeps nothing in the history; any actions
already created stay on people's boards.

## Team

*Managers and Admins.*

### Adding someone

**Team → Add person.** Name, username, email, role, department, job profile,
password, and **their manager**.

The manager matters more than it looks: it decides who approves their work, who
sees their score, and where they sit on the org chart.

### WIP limit

How many open tasks a person is expected to carry. **Default 5.** It is also
what their workload credit is measured against, so set it honestly — a limit of
20 on someone who should carry 5 will drag their score down.

### Leave

**Team → Leave.** Record approved leave, and overdue days stop accruing for
that person across those dates. A fortnight off should not read as a fortnight
of lateness.

### Job categories and priority levels

Both are yours to edit. Priority levels carry a weight that feeds the score. A
level still in use on open work cannot be deleted.

### Removing someone

Deactivating a person asks who inherits their open work. Their history stays,
so past scores and appraisals still reconcile. **The last Admin cannot be
removed or demoted.**

---

## KRAs and appraisals

### KRAs

A **KRA** is an area you are answerable for. A **KPI** is the number that says
whether you are meeting it.

Each one carries a title, a weight, how it is measured, and a **target**. That
target is what makes an appraisal a conversation about evidence rather than
opinion — "did you do well on Vendor Quality?" has no answer without one.

Weights cannot exceed 100% in total. Set them once per job profile and apply to
everyone holding it, or set them per person.

### The appraisal

**Reports → Appraisal.** Rate each KRA and each behaviour 0–5, add up to 5
discretionary "brownie" points, and write the remarks.

```
Performance = KRA 75% + Behaviour 20% + Brownie (max 5)   → out of 100
Delegation  = measured from the task record               → out of 100
Final       = (Performance + Delegation) / 2
```

Half judgement, half record. A half-rated appraisal drops the unrated half and
renormalises, so an unfinished form never reads as a low score. Somebody with
no closed work has no delegation half, and their final score is their
performance score — **a new joiner is not a poor performer**.

---

## Reports

*Managers and Admins. Included from the paid plans up.*

| | |
|---|---|
| **Period** | Week, month, quarter, year, and back through previous ones |
| **Team score** | The average of everybody with data |
| **Delivered / on-time / rework loops / overdue** | The month in four numbers |
| **Per person** | Score, band, delivered, load, and the full breakdown |
| **Trend** | Twelve periods back |
| **Heatmap** | Twenty weeks of delivery per person |
| **Accountability** | Rework by person — and **who is holding work up** |
| **Review history** | Every stored appraisal |

**Executive insight** (Pro and up) answers questions about last month's
delivery. Only summary figures are sent to the model — never staff records.

---

## Billing

**Plans** (from the account menu).

| Plan | Users | Monthly | Yearly |
|---|---|---|---|
| Free | 5 | ₹0 | — |
| Starter | 15 | ₹2,499 | ₹24,990 |
| **Growth** | 50 | ₹5,999 | ₹59,990 |
| Scale | 150 | ₹12,999 | ₹1,29,990 |
| Enterprise | 150+ | talk to us | |

**Every paid plan carries the whole product.** You pay for the size of your
team, not for features. Yearly is ten times monthly — two months free.

Prices exclude 18% GST, which is added at checkout and shown before the payment
sheet opens.

### Invoices

**Plans → Invoice details** — your registered name, GSTIN, address and state.
Fill this in *before* you pay: the invoice is written the moment the payment
lands and cannot be rewritten afterwards. Without your GSTIN you cannot claim
input credit.

An invoice is emailed from `info@biscsindia.com` the moment a payment goes
through. **Plans → Invoices** lists them all.

### When a plan lapses

A paid plan keeps working for a week past expiry, then drops to read-only.
Nobody loses access to their own history.

---

## For managers

Half of Dome Box is about whether *you* are holding work up.

### You are measured on your queue

Work waiting on your approval or review has a **2 working day** service level.
Past that you lose 2 points a working day — capped at 10 per item and **20 in
total**, because no single oversight should destroy a score.

**Reports → Accountability** shows this for everyone who has ever had something
waiting on a decision, so a manager cannot be absent from the report simply by
owning no tasks.

This exists because the most common way an automated performance metric loses
a room's trust is by scoring employees on a clock their manager controls.

### Reading a score honestly

- A **provisional** flag means too little work to judge. It is a fact, not a
  verdict.
- A low queue-health score with good on-time delivery usually means too much
  work, not slow work.
- Rework loops are the most useful number in the system. A pattern of them is
  about briefing, not effort.
- Open **See why** before a performance conversation. The whole design assumes
  the number will be challenged.

### What the daily digest sends

Every morning, each person gets what is due and what is overdue. A report's
task **3 days** overdue also reaches their manager. Managers get a month-end
nudge about appraisals on the 25th.

---

## Common questions

**I cannot assign a task to a colleague.**
By design. Raise it upward to your manager, or ask them to assign it. Peer-to-peer
assignment with no manager involved is how people end up overloaded with no way
to refuse.

**Why can I not verify my own work?**
Because a close nobody checked is not a close. If you raised it and you are
doing it, an Admin signs it off.

**My task disappeared from the board.**
Closed work archives after seven days. **Archive** shows it.

**The due date moved and my score still says late.**
A deadline changed in the drawer is recorded with the change. A deadline changed
verbally is not. Ask for it to be changed in the system, with the reason.

**I was on leave and it still counted me overdue.**
Leave has to be recorded under **Team → Leave**. The calendar cannot know about
it otherwise.

**Somebody closed nothing this month and is not on the leaderboard.**
Correct. They are listed under *Not ranked*, with the reason. That is not last
place.

**We paid but we are still on the free plan.**
Usually within a minute. If not, check **Plans → Invoices** — if an invoice is
there the payment landed. Contact support with the payment reference.

**Can we get a GST invoice for a past payment?**
Yes. **Plans → Invoices**, or reply to the invoice email and it will be
reissued with the corrected details.

**No email is arriving at all.**
Everything leaves from `info@biscsindia.com`. Check spam, then tell your Admin —
it is usually a configuration issue on the account, not on yours.

---

*Still stuck? Press **?** and choose **Contact support** at the foot of any help
page. Everything reaches `info@biscsindia.com`, and we reply within one working
day.*

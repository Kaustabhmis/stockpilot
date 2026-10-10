/**
 * The content behind the SEO pages.
 *
 * Kept separate from the page machinery so the writing can be read and argued
 * with on its own. Every page here exists because somebody searches for it and
 * a real answer is worth reading — not to hold a keyword. Google's helpful
 * content system demotes pages built the other way round, and so do buyers.
 */
module.exports = (C) => {
  const app = 'https://' + C.domain + '/?signup=1';
  const cta = (line) =>
    `<div class="cta"><p><strong>${line}</strong></p>
     <a class="btn" href="${app}">Start free — 5 users, no card</a>
     <p class="fine">Set up in an afternoon. Nothing to install.</p></div>`;

  return [
  /* ---------------------------------------------------------------- pricing */
  {
    slug: 'pricing',
    title: 'Pricing',
    h1: 'Pricing',
    description: 'Dome Box pricing in INR: free for 5 users, then ₹2,499/month for 15, ₹5,999 for 50 and ₹12,999 for 150. Every paid plan includes the whole product.',
    changefreq: 'monthly', priority: '0.9',
    faq: [
      ['Is there a free plan?', 'Yes. Up to 5 users and 100 tasks a month, with no card and no time limit. It includes the board, approvals and reminders.'],
      ['What is not included in the paid plans?', 'Nothing. Every paid plan carries the whole product — scoring, reports, KRA/KPI, appraisals, projects and WhatsApp alerts. You pay for the size of your team, not for features.'],
      ['Is GST included?', 'No. All prices are exclusive of 18% GST. A GST invoice is issued for every payment so you can claim input credit.'],
      ['What happens when my plan expires?', 'Your workspace stays fully usable for a week. After that it becomes read-only — nothing is ever deleted, and everything comes back the moment you renew.'],
      ['Can I pay monthly?', 'Yes. Yearly is ten times the monthly price, so two months are free if you pay for the year.'],
    ],
    body: `
<p class="lede">Every paid plan carries the whole product. What you pay for is the
size of your team, and the price per person falls as you grow.</p>

<table>
<thead><tr><th>Plan</th><th>Users</th><th>Monthly</th><th>Yearly</th><th>Per user / month</th></tr></thead>
<tbody>
<tr><td><strong>Free</strong></td><td>5</td><td>₹0</td><td>—</td><td>—</td></tr>
<tr><td><strong>Starter</strong></td><td>15</td><td>₹2,499</td><td>₹24,990</td><td>₹167</td></tr>
<tr><td><strong>Growth</strong></td><td>50</td><td>₹5,999</td><td>₹59,990</td><td>₹120</td></tr>
<tr><td><strong>Scale</strong></td><td>150</td><td>₹12,999</td><td>₹1,29,990</td><td>₹87</td></tr>
<tr><td><strong>Enterprise</strong></td><td>150+</td><td colspan="3">Custom — write to us</td></tr>
</tbody></table>

<p>Prices are in INR and exclude 18% GST. Yearly is exactly ten times monthly,
so paying for the year gives you two months free. Need a handful more seats than
a band allows? Extra seats are ₹149 per user a month — ask us.</p>

<h2>Why every plan has every feature</h2>
<p>A plan that withholds the scoring and the appraisals is selling a worse task
board, and it gives a buyer a reason to stay small rather than a reason to grow.
It also makes the decision harder than it needs to be: "which plan do I need?"
becomes "how many people?", which you can answer in a second.</p>

<h2>What happens if you stop paying</h2>
<p>Your workspace keeps working for a week after expiry. After that it turns
read-only. <strong>Nothing is deleted</strong> — your tasks, history, scores and
appraisals are all still there, and they come straight back when you renew. You
can export your data at any time, on any plan.</p>
${cta('Start on the free plan and move up when it is earning its keep.')}`,
  },

  /* --------------------------------------------------------------- features */
  {
    slug: 'features',
    title: 'Features',
    h1: 'What Dome Box does',
    description: 'Task board, multi-stage projects, recurring jobs, multi-level approvals, KRA/KPI tracking, appraisals, delegation scoring and an org chart — built for Indian MSMEs.',
    changefreq: 'monthly', priority: '0.8',
    body: `
<p class="lede">Everything below is in the product today. Not a roadmap.</p>

<h2>Work</h2>
<h3>A board the whole company shares</h3>
<p>Drag work across To Do, In Progress, For Review and Verified. Priority,
category, checklist, blockers and WIP limits. Nothing is "done" until the person
who asked for it says so.</p>

<h3>Projects that run in stages</h3>
<p>Design, then fabricate, then train — each stage with its own owner and its own
deadline. A stage opens only when the one before it is signed off, and its owner
is told the moment it lands. If the stage before yours overruns, your deadline
moves with it, so nobody wears somebody else's slip.</p>

<h3>Recurring jobs that do not die quietly</h3>
<p>Daily, weekly, monthly, quarterly or yearly. The next occurrence is created on
a schedule rather than only when somebody closes the last one — so one forgotten
calibration does not silently end the series.</p>

<h3>Approvals that follow your hierarchy</h3>
<p>Any head of department can raise work for anyone; it goes to that person's own
manager first. A rejection needs a reason, and whoever raised it sees it.</p>

<h3>A priority list that answers "what do I do first?"</h3>
<p>Today, this week, this month, this quarter, this year. Ranked by the level, the
date and who is held up — and every row says which of those put it where it is.</p>

<h2>People</h2>
<h3>KRA and KPI per person</h3>
<p>A target, its unit, which direction is good and how it is measured, so two
managers rating the same person reach the same conclusion. A job profile holds
the standard for the next hire. The KPI target is optional, because plenty of
real responsibilities are judged rather than counted.</p>

<h3>Appraisals you can defend</h3>
<p>KRA ratings, behaviour and the measured delivery record in one review, with the
working shown for every number.</p>

<h3>Cookie points</h3>
<p>Recognition on the day it happens, not six months later. A manager awards 1–5
with a stated reason; the person sees it, and it is on the record at their review.</p>

<h3>An org chart that builds itself</h3>
<p>From who reports to whom. It cannot drift out of date the way a drawn one does.</p>

<h2>Measurement</h2>
<p>A monthly score built from the task record rather than from memory, with every
figure traceable to a named task and a date. <a href="/delegation-score">How the
score works →</a></p>

<h2>Reminders</h2>
<p>One digest per person per day: their overdue work, what is due today and
tomorrow, and what is waiting on them to approve. Plus renewal reminders before a
plan lapses.</p>
${cta('See it with your own team this week.')}`,
  },

  /* -------------------------------------------------------- the score method */
  {
    slug: 'delegation-score',
    title: 'How the delegation score works',
    h1: 'A performance score your team will believe',
    description: 'The method behind the Dome Box score: how well you delivered multiplied by how much you delivered, with managers measured on the approvals they hold.',
    changefreq: 'monthly', priority: '0.7',
    faq: [
      ['Does one easy task score the same as ten hard ones?', 'No. The rate is credited against the load actually carried, weighted by priority, so ten jobs with seven delivered on time outscores one easy job delivered.'],
      ['Are managers measured too?', 'Yes. Sitting on an approval or a review costs score, counted in working days from the moment it reached that person.'],
      ['Does approved leave count as lateness?', 'Never. Weekends, company holidays and that person’s own approved leave are excluded everywhere a day is counted.'],
      ['Can the score go above 100?', 'No. Everybody starts at zero and earns it, and nothing — recognition included — takes anyone past 100.'],
    ],
    body: `
<p class="lede">Most performance software produces a number nobody can argue with,
because nobody can see where it came from. Every figure here traces back to a
named task, a date and a person.</p>

<h2>The formula</h2>
<p class="formula">Score = how well you delivered × how much you delivered</p>
<p>A rate on its own is blind to volume. Somebody who closed a single trivial task
on time was scoring 100, while somebody who carried ten and delivered seven on
time scored 70 — the system was quietly telling the hardest workers in the
company that they were the worst performers.</p>
<p>So the rate is credited against the load actually carried, counted in priority
weights: a High task is worth three Low ones. Load counts three things — work
closed, work in hand at half weight, and the approvals and reviews cleared for
other people. A manager who spends the month unblocking their team is not idle.</p>
<p>The expectation is set per person from their WIP limit, so a part-time or
deliberately low-volume role is measured against its own bar rather than against
the busiest desk in the building. Credit is capped at a full load, so carrying
double does not make 200 — and cutting work into more pieces cannot carry anybody
past a complete score.</p>

<h2>What the rate is made of</h2>
<table>
<thead><tr><th>Component</th><th>Weight</th><th>What it measures</th></tr></thead>
<tbody>
<tr><td>On-time delivery</td><td>35–45%</td><td>Handed in by the date, weighted by priority</td></tr>
<tr><td>First-pass quality</td><td>25–30%</td><td>How often work was sent back for rework</td></tr>
<tr><td>Queue health</td><td>20–25%</td><td>Open work that is running late</td></tr>
<tr><td>Project milestones</td><td>20%</td><td>Stage deadlines met (only if you run projects)</td></tr>
</tbody></table>

<h2>Managers are measured too</h2>
<p>A team marked down for lateness their own manager caused is the fastest way to
make a workforce stop believing any number you show them. Holding an approval or
a review costs score, counted in working days from the moment it landed on that
person's desk — not from the task's deadline, so work handed in early that then
waits a fortnight is counted properly. Two working days is the expected
turnaround; beyond that it is two points a day, capped at ten per item and twenty
overall, because one oversight should not destroy a record.</p>

<h2>Four rules that make it fair</h2>
<ul>
<li><strong>Leave is never lateness.</strong> Weekends, company holidays and that
person's own approved leave are excluded everywhere a day is counted.</li>
<li><strong>Nobody wears somebody else's slip.</strong> If the stage before yours
overran, you get back the window the plan gave you, counted from the day you were
actually released.</li>
<li><strong>The doer is not punished for a slow review.</strong> Delivery is
measured from when work was handed in, not when it was signed off.</li>
<li><strong>0 to 100, always.</strong> Everybody starts at zero and earns it.</li>
</ul>

<h2>Why the working is shown</h2>
<p>Every deduction and every gain appears with the item that caused it, the days
involved and the points. A score nobody can see the derivation of is a score
people quietly ignore — and they are right to.</p>
${cta('Measure a month of real work and see what it says.')}`,
  },

  /* ------------------------------------------------------------ KRA and KPI */
  {
    slug: 'kra-kpi-format',
    title: 'KRA and KPI format for employees, with examples',
    h1: 'KRA and KPI format for employees (with real examples)',
    description: 'What a KRA is, how it differs from a KPI, and a format you can use — with worked examples for production, quality, purchase, sales, accounts and HR roles in an Indian SME.',
    changefreq: 'yearly', priority: '0.8',
    faq: [
      ['What is the difference between a KRA and a KPI?', 'A KRA is the area somebody is answerable for — "Inventory Accuracy". A KPI is the number that settles whether they met it — "count variance under 2%". One is the responsibility, the other is the measurement.'],
      ['How many KRAs should one person have?', 'Three to five. Beyond that the weights get so small that nothing moves the score, and the appraisal becomes a form-filling exercise.'],
      ['Should KRA weights add up to 100?', 'Yes. If they add to less, part of the person’s job is unmeasured; if they add to more, the arithmetic is wrong and the score will be disputed.'],
      ['Does every KRA need a numeric target?', 'No. Plenty of real responsibilities — keeping the plant audit-ready, holding a team together — are judged rather than counted. Say so explicitly instead of inventing a number to fill the box.'],
    ],
    body: `
<p class="lede">A KRA is the area somebody is answerable for. A KPI is the number
that settles whether they met it. Most appraisal arguments in a small company come
from having the first without the second.</p>

<h2>The format</h2>
<p>Six columns. Nothing else is needed, and anything more gets left blank.</p>
<table>
<thead><tr><th>Column</th><th>What goes in it</th></tr></thead>
<tbody>
<tr><td>KRA</td><td>The area of responsibility. "Vendor Quality", not "do vendor work"</td></tr>
<tr><td>Weight</td><td>Its share of this person's job, as a percentage. All KRAs add to 100</td></tr>
<tr><td>KPI target</td><td>The number that settles it. Leave blank where the result is judged</td></tr>
<tr><td>Unit</td><td>%, days, count, ₹, ratio</td></tr>
<tr><td>Direction</td><td>Higher is better / lower is better / on target</td></tr>
<tr><td>How measured</td><td>The report or record the number comes from</td></tr>
</tbody></table>
<p>That last column is the one people skip and the one that prevents the argument.
If nobody can say where the number comes from, the rating is an opinion.</p>

<h2>Worked examples</h2>

<h3>Production supervisor</h3>
<table>
<thead><tr><th>KRA</th><th>Weight</th><th>Target</th><th>Direction</th><th>How measured</th></tr></thead>
<tbody>
<tr><td>Plan adherence</td><td>35%</td><td>95%</td><td>Higher is better</td><td>Daily production plan vs actual</td></tr>
<tr><td>Rejection control</td><td>30%</td><td>2%</td><td>Lower is better</td><td>Monthly rejection report</td></tr>
<tr><td>Downtime</td><td>20%</td><td>4 hours</td><td>Lower is better</td><td>Machine log</td></tr>
<tr><td>Housekeeping and safety</td><td>15%</td><td>—</td><td>On target</td><td>Weekly 5S audit, judged</td></tr>
</tbody></table>

<h3>Quality engineer</h3>
<table>
<thead><tr><th>KRA</th><th>Weight</th><th>Target</th><th>Direction</th><th>How measured</th></tr></thead>
<tbody>
<tr><td>Customer complaints closed within SLA</td><td>35%</td><td>90%</td><td>Higher is better</td><td>CRM closure report</td></tr>
<tr><td>Supplier CAPA closure</td><td>25%</td><td>15 days</td><td>Lower is better</td><td>CAPA register</td></tr>
<tr><td>Audit findings closed</td><td>25%</td><td>100%</td><td>Higher is better</td><td>Internal audit tracker</td></tr>
<tr><td>Calibration compliance</td><td>15%</td><td>100%</td><td>Higher is better</td><td>Calibration schedule</td></tr>
</tbody></table>

<h3>Purchase executive</h3>
<table>
<thead><tr><th>KRA</th><th>Weight</th><th>Target</th><th>Direction</th><th>How measured</th></tr></thead>
<tbody>
<tr><td>Cost savings</td><td>30%</td><td>₹5,00,000</td><td>Higher is better</td><td>Negotiated vs last rate</td></tr>
<tr><td>On-time material availability</td><td>30%</td><td>98%</td><td>Higher is better</td><td>Stock-out register</td></tr>
<tr><td>Vendor rating</td><td>20%</td><td>85</td><td>Higher is better</td><td>Quarterly vendor scorecard</td></tr>
<tr><td>PO cycle time</td><td>20%</td><td>3 days</td><td>Lower is better</td><td>Indent to PO date</td></tr>
</tbody></table>

<h3>Accounts executive</h3>
<table>
<thead><tr><th>KRA</th><th>Weight</th><th>Target</th><th>Direction</th><th>How measured</th></tr></thead>
<tbody>
<tr><td>Receivables over 60 days</td><td>35%</td><td>5%</td><td>Lower is better</td><td>Ageing report</td></tr>
<tr><td>GST and TDS filed on time</td><td>30%</td><td>100%</td><td>Higher is better</td><td>Portal acknowledgements</td></tr>
<tr><td>Month-end close</td><td>20%</td><td>5 days</td><td>Lower is better</td><td>Books closed date</td></tr>
<tr><td>Audit queries resolved</td><td>15%</td><td>—</td><td>On target</td><td>Auditor's list, judged</td></tr>
</tbody></table>

<h2>Five mistakes that make a KRA sheet useless</h2>
<ul>
<li><strong>Weights that do not add to 100.</strong> Part of the job goes
unmeasured, and the person notices.</li>
<li><strong>Ten KRAs.</strong> At 10% each, nothing moves the score. Three to five.</li>
<li><strong>A target with no source.</strong> "Improve quality" is not a target.
"Rejection under 2%, from the monthly rejection report" is.</li>
<li><strong>Inventing a number for something that is judged.</strong> Leave the
target blank and say it is rated on judgement. Pretending otherwise is worse.</li>
<li><strong>Writing them once and never looking again.</strong> A KRA sheet that
only appears at appraisal time is a form, not a management tool.</li>
</ul>

<h2>Doing it without a spreadsheet</h2>
<p>Dome Box holds a KRA set per person with the target, the unit, the direction
and the measurement source, and a job profile keeps the standard for the next
hire. The appraisal form then shows each target next to the rating, so the
conversation is about evidence rather than recollection.</p>
${cta('Set up your first KRA sheet in ten minutes.')}`,
  },

  /* ------------------------------------------------------- performance mgmt */
  {
    slug: 'employee-performance-management',
    title: 'Employee performance management in India',
    h1: 'Employee performance management for a small Indian company',
    description: 'A practical performance system for a 10 to 300 person Indian business: what to measure, how to keep it fair, and why the yearly appraisal fails.',
    changefreq: 'yearly', priority: '0.8',
    faq: [
      ['How often should we appraise people?', 'Score monthly, review formally once or twice a year. A yearly appraisal built from memory mostly reflects the last six weeks, which is why the quiet performer loses.'],
      ['Should performance be tied to attendance?', 'Only as a small behavioural component. Attendance measures presence, not output, and a system that leans on it rewards the person who sits at their desk over the person who finishes the work.'],
      ['How do we stop managers rating everyone the same?', 'Make the measured half of the score come from the work record rather than from an opinion, and show the working. A manager who has to rate against a stated target and a visible delivery history has much less room to flatten everybody to "good".'],
    ],
    body: `
<p class="lede">Most small Indian companies measure performance once a year, from
memory, mostly about the last six weeks. The quiet performer loses, everybody
knows it, and the exercise slowly loses its meaning.</p>

<h2>What actually needs measuring</h2>
<p>Three things, and they answer different questions:</p>
<ul>
<li><strong>Delivery</strong> — did the work get done, on time, without being sent
back? This comes from the record, not from an opinion.</li>
<li><strong>Responsibility</strong> — were the things this person is accountable
for actually moved? This is the KRA half, and it needs targets.</li>
<li><strong>Behaviour</strong> — how they work with everybody else. Judged, and
honest about being judged.</li>
</ul>

<h2>Why a yearly appraisal fails</h2>
<p>Not because managers are lazy. Because human memory is recency-weighted, and
twelve months of work does not fit in it. By the time the form is filled in, the
only evidence available is what happened recently and what was unusually good or
bad. Everything steady and reliable in between is invisible — which is precisely
the behaviour you most want to reward.</p>
<p>The fix is not more forms. It is recording the work as it happens, so the
appraisal has something to read.</p>

<h2>Keeping it fair enough to survive contact with the team</h2>
<p>A performance system fails the first time somebody can point at it and say
"that is not right". Four rules do most of the work:</p>
<ul>
<li><strong>Measure the manager too.</strong> If a manager sits on an approval for
two weeks, the delay is theirs, not the doer's. A system that only measures
downwards gets read as a stick.</li>
<li><strong>Never count approved leave as lateness.</strong> One sanctioned
fortnight off should not wreck somebody's year.</li>
<li><strong>Account for volume.</strong> Somebody who finished one easy job should
not outrank somebody who carried ten and finished seven on time.</li>
<li><strong>Show the working.</strong> Every number should trace to a named task
and a date. If it cannot, do not show the number.</li>
</ul>

<h2>A workable month</h2>
<ol>
<li>Work is assigned with an owner, a date and a priority. Nothing lives in a
WhatsApp thread that scrolls away.</li>
<li>Completion is claimed by the doer and <em>confirmed</em> by whoever asked for
it. "Done" is not self-certified.</li>
<li>Rework is recorded when work is sent back — this is your quality signal and
it costs nothing extra to collect.</li>
<li>At month end the delivery half of the score already exists. The manager only
has to rate the KRAs and the behaviours.</li>
<li>Recognition happens on the day, not at the review. A thank-you six months
late is not recognition, it is paperwork.</li>
</ol>

<h2>What to do first</h2>
<p>Do not start by writing KRAs for everyone — you will spend three weeks on it
and the sheets will be out of date by the time you finish. Start by getting the
work itself written down for one department for one month. The KRAs will write
themselves once you can see what people actually do.</p>
${cta('Start with one department and one month of real work.')}`,
  },

  /* ----------------------------------------------------------- manufacturing */
  {
    slug: 'task-management-for-manufacturing',
    title: 'Task management for manufacturing',
    h1: 'Task management for a manufacturing company',
    description: 'Why generic project tools do not fit a factory: recurring calibration and maintenance, staged handovers, visible blockers and a record that stands up at audit.',
    changefreq: 'yearly', priority: '0.7',
    body: `
<p class="lede">A factory does not run on projects. It runs on a few hundred
recurring obligations, a handful of things that pass through several hands, and a
constant stream of problems that have to be closed and evidenced.</p>

<h2>What generic tools get wrong</h2>
<ul>
<li><strong>They assume work is one-off.</strong> Most factory work is not.
Calibration, preventive maintenance, PDI checks, internal audits, stock
reconciliation — these repeat forever, and a tool where somebody has to remember
to create next month's is a tool that fails in month three.</li>
<li><strong>They have no concept of sign-off.</strong> "Done" ticked by the person
who did it is not how a quality system works. Somebody has to verify.</li>
<li><strong>They cannot express a handover.</strong> Design, then fabricate, then
trial, then train — four owners, four dates, each one unable to start until the
one before finishes.</li>
<li><strong>They produce no evidence.</strong> At audit time you need to show when
something was raised, who closed it and when. A board of coloured cards does not.</li>
</ul>

<h2>What a factory actually needs</h2>

<h3>Recurring work that survives being forgotten</h3>
<p>Daily, weekly, monthly, quarterly, yearly. The next occurrence should be
created on a schedule, not only when somebody closes the last one — otherwise one
missed calibration quietly ends the series, and nobody notices until the auditor
does.</p>

<h3>Multi-stage jobs with a deadline per stage</h3>
<p>A fixture upgrade is design (5 days) → fabricate and trial (15 days) → train
the operators (10 days), with three different owners. Each stage opens when the
one before it is signed off, and the person it lands on is told. If fabrication
overruns, training's deadline moves with it — the trainer should not be marked
down for a delay upstream of them.</p>

<h3>Blockers that are visible</h3>
<p>Rejection analysis cannot start until the vendor audit is finished. Saying so
in the system means the rejection task is not sitting in somebody's to-do list
accusing them of being slow.</p>

<h3>A record that stands up at audit</h3>
<p>Every status change, approval, rejection reason and date change kept with a
timestamp and a name against it.</p>

<h2>Categories that match a plant</h2>
<p>NPD, PQC, PDI, IQC, maintenance, production plan, purchase, supplier, SCM,
inventory plan, systems — out of the box, and editable, because every plant names
these slightly differently.</p>
${cta('Run one line or one department for a month.')}`,
  },

  /* ------------------------------------------------------------ alternatives */
  {
    slug: 'alternatives',
    title: 'Compared with Monday, Trello and Asana',
    h1: 'How Dome Box compares',
    description: 'An honest comparison with Monday.com, Trello, Asana and a spreadsheet for an Indian SME — including where one of the others is the better buy.',
    changefreq: 'yearly', priority: '0.7',
    body: `
<p class="lede">Written to be useful rather than flattering. There are places on
this page where the answer is "use the other one".</p>

<h2>The short version</h2>
<table>
<thead><tr><th>If you want…</th><th>Use</th></tr></thead>
<tbody>
<tr><td>A free board for a handful of people, nothing more</td><td>Trello</td></tr>
<tr><td>Deep customisation and you have someone to maintain it</td><td>Monday.com</td></tr>
<tr><td>Software-team workflows, sprints and dependencies</td><td>Asana or Jira</td></tr>
<tr><td>Work tracked <em>and</em> people measured, priced in INR</td><td>Dome Box</td></tr>
<tr><td>Fewer than 5 people and no process yet</td><td>A spreadsheet, honestly</td></tr>
</tbody></table>

<h2>Against a spreadsheet</h2>
<p>A spreadsheet is free, everybody can already use it, and for a team of four it
is genuinely fine. It stops working when you need two things it cannot do:
somebody other than the owner updating it reliably, and a history of what changed
and when. If your sheet has a "Status" column that is three weeks stale, you have
already found the limit.</p>

<h2>Against Trello</h2>
<p>Trello is a better pure board than ours and it is free. What it does not have
is a sign-off step, recurring work that generates itself reliably, or any notion
of performance. If all you need is to see who has what, Trello is the cheaper
answer and we would rather you knew that.</p>

<h2>Against Monday.com and Asana</h2>
<p>Both are more configurable than Dome Box and both have far bigger ecosystems.
Two practical differences for an Indian SME:</p>
<ul>
<li><strong>Price.</strong> Per-seat pricing in dollars at a 50-person company
runs to several lakh a year. Dome Box Growth covers 50 people at ₹59,990.</li>
<li><strong>Appraisals.</strong> Neither produces a defensible performance score
or holds KRAs and KPIs. You would still buy a second tool for that, or do it in a
spreadsheet.</li>
</ul>
<p>If your constraint is workflow complexity rather than cost, buy Monday. If your
constraint is "I cannot tell who is actually delivering", that is what we built.</p>

<h2>Against a full HRMS</h2>
<p>An HRMS handles payroll, attendance, leave and compliance, and does it far
better than we ever will. It usually treats performance as a form to fill in once
a year. Dome Box is the opposite: it is weak on payroll and strong on what
actually happened week to week. Many customers run both.</p>

<h2>Where Dome Box is genuinely different</h2>
<ul>
<li>A performance score built from the task record rather than from memory, with
the working shown for every number.</li>
<li>Managers are measured on the approvals they hold, not just doers on delivery.</li>
<li>KRA, KPI and appraisal in the same place as the work they are measuring.</li>
<li>Priced in INR, for team size, with every feature in every paid plan.</li>
</ul>
${cta('The free plan is enough to compare it properly.')}`,
  },

  /* ------------------------------------------------------------- guide index */
  {
    slug: 'guides',
    title: 'Guides',
    h1: 'Guides',
    description: 'Practical guides on KRAs and KPIs, employee performance management, and running task management in an Indian manufacturing or services business.',
    changefreq: 'monthly', priority: '0.6',
    faq: [
      ['Where should I start?', 'With the work itself, for one department, for one month. Writing KRAs for everybody first takes three weeks and the sheets are stale before you finish — once you can see what people actually do, the KRAs write themselves.'],
      ['Do I need all of this to begin?', 'No. A board with owners and dates is useful on day one. Scoring needs about a month of real data before it says anything you should act on, and the appraisal piece only matters at review time.'],
    ],
    body: `
<p class="lede">Written for the person who has to make this work on Monday
morning, not for a conference talk.</p>

<h2>The order that actually works</h2>
<p>Most attempts to put a system around work in a small company fail in the same
way: somebody starts by designing the measurement. Three weeks go into KRA
sheets, weights and rating scales, and by the time it is finished nobody has
changed how a single task gets assigned — so there is nothing to measure, and the
sheets quietly go in a drawer.</p>
<p>The order that survives is the other way round:</p>
<ol>
<li><strong>Get the work written down.</strong> One department, one month. Every
job has an owner, a date and a priority, and "done" is confirmed by whoever asked
for it rather than by whoever did it. Nothing else matters until this is
habitual.</li>
<li><strong>Let the record accumulate.</strong> After a few weeks you have
something no spreadsheet gives you: what was actually promised, what arrived on
time, and what came back for rework. That is most of a performance picture, and
it cost nobody any extra effort to collect.</li>
<li><strong>Write the KRAs from what you can now see.</strong> They will be
shorter, more concrete and far easier to agree, because you are describing
observed work rather than imagining it.</li>
<li><strong>Only then, appraise.</strong> With the delivery half already measured,
the conversation is about the judged half — which is the part a manager is
genuinely needed for.</li>
</ol>
<p>The guides below follow that sequence. If you read one, read the first.</p>

<div class="cards">
  <a class="card" href="/kra-kpi-format"><strong>KRA and KPI format, with examples</strong>
  <span>What goes in each column, worked examples for production, quality,
  purchase and accounts, and the five mistakes that make a KRA sheet useless.</span></a>

  <a class="card" href="/employee-performance-management"><strong>Performance management for a small Indian company</strong>
  <span>What to measure, why the yearly appraisal fails, and the four rules that
  keep a system fair enough to survive contact with the team.</span></a>

  <a class="card" href="/delegation-score"><strong>How the delegation score works</strong>
  <span>Why a rate on its own is misleading, how load is credited, and how
  managers are held to the approvals they sit on.</span></a>

  <a class="card" href="/task-management-for-manufacturing"><strong>Task management for a manufacturing company</strong>
  <span>Why generic project tools do not fit a factory, and what recurring work,
  staged handovers and audit evidence actually need.</span></a>

  <a class="card" href="/alternatives"><strong>Compared with Monday, Trello, Asana and a spreadsheet</strong>
  <span>An honest comparison, including the cases where one of the others is the
  better buy.</span></a>
</div>

<h2>A note on measuring people</h2>
<p>Every system on this page can be used badly. The failure mode is always the
same: a number appears, somebody cannot see where it came from, and within two
months the whole exercise is being quietly worked around rather than used.</p>
<p>Three things prevent it, and none of them are technical. Measure the managers
as well as the doers, so the system is not read as a stick pointing one way.
Never count sanctioned leave against anybody. And show the working behind every
figure, every time — if you cannot explain how a number was reached, do not put
it in front of the person it describes.</p>
${cta('Start with one department and a month of real work.')}`,
  },
  ];
};

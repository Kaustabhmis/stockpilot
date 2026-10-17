#!/usr/bin/env node
/**
 * Builds the static policy pages from site-config.json.
 *
 * Refuses to write anything while a required field is blank. These are legal
 * pages on a live commercial site; shipping one with "[TBD]" in it is worse
 * than not shipping it, so the failure is deliberate and loud.
 */
const fs = require('fs'), path = require('path');
const here = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'site-config.json'), 'utf8'));

const REQUIRED = ['registeredAddress','phone','gstin','entityType','registrationNumber',
  'grievanceOfficerName','jurisdictionCity','jurisdictionState'];
const missing = REQUIRED.filter(k => !String(cfg[k] || '').trim());
if (missing.length) {
  console.error('\nCannot build the policy pages — these fields are still blank in site-config.json:\n');
  missing.forEach(k => console.error('  · ' + k));
  console.error('\nSee REQUIRED-BEFORE-DEPLOY.md for what each one is and where to find it.');
  console.error('Nothing was written.\n');
  process.exit(1);
}

const esc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const C = Object.fromEntries(Object.entries(cfg).map(([k,v]) => [k, esc(v)]));

const shell = (slug, title, description, body) => `<!DOCTYPE html>
<html lang="en-IN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} | ${C.productName}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="https://${C.domain}/${slug}">
<meta name="robots" content="index, follow">
<meta property="og:title" content="${esc(title)} | ${C.productName}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="https://${C.domain}/${slug}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${C.productName}">
<meta property="og:image" content="https://${C.domain}/og-cover.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
/* Self-contained on purpose. A legal page must render even if a stylesheet or a
   font CDN fails, because it is the page a regulator or a payment reviewer
   opens, often on a bad connection. */
*{box-sizing:border-box}
body{margin:0;background:#f9fafb;color:#1f2937;
  font:16px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,sans-serif}
header{background:#fff;border-bottom:1px solid #e5e7eb;padding:16px 24px;
  display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.brand{font-weight:900;font-size:20px;letter-spacing:-.02em;color:#111827;text-decoration:none}
.brand span{color:#2563eb}
nav a{color:#4b5563;text-decoration:none;font-weight:700;font-size:14px;margin-left:18px}
nav a:hover{color:#2563eb;text-decoration:underline}
main{max-width:760px;margin:0 auto;padding:48px 24px 80px}
h1{font-size:34px;font-weight:900;letter-spacing:-.02em;margin:0 0 8px;line-height:1.2}
.eff{color:#6b7280;font-size:14px;font-weight:600;margin:0 0 40px}
h2{font-size:20px;font-weight:800;margin:40px 0 12px;letter-spacing:-.01em}
h3{font-size:16px;font-weight:800;margin:24px 0 8px}
p,li{color:#374151}
ul{padding-left:22px}
li{margin:6px 0}
a{color:#1d4ed8}
table{width:100%;border-collapse:collapse;margin:16px 0;font-size:15px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:800}
.box{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:20px 24px;margin:24px 0}
.box dt{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;font-weight:800;margin-top:14px}
.box dt:first-child{margin-top:0}
.box dd{margin:2px 0 0;font-weight:700;color:#111827}
footer{border-top:1px solid #e5e7eb;background:#fff;padding:28px 24px;text-align:center;
  color:#4b5563;font-size:14px}
footer a{color:#4b5563;margin:0 10px;font-weight:700}
@media(max-width:600px){h1{font-size:27px}main{padding:32px 20px 60px}}
</style>
</head>
<body>
<header>
  <a class="brand" href="/">Dome<span>Box</span></a>
  <nav>
    <a href="/">Home</a>
    <a href="/privacy">Privacy</a>
    <a href="/terms">Terms</a>
    <a href="/refund">Refunds</a>
    <a href="/contact">Contact</a>
  </nav>
</header>
<main>
${body}
</main>
<footer>
  <p>&copy; 2026 ${C.legalEntity}. ${C.productName} is a product of ${C.legalEntity}.</p>
  <p>
    <a href="/privacy">Privacy</a><a href="/terms">Terms</a>
    <a href="/refund">Refunds</a><a href="/contact">Contact</a>
  </p>
</footer>
</body>
</html>
`;

const identity = `<div class="box"><dl>
  <dt>Operated by</dt><dd>${C.legalEntity} (${C.entityType})</dd>
  <dt>Registration</dt><dd>${C.registrationNumber}</dd>
  <dt>GSTIN</dt><dd>${C.gstin}</dd>
  <dt>Registered address</dt><dd>${C.registeredAddress}</dd>
  <dt>Email</dt><dd><a href="mailto:${C.supportEmail}">${C.supportEmail}</a></dd>
  <dt>Phone</dt><dd>${C.phone}</dd>
</dl></div>`;

const grievance = `<h2>Grievance Officer</h2>
<p>In accordance with the Consumer Protection (E-Commerce) Rules, 2020 and the
Information Technology (Intermediary Guidelines and Digital Media Ethics Code)
Rules, 2021:</p>
<div class="box"><dl>
  <dt>Name</dt><dd>${C.grievanceOfficerName}</dd>
  <dt>Email</dt><dd><a href="mailto:${C.grievanceOfficerEmail}">${C.grievanceOfficerEmail}</a></dd>
  <dt>Address</dt><dd>${C.registeredAddress}</dd>
  <dt>Phone</dt><dd>${C.phone}</dd>
</dl></div>
<p>We acknowledge every complaint within <strong>48 hours</strong> and aim to
resolve it within <strong>one month</strong> of receipt.</p>`;

/* ------------------------------- PRIVACY -------------------------------- */
const privacy = shell('privacy', 'Privacy Policy',
  `How ${cfg.productName} collects, uses, stores and deletes your data, and your rights under India's DPDP Act 2023.`,
`<h1>Privacy Policy</h1>
<p class="eff">Effective ${C.effectiveDate} · Applies to ${C.domain}</p>

${identity}

<h2>1. Who we are, and the two roles we play</h2>
<p>${C.legalEntity} operates ${C.productName}, a task and team management service.
Our role depends on whose data it is, and the distinction matters for your rights:</p>
<ul>
  <li><strong>For your company's account</strong> — the person who signs up, billing
  details, and contact information — we are the <em>Data Fiduciary</em>. We decide
  how that data is used.</li>
  <li><strong>For the employee records your company puts into ${C.productName}</strong> —
  names, work emails, tasks, performance scores — we are a <em>Data Processor</em>
  acting on your company's instructions. Your employer decides what goes in and who
  may see it. If you are an employee with a question about your own performance
  data, your employer is the right first contact; we will assist them.</li>
</ul>

<h2>2. What we collect</h2>
<table>
  <tr><th>Category</th><th>Examples</th><th>Why</th></tr>
  <tr><td>Account</td><td>Name, work email, company name, phone, password (stored only as a salted hash)</td><td>To create and secure your workspace</td></tr>
  <tr><td>Work content</td><td>Tasks, deadlines, comments, checklists, KRAs, delegation and performance scores</td><td>To provide the service you subscribed to</td></tr>
  <tr><td>Billing</td><td>Plan, payment identifiers, invoices</td><td>To take payment and issue GST invoices</td></tr>
  <tr><td>Technical</td><td>IP address, browser type, timestamps of access</td><td>Security, abuse prevention, debugging</td></tr>
  <tr><td>WhatsApp (optional)</td><td>Mobile number and your explicit consent record</td><td>Only to send task reminders you asked for</td></tr>
</table>
<p><strong>We do not sell your data. We do not use your work content to train any
machine-learning model. We do not show third-party advertising inside the product.</strong></p>

<h2>3. Consent, and how to withdraw it</h2>
<p>We process account and work data because it is necessary to provide a service you
asked for. Two things are strictly opt-in and can be withdrawn at any time without
affecting the rest of the service:</p>
<ul>
  <li><strong>WhatsApp reminders</strong> — reply <strong>STOP</strong> to any message,
  or clear the checkbox on your profile. It takes effect immediately.</li>
  <li><strong>Product and marketing email</strong> — use the unsubscribe link. Service
  email about your own tasks and billing continues, because it is part of the service.</li>
</ul>

<h2>4. Where your data is stored</h2>
<p>${C.productName} is built on Google Workspace infrastructure. Each customer company
gets its own separate spreadsheet-backed database, so one customer's data is not
mixed with another's. Google may process and store this data on servers outside
India. Where that happens, the transfer relies on Google's contractual safeguards as
our sub-processor. Payments are handled by Razorpay, who receive only what is needed
to take the payment — we never see or store your full card details.</p>
<h3>Sub-processors</h3>
<table>
  <tr><th>Provider</th><th>Purpose</th></tr>
  <tr><td>Google (Workspace, Apps Script, Drive)</td><td>Application hosting, database, email delivery, backups</td></tr>
  <tr><td>Razorpay</td><td>Payment processing and invoicing</td></tr>
  <tr><td>Netlify</td><td>Hosting the public website</td></tr>
  <tr><td>Meta (WhatsApp Business Platform)</td><td>Delivering reminders, only where you opted in</td></tr>
</table>

<h2>5. How long we keep it</h2>
<ul>
  <li><strong>While your account is active</strong> — for as long as you use the service.</li>
  <li><strong>After cancellation</strong> — up to <strong>${C.dataRetentionMonths} months</strong>,
  so you can reactivate without losing your history. After that it is deleted from
  live systems.</li>
  <li><strong>Backups</strong> — dated copies are retained on a rolling schedule and
  are overwritten in turn. A deletion request is applied to live systems immediately
  and works through backups as they rotate.</li>
  <li><strong>Invoices and tax records</strong> — retained as long as Indian tax law
  requires, regardless of account status.</li>
</ul>
<p>You can ask us to delete your workspace sooner. Write to
<a href="mailto:${C.supportEmail}">${C.supportEmail}</a> from the account email.</p>

<h2>6. Your rights under the DPDP Act 2023</h2>
<ul>
  <li><strong>Access</strong> — a copy of the personal data we hold about you.</li>
  <li><strong>Correction</strong> — have inaccurate or incomplete data fixed.</li>
  <li><strong>Erasure</strong> — deletion, where we are not required to keep it by law.</li>
  <li><strong>Withdraw consent</strong> — for anything you opted into.</li>
  <li><strong>Grievance redressal</strong> — escalate to the officer named below, and
  from there to the Data Protection Board of India.</li>
  <li><strong>Nominate</strong> — appoint someone to exercise these rights if you are
  unable to.</li>
</ul>
<p>Write to <a href="mailto:${C.supportEmail}">${C.supportEmail}</a>. We respond within
30 days. If the data belongs to your employer's workspace, we will route the request
to them, because it is their record to release.</p>

<h2>7. Security</h2>
<ul>
  <li>Passwords are stored only as a salted, repeatedly-hashed digest. We cannot read
  your password, and neither can anyone who obtains the database.</li>
  <li>All traffic is served over HTTPS.</li>
  <li>Each customer company has a separate database rather than a shared table.</li>
  <li>Payment signatures are verified server-side before any account is upgraded.</li>
  <li>Nightly backups, with restores tested.</li>
</ul>
<p>No system is perfectly secure. If we discover a breach affecting your data, we will
notify you and the Data Protection Board of India as the DPDP Act requires.</p>

<h2>8. Children</h2>
<p>${C.productName} is a workplace tool and is not directed at anyone under 18. We do
not knowingly create accounts for children.</p>

<h2>9. Changes</h2>
<p>If we change this policy materially we will email the account holder and update the
date at the top. Continuing to use ${C.productName} after that constitutes acceptance.</p>

${grievance}`);

/* -------------------------------- TERMS --------------------------------- */
const terms = shell('terms', 'Terms & Conditions',
  `The agreement between you and ${cfg.legalEntity} for use of ${cfg.productName}.`,
`<h1>Terms &amp; Conditions</h1>
<p class="eff">Effective ${C.effectiveDate} · Applies to ${C.domain}</p>

${identity}

<h2>1. Agreement</h2>
<p>These terms are an agreement between you (and the company you represent) and
${C.legalEntity}. By creating an account or using ${C.productName} you accept them. If
you are accepting on behalf of a company, you confirm you are authorised to do so.</p>

<h2>2. The service</h2>
<p>${C.productName} is a subscription task and team management service: task
assignment and delegation, recurring work, reminders, KRA and KPI tracking,
performance scoring and reporting. We may add, change or withdraw features. If we
withdraw something material to a paid plan, you may cancel and receive a pro-rata
refund of the unused period.</p>

<h2>3. Your account</h2>
<ul>
  <li>You are responsible for keeping your password confidential and for everything
  done under your account.</li>
  <li>You must give accurate information and keep it current.</li>
  <li>One login is for one person. Sharing a login among several people is a breach of
  these terms and distorts the performance scoring the product exists to provide.</li>
  <li>Tell us promptly at <a href="mailto:${C.supportEmail}">${C.supportEmail}</a> if
  you suspect unauthorised access.</li>
</ul>

<h2>4. Plans, limits and payment</h2>
<p>Current plans, prices and limits are shown at
<a href="https://${C.domain}/#pricing-landing">${C.domain}</a>. All prices are in Indian
Rupees and exclusive of GST unless stated otherwise. A GST invoice is issued for every
paid subscription.</p>
<ul>
  <li><strong>User and task limits are enforced.</strong> Reaching a limit does not
  delete anything; it prevents adding more until you upgrade or the monthly count
  resets on the 1st.</li>
  <li>Recurring occurrences generated automatically by the system do not count against
  a monthly task allowance.</li>
  <li><strong>Monthly plans</strong> renew monthly until cancelled.
  <strong>Annual plans</strong> are paid upfront for twelve months.</li>
  <li>If a renewal payment fails, your access continues for
  <strong>${C.refundWindowDays} days</strong> while you fix it. After that the account
  reverts to the Free tier. <strong>Your data is not deleted</strong> — only access to
  paid features stops.</li>
  <li>We may change prices with 30 days' notice by email. An existing annual term is
  honoured at the price you paid.</li>
</ul>

<h2>5. Acceptable use</h2>
<p>You must not:</p>
<ul>
  <li>Use ${C.productName} unlawfully, or to store unlawful content.</li>
  <li>Attempt to access another company's workspace or data.</li>
  <li>Probe, scan or attempt to breach our systems, or circumvent plan limits.</li>
  <li>Resell or white-label the service without a written agreement with us.</li>
  <li>Use automated means to place unreasonable load on the service.</li>
  <li>Upload material that infringes someone else's rights.</li>
</ul>
<p>We may suspend an account that breaches this clause. Where the breach is not
deliberate we will contact you first.</p>

<h2>6. Your data</h2>
<p><strong>Your work content is yours.</strong> We claim no ownership of it. We process
it to provide the service, as described in the <a href="/privacy">Privacy Policy</a>.
You can export it, and you can ask us to delete it. We use it for nothing else — no
resale, no advertising, and no training of machine-learning models.</p>

<h2>7. Performance scoring — an important limitation</h2>
<p>${C.productName} calculates delegation scores, KRA ratings and appraisal figures
from the data your company enters. <strong>These are an input to a human decision, not
a substitute for one.</strong> They reflect only what was recorded in the system, and
records are incomplete for ordinary reasons — work done offline, context a manager
knows and the system does not, or a deadline everyone agreed to move but nobody
updated.</p>
<p>You are responsible for how you use these numbers. If you use them in decisions
about pay, promotion or continued employment, you remain solely responsible for those
decisions and for complying with the employment law that applies to you. We strongly
recommend letting employees see their own score and its breakdown, and giving them a
route to contest it.</p>

<h2>8. Availability</h2>
<p>We work to keep ${C.productName} available but do not guarantee uninterrupted
service. It depends on third-party infrastructure, chiefly Google Workspace, and is
subject to that platform's own limits and outages. We aim to give advance notice of
planned maintenance.</p>

<h2>9. Liability</h2>
<p>To the maximum extent permitted by law, ${C.legalEntity}'s total liability arising
out of or relating to these terms is limited to the fees you paid us in the
<strong>twelve months</strong> before the claim. We are not liable for indirect or
consequential loss, lost profits, lost business, or loss of data beyond our duty to
maintain the backups described in the Privacy Policy.</p>
<p>Nothing here excludes liability that cannot lawfully be excluded, including for
fraud or for death or personal injury caused by negligence.</p>

<h2>10. Cancellation and termination</h2>
<p>You may cancel at any time — see the <a href="/refund">Refund &amp; Cancellation
Policy</a>. We may terminate for material breach, or for non-payment after the grace
period. On termination you may export your data for
<strong>${C.dataRetentionMonths} months</strong>, after which it is deleted.</p>

<h2>11. Governing law</h2>
<p>These terms are governed by the laws of India. The courts at
<strong>${C.jurisdictionCity}, ${C.jurisdictionState}</strong> have exclusive
jurisdiction.</p>

<h2>12. Changes</h2>
<p>We may update these terms. Material changes will be emailed to the account holder
at least 14 days before they take effect. Continuing to use the service after that
constitutes acceptance.</p>

${grievance}`);

/* -------------------------------- REFUND -------------------------------- */
const refund = shell('refund', 'Refund & Cancellation Policy',
  `How to cancel a ${cfg.productName} subscription and when a refund applies.`,
`<h1>Refund &amp; Cancellation Policy</h1>
<p class="eff">Effective ${C.effectiveDate} · Applies to ${C.domain}</p>

<p>Short version: there is a <strong>free tier you can test on indefinitely</strong>,
so we ask you to try before you pay. Once a paid period has begun we refund it within
${C.refundWindowDays} days if the product does not do what we said it does, and we
always refund our own mistakes.</p>

${identity}

<h2>How to cancel</h2>
<p>Email <a href="mailto:${C.supportEmail}">${C.supportEmail}</a> from your registered
address, or ask us in the app. We confirm within one working day.</p>
<ul>
  <li><strong>Monthly plans</strong> — cancel any time. Your plan runs to the end of
  the period you have paid for and does not renew. No part-month refund.</li>
  <li><strong>Annual plans</strong> — cancel any time; see the refund window below.</li>
  <li><strong>Your data is not deleted when you cancel.</strong> It stays available for
  export for ${C.dataRetentionMonths} months.</li>
</ul>

<h2>When we refund</h2>
<table>
  <tr><th>Situation</th><th>Outcome</th></tr>
  <tr><td>Within <strong>${C.refundWindowDays} days</strong> of a first paid subscription, and you have decided it is not for you</td><td><strong>Full refund</strong></td></tr>
  <tr><td>Charged twice, or charged the wrong amount</td><td><strong>Full refund</strong> of the error, always</td></tr>
  <tr><td>Charged after you asked us to cancel</td><td><strong>Full refund</strong></td></tr>
  <tr><td>A feature we advertised does not work and we cannot fix it in a reasonable time</td><td><strong>Pro-rata refund</strong> of the unused period</td></tr>
  <tr><td>We withdraw a feature that is material to your paid plan</td><td><strong>Pro-rata refund</strong> of the unused period</td></tr>
  <tr><td>Annual plan cancelled part-way through, service working as described</td><td>No refund of the remaining months, but the plan runs to the end of its term</td></tr>
  <tr><td>Account suspended for a breach of the Terms</td><td>No refund</td></tr>
  <tr><td>Non-use — you paid and did not log in</td><td>No refund outside the ${C.refundWindowDays}-day window</td></tr>
</table>

<h2>How long a refund takes</h2>
<p>Approved refunds are issued through <strong>Razorpay to the original payment
method</strong>. We initiate within <strong>3 working days</strong> of approving. Your
bank or card issuer then typically takes <strong>5 to 7 working days</strong> to show
it, and that part is outside our control. Any GST paid is refunded with the
principal.</p>

<h2>Failed renewals</h2>
<p>If a renewal payment fails we do not cut you off. You keep full access for
<strong>${C.refundWindowDays} days</strong> while you sort it out. After that the
account moves to the Free tier and stays there — nothing is deleted, and paying
restores access immediately.</p>

<h2>Disputes</h2>
<p>If you are unhappy with a refund decision, escalate to the Grievance Officer below.
Please contact us before raising a chargeback with your bank: a chargeback freezes the
amount for weeks and we can almost always resolve it faster directly.</p>

${grievance}`);

/* ------------------------------- CONTACT -------------------------------- */
const contact = shell('contact', 'Contact Us',
  `Reach ${cfg.legalEntity} about ${cfg.productName} — support, sales, billing and grievances.`,
`<h1>Contact Us</h1>
<p class="eff">We reply to every email within one working day.</p>

${identity}

<h2>What to write about where</h2>
<table>
  <tr><th>Reason</th><th>Where</th></tr>
  <tr><td>Support — something is broken or confusing</td><td><a href="mailto:${C.supportEmail}">${C.supportEmail}</a></td></tr>
  <tr><td>Sales, demos, Enterprise pricing</td><td><a href="mailto:${C.supportEmail}">${C.supportEmail}</a></td></tr>
  <tr><td>Billing, GST invoices, refunds</td><td><a href="mailto:${C.supportEmail}">${C.supportEmail}</a></td></tr>
  <tr><td>Privacy, data access or deletion requests</td><td><a href="mailto:${C.supportEmail}">${C.supportEmail}</a></td></tr>
  <tr><td>Security — reporting a vulnerability</td><td><a href="mailto:${C.supportEmail}">${C.supportEmail}</a></td></tr>
  <tr><td>A complaint you want escalated</td><td>The Grievance Officer, below</td></tr>
</table>

<h2>Reporting a security problem</h2>
<p>If you have found a vulnerability, please tell us at
<a href="mailto:${C.supportEmail}">${C.supportEmail}</a> before disclosing it publicly.
We will acknowledge within 48 hours and keep you updated. We will not pursue legal
action against anyone who reports a genuine issue in good faith, without accessing
other customers' data and without degrading the service for others.</p>

${grievance}`);

/* -------------------------------- 404 ----------------------------------- */
const notFound = shell('404', 'Page not found',
  'That page does not exist.',
`<h1>That page does not exist</h1>
<p class="eff">You may have followed an old link, or typed the address slightly wrong.</p>
<p>Try one of these:</p>
<ul>
  <li><a href="/">The ${C.productName} home page</a> — features, pricing and sign-in</li>
  <li><a href="/contact">Contact us</a> — if you were looking for something specific</li>
  <li><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms</a> · <a href="/refund">Refunds</a></li>
</ul>`);

const files = { 'privacy.html': privacy, 'terms.html': terms, 'refund.html': refund,
  'contact.html': contact, '404.html': notFound };
Object.entries(files).forEach(([name, html]) => {
  fs.writeFileSync(path.join(here, name), html);
  console.log(`  ${name.padEnd(14)} ${(html.length/1024).toFixed(1)} KB`);
});
console.log('\nPolicy pages built. Read them before deploying — they describe how you\nactually operate, and only you know if any of it is wrong.');

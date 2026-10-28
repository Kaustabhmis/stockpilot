#!/usr/bin/env node
// Runs the onboarding sequence for due contacts.
// Dry run by default. Pass --send and set MARKETING_LIVE=1 to actually send.
import { loadContacts, saveContacts, canEmail } from './contacts.mjs';
import { dueSteps, renderTemplate } from './sequences.mjs';
import { sendEmail } from './gmail.mjs';
import { unsubscribeUrl } from './unsubscribe.mjs';

const CONTACTS_PATH = process.env.CONTACTS_PATH ?? new URL('../data/contacts.json', import.meta.url).pathname;
// Gmail limits: about 500 messages a day on consumer accounts, 2,000 on Workspace.
// Keep well under either to avoid throttling and spam flags.
const DAILY_CAP = Number(process.env.GMAIL_DAILY_CAP ?? 300);
const APP_URL = process.env.APP_URL ?? 'https://domebox.in';
const PRICING_URL = `${APP_URL}/#pricing`;
const UNSUB_SECRET = process.env.UNSUBSCRIBE_SECRET;

const live = process.argv.includes('--send') && process.env.MARKETING_LIVE === '1';

async function main() {
  if (!UNSUB_SECRET) throw new Error('UNSUBSCRIBE_SECRET is required');
  const contacts = await loadContacts(CONTACTS_PATH);
  let sentToday = 0;
  const plan = [];

  for (const contact of contacts) {
    const check = canEmail(contact);
    if (!check.ok) continue;
    for (const step of dueSteps(contact)) {
      plan.push({ contact, step });
    }
  }

  for (const { contact, step } of plan.slice(0, DAILY_CAP)) {
    const vars = {
      firstName: contact.firstName ?? 'there',
      appUrl: APP_URL,
      pricingUrl: PRICING_URL,
    };
    const message = {
      to: contact.email,
      subject: renderTemplate(step.subject, vars),
      text: renderTemplate(step.text, vars) + `\n\nUnsubscribe: ${unsubscribeUrl(APP_URL, contact.email, UNSUB_SECRET)}`,
      html: `<p>${renderTemplate(step.text, vars).replace(/\n/g, '<br>')}</p>` +
        `<p style="font-size:12px;color:#666"><a href="${unsubscribeUrl(APP_URL, contact.email, UNSUB_SECRET)}">Unsubscribe</a></p>`,
      unsubscribeUrl: unsubscribeUrl(APP_URL, contact.email, UNSUB_SECRET),
    };

    if (!live) {
      console.log(`[dry-run] ${step.id} -> ${contact.email}`);
      continue;
    }

    await sendEmail(message);
    contact.sent = [...(contact.sent ?? []), { stepId: step.id, at: new Date().toISOString() }];
    sentToday += 1;
    console.log(`sent ${step.id} -> ${contact.email}`);
  }

  if (live) await saveContacts(CONTACTS_PATH, contacts);
  console.log(`${live ? 'Sent' : 'Would send'} ${Math.min(plan.length, DAILY_CAP)} of ${plan.length} due messages (cap ${DAILY_CAP}).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

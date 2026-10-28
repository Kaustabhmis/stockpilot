import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// A contact may be emailed only if they opted in (or are an existing customer)
// and have not unsubscribed. Anything else is refused, no matter the sequence.
export const CONSENT_SOURCES = ['signup_form', 'existing_customer', 'manual_opt_in'];

export function canEmail(contact) {
  if (!contact || !contact.email) return { ok: false, reason: 'no email' };
  if (contact.unsubscribed) return { ok: false, reason: 'unsubscribed' };
  if (!contact.consent || !CONSENT_SOURCES.includes(contact.consent.source)) {
    return { ok: false, reason: 'no recorded consent' };
  }
  return { ok: true };
}

export async function loadContacts(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function saveContacts(path, contacts) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(contacts, null, 2));
}

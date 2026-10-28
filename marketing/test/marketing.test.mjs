import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canEmail } from '../src/contacts.mjs';
import { dueSteps, renderTemplate } from '../src/sequences.mjs';
import { signUnsubscribe, verifyUnsubscribe } from '../src/unsubscribe.mjs';

test('refuses contacts without consent', () => {
  assert.equal(canEmail({ email: 'a@x.com' }).ok, false);
  assert.equal(canEmail({ email: 'a@x.com', consent: { source: 'scraped' } }).ok, false);
});

test('refuses unsubscribed contacts even with consent', () => {
  const c = { email: 'a@x.com', unsubscribed: true, consent: { source: 'signup_form' } };
  assert.equal(canEmail(c).ok, false);
});

test('allows contacts with recorded consent', () => {
  const c = { email: 'a@x.com', consent: { source: 'signup_form' } };
  assert.equal(canEmail(c).ok, true);
});

test('sequence steps become due by day and are not repeated', () => {
  const contact = { signedUpAt: '2026-01-01T00:00:00Z', sent: [{ stepId: 'welcome' }] };
  const today = new Date('2026-01-03T12:00:00Z');
  assert.deepEqual(dueSteps(contact, today).map((s) => s.id), ['first_task']);
});

test('template fills known variables and blanks unknown ones', () => {
  assert.equal(renderTemplate('Hi {{firstName}} {{x}}', { firstName: 'Asha' }), 'Hi Asha ');
});

test('unsubscribe token verifies only for its own email', () => {
  const token = signUnsubscribe('a@x.com', 'secret');
  assert.equal(verifyUnsubscribe('a@x.com', token, 'secret'), true);
  assert.equal(verifyUnsubscribe('b@x.com', token, 'secret'), false);
  assert.equal(verifyUnsubscribe('a@x.com', token, 'other'), false);
});

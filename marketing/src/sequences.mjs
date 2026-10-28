// Trial onboarding sequence. `day` counts from the contact's signup date.
// Copy is a draft: review it before turning sending on.
export const TRIAL_SEQUENCE = [
  {
    id: 'welcome',
    day: 0,
    subject: 'Your Domebox workspace is ready',
    text: 'Hi {{firstName}},\n\nYour Domebox workspace is ready. Start by adding your team and assigning the first task.\n\n{{appUrl}}',
  },
  {
    id: 'first_task',
    day: 2,
    subject: 'Assign your first task in 60 seconds',
    text: 'Hi {{firstName}},\n\nCreate a task, set a due date, and Domebox will remind the assignee by email.\n\n{{appUrl}}',
  },
  {
    id: 'approvals',
    day: 5,
    subject: 'Approvals without the WhatsApp chase',
    text: 'Hi {{firstName}},\n\nSend requests for approval and track them in one place, with reminders built in.\n\n{{appUrl}}',
  },
  {
    id: 'trial_ending',
    day: 11,
    subject: 'Your trial ends in 3 days',
    text: 'Hi {{firstName}},\n\nYour 14-day trial ends soon. Team plan is ₹999 a month for up to 10 people, with unlimited tasks.\n\n{{pricingUrl}}',
  },
];

export function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

// Returns the sequence steps that are due for a contact on `today`, and not yet sent.
export function dueSteps(contact, today = new Date()) {
  const signedUp = new Date(contact.signedUpAt);
  const daysElapsed = Math.floor((today - signedUp) / 86_400_000);
  const sent = new Set((contact.sent ?? []).map((s) => s.stepId));
  return TRIAL_SEQUENCE.filter((step) => step.day <= daysElapsed && !sent.has(step.id));
}

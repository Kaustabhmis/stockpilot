/**
 * Apps Script puts every .gs file in ONE global scope, and the last definition
 * of a name wins — silently, at parse time, with nothing in any log.
 *
 * This has now bitten this project three times: reminders.gs redefining esc_,
 * payments-secure.gs redefining grantPlan_, and whatsapp.gs redefining doPost.
 * The last one replaces the API's entry point: every login, task and payment
 * stops working and nothing anywhere says why.
 *
 * So every file that can share a project with code.gs is checked against it,
 * and against every other one. This is cheap to run and the alternative is
 * finding out from a customer.
 */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };

const ROOT = '/home/user/stockpilot';
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Top-level declarations only — anything nested is in its own scope. */
function declarations(src) {
  const fns = new Set([...src.matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map((m) => m[1]));
  const vars = new Set([...src.matchAll(/^var\s+([A-Za-z0-9_$]+)\s*=/gm)].map((m) => m[1]));
  return { fns, vars, all: new Set([...fns, ...vars]) };
}

const CODE = declarations(read('dist/code.gs'));

/* Every .gs a deployment might add to the project that serves the app. */
const ADDABLE = ['domebox/reminders.gs', 'domebox/backup.gs', 'domebox/remediate-sharing.gs',
                 'domebox/whatsapp.gs', 'domebox/billing.gs', 'domebox/payments-secure.gs'];

console.log('\n=== nothing redefines anything in code.gs ===');
const loaded = {};
ADDABLE.forEach((f) => {
  loaded[f] = declarations(read(f));
  const clash = [...loaded[f].all].filter((n) => CODE.all.has(n));
  ok(path.basename(f) + ' adds no name code.gs already uses', clash.length === 0, clash.join(', '));
});

console.log('\n=== and they do not redefine each other ===');
for (let i = 0; i < ADDABLE.length; i++) {
  for (let j = i + 1; j < ADDABLE.length; j++) {
    const a = ADDABLE[i], b = ADDABLE[j];
    const clash = [...loaded[a].all].filter((n) => loaded[b].all.has(n));
    ok(path.basename(a) + ' + ' + path.basename(b), clash.length === 0, clash.join(', '));
  }
}

console.log('\n=== the entry points belong to code.gs alone ===');
/* The worst case of all: a second doGet or doPost takes the whole API down. */
['doGet', 'doPost'].forEach((entry) => {
  ok('code.gs defines ' + entry, CODE.fns.has(entry));
  const others = ADDABLE.filter((f) => loaded[f].fns.has(entry));
  ok('and nothing else does', others.length === 0, others.join(', '));
});

console.log('\n=== WhatsApp still reaches its handler ===');
/* Renaming them is only safe if something routes to the new names. */
const code = read('dist/code.gs');
ok('code.gs answers Meta\'s verification handshake', /hub\.mode.*subscribe/.test(code));
ok('and routes inbound WhatsApp events', /whatsapp_business_account/.test(code));
ok('to the renamed handler', /waDoPost\(e\)/.test(code));
ok('only when that optional file is present', /typeof waDoPost === 'function'/.test(code));
ok('acknowledging rather than erroring when it is not',
   /EVENT_RECEIVED/.test(code.slice(code.indexOf('whatsapp_business_account'),
                                    code.indexOf('whatsapp_business_account') + 400)));
ok('whatsapp.gs defines the renamed handler', loaded['domebox/whatsapp.gs'].fns.has('waDoPost'));
ok('and the renamed GET one', loaded['domebox/whatsapp.gs'].fns.has('waDoGet'));

console.log('\n=== the superseded payment module is inert ===');
const psec = loaded['domebox/payments-secure.gs'];
['grantPlan_', 'hex_', 'receiptHtml_'].forEach((n) => {
  ok('payments-secure.gs no longer defines ' + n, !psec.fns.has(n));
});
ok('and says at the top that it must not be pasted in',
   /DO NOT PASTE THIS INTO THE SAME APPS SCRIPT PROJECT/.test(read('domebox/payments-secure.gs')));

console.log('\n=== the scheduler is the one that must coexist ===');
/* reminders.gs is not optional in practice — nothing is chased without it — so
   its isolation matters more than the others'. */
const rem = loaded['domebox/reminders.gs'];
ok('it defines the trigger handlers setupDomeBox looks for',
   ['sendDailyReminders', 'generateRecurringJobs', 'sendRenewalReminders', 'sendTaskReminders']
     .every((h) => rem.fns.has(h)),
   [...rem.fns].filter((f) => /^send|^generate/.test(f)).join(', '));
ok('setupDomeBox looks for all of them',
   ['sendDailyReminders', 'generateRecurringJobs', 'sendRenewalReminders', 'sendTaskReminders']
     .every((h) => code.indexOf("'" + h + "'") > -1));
ok('and it reuses the rules engine rather than carrying its own copy',
   /dueOccurrences\(/.test(read('domebox/reminders.gs')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

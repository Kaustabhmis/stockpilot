/* The eSSL "Log Records (Device Wise)" export, imported, then imported again.
 *
 * The second import is the point. These reports cover a window, and the way
 * this gets used is to upload the latest one each morning - so the same
 * punches arrive again and again. Every punch used to be given a random id,
 * so each upload appended the lot a second time; a week of daily uploads of
 * a seven-day report stored every punch seven times, and the log trim would
 * then drop genuine history to make room for the copies.
 *
 * What is checked: the figures the file implies, then that the second import
 * adds nothing, changes nothing, and still reports the same attendance.
 */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://127.0.0.1:8101';
/* a real export from the machines at Dynamic Engineers, kept as a fixture:
   five device blocks, a blank Direction column, and a reader that stutters */
const FILE = process.argv[3] || path.join(HERE, 'fixtures', 'LogRecords_DeviceWise.xls');
const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token }) });
  const j = await r.json();
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
};
let bad = 0;
const ok = (pass, label, why) => { if (!pass) bad++;
  console.log('   ' + (pass ? 'ok  ' : '**  ') + String(label).padEnd(40) + (why || '')); };
const eq = (got, want, label, why) => ok(String(got) === String(want), label,
  (String(got) === String(want) ? '' : 'got ' + got + ', wanted ' + want + ' - ') + (why || ''));

const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;

/* The sixty people in the file have to be on the books, or every punch is
   correctly skipped and the run proves nothing. Seeded from the file itself. */
const ROSTER = JSON.parse(
  (await import('node:fs')).readFileSync(path.join(HERE, 'fixtures', 'roster.json'), 'utf8'));
await call('saveMany', { sheet: 'Employees', rows: ROSTER }, token);

/* and the window it covers must be clear, so a previous pass cannot be read
   as this one's work */
const old = (await call('list', { sheet: 'Punches' }, token))
  .filter(x => String(x.punch_time).slice(0, 10) >= '2026-10-01' &&
               String(x.punch_time).slice(0, 10) <= '2026-10-07');
for (let i = 0; i < old.length; i += 200) {
  await call('removeMany', { sheet: 'Punches', ids: old.slice(i, i + 200).map(r => r.id) }, token);
}
const oldAtt = (await call('list', { sheet: 'Attendance' }, token))
  .filter(a => String(a.date) >= '2026-10-01' && String(a.date) <= '2026-10-07');
for (let i = 0; i < oldAtt.length; i += 200) {
  await call('removeMany', { sheet: 'Attendance', ids: oldAtt.slice(i, i + 200).map(r => r.id) }, token);
}

const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await p.evaluate(u => localStorage.setItem('hrms_lite_api', u + '/exec'), BASE);
await p.reload({ waitUntil: 'networkidle' });
await p.fill('#in-email', 'admin@company.com');
await p.fill('#in-pass', 'admin123');
await p.click('#btn-login');
await p.waitForTimeout(6000);
await p.evaluate(() => {
  const i = document.createElement('input');
  i.type = 'file'; i.id = 'probe-file'; document.body.appendChild(i);
});
await p.setInputFiles('#probe-file', FILE);

const read = () => p.evaluate(async () => {
  const sheets = await readSpreadsheet(document.getElementById('probe-file').files[0]);
  const kind = detectKind(sheets);
  const built = buildImport(sheets, kind, thisMonth());
  return { kind, punches: built.punches.length, days: built.rows.length,
           problems: built.problems, meta: built.meta };
});

console.log('reading the file the app reads it\n');
const first = await read();
eq(first.kind, 'esslreport', 'detected without being told', 'the title row says Log Records');
ok(first.punches === 1000, 'punches found', first.punches + ' of 1000 rows in the file');
ok(first.problems.length === 0, 'nothing unreadable', first.problems.join('; ').slice(0, 60));
ok(/5 device\(s\)/.test(first.meta), 'every device block read',
   'the file has five, each with its own header row');

/* send them the way the Import button does */
const send = async () => {
  const punches = await p.evaluate(async () => {
    const sheets = await readSpreadsheet(document.getElementById('probe-file').files[0]);
    return buildImport(sheets, detectKind(sheets), thisMonth()).punches;
  });
  const rows = punches.map(x => ({ emp_code: x.code, punch_time: x.date + ' ' + x.time,
                                   device: x.device || '' }));
  let added = 0, dup = 0, days = 0;
  for (let i = 0; i < rows.length; i += 250) {
    const r = await call('ingestPunches',
      { punches: rows.slice(i, i + 250), source: 'file' }, token);
    added += Number(r.added || 0); dup += Number(r.duplicates || 0); days += Number(r.days || 0);
  }
  return { added, dup, days };
};

console.log('\nfirst import');
const one = await send();
/* Only the window this file covers. Other suites run against the same
   workspace and leave punches of their own behind; counting the whole tab
   measured them too. */
const inWindow = async () => (await call('list', { sheet: 'Punches' }, token))
  .filter(x => String(x.punch_time).slice(0, 10) >= '2026-10-01' &&
               String(x.punch_time).slice(0, 10) <= '2026-10-07').length;
const punches1 = await inWindow();
const att1 = (await call('list', { sheet: 'Attendance' }, token))
  .filter(a => String(a.date) >= '2026-10-01' && String(a.date) <= '2026-10-07');
/* The file has 1000 rows but only 608 punches. A reader stutters: it takes
   the same finger three or four times in as many seconds, and the log stores
   the minute, so those rows are identical in every field that is kept. Four
   reads of one person inside sixteen seconds is one punch, not four. Worked
   out from the file itself, by counting distinct person+minute+device. */
eq(one.added, 608, 'punches stored', 'distinct person, minute and reader');
eq(one.dup, 392, 'machine re-reads collapsed', 'the same finger read again seconds later');
eq(punches1, 608, 'rows in the punch log', 'one per real punch, not one per row');
eq(att1.length, 322, 'attendance days written', 'person-days present in the file');

console.log('\nsame file again - the whole point');
const two = await send();
const punches2 = await inWindow();
const att2 = (await call('list', { sheet: 'Attendance' }, token))
  .filter(a => String(a.date) >= '2026-10-01' && String(a.date) <= '2026-10-07');
eq(two.added, 0, 'nothing new stored', 'every punch was already held');
eq(two.dup, 1000, 'every row recognised', 'as punches we already have, not new ones');
eq(punches2, punches1, 'punch log did not grow', 'this is what used to double');
eq(att2.length, att1.length, 'same number of days', 'no day invented or lost');

/* and the days themselves are identical, not merely the same count */
const key = a => a.emp_code + '|' + a.date + '|' + a.status + '|' + a.in_time + '|' + a.out_time;
const before = att1.map(key).sort().join('\n');
const after = att2.map(key).sort().join('\n');
ok(before === after, 'every day came out identical', 'in, out and status unchanged');

if (errs.length) { bad += errs.length; console.log('\nscript errors:', errs.slice(0, 3)); }
console.log('\n' + (bad ? '** ' + bad + ' did not hold' : 'the same file twice changes nothing the second time'));
await b.close();
process.exit(bad ? 1 : 0);

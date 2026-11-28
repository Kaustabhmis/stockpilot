/* Leave days on the phone: a Monday must count as a Monday on an Indian
   clock, Saturdays follow the person's shift, and the sandwich rule only
   charges offs when it is switched on. Run with TZ=Asia/Kolkata. */
import fs from 'node:fs';
import vm from 'node:vm';
process.env.TZ = process.env.TZ || 'Asia/Kolkata';
const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const pick = name => {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = html.indexOf('{', i);
  for (let k = j; k < html.length; k++) {
    if (html[k] === '{') d++; else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1);
  }
};
const src = ['isoOf', 'weeklyOffSet', 'saturdayIsOff', 'isWeeklyOff', 'holidayOn', 'workingDaysBetween',
  'myShift', 'shiftOfPerson'].map(pick).join('\n');
const ctx = { S: { settings: { weekly_off: 'Sun', sandwich_rule: 'no', default_shift: 'General' },
  holidays: [{ date: '2026-12-25' }, { date: '2026-12-24', optional: 'yes' }],
  shifts: [{ name: 'General', weekly_off: 'Sun', saturday_policy: '2_4' }], me: { shift: 'General' } } };
vm.createContext(ctx); vm.runInContext(src, ctx);
let bad = 0;
const eq = (what, got, want) => { if (got !== want) { bad++; console.log('FAIL', what, got, '!=', want); } else console.log('ok  ', what); };
const W = (a, b) => vm.runInContext(`workingDaysBetween('${a}','${b}')`, ctx);
eq('Monday alone', W('2026-11-30', '2026-11-30'), 1);
eq('1st Saturday (working)', W('2026-12-05', '2026-12-05'), 1);
eq('2nd Saturday (off by shift)', W('2026-12-12', '2026-12-12'), 0);
eq('Sat..Mon, sandwich off', W('2026-12-05', '2026-12-07'), 2);
eq('Sunday alone', W('2026-12-06', '2026-12-06'), 0);
eq('Christmas holiday', W('2026-12-25', '2026-12-25'), 0);
eq('optional holiday counts', W('2026-12-24', '2026-12-24'), 1);
eq('Mon..Fri week', W('2026-11-30', '2026-12-04'), 5);
ctx.S.settings.sandwich_rule = 'yes';
eq('Sat..Mon, sandwich on', W('2026-12-05', '2026-12-07'), 3);
eq('isoOf local', vm.runInContext("isoOf(new Date(2026,10,30,1,0))", ctx), '2026-11-30');
process.exit(bad ? 1 : 0);

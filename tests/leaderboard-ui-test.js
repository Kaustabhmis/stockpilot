/**
 * The board as a person sees it: a podium, a ranked table top to bottom, the
 * movement, and — the part that stops it being a wall of shame — the people
 * with nothing closed kept out of the ranking and named apart from it.
 */
const { chromium } = require('playwright');
const http = require('http');
const post = (body) => new Promise((res, rej) => {
  const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: 8095, path: '/exec', method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(d) } }, (s) => {
    let b = ''; s.on('data', (c) => b += c); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  });
  r.on('error', rej); r.write(d); r.end();
});
const hit = (path) => new Promise((res, rej) =>
  http.get('http://localhost:8095' + path, (r) => { r.resume(); r.on('end', res); }).on('error', rej));
const ymd = (plus) => { const d = new Date(); d.setDate(d.getDate() + plus); return d.toISOString().slice(0, 10); };

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 190) + ']')); v ? pass++ : fail++; };

  const RUN = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const U = (u) => u + RUN;
  const email = 'lbui+' + RUN + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering',
    name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Scale');

  const tok = {};
  for (const [n, u, role] of [['Sruti Charulata', 'sruti', 'HOD'],
                              ['Payel Sanyamath', 'payel', 'Doer'],
                              ['Vikram Rathore', 'vikram', 'Doer'],
                              ['Imran Qureshi', 'imran', 'Doer'],
                              ['Nita Bose', 'nita', 'Doer']]) {
    await post({ action: 'addUser', token: A, form: { name: n, username: U(u), email: U(u) + '@acme.in',
      role, manager: u === 'sruti' ? '' : U('sruti'), jobProfile: 'Executive', password: 'staffpass123' } });
    tok[u] = (await post({ action: 'login', username: U(u) + '@acme.in', password: 'staffpass123' })).token;
  }
  const run = async (who, title, due, priority) => {
    await post({ action: 'createTask', token: A, form: { title, assignTo: U(who), dueDate: due, priority } });
    const t = (await post({ action: 'getDashboard', token: A })).tasks.find((x) => x.title === title);
    await post({ action: 'updateTask', token: tok[who], taskId: t.id, status: 'In Progress' });
    await post({ action: 'updateTask', token: tok[who], taskId: t.id, status: 'For Review' });
    await post({ action: 'updateTask', token: A, taskId: t.id, status: 'Verified' });
  };
  for (let i = 0; i < 7; i++) await run('payel', 'P on time ' + i, ymd(5), 'High');
  for (let i = 0; i < 3; i++) await run('payel', 'P late ' + i, ymd(-6), 'High');
  for (let i = 0; i < 4; i++) await run('imran', 'I job ' + i, ymd(4), 'Medium');
  await run('vikram', 'One easy job', ymd(5), 'Low');

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1400, height: 1100 } });
  await p.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
  await p.fill('#liUser', email); await p.fill('#liPass', 'strongpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1600);

  console.log('\n--- getting to it ---');
  ok('there is a Board tab', await p.locator('#navTabs button[data-tab="board"]').count() === 1);
  await p.click('#navTabs button[data-tab="board"]');
  await p.waitForTimeout(1400);
  const body = await p.locator('#lbBody').textContent();
  ok('the board renders', !/Working out the order/.test(body), body.slice(0, 120));

  console.log('\n--- the podium ---');
  ok('somebody is named for the month', /Best delivery in/.test(body), body.slice(0, 160));
  ok('and it is the person who carried the load', /Payel Sanyamath/.test(
     await p.locator('#lbBody > div').first().textContent()));
  ok('the approver above them is explained, not hidden',
     /approvals cleared rather than work delivered/.test(body));

  console.log('\n--- top to bottom ---');
  const ranks = await p.locator('#lbBody tbody tr td:first-child').allTextContents();
  ok('the whole team is listed', ranks.length >= 4, ranks.length);
  ok('the first three get medals', ranks.slice(0, 3).join('') === '🥇🥈🥉', ranks.slice(0, 3).join(''));
  ok('and the rest get numbers', /^\d+$/.test(ranks[3].trim()), ranks[3]);
  const scores = await p.locator('#lbBody tbody tr td:nth-child(4)').allTextContents();
  const nums = scores.map((s) => Number(s.replace(/\D/g, '')));
  ok('every row shows its score', nums.every((n) => n > 0), scores.join('|'));
  ok('scores descend down the table', nums.every((n, i) => i === 0 || nums[i - 1] >= n), nums.join(' '));
  /* .hidden carries !important in this stylesheet, so a column hidden with
     Tailwind's `hidden md:table-cell` never comes back at the breakpoint.
     Pinned, because it is invisible in code review and obvious only on screen. */
  ok('the score bar is actually visible at desktop width',
     await p.locator('#lbBody tbody tr:first-child td:nth-child(4)').isVisible());
  ok('and so is the timeliness column',
     await p.locator('#lbBody thead th:nth-child(7)').isVisible());
  ok('a thin month is called out rather than left to look like a bad one',
     /thin month/.test(body));
  ok('top, median and lowest are all on screen',
     /Top/.test(body) && /Median/.test(body) && /Lowest/.test(body));

  console.log('\n--- nobody is ranked on nothing ---');
  ok('people with nothing closed are kept out of the ranking',
     !(await p.locator('#lbBody tbody').textContent()).includes('Nita Bose'));
  ok('listed apart from it instead', /Not ranked this month/.test(body));
  ok('and said plainly not to be last place', /This is not last place/.test(body));
  await p.screenshot({ path: 'shot-30-leaderboard.png', fullPage: true });

  console.log('\n--- the Admin decides who sees it ---');
  ok('an Admin is offered the choice', await p.locator('#lbVisWrap.hidden').count() === 0);
  await p.selectOption('#lbVis', 'top');
  await p.waitForTimeout(1200);
  ok('and is told what changed', /top 3/.test(await p.locator('#toasts').textContent()),
     await p.locator('#toasts').textContent());

  console.log('\n--- what a Doer then sees ---');
  await p.evaluate(() => signOut());
  await p.waitForTimeout(700);
  await p.fill('#liUser', U('vikram') + '@acme.in'); await p.fill('#liPass', 'staffpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1600);
  await p.click('#navTabs button[data-tab="board"]');
  await p.waitForTimeout(1300);
  const doer = await p.locator('#lbBody').textContent();
  ok('they see the top three', (await p.locator('#lbBody tbody tr').count()) <= 4,
     await p.locator('#lbBody tbody tr').count());
  ok('their own row is one of them', /Vikram Rathore/.test(doer));
  ok('marked as theirs', /YOU/.test(doer));
  ok('and they are told their real place out of the real total',
     /You are \d+(st|nd|rd|th) of \d+/.test(doer), (doer.match(/You are [^·]*/) || [])[0]);
  ok('they are not shown who else had a blank month', !/Nita Bose/.test(doer));
  ok('and cannot change who sees the board',
     await p.locator('#lbVisWrap.hidden').count() === 1);
  await p.screenshot({ path: 'shot-31-leaderboard-doer.png', fullPage: true });

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();

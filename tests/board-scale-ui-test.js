/**
 * A board that keeps filling. A company of fifty assigns hundreds of tasks a
 * month; a year later the Tasks sheet holds thousands of closed ones. Two
 * things must stay true however big it gets:
 *
 *  - the browser is only ever sent ACTIVE work. Closed work older than a week
 *    is fetched from Archive a page at a time, searched on the server. Before
 *    this, every 30-second poll shipped every task the person had ever seen.
 *  - a long column shows its most urgent cards first and stops, with a button
 *    for the rest, instead of a To do column you scroll for a minute.
 *
 * Runs on the demo workspace (built by /__demo; run after demo-ui-test, which
 * expects to build it first), plus forty extra tasks to push a column past
 * its limit.
 */
const { chromium } = require('playwright');
const http = require('http');
const hit = (p) => new Promise((res, rej) => http.get('http://localhost:8095' + p,
  (r) => { let b = ''; r.on('data', (c) => b += c); r.on('end', () => res(b)); }).on('error', rej));

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 220) + ']')); v ? pass++ : fail++; };

  await hit('/__demo');      // builds it, or says it already exists — either way it is there
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  await p.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
  await p.fill('#liUser', 'demo@biscsindia.com'); await p.fill('#liPass', 'DomeBoxDemo2026');
  await p.click('#btnLogin'); await p.waitForTimeout(2200);
  const W = (ms) => p.waitForTimeout(ms);

  console.log('\n--- the browser is sent active work only ---');
  const d = await p.evaluate(() => api('getDashboard'));
  ok('no archived task is in the dashboard payload', d.tasks.length > 0 && d.tasks.every((t) => !t.isArchived),
     d.tasks.filter((t) => t.isArchived).length);
  ok('but the dashboard says how many are archived', d.archivedCount > 0, d.archivedCount);

  console.log('\n--- forty more jobs for one person ---');
  const made = await p.evaluate(async () => {
    const day = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    for (let i = 1; i <= 40; i++) {
      await api('createTask', { form: { title: 'Bulk job ' + String(i).padStart(2, '0'), assignTo: 'meera',
        dueDate: day(i + 3), priority: 'Medium', jobCategory: 'Stores' } });
    }
    await refresh();
    return STATE.data.tasks.filter((t) => t.status === 'Pending').length;
  });
  ok('the To do column now holds well over the limit', made > 40, made);
  await p.click('button[data-tab="tasks"] >> visible=true'); await W(800);

  console.log('\n--- a long column stops, most urgent first ---');
  const todo = p.locator('.col[data-col="todo"]');
  const shown = await todo.locator('.card').count();
  ok('it shows twenty cards, not all of them', shown === 20, shown);
  ok('the header still counts every card in it',
     Number((await p.locator('.col[data-col="todo"]').locator('xpath=..').locator('span.text-gray-400').first().textContent()).trim()) === made);
  ok('with a button for the rest', /Show all \d+/.test(await todo.locator('.colMore').textContent()));
  const order = await p.evaluate(() => {
    const ids = [...document.querySelectorAll('.col[data-col="todo"] .card')].map((c) => c.dataset.id);
    return ids.map((id) => { const t = taskById(id); return { late: daysLate(t), due: t.due }; });
  });
  const lateFirst = order.findIndex((o) => !o.late);
  ok('late work comes first', order[0].late > 0 && order.slice(lateFirst).every((o) => !o.late), JSON.stringify(order.slice(0, 4)));
  ok('then the nearest due date', order.slice(lateFirst).every((o, i, a) => i === 0 || a[i - 1].due <= o.due),
     JSON.stringify(order.slice(lateFirst, lateFirst + 4)));
  ok('the bulk jobs due weeks out are the ones held back',
     !(await todo.locator('.card:has-text("Bulk job 40")').count()));
  await todo.locator('.colMore').click(); await W(400);
  ok('"Show all" shows every card', await todo.locator('.card').count() === made);
  ok('and offers to fold it back', /Show fewer/.test(await todo.locator('.colMore').textContent()));
  await todo.locator('.colMore').click(); await W(300);
  ok('which it does', await todo.locator('.card').count() === 20);

  console.log('\n--- filters still find anything on the board ---');
  await p.fill('#fSearch', 'Bulk job 40'); await W(500);
  ok('a search reaches a card that was folded away', await p.locator('.card:has-text("Bulk job 40")').count() === 1);
  await p.fill('#fSearch', ''); await W(300);

  console.log('\n--- Archive: a page at a time, from the server ---');
  await p.click('#btnHistory'); await W(1800);
  const total = d.archivedCount;
  ok('Archive shows closed work as a list', !(await p.locator('#list').isHidden()) && await p.locator('#list tbody tr').count() > 0);
  ok('and says how much there is', new RegExp('of ' + total + ' closed tasks').test(await p.locator('#archiveMore').textContent()),
     await p.locator('#archiveMore').textContent());
  await p.fill('#fSearch', 'Tata'); await W(1300);
  const tata = await p.locator('#list tbody tr').allTextContents();
  ok('a search goes to the server and comes back filtered', tata.length > 0 && tata.every((r) => /Tata/.test(r)), tata.length);
  await p.fill('#fSearch', ''); await W(1200);
  const pages = await p.evaluate(async () => {
    const a = await api('getArchive', { page: 0, pageSize: 10 });
    const b = await api('getArchive', { page: 1, pageSize: 10 });
    return { a: a.tasks.map((t) => t.id), b: b.tasks.map((t) => t.id), total: a.total, closed: a.tasks.every((t) => t.isArchived) };
  });
  ok('pages do not overlap', pages.a.every((id) => pages.b.indexOf(id) < 0), JSON.stringify(pages).slice(0, 200));
  ok('and every row is closed work', pages.closed);
  ok('the page size is capped, so nobody can ask for the lot', await p.evaluate(async () =>
     (await api('getArchive', { pageSize: 100000 })).tasks.length <= 100));

  console.log('\n--- an archived task still opens from elsewhere ---');
  const archivedId = pages.a[0];
  await p.click('#btnHistory'); await W(800);           // back to the board
  await p.evaluate((id) => openTask(id), archivedId); await W(1500);
  ok('opening a closed task by id fetches it instead of saying it does not exist',
     await p.locator('#drawer').isVisible() && new RegExp(archivedId).test(await p.locator('#drawer').textContent()));

  console.log('\n--- a Doer only ever sees their own archive ---');
  const p2 = await b.newPage({ viewport: { width: 1300, height: 900 } });
  await p2.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
  await p2.fill('#liUser', 'payel@demo.domebox.in'); await p2.fill('#liPass', 'DemoStaff2026');
  await p2.click('#btnLogin'); await p2.waitForTimeout(2000);
  const mine = await p2.evaluate(async () => (await api('getArchive', { pageSize: 100 })).tasks);
  ok('her archive is her work', mine.length > 0 && mine.every((t) => t.assignee === 'payel' || t.by === 'payel' || t.approver === 'payel'),
     JSON.stringify(mine.map((t) => t.assignee)));

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

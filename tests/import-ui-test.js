/**
 * Team import on screen: an Excel file (made by a real spreadsheet library,
 * with Excel's own column names), a preview that marks each problem, only the
 * good rows added, and the Team list showing them. A CSV works the same way,
 * and the template downloads.
 */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const PORT = Number(process.env.PORT || 8095);
const post = (body) => new Promise((res, rej) => { const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: PORT, path: '/exec', method: 'POST', headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(d) } },
    (s) => { let b = ''; s.on('data', (c) => b += c); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); });
  r.on('error', rej); r.write(d); r.end(); });
const hit = (p) => new Promise((res) => http.get('http://localhost:' + PORT + p, (r) => { r.resume(); r.on('end', res); }));
const SHOTS = process.env.SHOTS || '';

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };
  const R = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const email = 'im+' + R + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering', name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  const dom = R + '.acme.test';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
  const xlsx = path.join(dir, 'team.xlsx');
  /* A real .xlsx, written by openpyxl with Excel-style headings and a phone
     number stored as a number, as people's sheets usually are. */
  execFileSync('python3', ['-c', `
import openpyxl, sys
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Staff'
d = sys.argv[1]
ws.append(['Employee Name', 'Email ID', 'Mobile No', 'Role', 'Department', 'Designation', 'Reports To'])
ws.append(['Nita Bose', 'nita@' + d, 9876543210, 'Doer', 'Quality', 'Inspector', 'Imran Qureshi'])
ws.append(['Imran Qureshi', 'IMRAN@' + d, 9876500001, 'HOD', 'Quality', 'Quality Head', ''])
ws.append(['Meera Iyer', 'meera@' + d, '', '', 'Stores', 'Storekeeper', 'Imran Qureshi'])
ws.append(['No Email Person', '', '', 'Doer', 'Stores', '', ''])
ws.append(['Twice Again', 'meera@' + d, '', 'Doer', '', '', ''])
ws.append(['Rafiq Ahmed', 'rafiq@' + d, '', 'Boss', '', '', ''])
wb.save(sys.argv[2])`, dom, xlsx]);
  const csv = path.join(dir, 'team.csv');
  fs.writeFileSync(csv, '﻿Name,Email,Role,Reports to\r\n"Bose, Payel",payel@' + dom + ',Doer,Imran Qureshi\r\n');

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  const p = await b.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:' + PORT + '/?login=1', { waitUntil: 'networkidle' });
  await p.fill('#liUser', email); await p.fill('#liPass', 'strongpass123'); await p.click('#btnLogin'); await p.waitForTimeout(1800);
  await p.click('button[data-tab="team"]:visible'); await p.waitForTimeout(800);

  console.log('\n=== from Excel ===');
  ok('the Team tab has "Import from Excel"', await p.isVisible('#btnImport'));
  await p.click('#btnImport'); await p.waitForTimeout(300);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#impTpl')]);
  const tpl = fs.readFileSync(await dl.path(), 'utf8');
  ok('the template downloads, with the right columns', /Name,Email,Phone,Role,Department,Job profile,Reports to/.test(tpl) && dl.suggestedFilename() === 'domebox-team-template.csv');
  await p.setInputFiles('#impFile', xlsx); await p.waitForTimeout(1200);
  const rows = await p.$$eval('#impBody tbody tr', (trs) => trs.map((t) => t.textContent));
  ok('every row of the sheet is shown', rows.length === 6, rows.length);
  ok('Excel’s own column names are understood (Employee Name, Email ID, Designation…)', rows.some((r) => /Nita Bose/.test(r) && /nita@/.test(r)));
  ok('emails are made lower case', rows.some((r) => /imran@/.test(r)));
  ok('problems are marked before anything is sent', rows.some((r) => /No valid email/.test(r)) && rows.some((r) => /Twice in this sheet/.test(r)) && rows.some((r) => /Role must be/.test(r)), rows.join(' | '));
  ok('and the count says how many are ready', /3 ready to add/.test(await p.textContent('#impBody')) && /3 with a problem/.test(await p.textContent('#impBody')));
  if (SHOTS) await p.screenshot({ path: SHOTS + '/4-import-preview.png' });
  const startPw = await p.inputValue('#impPw');
  await p.click('#impGo'); await p.waitForTimeout(4000);
  ok('it reports what was added', /3 added/.test(await p.textContent('#impProg')), await p.textContent('#impProg'));
  const users = (await post({ action: 'getUsers', token: A })).users || [];
  const by = (e) => users.find((u) => u.email === e) || {};
  ok('the three are in the team', ['nita@', 'imran@', 'meera@'].every((x) => by(x + dom).name), users.map((u) => u.email).join(' '));
  ok('Imran is added first, so "Reports to Imran" finds him even though he is lower in the sheet', by('nita@' + dom).manager === by('imran@' + dom).username && !!by('imran@' + dom).username);
  ok('the phone number stored as a number comes across whole', by('nita@' + dom).phone === '9876543210', by('nita@' + dom).phone);
  ok('the designation becomes the job profile', by('imran@' + dom).jobProfile === 'Quality Head' && by('imran@' + dom).role === 'HOD');
  ok('nobody with a problem was added', !users.some((u) => /rafiq@/.test(u.email)));
  await p.waitForTimeout(800);
  ok('and the Team list shows them', /Meera Iyer/.test(await p.textContent('#teamTable')));

  console.log('\n=== from CSV ===');
  await p.evaluate(() => closeModal()); await p.waitForTimeout(300);
  await p.click('#btnImport'); await p.waitForTimeout(300);
  await p.setInputFiles('#impFile', csv); await p.waitForTimeout(800);
  ok('a CSV with a comma inside quotes reads as one name', /Bose, Payel/.test(await p.textContent('#impBody')));
  await p.click('#impGo'); await p.waitForTimeout(3000);
  ok('and is added', ((await post({ action: 'getUsers', token: A })).users || []).some((u) => u.email === 'payel@' + dom));

  console.log('\n=== two people who report to each other ===');
  await p.evaluate(() => closeModal()); await p.waitForTimeout(200);
  const sent = await p.evaluate(() => {
    openImport();
    const rows = [];
    const real = window.api;
    window.api = (a, prm) => { if (a === 'importUsers') { rows.push(...prm.rows); return Promise.resolve({ results: prm.rows.map((x) => ({ row: x.row, status: 'added' })) }); } return real(a, prm); };
    previewImport(rowsToPeople([['Name', 'Email', 'Reports to'], ['Asha Loop', 'asha@loop.test', 'Bina Loop'], ['Bina Loop', 'bina@loop.test', 'Asha Loop']]));
    document.getElementById('impGo').click();
    return new Promise((res) => setTimeout(() => { window.api = real; res(rows.map((r) => r.email)); }, 800));
  });
  ok('a reporting loop adds each person once, not twenty-five times', sent.length === 2 && new Set(sent).size === 2, sent.join(','));
  await p.evaluate(() => closeModal());

  console.log('\n=== on a phone, and for staff ===');
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  m.on('pageerror', (e) => errs.push(e.message));
  await m.goto('http://localhost:' + PORT + '/?login=1', { waitUntil: 'networkidle' });
  await m.fill('#liUser', email); await m.fill('#liPass', 'strongpass123'); await m.click('#btnLogin'); await m.waitForTimeout(1800);
  await m.evaluate(() => openImport()); await m.waitForTimeout(300);
  await m.setInputFiles('#impFile', xlsx); await m.waitForTimeout(1200);
  ok('the preview fits a phone', await m.evaluate(() => document.querySelector('#modal').scrollWidth <= window.innerWidth + 1));
  if (SHOTS) await m.screenshot({ path: SHOTS + '/5-import-phone.png' });
  await m.close();
  const s = await b.newPage({ viewport: { width: 1400, height: 900 } });
  s.on('pageerror', (e) => errs.push(e.message));
  await s.goto('http://localhost:' + PORT + '/?login=1', { waitUntil: 'networkidle' });
  await s.fill('#liUser', 'nita@' + dom); await s.fill('#liPass', startPw); await s.click('#btnLogin'); await s.waitForTimeout(1800);
  ok('an imported person signs in with the starting password', await s.evaluate(() => !!(window.STATE && STATE.user && STATE.user.name === 'Nita Bose')));
  ok('and, as staff, is not offered the import', await s.evaluate(() => { TEAM = []; STATE.usage = STATE.usage || {}; renderTeam(); return document.querySelector('#btnImport').classList.contains('hidden'); }));
  await s.close();

  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

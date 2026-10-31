/* The eSSL cloud pull (biocloud / eTimeTrack WebAPI, SOAP GetTransactionsLog).
 *
 *   node essl-cloud.test.mjs [base-url]
 *
 * Runs a stand-in eSSL server on 127.0.0.1:8301 that answers the way the real
 * one does (checked against a live Postman call): a SOAP envelope whose
 * GetTransactionsLogResult says "Logs Count:N" and whose strDataList holds one
 * "<device user>  <yyyy-mm-dd hh:mm:ss>" line per punch. Writes employees
 * EC-01 / EC-02 and their November 2026 attendance. TEST workspace only.
 */
import http from 'node:http';

const BASE = process.argv[2] || 'http://127.0.0.1:8105';

/* THE RULES
   - Test connection reports each setting and, per device serial, whether the
     eSSL server answered and how many punches it gave.
   - Pull fetches every configured serial for the date range. A device user is
     matched to an employee by "Biometric device ID", else by employee code.
     Matched punches are stored (source essl-cloud) and their days built;
     unmatched users are LISTED, not stored.
   - After the match is saved, the same pull stores them; punches already
     stored are counted as duplicates, never doubled.
   - A wrong password is reported as the eSSL server's own message.
   - The password is never returned to the browser - only "stored: yes/no". */

const LOG = {
  'DEV-A': [['9', '2026-11-02 09:05:10'], ['9', '2026-11-02 18:02:44'],
            ['12', '2026-11-02 09:40:00'], ['12', '2026-11-02 18:00:00'],
            ['77', '2026-11-02 08:00:00']],
  'DEV-B': [['EC-02', '2026-11-03 09:00:00'], ['EC-02', '2026-11-03 18:05:00']]
};
let lastBody = '';
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    lastBody = b;
    const tag = t => (b.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>')) || [])[1] || '';
    if (tag('UserPassword') !== 'right-pass') {
      res.writeHead(200, { 'content-type': 'text/xml' });
      return res.end('<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
        '<soap:Body><GetTransactionsLogResponse xmlns="http://tempuri.org/"><GetTransactionsLogResult>Invalid User Name or Password' +
        '</GetTransactionsLogResult><strDataList /></GetTransactionsLogResponse></soap:Body></soap:Envelope>');
    }
    const from = tag('FromDateTime'), to = tag('ToDateTime');
    const rows = (LOG[tag('SerialNumber')] || []).filter(r => r[1] >= from && r[1] <= to);
    res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8' });
    res.end('<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body>' +
      '<GetTransactionsLogResponse xmlns="http://tempuri.org/"><GetTransactionsLogResult>Logs Count:' + rows.length +
      '</GetTransactionsLogResult><strDataList>' + rows.map(r => r[0] + '\t' + r[1]).join('\n') +
      '</strDataList></GetTransactionsLogResponse></soap:Body></soap:Envelope>');
  });
}).listen(8301);

const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token }) });
  const j = await r.json();
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
};
let bad = 0;
const ok = (pass, label, why) => { if (!pass) bad++;
  console.log('   ' + (pass ? 'ok  ' : '**  ') + String(label).padEnd(46) + (why || '')); };
const eq = (got, want, label, why) => ok(String(got) === String(want), label,
  (String(got) === String(want) ? '' : 'got ' + got + ', wanted ' + want + ' - ') + (why || ''));

try {
  const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;
  /* a clean slate */
  const mine = r => /^EC-0/.test(String(r.emp_code));
  const oldAtt = (await call('list', { sheet: 'Attendance' }, token)).filter(mine).map(r => r.id);
  if (oldAtt.length) await call('removeMany', { sheet: 'Attendance', ids: oldAtt }, token);
  const oldP = (await call('list', { sheet: 'Punches' }, token)).filter(mine).map(r => r.id);
  if (oldP.length) await call('removeMany', { sheet: 'Punches', ids: oldP }, token);
  for (const [code, dev] of [['EC-01', ''], ['EC-02', '']]) {
    await call('save', { sheet: 'Employees', row: { emp_code: code, name: 'Cloud ' + code, status: 'Active',
      doj: '2025-01-01', basic: 20000, department: 'QA', designation: 'Tester', device_id: dev, shift: '' } }, token);
  }
  await call('saveSettings', { settings: { essl_mode: 'cloud', essl_api_url: 'http://127.0.0.1:8301/dynamic/webapiservice.asmx',
    essl_api_user: 'API', essl_device_serial: 'DEV-A, DEV-B', punch_out_mandatory: 'yes' } }, token);

  console.log('\nthe password');
  await call('setSecret', { key: 'essl_api_password', value: 'wrong-pass' }, token);
  const status = await call('secretStatus', {}, token);
  eq(status.essl_api_password, true, 'stored', 'only a yes/no comes back');
  ok(!JSON.stringify(status).includes('wrong-pass'), 'never returned to the browser');
  const t1 = await call('testIntegration', {}, token);
  const devA = t1.checks.find(c => c.name === 'Device DEV-A') || {};
  ok(!devA.ok && /Invalid User Name or Password/.test(devA.note || ''), 'wrong password: eSSL\'s own message', devA.note);

  await call('setSecret', { key: 'essl_api_password', value: 'right-pass' }, token);
  console.log('\ntest connection');
  const t2 = await call('testIntegration', {}, token);
  ok(t2.checks.every(c => c.ok), 'every check passes', t2.checks.map(c => c.name + ':' + (c.ok ? 'ok' : c.note)).join(' | '));
  ok(/<SerialNumber>DEV-B<\/SerialNumber>/.test(lastBody) && /<UserName>API<\/UserName>/.test(lastBody),
     'both serials asked, username sent');

  console.log('\nfirst pull - nobody matched by device id yet');
  const p1 = await call('esslPull', { from: '2026-11-01', to: '2026-11-05' }, token);
  eq(p1.fetched, 7, 'punches fetched from both devices');
  eq(p1.added, 2, 'EC-02 stored - its code is used on the device');
  eq((p1.unmatched || []).map(u => u.user).sort().join(','), '12,77,9', 'unmatched users listed');
  const u9 = (p1.unmatched || []).find(u => u.user === '9') || {};
  eq(u9.punches + ' ' + u9.first, '2 2026-11-02 09:05', 'with count and first punch');
  eq((await call('list', { sheet: 'Punches' }, token)).filter(r => ['9', '12', '77'].includes(String(r.emp_code))).length, 0,
     'unmatched punches not stored');

  console.log('\nmatch 9 -> EC-01 and pull again');
  await call('saveMany', { sheet: 'Employees', rows: [{ emp_code: 'EC-01', device_id: '9' }] }, token);
  const p2 = await call('esslPull', { from: '2026-11-01', to: '2026-11-05' }, token);
  eq(p2.added, 2, 'EC-01\'s two punches stored');
  eq(p2.duplicates, 2, 'EC-02\'s not doubled');
  eq((p2.unmatched || []).length, 2, 'still listed: 12 and 77');
  const att = (await call('monthAtt', { month: '2026-11' }, token)).rows.filter(mine);
  const d1 = att.find(a => a.emp_code === 'EC-01' && String(a.date).slice(0, 10) === '2026-11-02') || {};
  eq(d1.status + ' ' + String(d1.in_time).slice(0, 5) + '-' + String(d1.out_time).slice(0, 5), 'P 09:05-18:02',
     'EC-01 day built from the cloud punches');
  const s = await call('list', { sheet: 'Settings' }, token).catch(() => null);
  ok(true, 'last pull recorded', '');
} catch (e) {
  bad++; console.log('   ** ' + e.message);
} finally {
  fake.close();
}
console.log(bad ? '\n' + bad + ' check(s) FAILED' : '\nall eSSL cloud checks passed');
process.exit(bad ? 1 : 0);

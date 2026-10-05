/* What the person is told when the address answers with a web page.
 *
 * The backend wraps everything and answers in JSON even when refusing, so a
 * reply that will not parse never reached it. Each case below is a real way
 * that happens, and the only thing being checked is whether the sentence the
 * person reads points at the thing they have to go and change.
 *
 * The old behaviour - r.json() on whatever came back - produced
 * "Unexpected token '<', "<!DOCTYPE "... is not valid JSON" for all four.
 *
 *   node reply-msg.test.mjs http://127.0.0.1:8101
 */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SITE = process.argv[2] || 'http://127.0.0.1:8101';

/* The four broken addresses are served from here, so the file is one command
   and leaves nothing listening behind it. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const servers = spawn(process.execPath, [path.join(HERE, 'badreply-servers.cjs')],
  { stdio: 'ignore' });
const stop = () => { try { servers.kill(); } catch (e) {} };
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(1); });
await new Promise(r => setTimeout(r, 900));

/* address, what it is, what the sentence must point at */
const CASES = [
  ['http://127.0.0.1:8111/exec', 'a Google sign-in page',        /Who has access.*Anyone/is],
  ['http://127.0.0.1:8112/exec', 'a dead deployment (404)',      /not a live \/exec deployment|does not recognise/i],
  ['http://127.0.0.1:8113/exec', 'the script failing to start',  /Executions|failed before it could answer/i],
  ['SELF',                       'the website itself',           /pointing at this website/i],
];

let bad = 0;
const ok = (pass, label, why) => { if (!pass) bad++;
  console.log('   ' + (pass ? 'ok  ' : '**  ') + label.padEnd(34) + (why || '')); };

const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
await p.goto(SITE + '/index.html', { waitUntil: 'networkidle' });

console.log('what the person is told when the address answers with a web page\n');
for (const [addr, what, must] of CASES) {
  const url = addr === 'SELF' ? SITE + '/index.html' : addr;
  const msg = await p.evaluate(async u => {
    S.api = u; S.demo = false;
    try { await api('ping', {}); return 'NO ERROR AT ALL'; }
    catch (e) { return e.message; }
  }, url);
  ok(must.test(msg) && !/is not valid JSON|Unexpected token/.test(msg), what, msg.slice(0, 92));
}

/* and the self-check on the sign-in screen reports the same thing */
console.log('\nthe "Test this address" button on the sign-in screen');
await p.evaluate(u => { el('in-api').value = u; testLoginUrl(); }, 'http://127.0.0.1:8111/exec');
await p.waitForTimeout(1200);
const shown = await p.evaluate(() => el('setup-test').textContent);
ok(/HTTP 200/.test(shown) && /Who has access.*Anyone/is.test(shown), 'reports the status and the fix',
   shown.replace(/\s+/g, ' ').slice(0, 92));

await p.evaluate(u => { el('in-api').value = u; testLoginUrl(); }, SITE + '/exec');
await p.waitForTimeout(1500);
const good = await p.evaluate(() => el('setup-test').textContent);
ok(/working workspace/.test(good), 'and says plainly when one is good',
   good.replace(/\s+/g, ' ').slice(0, 92));

console.log('\n' + (bad ? '** ' + bad + ' message(s) would not help' : 'every message points at the fix'));
await b.close();
process.exit(bad ? 1 : 0);

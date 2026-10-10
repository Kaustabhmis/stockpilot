const { chromium } = require('playwright');
const EMAIL = process.argv[2];
(async () => {
  const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const p = await b.newPage({viewport:{width:1500,height:950}});
  let pass=0,fail=0;
  const ok=(n,v,x)=>{console.log((v?'  PASS ':'  FAIL ')+n+(v||!x?'':'  ['+String(x).slice(0,110)+']'));v?pass++:fail++;};

  await p.goto('http://localhost:8095/?login=1',{waitUntil:'networkidle'});
  await p.fill('#liUser', EMAIL); await p.fill('#liPass','strongpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1600);

  // A quarterly task, so the series is clearly recurring
  await p.click('.card:has-text("Calibration of torque wrenches")');
  await p.waitForTimeout(700);
  const drawer = await p.locator('#drawer').textContent();
  ok('drawer shows the cadence', /Quarterly/.test(drawer));
  ok('"Stop repeating" button is present',
     await p.locator('#drawer .act[data-act="stop"]').count() === 1);
  await p.screenshot({path:'shot-15-recurring.png'});

  // and it actually works
  await p.click('#drawer .act[data-act="stop"]');
  await p.waitForTimeout(1400);
  const after = await p.evaluate(()=>{
    const t = STATE.data.tasks.find(x=>x.title.indexOf('Calibration')===0);
    return { freq: t.frequency, note: (t.history||[]).slice(-1)[0] };
  });
  ok('frequency becomes One Time', after.freq === 'One Time', after.freq);
  ok('the stop is recorded in the audit trail',
     /Recurrence stopped/.test((after.note||{}).note||''), JSON.stringify(after.note));

  await p.click('.card:has-text("Calibration of torque wrenches")');
  await p.waitForTimeout(600);
  ok('the button is gone once stopped',
     await p.locator('#drawer .act[data-act="stop"]').count() === 0);
  await p.screenshot({path:'shot-16-recurring-stopped.png'});

  // a Doer who merely owns the task cannot stop the series
  await p.evaluate(()=>{ closeDrawer(); signOut(); });
  await p.waitForTimeout(600);
  ok('after signing out the Sign in button is usable again',
     !(await p.locator('#btnLogin').isDisabled()),
     await p.locator('#btnLogin').textContent());
  ok('and the password field was cleared',
     (await p.inputValue('#liPass')) === '');
  await p.fill('#liUser', EMAIL.replace('rohan+','payel+')); await p.fill('#liPass','staffpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1500);
  await p.click('.card:has-text("Monthly stock reconciliation")');
  await p.waitForTimeout(600);
  ok('the owner of a recurring task cannot stop the series',
     await p.locator('#drawer .act[data-act="stop"]').count() === 0);
  ok('but they still see it repeats', /Monthly/.test(await p.locator('#drawer').textContent()));
  await p.screenshot({path:'shot-17-recurring-doer.png'});

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail?1:0);
})();

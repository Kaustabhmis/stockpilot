const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const p = await b.newPage({viewport:{width:1500,height:1000}});
  const errs=[]; let pass=0,fail=0;
  const ok=(n,v,x)=>{console.log((v?'  PASS ':'  FAIL ')+n+(v||!x?'':'  ['+String(x).slice(0,120)+']'));v?pass++:fail++;};
  p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  /* This sandbox denies external hosts, so fonts and the Razorpay script fail to
     load. Those are environment failures, not defects in the page. */
  const EXTERNAL = /favicon|tailwindcss|fonts\.googleapis|fonts\.gstatic|razorpay|ERR_TUNNEL|ERR_CERT|ERR_NAME|ERR_CONNECTION/;
  p.on('console',m=>{ const s=m.text()+' '+(m.location()?.url||'');
    if(m.type()==='error' && !EXTERNAL.test(s)) errs.push(m.text()); });
  await p.goto('http://localhost:8095/',{waitUntil:'networkidle'});

  console.log('--- the mark ---');
  /* The logo is an inline SVG, not an image file: one HTML file, nothing to
     fetch, and it renders before anything else on the page has loaded. */
  ok('the mark is drawn into the page, not loaded from somewhere',
     (await p.locator('#view-home svg path').count()) >= 2);
  ok('and it inverts on the dark auth surface',
     (await p.locator('#view-auth svg path[fill="#fff"]').count()) === 1);

  console.log('--- the landing page ---');
  ok('a stranger lands on the home page, not a bare form',
     await p.locator('#view-home').isVisible() && !(await p.locator('#view-auth').isVisible()));
  ok('it says what the product is', /Know who is doing what, by when/
     .test(await p.locator('#view-home').textContent()));
  ok('and who it is for', /Indian MSMEs/.test(await p.locator('#view-home').textContent()));
  ok('every band is priced on the page', (await p.locator('#homePlans > div').count()) === 5);
  ok('yearly is shown first, because it is the better deal',
     /Yearly — 2 months free/.test(await p.locator('#homeCycle').textContent()));
  ok('and the GST position is stated rather than left to be discovered',
     /exclusive of 18% GST/.test(await p.locator('#pricing').textContent()));
  ok('the scoring argument is made', /how well you delivered × how much you delivered/
     .test(await p.locator('#view-home').textContent()));

  console.log('--- signup ---');
  await p.click('#view-home button:has-text("Start free — no card")');
  await p.waitForTimeout(400);
  ok('Start free goes straight to the signup form', await p.locator('#formSignup').isVisible());
  await p.click('button:has-text("Back to sign in")'); await p.waitForTimeout(200);
  ok('and the sign-in form is one click away', await p.locator('#formLogin').isVisible());
  ok('with a way back to the home page',
     await p.locator('button:has-text("Back to the Dome Box home page")').isVisible());
  await p.click('button:has-text("Create a company workspace")');
  await p.waitForTimeout(200);
  ok('signup form shown', await p.locator('#formSignup').isVisible());
  // unique per run: the harness keeps state in memory between runs
  const RUN = Date.now().toString(36);
  const EMAIL = 'asha+' + RUN + '@bright.in';
  await p.fill('#suCompany','Bright Metals'); await p.fill('#suName','Asha Rao');
  await p.fill('#suEmail', EMAIL); await p.fill('#suPhone','9811122233');
  await p.fill('#suPass','strongpass123');
  await p.click('#btnSignup'); await p.waitForTimeout(1200);
  ok('lands in the app', await p.locator('#view-app').isVisible());
  ok('name in the nav', (await p.locator('#navName').textContent())==='Asha Rao');
  ok('company in the nav', /Bright Metals/.test(await p.locator('#navCompany').textContent()));
  ok('stat tiles rendered', (await p.locator('#statTiles > div').count())===6);
  ok('empty state shown', await p.locator('#tasksEmpty').isVisible());

  console.log('--- add team ---');
  await p.click('button[data-tab="team"]'); await p.waitForTimeout(600);
  ok('team tab shows the admin', (await p.locator('#teamTable tbody tr').count())===1);
  await p.click('#btnNewUser'); await p.waitForTimeout(300);
  await p.fill('#uName','Imran Qureshi'); await p.fill('#uUser','imran-'+RUN);
  await p.fill('#uMail','imran+'+RUN+'@bright.in'); await p.selectOption('#uRole','HOD');
  await p.fill('#uDept','Quality'); await p.fill('#uProfile','Quality Head');
  await p.fill('#uPass','staffpass123');
  await p.click('#fUser button[type=submit]'); await p.waitForTimeout(900);
  ok('member added', (await p.locator('#teamTable tbody tr').count())===2);

  console.log('--- KRA weights validated inline ---');
  await p.click('#teamTable tr:has-text("Imran") .edit'); await p.waitForTimeout(400);
  await p.click('#uAddKra'); await p.waitForTimeout(150);
  await p.fill('.kItem','Rejection control'); await p.fill('.kW','140'); await p.waitForTimeout(200);
  ok('over-100% flagged live', /cannot exceed 100/.test(await p.locator('#uKraMsg').textContent()));
  await p.fill('.kW','60'); await p.waitForTimeout(200);
  ok('valid weights accepted', /60%/.test(await p.locator('#uKraMsg').textContent()));
  await p.click('#fUser button[type=submit]'); await p.waitForTimeout(900);

  console.log('--- assign a task ---');
  await p.click('button[data-tab="tasks"]'); await p.waitForTimeout(400);
  await p.click('#btnNewTask'); await p.waitForTimeout(400);
  ok('assign form opens', await p.locator('#fAssign').isVisible());
  await p.fill('#asTitle','Calibrate torque wrenches');
  await p.fill('#asDesc','Annual calibration for all lines');
  await p.check('.asWho[value="imran-'+RUN+'"]'); await p.waitForTimeout(200);
  ok('routing note shown', (await p.locator('#asRoute').textContent()).length>5);
  await p.selectOption('#asFreq','Quarterly');
  await p.fill('#asChk','Book the agency\nCollect certificates');
  await p.click('#fAssign button[type=submit]'); await p.waitForTimeout(1200);
  ok('board renders the task', (await p.locator('.card').count())===1);
  ok('five columns', (await p.locator('.col').count())===5);
  ok('recurring chip shown', /Quarterly/.test(await p.locator('.card').first().textContent()));

  console.log('--- detail drawer ---');
  await p.click('.card'); await p.waitForTimeout(400);
  ok('drawer opens', await p.locator('#drawer.on').count()===1);
  ok('checklist shown', (await p.locator('#drawer .sub').count())===2);
  ok('history shown', /Pending/.test(await p.locator('#drawer').textContent()));
  await p.evaluate(()=>closeDrawer()); await p.waitForTimeout(250);

  console.log('--- list view and filters ---');
  await p.click('#viewMode button[data-mode="list"]'); await p.waitForTimeout(400);
  ok('list renders', (await p.locator('#list tbody tr').count())===1);
  await p.fill('#fSearch','nothingmatches'); await p.waitForTimeout(300);
  ok('search filters to nothing', await p.locator('#tasksEmpty').isVisible());
  await p.fill('#fSearch','torque'); await p.waitForTimeout(300);
  ok('search finds it back', (await p.locator('#list tbody tr').count())===1);
  await p.fill('#fSearch',''); await p.waitForTimeout(250);

  console.log('--- reports gated on Free ---');
  await p.click('button[data-tab="reports"]'); await p.waitForTimeout(700);
  ok('upgrade wall shown', /Pro feature/.test(await p.locator('#reportsLocked').textContent()));
  await p.click('#reportsLocked button'); await p.waitForTimeout(400);
  ok('plans modal opens', /Plans/.test(await p.locator('#modal').textContent()));
  ok('every buyable band is offered', (await p.locator('#modal .buy').count())===3);
  ok('priced yearly by default', /\/year/.test(await p.locator('#billingPlans').textContent()));
  await p.click('#billingCycle button:has-text("Monthly")'); await p.waitForTimeout(300);
  ok('and the monthly price is one click away',
     /\/month/.test(await p.locator('#billingPlans').textContent()));
  await p.evaluate(()=>closeModal()); await p.waitForTimeout(250);

  console.log('--- notifications & account ---');
  await p.click('#btnBell'); await p.waitForTimeout(300);
  ok('bell opens', await p.locator('#bellMenu:not(.hidden)').count()===1);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.click('#btnAccount'); await p.waitForTimeout(300);
  ok('account modal shows the user', (await p.locator('#modal').textContent()).includes(EMAIL));
  await p.evaluate(()=>closeModal()); await p.waitForTimeout(200);

  console.log('--- session ---');
  await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(900);
  ok('session survives a reload', await p.locator('#view-app').isVisible());
  await p.evaluate(()=>signOut()); await p.waitForTimeout(400);
  ok('sign out returns to login', await p.locator('#view-auth').isVisible());
  await p.fill('#liUser', EMAIL); await p.fill('#liPass','strongpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1200);
  ok('can sign back in', await p.locator('#view-app').isVisible());

  console.log('--- the priority list ---');
  await p.click('#navTabs button[data-tab="priority"]'); await p.waitForTimeout(1400);
  ok('the priority tab opens', await p.locator('#tab-priority').isVisible());
  const hz = (await p.locator('#prHorizons button').allTextContents())
    .map(t => t.replace(/\s*\d+\s*$/, '').trim()).join('|');
  ok('with every horizon offered',
     hz === 'Today|This week|This month|This quarter|This year|Everything', hz);
  ok('each carrying a count',
     /\d/.test((await p.locator('#prHorizons button').first().textContent()) || ''));
  await p.click('#prHorizons button[data-h="day"]'); await p.waitForTimeout(900);
  ok('switching horizon reloads the list',
     (await p.locator('#prHorizons button[data-h="day"]').getAttribute('class')).indexOf('border-blue-600') > -1);
  ok('and it says what it is ranking by',
     /not just by the label on it/.test(await p.locator('#tab-priority').textContent()));

  console.log('--- responsive ---');
  const of1 = await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  ok('no overflow at 1500px', of1<=1, String(of1));
  await p.setViewportSize({width:390,height:900}); await p.waitForTimeout(600);
  const of2 = await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  ok('no overflow at 390px', of2<=1, String(of2));
  await p.screenshot({path:'new-mobile.png',fullPage:true});
  await p.setViewportSize({width:1500,height:1000}); await p.waitForTimeout(500);
  await p.screenshot({path:'new-board.png',fullPage:true});

  ok('no console errors', errs.length===0);
  errs.slice(0,5).forEach(e=>console.log('       '+e));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail?1:0);
})();

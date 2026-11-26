/* Domebox social posters (1080x1080, Facebook + LinkedIn). Run: node marketing/posters/make-posters.js — writes the PNGs into this folder. */
const { chromium } = require('/home/user/stockpilot/node_modules/playwright');
const fs = require('fs'), path = require('path');
const OUT = __dirname; fs.mkdirSync(OUT, { recursive: true });
const IMG = (f) => 'file:///home/user/stockpilot/netlify/img/' + f + '.jpg';
const FONTS = 'file:///home/user/stockpilot/tests/fonts/';

const css = `
@font-face{font-family:Inter;font-weight:100 900;src:url(${FONTS}inter-1.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:Inter;font-weight:100 900;src:url(${FONTS}inter-3.woff2) format('woff2');unicode-range:U+0100-02AF,U+0304,U+0308,U+0329,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:MI;src:url(${FONTS}mi.ttf)}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1080px;height:1080px;overflow:hidden;font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased}
.p{position:relative;width:1080px;height:1080px;overflow:hidden;padding:72px 76px}
.navy{background:radial-gradient(900px 640px at 18% 8%,#1e4fbf 0%,rgba(30,79,191,0) 62%),radial-gradient(760px 560px at 96% 100%,#0f8f84 0%,rgba(15,143,132,0) 58%),#0c1a30;color:#fff}
.white{background:#fff;color:#0f1b2d}
.sky{background:linear-gradient(160deg,#eef4ff 0%,#f7f9fc 60%,#e9f6f4 100%);color:#0f1b2d}
.gold-bg{background:radial-gradient(800px 600px at 85% 10%,#ffe08a 0%,rgba(255,224,138,0) 60%),#f5b301;color:#0f1b2d}
.brand{display:flex;align-items:center;gap:12px;font-weight:900;font-size:30px;letter-spacing:-.4px}
.brand svg{width:44px;height:44px}
.kick{font-size:20px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;margin-top:42px}
.navy .kick{color:#7fb2ff} .white .kick,.sky .kick{color:#1e4fbf} .gold-bg .kick{color:#7a4b00}
h1{font-size:76px;line-height:1.02;font-weight:900;letter-spacing:-2.2px;margin-top:14px}
h1 .g{color:#f5c542} .white h1 .g,.sky h1 .g{color:#1e4fbf} .gold-bg h1 .g{color:#13294b}
.sub{font-size:28px;line-height:1.4;font-weight:600;margin-top:22px;max-width:860px}
.navy .sub{color:#c9d6ea} .white .sub,.sky .sub{color:#475467} .gold-bg .sub{color:#3d2a00}
.shot{position:absolute;border-radius:22px;overflow:hidden;background:#fff;box-shadow:0 40px 80px -24px rgba(8,20,45,.55),0 0 0 1px rgba(15,27,45,.08)}
.shot .bar{height:34px;background:#eef2f8;display:flex;align-items:center;gap:8px;padding:0 16px}
.shot .bar i{width:11px;height:11px;border-radius:50%;background:#c9d3e3;display:block}
.shot .bar span{margin-left:14px;font-size:14px;font-weight:700;color:#667085;background:#fff;border-radius:7px;padding:3px 14px}
.shot img{display:block;width:100%}
.navy .shot{box-shadow:0 50px 90px -20px rgba(0,0,0,.7),0 0 0 8px rgba(255,255,255,.06)}
.foot{position:absolute;left:0;right:0;bottom:0;height:150px;padding:0 76px;display:flex;align-items:center;justify-content:space-between;z-index:5}
.navy .foot{background:#0b1830;border-top:1px solid rgba(255,255,255,.08)}
.white .foot{background:#fff;border-top:1px solid #e6ebf3}
.sky .foot{background:#fff;border-top:1px solid #dfe7f3}
.gold-bg .foot{background:#13294b} .gold-bg .url{color:#fff}
.gold-bg .foot .cta{background:#f5b301;color:#0f1b2d}
.url{font-size:26px;font-weight:900;letter-spacing:-.2px}
.navy .url{color:#fff} .white .url,.sky .url{color:#13294b}
.cta{background:#f5b301;color:#0f1b2d;font-weight:900;font-size:24px;padding:18px 30px;border-radius:16px;box-shadow:0 14px 30px -10px rgba(245,179,1,.7)}
.gold-bg .cta{background:#13294b;color:#fff;box-shadow:0 14px 30px -10px rgba(19,41,75,.6)}
.pts{margin-top:34px;display:flex;flex-direction:column;gap:18px}
.pt{display:flex;gap:16px;align-items:flex-start;font-size:28px;font-weight:700;line-height:1.3}
.pt .mi{font-family:MI;font-size:34px;line-height:1;color:#0f8f84;flex:none;margin-top:1px}
.navy .pt .mi{color:#3fd6b7}
.chip{display:inline-flex;align-items:center;gap:12px;font-weight:900;font-size:40px;padding:22px 32px;border-radius:22px;background:#fff;color:#13294b;border:3px solid #1e4fbf}
.mi{font-family:MI;font-weight:normal;font-style:normal;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;-webkit-font-feature-settings:'liga';font-feature-settings:'liga'}
.tag{display:inline-block;font-size:18px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;padding:9px 16px;border-radius:999px;background:rgba(245,197,66,.16);color:#f5c542;border:1.5px solid rgba(245,197,66,.4)}
`;
const LOGO = (dome, tick) => `<svg viewBox="0 0 100 100"><path d="M12 52 A38 38 0 0 1 88 52 L88 76 A12 12 0 0 1 76 88 L24 88 A12 12 0 0 1 12 76 Z" fill="${dome}"/><path d="M35 55 L46 66 L67 42" fill="none" stroke="${tick}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const brand = (t) => `<div class="brand">${t === 'navy' ? LOGO('#fff', '#1e4fbf') : t === 'gold-bg' ? LOGO('#13294b', '#f5b301') : LOGO('#1e4fbf', '#fff')}<span>Domebox</span></div>`;
const foot = (cta) => `<div class="foot"><div class="url">www.domebox.in</div><div class="cta">${cta || 'Start your free 14-day trial'}</div></div>`;
const shot = (img, style) => `<div class="shot" style="${style}"><div class="bar"><i></i><i></i><i></i><span>www.domebox.in</span></div><img src="${IMG(img)}"></div>`;
const pts = (list) => `<div class="pts">${list.map((t) => `<div class="pt"><span class="mi">check_circle</span><span>${t}</span></div>`).join('')}</div>`;

const P = [
  ['01-stop-chasing', 'navy', `<span class="tag" style="margin-top:34px">Task, team &amp; performance management</span>
    <h1 style="margin-top:28px;font-size:84px">Stop chasing work on WhatsApp.<br><span class="g">Know who delivered.</span></h1>
    ${shot('16-lead-board', 'left:76px;right:-140px;top:560px')}`, ''],
  ['02-owner-deadline-proof', 'white', `<div class="kick">Accountability, built in</div>
    <h1>Every job has an owner, a deadline <span class="g">and a proof.</span></h1>
    ${pts(['Assign to one person or ten in seconds', 'Approved only when it is really done', 'Late work is visible — nobody has to ask'])}
    ${shot('03-task-drawer', 'left:300px;right:-330px;top:590px')}`, ''],
  ['03-fair-score', 'navy', `<div class="kick">Delegation score</div>
    <h1>A fair score for every person.<br><span class="g">With the working shown.</span></h1>
    <p class="sub">Every number opens up task by task — so a score can be checked, not argued about.</p>
    ${shot('09-score-why', 'left:76px;right:-160px;top:610px')}`, ''],
  ['04-reminders', 'sky', `<div class="kick">Automatic reminders</div>
    <h1>The follow-up <span class="g">happens by itself.</span></h1>
    <p class="sub">Open work is reminded three times a day, a morning digest lands at 9, and urgent jobs go first.</p>
    <div style="display:flex;gap:22px;margin-top:56px">
      <span class="chip"><span class="mi" style="color:#1e4fbf">alarm</span>9 AM</span>
      <span class="chip"><span class="mi" style="color:#1e4fbf">alarm</span>3 PM</span>
      <span class="chip"><span class="mi" style="color:#1e4fbf">alarm</span>5 PM</span></div>
    <div style="position:absolute;right:86px;top:600px;width:250px;border-radius:38px;overflow:hidden;border:10px solid #0f1b2d;box-shadow:0 40px 80px -24px rgba(8,20,45,.5);transform:rotate(4deg)"><img src="${IMG('15-phone')}" style="display:block;width:100%"></div>`, ''],
  ['05-priority', 'white', `<div class="kick">Priority list</div>
    <h1>"What do I do first?"<br><span class="g">Answered — with the reason.</span></h1>
    <p class="sub">One ranked list for today: what is late, what is blocking others, what is due.</p>
    ${shot('08-priority', 'left:76px;right:-160px;top:600px')}`, ''],
  ['06-projects', 'navy', `<div class="kick">Multi-stage projects</div>
    <h1>Finish one stage.<br><span class="g">The next one starts itself.</span></h1>
    <p class="sub">Each stage has its owner and deadline, and releases the next when it is approved.</p>
    ${shot('11-projects', 'left:76px;right:-160px;top:600px')}`, ''],
  ['07-appraisals', 'sky', `<div class="kick">KRA · KPI · Appraisals</div>
    <h1>Appraisals from real work, <span class="g">not memory.</span></h1>
    ${pts(['KRAs and KPIs set for every role', 'Delivery scored from the task record, not memory', 'Manager and employee see the same record'])}
    ${shot('21-appraisal', 'left:300px;right:-330px;top:590px')}`, ''],
  ['08-weekly-review', 'white', `<div class="kick">Weekly review meetings</div>
    <h1>A weekly meeting where <span class="g">actions become tasks.</span></h1>
    <p class="sub">Wins, roadblocks and key numbers in one agenda. Every action agreed lands on someone’s board.</p>
    ${shot('23-meeting-wins', 'left:76px;right:-160px;top:620px')}`, ''],
  ['09-recognition', 'navy', `<div class="kick">Leaderboard &amp; cookie points</div>
    <h1>Recognise the people <span class="g">who deliver.</span></h1>
    <p class="sub">A monthly leaderboard and cookie points for going the extra mile — earned, not guessed.</p>
    ${shot('10-leaderboard', 'left:76px;right:-160px;top:610px')}`, ''],
  ['10-goals-reports', 'sky', `<div class="kick">Goals &amp; reports</div>
    <h1>Goals the whole team can see. <span class="g">Progress you can trust.</span></h1>
    ${shot('12-goals', 'left:76px;width:600px;top:560px;transform:rotate(-2deg)')}
    ${shot('20-reports', 'left:470px;width:620px;top:640px;transform:rotate(2deg)')}`, ''],
  ['11-pricing', 'navy', `<div class="kick">Simple pricing</div>
    <h1>Every feature on <span class="g">every paid plan.</span></h1>
    <p class="sub">You pay for the size of your team — not for features.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:44px">
      ${[['Team', '10 users', '₹999'], ['Starter', '15 users', '₹2,499'], ['Growth', '50 users', '₹5,999'], ['Scale', '150 users', '₹12,999']].map(([n, u, p], i) =>
        `<div style="border-radius:22px;padding:26px 30px;${i === 2 ? 'background:#fff;color:#0f1b2d' : 'background:rgba(255,255,255,.07);border:1.5px solid rgba(255,255,255,.18)'}">
          <div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:30px;font-weight:900">${n}</span><span style="font-size:20px;font-weight:700;opacity:.7">${u}</span></div>
          <div style="font-size:52px;font-weight:900;letter-spacing:-1.5px;margin-top:6px">${p}<span style="font-size:22px;font-weight:700;opacity:.6"> /month</span></div>
          ${i === 2 ? '<div style="font-size:16px;font-weight:900;letter-spacing:.14em;color:#1e4fbf;margin-top:2px">MOST POPULAR</div>' : ''}</div>`).join('')}
    </div>
    <p class="sub" style="font-size:22px;margin-top:22px">Yearly = 2 months free · Free plan for up to 5 people</p>`, ''],
  ['12-free-trial', 'gold-bg', `<div class="kick">No card needed</div>
    <h1 style="font-size:92px">Try Domebox free <span class="g">for 14 days.</span></h1>
    <p class="sub">The full Growth plan — up to 50 people, scoring, reports and appraisals. Running the same afternoon.</p>
    ${pts(['Or open the live demo — no sign-up', 'Nothing is deleted when the trial ends'])}
    <div style="position:absolute;right:96px;top:520px;width:250px;border-radius:38px;overflow:hidden;border:10px solid #0f1b2d;box-shadow:0 40px 80px -24px rgba(8,20,45,.5);transform:rotate(-5deg)"><img src="${IMG('15-phone')}" style="display:block;width:100%"></div>`, 'Start free at domebox.in'],
];

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await b.newPage({ viewport: { width: 1080, height: 1080 } });
  for (const [name, theme, body, cta] of P) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
      <div class="p ${theme}">${brand(theme)}${body}${foot(cta)}</div></body></html>`;
    const f = path.join(require('os').tmpdir(), name + '.html');
    fs.writeFileSync(f, html);
    await pg.goto('file://' + f, { waitUntil: 'load' });
    await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(250);
    await pg.screenshot({ path: path.join(OUT, 'domebox-' + name + '.png') });
  }
  await b.close();
  console.log(fs.readdirSync(OUT).join('\n'));
})();

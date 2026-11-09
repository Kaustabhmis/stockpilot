/* Domebox LinkedIn set: six 1080x1350 feed posts, a 7-slide document carousel
   (PDF, 1080x1350 pages), and the two LinkedIn banners.
   Run: node marketing/linkedin/make-linkedin.js — writes into this folder. */
const { chromium } = require('/home/user/stockpilot/node_modules/playwright');
const fs = require('fs'), path = require('path');
const OUT = __dirname;
const IMG = (f) => 'file:///home/user/stockpilot/netlify/img/' + f + '.jpg';
const FONTS = 'file:///home/user/stockpilot/tests/fonts/';

const css = (w, h) => `
@font-face{font-family:Inter;font-weight:100 900;src:url(${FONTS}inter-1.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:Inter;font-weight:100 900;src:url(${FONTS}inter-3.woff2) format('woff2');unicode-range:U+0100-02AF,U+0304,U+0308,U+0329,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:MI;src:url(${FONTS}mi.ttf)}
*{box-sizing:border-box;margin:0;padding:0}
@page{size:${w}px ${h}px;margin:0}
body{font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased}
.p{position:relative;width:${w}px;height:${h}px;overflow:hidden;padding:76px 80px;page-break-after:always}
.navy{background:radial-gradient(900px 700px at 15% 5%,#1e4fbf 0%,rgba(30,79,191,0) 62%),radial-gradient(800px 600px at 100% 100%,#0f8f84 0%,rgba(15,143,132,0) 58%),#0c1a30;color:#fff}
.white{background:#fff;color:#0f1b2d}
.sky{background:linear-gradient(160deg,#eef4ff 0%,#f7f9fc 60%,#e9f6f4 100%);color:#0f1b2d}
.gold-bg{background:radial-gradient(800px 600px at 85% 10%,#ffe08a 0%,rgba(255,224,138,0) 60%),#f5b301;color:#0f1b2d}
.brand{display:flex;align-items:center;gap:12px;font-weight:900;font-size:30px;letter-spacing:-.4px}
.brand svg{width:44px;height:44px}
.kick{font-size:21px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;margin-top:48px}
.navy .kick{color:#7fb2ff} .white .kick,.sky .kick{color:#1e4fbf} .gold-bg .kick{color:#7a4b00}
h1{font-size:80px;line-height:1.03;font-weight:900;letter-spacing:-2.4px;margin-top:16px}
h1 .g{color:#f5c542} .white h1 .g,.sky h1 .g{color:#1e4fbf} .gold-bg h1 .g{color:#13294b}
.sub{font-size:30px;line-height:1.42;font-weight:600;margin-top:26px;max-width:900px}
.navy .sub{color:#c9d6ea} .white .sub,.sky .sub{color:#475467} .gold-bg .sub{color:#3d2a00}
.shot{position:absolute;border-radius:22px;overflow:hidden;background:#fff;box-shadow:0 40px 80px -24px rgba(8,20,45,.55),0 0 0 1px rgba(15,27,45,.08)}
.shot .bar{height:36px;background:#eef2f8;display:flex;align-items:center;gap:8px;padding:0 16px}
.shot .bar i{width:11px;height:11px;border-radius:50%;background:#c9d3e3;display:block}
.shot .bar span{margin-left:14px;font-size:15px;font-weight:700;color:#667085;background:#fff;border-radius:7px;padding:3px 14px}
.shot img{display:block;width:100%}
.navy .shot{box-shadow:0 50px 90px -20px rgba(0,0,0,.7),0 0 0 8px rgba(255,255,255,.06)}
.foot{position:absolute;left:0;right:0;bottom:0;height:150px;padding:0 80px;display:flex;align-items:center;justify-content:space-between;z-index:5}
.navy .foot{background:#0b1830;border-top:1px solid rgba(255,255,255,.08)}
.white .foot,.sky .foot{background:#fff;border-top:1px solid #e3e9f3}
.gold-bg .foot{background:#13294b}
.url{font-size:28px;font-weight:900}
.navy .url,.gold-bg .url{color:#fff} .white .url,.sky .url{color:#13294b}
.cta{background:#f5b301;color:#0f1b2d;font-weight:900;font-size:25px;padding:19px 30px;border-radius:16px}
.pts{margin-top:40px;display:flex;flex-direction:column;gap:22px}
.pt{display:flex;gap:16px;align-items:flex-start;font-size:31px;font-weight:700;line-height:1.3}
.mi{font-family:MI;font-weight:normal;font-style:normal;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;font-feature-settings:'liga'}
.pt .mi{font-size:38px;color:#0f8f84;flex:none;margin-top:1px} .navy .pt .mi{color:#3fd6b7}
.pt.no .mi{color:#d92d20} .navy .pt.no .mi{color:#ff8a80}
.tag{display:inline-block;font-size:19px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;padding:10px 18px;border-radius:999px;background:rgba(245,197,66,.16);color:#f5c542;border:1.5px solid rgba(245,197,66,.4)}
.quote{font-size:66px;line-height:1.14;font-weight:900;letter-spacing:-1.6px;margin-top:40px}
.quote .q{font-size:170px;line-height:.6;color:#1e4fbf;display:block;height:90px;font-family:Georgia,serif}
.who{display:flex;align-items:center;gap:22px;margin-top:56px}
.av{width:96px;height:96px;border-radius:50%;background:#1e4fbf;color:#fff;font-weight:900;font-size:36px;display:flex;align-items:center;justify-content:center}
.who b{font-size:32px;display:block} .who span{font-size:24px;color:#475467;font-weight:600}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:46px}
.col{border-radius:26px;padding:34px 32px}
.col h3{font-size:30px;font-weight:900;margin-bottom:22px;display:flex;align-items:center;gap:12px}
.col .pt{font-size:30px} .col .pt .mi{font-size:36px}
.bad{background:#fff3f1;border:2px solid #fbd5d0} .good{background:#ecfdf5;border:2px solid #bbf0d9}
.num{font-size:200px;font-weight:900;line-height:.9;letter-spacing:-6px;color:#1e4fbf}
.navy .num{color:#f5c542}
.pg{position:absolute;top:84px;right:80px;font-size:22px;font-weight:900;letter-spacing:.12em;color:#98a2b3}
.navy .pg{color:#7fb2ff}
.fix{margin-top:44px;border-radius:24px;padding:30px 32px;background:#ecfdf5;border:2px solid #bbf0d9}
.fix b{display:block;font-size:24px;letter-spacing:.14em;text-transform:uppercase;color:#067647;margin-bottom:10px}
.fix p{font-size:36px;line-height:1.4;font-weight:700;color:#0f1b2d}
/* content that should sit in the middle of the space between the logo and the footer */
.mid{position:absolute;left:80px;right:80px;top:150px;bottom:150px;display:flex;flex-direction:column;justify-content:center}
.mid.nofoot{bottom:40px}
.swipe{position:absolute;right:80px;bottom:200px;font-size:26px;font-weight:900;display:flex;align-items:center;gap:10px}
.navy .swipe{color:#f5c542}
`;
const LOGO = (dome, tick) => `<svg viewBox="0 0 100 100"><path d="M12 52 A38 38 0 0 1 88 52 L88 76 A12 12 0 0 1 76 88 L24 88 A12 12 0 0 1 12 76 Z" fill="${dome}"/><path d="M35 55 L46 66 L67 42" fill="none" stroke="${tick}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const brand = (t) => `<div class="brand">${t === 'navy' ? LOGO('#fff', '#1e4fbf') : t === 'gold-bg' ? LOGO('#13294b', '#f5b301') : LOGO('#1e4fbf', '#fff')}<span>Domebox</span></div>`;
const foot = (cta) => `<div class="foot"><div class="url">www.domebox.in</div><div class="cta">${cta || 'Start your free 14-day trial'}</div></div>`;
const shot = (img, style) => `<div class="shot" style="${style}"><div class="bar"><i></i><i></i><i></i><span>www.domebox.in</span></div><img src="${IMG(img)}"></div>`;
const pts = (list, no) => `<div class="pts">${list.map((t) => `<div class="pt${no ? ' no' : ''}"><span class="mi">${no ? 'cancel' : 'check_circle'}</span><span>${t}</span></div>`).join('')}</div>`;
const page = (theme, body, cta) => `<div class="p ${theme}">${brand(theme)}${body}${cta === false ? '' : foot(cta)}</div>`;

/* ---- the six feed posts ------------------------------------------------ */
const POSTS = [
  ['01-launch', 'navy', `<span class="tag" style="margin-top:40px">Now live · Made in Kolkata</span>
    <h1 style="margin-top:30px;font-size:90px">Stop chasing work on WhatsApp.<br><span class="g">Know who delivered.</span></h1>
    <p class="sub">Task, team and performance management for Indian MSMEs — factories, trading houses and service firms.</p>
    ${shot('16-lead-board', 'left:80px;right:-150px;top:760px')}`],
  ['02-founder-note', 'white', `<div class="mid"><div class="quote" style="margin-top:0"><span class="q">“</span>I built Domebox because I was tired of asking
    <span style="color:#1e4fbf">“Has this been done?”</span> on WhatsApp — and never getting a straight answer.</div>
    <div class="who"><div class="av">KM</div><div><b>Kaustabh Maitra</b><span>Founder, Domebox · BISCS India, Kolkata</span></div></div></div>`, 'Try Domebox free'],
  ['03-whatsapp-vs-domebox', 'sky', `<div class="mid"><div class="kick" style="margin-top:0">The difference</div>
    <h1 style="font-size:72px">Same team. Same work.<br><span class="g">No chasing.</span></h1>
    <div class="cols">
      <div class="col bad"><h3><span class="mi" style="color:#d92d20">chat</span>On WhatsApp</h3>
        ${pts(['Work lost in 40 groups', '“Has this been done?” all day', 'Nobody knows who is late', 'Appraisals from memory'], true)}</div>
      <div class="col good"><h3><span class="mi" style="color:#067647">task_alt</span>On Domebox</h3>
        ${pts(['One owner, one deadline', 'Reminders go by themselves', 'Late work shows on its own', 'Scores from the real record'])}</div>
    </div></div>`],
  ['04-fair-score', 'navy', `<div class="kick">Delegation score</div>
    <h1>A score your team<br><span class="g">can check.</span></h1>
    <p class="sub">On time, first-pass quality and the load each person carried — and every number opens up, task by task.</p>
    ${shot('09-score-why', 'left:80px;right:-170px;top:720px')}`],
  ['05-question', 'gold-bg', `<div class="mid"><div class="kick" style="margin-top:0">A question for factory owners</div>
    <h1 style="font-size:96px;margin-top:30px">How many “Has this been done?” messages did you send <span class="g">today?</span></h1>
    <p class="sub" style="margin-top:40px">Tell us in the comments. Then imagine a day where the answer is zero.</p></div>`, 'See how at domebox.in'],
  ['06-built-in-kolkata', 'white', `<div class="kick">About us</div>
    <h1 style="font-size:76px">Built in Kolkata,<br><span class="g">for the way Indian MSMEs work.</span></h1>
    ${pts(['Approvals up the manager chain — the way your factory already runs', 'KRAs, appraisals and scores in one place', 'Priced in rupees, from ₹999 a month', 'Member of the Microsoft for Startups Founders Hub'])}
    ${shot('20-reports', 'left:300px;right:-320px;top:860px')}`],
];

/* ---- the document carousel: 5 signs -------------------------------------- */
const SIGNS = [
  ['You start every morning by asking who is doing what.', 'Every task in Domebox has one owner and one deadline. The board shows who is doing what — no asking.'],
  ['Work gets “done” and comes back wrong.', 'A task closes only when the person who asked for it verifies it. Rework is counted, so quality shows.'],
  ['You find out a job is late after the customer does.', 'Late work turns red on its own, and reminders go out at 9 AM, 3 PM and 5 PM.'],
  ['Appraisals are based on who you remember.', 'Each person’s score is built from their own task record — on time, first-pass quality, the load carried.'],
  ['Projects stall between one person and the next.', 'Each stage has its own owner and deadline, and the next stage starts the moment one is approved.'],
];
const CAROUSEL = [
  page('navy', `<div class="mid nofoot"><div><span class="tag">For owners and HODs</span></div>
    <h1 style="font-size:110px;margin-top:34px">5 signs your team runs on <span class="g">follow-ups, not systems.</span></h1>
    <p class="sub" style="margin-top:36px;font-size:36px">And what to do about each one.</p></div>
    <div class="swipe" style="bottom:70px">Swipe <span class="mi">arrow_forward</span></div>`, false),
  ...SIGNS.map(([sign, fix], i) => page(i % 2 ? 'sky' : 'white', `<div class="pg">${i + 1} / 5</div>
    <div class="mid nofoot"><div class="num">${i + 1}</div>
    <h1 style="font-size:78px;margin-top:26px">${sign}</h1>
    <div class="fix"><b>The fix</b><p>${fix}</p></div></div>`, false)),
  page('navy', `<div class="mid"><h1 style="font-size:96px">Recognised two or more?<br><span class="g">Try Domebox free.</span></h1>
    <p class="sub" style="margin-top:36px;font-size:34px">14 days, no card. Set it up in an afternoon — or open the live demo first.</p>
    ${pts(['Free plan for up to 5 people', 'Paid plans from ₹999 a month', 'Made in Kolkata for Indian MSMEs'])}</div>`),
];

/* ---- banners --------------------------------------------------------------- */
/* LinkedIn covers the left of a profile banner with the round photo, and crops
   the top and bottom on phones, so the words sit in the middle band, clear of
   both, and the screenshot stays to the right of them. */
const banner = (w, h, scale, left) => `<div style="position:relative;width:${w}px;height:${h}px;overflow:hidden" class="navy">
  <div style="position:absolute;left:${left}px;width:${Math.round(w * .5)}px;top:50%;transform:translateY(-50%);color:#fff">
    <div style="font-size:${Math.round(40 * scale)}px;font-weight:900;letter-spacing:-1px;line-height:1.08">Stop chasing work on WhatsApp.<br><span style="color:#f5c542">Know who delivered.</span></div>
    <div style="font-size:${Math.round(19 * scale)}px;font-weight:700;color:#c9d6ea;margin-top:${Math.round(12 * scale)}px">Task, team &amp; performance management for Indian MSMEs · www.domebox.in</div></div>
  <div style="position:absolute;left:${left + Math.round(w * .53)}px;right:-${Math.round(w * .04)}px;top:50%;transform:translateY(-50%);border-radius:${Math.round(12 * scale)}px;overflow:hidden;box-shadow:0 30px 60px -20px rgba(0,0,0,.7)"><img src="${IMG('16-lead-board')}" style="display:block;width:100%"></div>
</div>`;

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const render = async (html, w, h, file, pdf) => {
    const f = path.join(OUT, '.tmp.html');
    fs.writeFileSync(f, `<!doctype html><html><head><meta charset="utf-8"><style>${css(w, h)}</style></head><body>${html}</body></html>`);
    const pg = await b.newPage({ viewport: { width: w, height: h } });
    await pg.goto('file://' + f, { waitUntil: 'load' });
    await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(400);
    if (pdf) await pg.pdf({ path: path.join(OUT, file), width: w + 'px', height: h + 'px', printBackground: true, pageRanges: '' });
    else await pg.screenshot({ path: path.join(OUT, file) });
    await pg.close();
  };
  for (const [name, theme, body, cta] of POSTS) await render(page(theme, body, cta), 1080, 1350, 'linkedin-' + name + '.png');
  await render(CAROUSEL.join(''), 1080, 1350, 'linkedin-carousel-5-signs.pdf', true);
  for (let i = 0; i < CAROUSEL.length; i++) await render(CAROUSEL[i], 1080, 1350, 'carousel-slide-' + (i + 1) + '.png');
  await render(banner(1128, 191, .62, 60), 1128, 191, 'linkedin-company-page-banner-1128x191.png');
  await render(banner(1584, 396, 1.05, 470), 1584, 396, 'linkedin-profile-banner-1584x396.png');
  fs.unlinkSync(path.join(OUT, '.tmp.html'));
  await b.close();
  console.log('written to ' + OUT);
})();

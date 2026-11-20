import { buildSharePayload } from '../../src/routes/content.js';
import { escapeHtml, sanitizeUrl } from '../../src/lib/util.js';
import { env } from '../../src/lib/config.js';

/**
 * Server-rendered public share page at /p/:postId.
 *
 * This is the whole reason link previews work on this stack. Apps Script served
 * its HTML inside a googleusercontent iframe, so a crawler fetching the URL got
 * a wrapper and never saw the Open Graph tags — which is why the old build
 * needed an external Cloudflare Worker. Here we return the real document, tags
 * and all, with no extra infrastructure.
 */
export const handler = async (event) => {
  const postId = decodeURIComponent((event.path || '').split('/').filter(Boolean).pop() || '');
  const shared = await buildSharePayload(postId);
  const site = env.siteUrl();

  const html = shared.found ? foundPage(shared, site) : missingPage(site);

  return {
    statusCode: shared.found ? 200 : 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Short cache: engagement counts change, but crawlers should not refetch
      // on every scroll past a link.
      'Cache-Control': 'public, max-age=300, s-maxage=600'
    },
    body: html
  };
};

function foundPage(shared, site) {
  const { post, expired } = shared;
  const author = post.author;

  const locked = shared.locked === true;
  const title = `${author.fullName}${author.isVerified ? ' ✓' : ''} on VibeStar`;
  const caption = String(post.caption || '').replace(/\s+/g, ' ').trim();

  // A private post is described without describing it. The preview says who
  // posted and that it is subscriber-only; the caption and media stay behind
  // the paywall, including in the Open Graph card.
  const description = locked
    ? `${author.fullName} shared this with subscribers only.`
    : (expired
        ? 'This post has completed its 30-day run and has been archived.'
        : (caption
            ? (caption.length > 180 ? `${caption.slice(0, 177)}…` : caption)
            : `Exclusive from ${author.fullName} — live for ${post.daysLeft} more days.`));

  // Never the post media for a locked post — only the author's avatar, which is
  // public anyway.
  const image = locked
    ? sanitizeUrl(author.avatarUrl)
    : (sanitizeUrl(post.mediaUrl) || sanitizeUrl(author.avatarUrl));
  const isVideo = !locked && post.type === 'VIDEO' && !!sanitizeUrl(post.mediaUrl);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(shared.shareUrl)}">

<meta property="og:type" content="article">
<meta property="og:site_name" content="VibeStar">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(shared.shareUrl)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:alt" content="${escapeHtml(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${escapeHtml(image)}">`
        : `<meta name="twitter:card" content="summary">`}
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">

<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { --gilt:#C9A227; --ivory:#F5F0E8; }
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:#0A0908;color:var(--ivory);
       font-family:Inter,system-ui,sans-serif;display:flex;flex-direction:column;
       align-items:center;padding:2rem 1rem}
  body::before{content:'';position:fixed;inset:0;pointer-events:none;opacity:.035;
       background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E")}
  body::after{content:'';position:fixed;inset:0;pointer-events:none;
       background:radial-gradient(120% 80% at 50% -10%,rgba(201,162,39,.10),transparent 60%)}
  .wrap{position:relative;z-index:1;width:100%;max-width:28rem}
  .brand{display:flex;align-items:center;gap:.6rem;justify-content:center;margin-bottom:1.75rem;
       text-decoration:none}
  .mark{width:2.25rem;height:2.25rem;border-radius:.7rem;display:grid;place-items:center;
       background:linear-gradient(135deg,#E3C767,#C9A227 46%,#A8811C);color:#14110F;
       font-weight:900;font-size:1.2rem}
  .word{font-family:'Playfair Display',serif;font-size:1.3rem;font-weight:600;
       background:linear-gradient(90deg,#EAD07C,#C08A55);-webkit-background-clip:text;
       -webkit-text-fill-color:transparent;background-clip:text}
  .card{background:#141110;border:1px solid #241E18;border-radius:1.5rem;overflow:hidden;
       box-shadow:0 30px 70px -30px rgba(0,0,0,.85)}
  .head{display:flex;align-items:center;gap:.75rem;padding:1rem;border-bottom:1px solid #241E18}
  .avatar{width:2.75rem;height:2.75rem;border-radius:999px;object-fit:cover;background:#211C17;flex:0 0 auto}
  .initials{width:2.75rem;height:2.75rem;border-radius:999px;display:grid;place-items:center;
       background:linear-gradient(135deg,#C9A227,#A46E3C);color:#14110F;font-weight:700;flex:0 0 auto}
  .name{font-weight:600;font-size:.9rem;display:flex;align-items:center;gap:.3rem}
  .handle{font-size:.75rem;color:#9A8F84;margin-top:.1rem}
  .pill{margin-left:auto;flex:0 0 auto;font-size:.7rem;padding:.25rem .6rem;border-radius:999px;
       border:1px solid rgba(217,168,60,.25);background:rgba(217,168,60,.1);color:#D9A83C}
  .pill.archived{border-color:#2E2822;background:#211C17;color:#9A8F84}
  .pill.locked{border-color:rgba(129,140,248,.3);background:rgba(99,102,241,.12);color:#A5B4FC}
  .locked-body{padding:3rem 1.5rem;text-align:center}
  .locked-mark{font-size:2rem;opacity:.85;margin-bottom:.75rem}
  .locked-title{font-family:'Playfair Display',serif;font-size:1.15rem;margin:0 0 .35rem}
  .locked-sub{font-size:.8rem;color:#9A8F84;margin:0;line-height:1.6}
  .caption{padding:1rem;font-size:.9rem;line-height:1.6;color:#E4DCD1;white-space:pre-wrap;margin:0}
  .media{width:100%;display:block;max-height:26rem;object-fit:cover;background:#000}
  .counts{display:flex;gap:1.25rem;padding:.85rem 1rem;border-top:1px solid #241E18;
       font-size:.8rem;color:#9A8F84}
  .note{margin:1rem;padding:1rem;border-radius:1rem;background:rgba(33,28,23,.6);
       border:1px solid #241E18;font-size:.78rem;line-height:1.6;color:#9A8F84;text-align:center}
  .cta{display:block;margin:1rem;padding:.9rem;border-radius:1rem;text-align:center;
       text-decoration:none;font-weight:700;font-size:.85rem;color:#14110F;
       background:linear-gradient(135deg,#E3C767,#C9A227 46%,#A8811C);
       box-shadow:0 10px 30px -14px rgba(201,162,39,.55)}
  .sub{text-align:center;font-size:.72rem;color:#6E645B;padding:0 1rem 1.1rem}
  .foot{text-align:center;font-size:.68rem;color:#463F38;margin-top:1.5rem}
  .foot a{color:#6E645B;text-decoration:none;margin:0 .2rem}
  .foot a:hover{color:var(--gilt)}
  h1{font-family:'Playfair Display',serif;font-size:1.1rem;margin:0}
</style>
</head>
<body>
  <div class="wrap">
    <a class="brand" href="${escapeHtml(site)}"><span class="mark">V</span><span class="word">VibeStar</span></a>

    <div class="card">
      <div class="head">
        ${sanitizeUrl(author.avatarUrl)
          ? `<img class="avatar" src="${escapeHtml(sanitizeUrl(author.avatarUrl))}" alt="">`
          : `<span class="initials">${escapeHtml(initialsOf(author.fullName))}</span>`}
        <div style="min-width:0">
          <h1 class="name">${escapeHtml(author.fullName)}${
            author.badge ? `<span style="color:${escapeHtml(author.badge.color)}">●</span>` : ''}</h1>
          <div class="handle">@${escapeHtml(author.username)}${
            author.category ? ` · ${escapeHtml(author.category)}` : ''}</div>
        </div>
        ${locked
          ? `<span class="pill locked">SUBSCRIBERS</span>`
          : (expired
              ? `<span class="pill archived">ARCHIVED</span>`
              : `<span class="pill">${post.daysLeft}d left</span>`)}
      </div>

      ${locked ? '' : (caption ? `<p class="caption">${escapeHtml(post.caption)}</p>` : '')}

      ${locked ? `<div class="locked-body">
        <div class="locked-mark">&#128274;</div>
        <p class="locked-title">A private post</p>
        <p class="locked-sub">Only ${escapeHtml(author.fullName.split(' ')[0])}&rsquo;s
        subscribers can open this one.</p>
      </div>` : ''}

      ${locked ? '' : isVideo
        ? `<video class="media" src="${escapeHtml(sanitizeUrl(post.mediaUrl))}" controls playsinline preload="metadata"></video>`
        : (sanitizeUrl(post.mediaUrl)
            ? `<img class="media" src="${escapeHtml(sanitizeUrl(post.mediaUrl))}" alt="">`
            : '')}

      ${locked ? '' : `<div class="counts">
        <span>&#9829; ${post.likeCount}</span>
        <span>&#128172; ${post.commentCount}</span>
      </div>`}

      ${!locked && expired ? `<div class="note">This post finished its 30-day run, so the media is gone.
        That is the point — on VibeStar nothing follows you forever.</div>` : ''}

      <a class="cta" href="${escapeHtml(site)}">${
        locked
          ? `Subscribe to ${escapeHtml(author.fullName.split(' ')[0])} to unlock`
          : (author.role === 'CELEBRITY'
              ? `Follow ${escapeHtml(author.fullName.split(' ')[0])} on VibeStar`
              : 'See more on VibeStar')}</a>
      ${author.role === 'CELEBRITY' && author.monthlyPrice
        ? `<div class="sub">Following is free · private chat from ₹${author.monthlyPrice}/month</div>` : ''}
    </div>

    <p class="foot">Posts on VibeStar expire after 30 days. Adults only, 18+.</p>
    <p class="foot" style="margin-top:.6rem">
      <a href="${escapeHtml(site)}/legal/terms.html">Terms</a> ·
      <a href="${escapeHtml(site)}/legal/privacy.html">Privacy</a> ·
      <a href="${escapeHtml(site)}/legal/content-policy.html">Content Policy</a>
    </p>
  </div>
</body>
</html>`;
}

function missingPage(site) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Post not available · VibeStar</title>
<meta property="og:title" content="VibeStar">
<meta property="og:description" content="Private one-on-one threads with creators.">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0A0908;
  color:#F5F0E8;font-family:Inter,system-ui,sans-serif;text-align:center;padding:2rem}
  a{color:#C9A227}</style>
</head><body><div>
  <h1 style="font-family:Georgia,serif">This post is not available</h1>
  <p style="color:#9A8F84;font-size:.9rem">It may have been removed, or the link may be wrong.</p>
  <p><a href="${escapeHtml(site)}">Explore VibeStar</a></p>
</div></body></html>`;
}

function initialsOf(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase()).join('');
}

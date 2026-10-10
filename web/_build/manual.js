/**
 * MANUAL.md -> the in-app Help Centre.
 *
 * Built from the same file, at build time, so the help inside Dome Box and the
 * manual handed to a customer cannot say different things. tests/manual-test.js
 * already holds every number in MANUAL.md against the code; rendering the help
 * from it means that guard covers what people read inside the app too.
 *
 * Deliberately a small renderer for the Markdown the manual actually uses —
 * headings, paragraphs, lists, tables, fenced code, blockquotes, bold, italic,
 * inline code and links — rather than a dependency. The build has no npm
 * install step, and a Markdown library is a lot of surface to pull into a page
 * that collects passwords for the sake of six constructs.
 *
 * Everything is escaped before any markup is added, so the only HTML that
 * reaches the page is HTML this file wrote.
 */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** GitHub's anchor rule, so `[x](#scores)` in the manual still resolves. */
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-');

/* Sections that are about managing other people. A Doer still sees them —
   knowing how your manager is measured is part of trusting the score — but
   they are labelled, and they sort after the ones about your own work. */
const MANAGER_ONLY = ['team', 'reports', 'kras-and-appraisals', 'for-managers'];

/* Which section the Help Centre opens on, from the tab you are looking at.
   Help that opens on its own table of contents makes you find your place
   twice. */
const FOR_TAB = { tasks: 'tasks', priority: 'priority', projects: 'projects',
  team: 'team', reports: 'reports', board: 'the-leaderboard',
  goals: 'goals-and-values', meetings: 'meetings' };

function inline(s) {
  let out = esc(s);
  // code first, so ** inside backticks is left alone
  const codes = [];
  out = out.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, href) => {
    if (href.charAt(0) === '#') {
      return '<a href="#" class="hc-link" data-go="' + esc(href.slice(1)) + '">' + text + '</a>';
    }
    /* Links to repository files (SETUP.md and the like) mean nothing inside
       the app. Keep the words, drop the link. */
    if (!/^https?:\/\//.test(href)) return text;
    return '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + text + '</a>';
  });
  out = out.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + codes[Number(i)] + '</code>');
  return out;
}

function renderBlock(lines) {
  const html = [];
  let i = 0;
  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  while (i < lines.length) {
    const l = lines[i];

    if (!l.trim()) { i++; continue; }
    if (/^---+\s*$/.test(l)) { i++; continue; }          // section rules are layout here

    if (/^```/.test(l)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html.push('<pre class="hc-pre">' + esc(buf.join('\n')) + '</pre>');
      continue;
    }

    const h = l.match(/^(#{3,4}) (.+)$/);
    if (h) {
      html.push('<h' + h[1].length + ' class="hc-h' + h[1].length + '" id="hc-' + slug(h[2]) + '">' +
        inline(h[2]) + '</h' + h[1].length + '>');
      i++; continue;
    }

    if (/^> ?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^> ?/.test(lines[i])) buf.push(lines[i++].replace(/^> ?/, ''));
      html.push('<div class="hc-note">' + inline(buf.join(' ')) + '</div>');
      continue;
    }

    if (isTableRow(l)) {
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      const head = cells(body[0]);
      /* A header row of empty cells is the manual's way of saying "two-column
         list, no headings". Render it without a header rather than with a
         row of blank boxes. */
      const blankHead = head.every((c) => !c);
      html.push('<div class="hc-tablewrap"><table class="hc-table">' +
        (blankHead ? '' : '<thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead>') +
        '<tbody>' + body.slice(1).map((r) =>
          '<tr>' + cells(r).map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>');
      continue;
    }

    if (/^\s*([-*]|\d+\.) /.test(l)) {
      const ordered = /^\s*\d+\. /.test(l);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*]|\d+\.) /, '');
        // continuation lines, indented
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.) /.test(lines[i])) {
          item += ' ' + lines[i++].trim();
        }
        items.push(item.replace(/^\[ \] /, ''));
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push('<' + tag + ' class="hc-list">' + items.map((t) => '<li>' + inline(t) + '</li>').join('') + '</' + tag + '>');
      continue;
    }

    // a paragraph: everything up to the next blank line or block start
    const buf = [];
    while (i < lines.length && lines[i].trim() &&
           !/^(#{3,4} |```|> ?|\s*\||\s*([-*]|\d+\.) |---+\s*$)/.test(lines[i])) buf.push(lines[i++].trim());
    if (!buf.length) continue;
    /* A paragraph whose first line is wholly bold is a question followed by
       its answer — the manual's FAQ shape. Markdown rightly joins the two into
       one paragraph; on a help screen the question wants its own line. */
    if (buf.length > 1 && /^\*\*[^*]+\*\*$/.test(buf[0])) {
      html.push('<p class="hc-q">' + inline(buf[0].slice(2, -2)) + '</p>');
      html.push('<p class="hc-a">' + inline(buf.slice(1).join(' ')) + '</p>');
      continue;
    }
    html.push('<p>' + inline(buf.join(' ')) + '</p>');
  }
  return html.join('\n');
}

/** Plain text for search: what a person would type, not the markup. */
function plain(md) {
  return md.replace(/```[\s\S]*?```/g, ' ').replace(/[`*>#|]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim().toLowerCase();
}

function build(md) {
  const parts = md.split(/^## /m);
  const sections = parts.slice(1).map((chunk) => {
    const nl = chunk.indexOf('\n');
    const title = chunk.slice(0, nl).trim();
    const body = chunk.slice(nl + 1);
    const id = slug(title);
    // the trailing "help / support" footer line belongs to the app's own footer
    const cleaned = body.replace(/^\*Still stuck\?[\s\S]*$/m, '');
    return { id, title, html: renderBlock(cleaned.split('\n')), text: plain(title + ' ' + cleaned),
             managers: MANAGER_ONLY.indexOf(id) > -1 };
  });
  return { sections, forTab: FOR_TAB };
}

module.exports = { build, inline, renderBlock, slug, esc };

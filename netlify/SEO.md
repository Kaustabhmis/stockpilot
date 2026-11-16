# SEO and marketing

## What is here

| URL | Why it exists |
|---|---|
| `/` | The landing page. Was `noindex` — see below |
| `/features` | What the product does |
| `/pricing` | Prices in INR, with the GST position stated |
| `/guides` | Index, and the order to actually do this in |
| `/kra-kpi-format` | High-volume Indian query, answered with real worked examples |
| `/employee-performance-management` | The pillar page |
| `/delegation-score` | The scoring method — the most link-worthy thing we have |
| `/task-management-for-manufacturing` | Industry page |
| `/alternatives` | Honest comparison, including where to buy someone else |

## The one that mattered most

`index.html` carried `<meta name="robots" content="noindex">`, left over from
when it was only a login box. **That kept the entire domain out of Google.** No
amount of content helps past a closed front door. It is now `index, follow`
with a canonical, Open Graph and Twitter cards, and Organization / WebSite /
SoftwareApplication structured data carrying the real prices.

## How it is built

`node build.js` — which Netlify runs on every deploy.

- `seo-content.js` holds the writing, separated so it can be read and argued
  with on its own.
- `gen-seo.js` renders the pages **and the sitemap from the same manifest**. A
  hand-maintained sitemap is wrong within a month: it lists pages that were
  renamed and misses pages that were added, and both cost indexing. Here they
  are two renderings of one list and cannot disagree.
- `gen-pages.js` builds the legal pages, and only runs once `site-config.json`
  is filled in. The build says so loudly rather than failing — a missing
  registered address should not stop a content page shipping, though it will
  still stop payment onboarding.

`tests/seo-test.js` is the gate: 116 checks covering title and description
lengths, thin pages, duplicate titles, canonicals, JSON-LD that parses, FAQ
markup matching questions actually visible on the page, every sitemap URL
resolving to a real file or a redirect, no orphan pages, and the CSP still
matching what the pages load.

## What is deliberately not here

**No `Review` or `AggregateRating` markup, anywhere.** Google requires those to
describe genuine, collected reviews. Inventing them to win a star rating in the
results is a manual-action risk and a lie to a buyer. When you have real
customer reviews with permission to publish them, that is the time — and the
test will need updating, on purpose.

**No doorway pages.** It would be easy to generate forty thin variations on
"task management software in \<city\>". Google's helpful-content system demotes
exactly that, and they do not convert either. Eight substantial pages beats
forty thin ones.

## What to do after deploying

1. **Google Search Console** — add `https://www.domebox.in`, verify by DNS, and
   submit `https://www.domebox.in/sitemap.xml`. Then use **URL Inspection** on
   the homepage and request indexing; it was `noindex`, so Google needs telling
   that changed.
2. **Bing Webmaster Tools** — import from Search Console, two minutes.
3. **Google Business Profile** for BISCS India. Local intent is a real share of
   "task management software" searches in India.
4. Give it six to twelve weeks before judging anything. New content on a domain
   with no history does not rank in a fortnight.

## Where the next traffic comes from

The pages above answer *problem* and *comparison* intent. The gap is
**template intent** — "KRA format excel download", "appraisal form format pdf".
That is enormous volume in India and it converts, because somebody downloading
a KRA template is doing the exact job this product does. It needs real
downloadable files, which is a content job rather than a code one.

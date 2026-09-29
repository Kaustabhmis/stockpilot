# Ashirbad Enterprise – Website & Admin Panel

A static site: no build step and no Node server. Host it on any static host (Netlify, Vercel, Cloudflare Pages, Firebase Hosting, GitHub Pages or cPanel).

| Page | Purpose |
|---|---|
| `index.html` | Home: live-project carousel, commercial listings, completed & sold-out gallery, map, about, latest blog posts, contact form |
| `enquiry.html` | Landing page for buyers: site-visit / price-list form. Captures UTM parameters for ad campaigns |
| `blog.html` | Blog list (search and category filter). Single article at `blog.html?post=<slug>` |
| `admin.html` | Admin panel: projects, **Sold Out** button, blog posts, commercial listings, image uploads, leads |
| `privacy.html` | Privacy policy |

## How "Sold Out" works

Every project has a **stage**:

- `live`: shown in the homepage carousel (blue map pin). The carousel auto-advances every **10 seconds** when there is more than one live project (`CAROUSEL_DELAY_MS` in `assets/js/config.js`).
- `sold`: removed from the carousel, shown in the gallery with a red **Sold Out** badge (orange map pin).
- `completed`: shown in the gallery as a completed project.

In **Admin → Projects**, click **Mark Sold Out**. The project leaves the carousel and joins the gallery with the other past projects. Its main image and gallery images become its lightbox slides. **Make Live** reverses it. If every project is sold out, the homepage shows a "New Projects Launching Soon" banner that links to the landing page.

## Demo mode (default)

With `SUPABASE_URL` and `SUPABASE_ANON_KEY` left empty in `assets/js/config.js`, the site runs in **demo mode**:

- Data and uploaded images are saved in *this browser only* (IndexedDB), and start from the sample content.
- Admin password: `LOCAL_ADMIN_PASSWORD` in `config.js` (default `ashirbad@admin`).
- Good for trying the admin panel. **Not for production:** visitors never see your edits, and the password is visible in the page source.

## Production setup (Supabase – free tier)

1. Create a project at <https://supabase.com>.
2. **SQL Editor → New query**: paste `supabase/schema.sql` and **Run**. This creates the tables, row-level security rules and the public `media` image bucket.
3. **Authentication → Users → Add user**: create your admin email and password.
4. Back in the SQL Editor, make that user an administrator:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'admin@ashirbadenterprise.com';
   ```
5. **Authentication → Providers → Email**: turn off *Allow new users to sign up*. Only admins listed in `public.admins` can edit anyway, but this keeps the user list clean.
6. **Project Settings → API**: copy the *Project URL* and the *anon / publishable* key into `assets/js/config.js`. Never use the `service_role` key.
7. Open `admin.html`, sign in, and go to **Settings → Load Sample Data** to start from the sample content (or add your own).

Security model: visitors can read projects, commercial listings and published posts, and can *submit* leads. Only accounts listed in `public.admins` can edit content, upload images, or read, update and delete leads.

## Other configuration (`assets/js/config.js`)

- `GOOGLE_MAPS_API_KEY`: enables the interactive map. Until it is set, the map section shows a list of Google Maps links. Restrict the key to your domain in Google Cloud Console.
- `WHATSAPP_NUMBER`, `PHONE`, `EMAIL`, `ADDRESS`, `SITE_URL`: contact details used across all pages.
- Also update the hard-coded contact details and domain in the `<head>` meta tags and JSON-LD of each page, and in `sitemap.xml` / `robots.txt`.

## Writing blog posts

In the article content box, leave a blank line between paragraphs. Start a line with `## ` for a heading and `- ` for a bullet point. The **Short Summary** is used on cards and as the page's SEO description.

## Files

```
assets/js/config.js   site settings (edit this)
assets/js/store.js    data layer – Supabase or browser storage
assets/js/common.js   Tailwind theme, header/footer, modals, helpers
assets/css/site.css   shared styles
supabase/schema.sql   database schema + security policies
1000365300.jpg        logo
```

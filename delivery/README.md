# What to deploy

Both files here are built from the sources in `hrms-lite/` - they are copies
for downloading, not somewhere to edit. Change `hrms-lite/` and rebuild.

- **`Code.gs`** - the Apps Script. Paste it over the script bound to the
  Google Sheet, then deploy the existing deployment (do not make a new one,
  or the address the apps talk to changes).
- **`biscs-os-netlify.zip`** - the site. Drag it onto Netlify. It holds the
  office screen at `/` and the staff app at `/app/`.

Do the sheet first, then the site. Either order works - a screen running from
an older cached copy tells the workspace nothing and is handed the wider
reach it expects - but this way nobody sees the in-between.

The installed office app now opens from its cached copy and fetches a fresh
one behind it, so **open it twice after a redeploy**: the first open still
shows the previous copy.

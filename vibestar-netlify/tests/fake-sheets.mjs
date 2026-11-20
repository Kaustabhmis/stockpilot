/**
 * An in-memory Google Sheets, installed over global fetch.
 *
 * Mocking at the fetch boundary rather than stubbing src/lib/sheets.js means the
 * real transport is under test too: the JWT is genuinely signed, A1 ranges are
 * genuinely parsed, and append/delete behave the way the API does — including
 * the two behaviours most likely to bite, namely that trailing empty cells are
 * omitted from a response and that deleting a row shifts every row below it up.
 */
import crypto from 'node:crypto';

const SHEET_ID = 'test-sheet-id';

export function installFakeSheets() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

  process.env.GOOGLE_SHEET_ID = SHEET_ID;
  process.env.GOOGLE_CLIENT_EMAIL = 'tester@vibestar.iam.gserviceaccount.com';
  process.env.GOOGLE_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
  process.env.VIBESTAR_LOCAL_KV = '1';
  process.env.URL = 'https://vibestar.test';

  // tab -> array of rows, each row an array of cells. Row 0 is the header.
  const tabs = new Map();
  const gids = new Map();
  let nextGid = 100;
  const stats = { reads: 0, writes: 0, tokenMints: 0 };

  const ensure = (title) => {
    if (!tabs.has(title)) { tabs.set(title, []); gids.set(title, nextGid += 1); }
    return tabs.get(title);
  };

  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' }
  });

  /** "'Users'!A2:D" -> { title, startRow, endRow, startCol, endCol } */
  function parseRange(range) {
    const match = /^'?(.*?)'?!([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/.exec(range);
    if (!match) throw new Error(`fake-sheets: cannot parse range "${range}"`);
    const [, rawTitle, c1, r1, c2, r2] = match;
    const col = (letters) => letters.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    return {
      title: rawTitle.replace(/''/g, "'"),
      startRow: r1 ? Number(r1) - 1 : 0,
      endRow: r2 ? Number(r2) - 1 : (r1 && !c2 ? Number(r1) - 1 : Infinity),
      startCol: col(c1),
      endCol: c2 ? col(c2) : col(c1)
    };
  }

  function readRange(range) {
    const { title, startRow, endRow, startCol, endCol } = parseRange(range);
    const grid = ensure(title);
    const out = [];

    const last = Math.min(endRow, grid.length - 1);
    for (let r = startRow; r <= last; r += 1) {
      const row = grid[r] || [];
      const slice = [];
      for (let c = startCol; c <= endCol; c += 1) slice.push(row[c] === undefined ? '' : row[c]);
      // The real API omits trailing empty cells. Reproducing that is the point:
      // code that assumes a full-width row breaks against the real service.
      while (slice.length && (slice[slice.length - 1] === '' || slice[slice.length - 1] === null)) slice.pop();
      out.push(slice);
    }
    while (out.length && out[out.length - 1].length === 0) out.pop();
    return out;
  }

  function writeRange(range, values) {
    const { title, startRow, startCol } = parseRange(range);
    const grid = ensure(title);
    values.forEach((row, i) => {
      const target = startRow + i;
      while (grid.length <= target) grid.push([]);
      row.forEach((cell, j) => { grid[target][startCol + j] = cell; });
    });
  }

  const originalFetch = globalThis.fetch;
  let external = null;

  globalThis.fetch = async (input, init = {}) => {
    // Callers pass a string, a URL, or a Request — accept all three.
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();

    // ------------------------------------------------------------ OAuth
    // Handled before any JSON parsing: the token request is form-encoded.
    if (url.href.startsWith('https://oauth2.googleapis.com/token')) {
      stats.tokenMints += 1;
      const assertion = new URLSearchParams(init.body).get('assertion') || '';
      const [header, claim, signature] = assertion.split('.');
      // Verify for real: a malformed JWT should fail here, not silently pass.
      const valid = crypto.createVerify('RSA-SHA256')
        .update(`${header}.${claim}`)
        .verify(privateKey, Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
      if (!valid) return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: 'fake-token', expires_in: 3600 });
    }

    if (!url.href.includes('/v4/spreadsheets/')) {
      // Anything else — Razorpay, say — goes to whatever the test installed.
      const handled = external && await external(url, init);
      if (handled) return handled;
      throw new Error(`fake-sheets: unexpected request to ${url.href}`);
    }

    if (init.headers?.Authorization !== 'Bearer fake-token') return json({ error: { message: 'Unauthorized' } }, 401);

    const body = init.body ? JSON.parse(init.body) : null;
    const path = decodeURIComponent(url.pathname.split(`/v4/spreadsheets/${SHEET_ID}`)[1] || '');

    // ------------------------------------------------------- batchGet
    if (path === '/values:batchGet') {
      stats.reads += 1;
      const ranges = url.searchParams.getAll('ranges');
      return json({ valueRanges: ranges.map((range) => ({ range, values: readRange(range) })) });
    }

    // --------------------------------------------------------- append
    if (path.endsWith(':append')) {
      stats.writes += 1;
      const range = path.replace(/^\/values\//, '').replace(/:append$/, '');
      const { title } = parseRange(range);
      const grid = ensure(title);
      const firstRow = grid.length + 1;   // 1-based, appended after the last row
      for (const row of body.values) grid.push([...row]);
      return json({
        updates: {
          updatedRange: `'${title}'!A${firstRow}:Z${grid.length}`,
          updatedRows: body.values.length
        }
      });
    }

    // --------------------------------------------- values:batchUpdate
    if (path === '/values:batchUpdate') {
      stats.writes += 1;
      for (const entry of body.data) writeRange(entry.range, entry.values);
      return json({ totalUpdatedRows: body.data.length });
    }

    // ---------------------------------------------------------- clear
    if (path.endsWith(':clear')) {
      stats.writes += 1;
      const range = path.replace(/^\/values\//, '').replace(/:clear$/, '');
      const { title, startRow } = parseRange(range);
      const grid = ensure(title);
      grid.length = Math.min(grid.length, startRow);
      return json({});
    }

    // ------------------------------------- single range PUT and GET
    if (path.startsWith('/values/')) {
      const range = path.replace(/^\/values\//, '');
      if (method === 'PUT') {
        stats.writes += 1;
        writeRange(range, body.values);
        return json({ updatedCells: body.values.flat().length });
      }
      stats.reads += 1;
      return json({ range, values: readRange(range) });
    }

    // --------------------------------- spreadsheet-level batchUpdate
    if (path === ':batchUpdate') {
      stats.writes += 1;
      for (const request of body.requests || []) {
        if (request.addSheet) ensure(request.addSheet.properties.title);

        if (request.deleteDimension) {
          const { sheetId, startIndex, endIndex } = request.deleteDimension.range;
          const title = [...gids.entries()].find(([, gid]) => gid === sheetId)?.[0];
          if (!title) return json({ error: { message: 'No such sheetId' } }, 400);
          // Splicing is exactly what the API does, which is why deletes have to
          // be issued highest-index-first.
          ensure(title).splice(startIndex, endIndex - startIndex);
        }
      }
      return json({ replies: [] });
    }

    // ------------------------------------------------- get metadata
    if (path === '') {
      stats.reads += 1;
      return json({
        properties: { title: 'VibeStar Test Sheet' },
        sheets: [...tabs.keys()].map((title) => ({ properties: { title, sheetId: gids.get(title) } }))
      });
    }

    return json({ error: { message: `fake-sheets: unhandled ${method} ${path}` } }, 404);
  };

  return {
    stats,
    /** Installs a handler for non-Sheets requests, e.g. the Razorpay API. */
    onExternal(handler) { external = handler; },
    json,
    /** Seeds a tab straight from column names plus row objects. */
    seed(title, headers, rows = []) {
      const grid = ensure(title);
      grid.length = 0;
      grid.push([...headers]);
      for (const row of rows) grid.push(headers.map((h) => (row[h] === undefined ? '' : row[h])));
    },
    dump(title) { return (tabs.get(title) || []).map((row) => [...row]); },
    rowCount(title) { return Math.max(0, (tabs.get(title) || []).length - 1); },
    restore() { globalThis.fetch = originalFetch; }
  };
}

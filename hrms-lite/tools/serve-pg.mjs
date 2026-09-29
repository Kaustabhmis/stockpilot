/* The Postgres backend, served locally so the rules audit can run against it.
 *
 *   node serve-pg.mjs [port] [connection-string]
 *
 * It serves the two front ends from hrms-lite/ and answers /exec with the
 * same contract the Apps Script version answered, so the audit files in this
 * folder point at it unchanged.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRouter } from '../supabase/functions/api/router.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const PORT = Number(process.argv[2] || 8105);
const CONN = process.argv[3] || process.env.DATABASE_URL ||
  'postgresql://postgres@/hrms?host=/tmp/pgwork/run&port=5433';

const pgPath = process.env.PG_MODULE ||
  '/tmp/claude-0/-home-user-stockpilot/8aedcd83-0e16-508a-a671-eb29f4bcbbbe/scratchpad/pgapi/node_modules/pg/lib/index.js';
const { default: pg } = await import(pgPath);
const pool = new pg.Pool({ connectionString: CONN, max: 10 });
await pool.query('set search_path to hrms, public');

const handle = createRouter(
  { query: (sql, params) => pool.query(sql, params) },
  {
    tokenSecret: process.env.TOKEN_SECRET || 'local-dev-secret',
    timezone: 'Asia/Kolkata',
    crypto: {
      hmac: async (key, msg) =>
        crypto.createHmac('sha256', key).update(msg).digest('hex')
    }
  }
);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS' });
    return res.end();
  }
  if (req.method === 'POST' && req.url.startsWith('/exec')) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      let out;
      try { out = await handle(JSON.parse(body)); }
      catch (e) { out = { ok: false, error: String(e.message || e) }; }
      res.writeHead(200, { 'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'text/plain' });
    res.end(data);
  });
}).listen(PORT, () => console.log('postgres-backed workspace on ' + PORT));

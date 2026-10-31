/* The Supabase Edge Function.
 *
 * Deno's entry point. Everything below it - the router, the actions, the
 * tables - is the same code the Node server in tools/serve-pg.mjs runs, so
 * what the rules audit proved locally is what runs here. Only the three
 * things Deno does differently live in this file: the HTTP handler, the
 * database connection, and the HMAC.
 *
 * Deploy:
 *   supabase functions deploy api --project-ref <ref> --no-verify-jwt
 *
 * --no-verify-jwt is deliberate: this function does its own authentication.
 * The two front ends post a session token of ours, not a Supabase JWT, and
 * the sign-in call has to be reachable without one.
 *
 * Secrets it expects:
 *   SUPABASE_DB_URL   set for you by Supabase
 *   TOKEN_SECRET      optional. The signing key lives in hrms.app_secrets,
 *                     minted by a migration; setting or changing this mixes
 *                     into it and so rotates every session. Any value will
 *                     do - it cannot weaken the key.
 *   COMPANY_TZ        optional, defaults to Asia/Kolkata
 */

import postgres from 'npm:postgres@3.4.5';
import { createRouter } from './router.js';

const DB_URL = Deno.env.get('SUPABASE_DB_URL') ?? Deno.env.get('DB_URL');
if (!DB_URL) throw new Error('SUPABASE_DB_URL is not set');

/* hrms is where the tables are; extensions is where Supabase keeps
   pgcrypto, and without it on the path crypt() and gen_salt() are not
   found and every password check fails. */
const sql = postgres(DB_URL, {
  max: 5, prepare: false,
  connection: { search_path: 'hrms, public, extensions' }
});

/* The key that signs session tokens.
 *
 * A guessable key means anybody can mint a session as the owner, so this
 * function will not start without a strong one, and it never invents a
 * default.
 *
 * The floor is hrms.app_secrets, where a migration had Postgres mint 256
 * random bits with gen_random_bytes. Reading that table needs the database
 * credentials, which already open every salary record in the workspace, so
 * keeping the key there gives an attacker nothing they did not have. If it
 * is missing the function stops dead.
 *
 * TOKEN_SECRET, if somebody sets one, does not replace that key - it is
 * mixed into it. Two reasons. It rotates every session on demand: change
 * the secret and yesterday's tokens stop verifying. And it cannot weaken
 * anything, because the result is a 256-bit HMAC however short or guessable
 * the typed value was. A person picking their company name as the secret is
 * the likeliest way this would have gone wrong, and mixing removes it.
 *
 * Read once, at boot, not per request. */
async function signingKey(): Promise<string> {
  const rows = await sql.unsafe(
    `select value from hrms.app_secrets where key = 'token_secret'`);
  const base = String((rows[0] as { value?: string } | undefined)?.value ?? '');
  if (base.length < 24) {
    throw new Error("No session signing key. Seed hrms.app_secrets with a long " +
                    "random 'token_secret' - the schema migration does this.");
  }
  const extra = Deno.env.get('TOKEN_SECRET') ?? '';
  if (!extra) return base;

  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(base),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k,
    new TextEncoder().encode('biscs-os/session-token/v1|' + extra));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const TOKEN_SECRET = await signingKey();

/* A separate, simpler key for biometric devices that push punches straight in
 * (eSSL "Push to Web API"). Stored in hrms.app_secrets like the signing key,
 * or set as the ESSL_PUSH_KEY env var. Empty means the push endpoint is shut.
 * It is not a session token: all it can ever do is add punches. */
async function esslPushKey(): Promise<string> {
  try {
    const rows = await sql.unsafe(
      `select value from hrms.app_secrets where key = 'essl_push_key'`);
    const v = String((rows[0] as { value?: string } | undefined)?.value ?? '');
    if (v) return v;
  } catch (_e) { /* row may not exist yet */ }
  return Deno.env.get('ESSL_PUSH_KEY') ?? '';
}
const ESSL_PUSH_KEY = await esslPushKey();

/* The one method the API asks of a database. postgres.js returns the rows
   directly; the API expects { rows }, as node-postgres gives. */
const db = {
  query: async (text: string, params: unknown[] = []) => {
    const rows = await sql.unsafe(text, params as never[]);
    return { rows };
  }
};

const enc = new TextEncoder();
const hmacKey = await crypto.subtle.importKey(
  'raw', enc.encode(TOKEN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

const handle = createRouter(db, {
  tokenSecret: TOKEN_SECRET,
  timezone: Deno.env.get('COMPANY_TZ') ?? 'Asia/Kolkata',
  sessionHours: 12,
  crypto: {
    hmac: async (_key: string, msg: string) => {
      const sig = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(msg));
      return [...new Uint8Array(sig)]
        .map(b => b.toString(16).padStart(2, '0')).join('');
    }
  }
});

/* The apps post from the Netlify site, so the browser asks permission first. */
const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOW_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

/* -------------------- eSSL "Push to Web API" endpoint --------------------
 * A biometric device (or eTimeTrackLite's push feature) POSTs new punches to
 *   .../functions/v1/api/push?key=THE_PUSH_KEY
 * and reads back a one-character status the way those devices expect:
 *   1 = saved, 0 = nothing saved (e.g. all duplicates), 2 = rejected / error.
 * The punch rows can be a bare array or wrapped in { data | logs | records |
 * rows | Table | ... }; field names are matched leniently by the same
 * normaliser the file import and LAN agent use, so UserId/EmployeeCode/PIN and
 * LogDate/PunchTime/AttDateTime all work. The raw body is logged (first 500
 * chars) so an unfamiliar shape can be read off the function logs and mapped.
 * ------------------------------------------------------------------------ */
function esslPickKey(req: Request, url: URL): string {
  const h = req.headers;
  const auth = h.get('authorization') || '';
  return (url.searchParams.get('key') || url.searchParams.get('apikey') ||
          h.get('x-api-key') || h.get('x-push-key') || h.get('push-key') ||
          (auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '') ||
          '').trim();
}
function esslRows(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    for (const k of ['data', 'Data', 'logs', 'Logs', 'records', 'Records',
                     'rows', 'Rows', 'punches', 'AttLogs', 'Table', 'table', 'result']) {
      if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
    }
    const keys = Object.keys(o).map(s => s.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (keys.some(k => ['empcode', 'employeecode', 'userid', 'usrid', 'pin',
                        'employeeid', 'empid', 'staffcode', 'code'].includes(k))) return [o];
  }
  return [];
}
async function esslPush(req: Request, url: URL): Promise<Response> {
  const reply = (code: number) => new Response(String(code),
    { status: 200, headers: { ...CORS, 'Content-Type': 'text/plain' } });
  try {
    if (!ESSL_PUSH_KEY) { console.log('essl-push: no key configured'); return reply(2); }
    if (esslPickKey(req, url) !== ESSL_PUSH_KEY) { console.log('essl-push: bad key'); return reply(2); }
    const text = await req.text();
    let body: unknown;
    try { body = JSON.parse(text); }
    catch (_e) { console.log('essl-push: non-JSON body:', text.slice(0, 300)); return reply(2); }
    console.log('essl-push received:', JSON.stringify(body).slice(0, 500));
    const rows = esslRows(body);
    if (!rows.length) { console.log('essl-push: no rows in body'); return reply(0); }
    // deno-lint-ignore no-explicit-any
    const res = await (handle as any).ingest(rows, 'essl-push');
    console.log('essl-push ingested:', JSON.stringify(res));
    return reply(res && (Number(res.added) > 0 || Number(res.days) > 0) ? 1 : 0);
  } catch (e) {
    console.log('essl-push error:', String((e as Error)?.message ?? e));
    return reply(2);
  }
}

/* The scheduled eSSL cloud pull: Postgres (pg_cron + pg_net) calls
     .../functions/v1/api/pull?key=THE_PUSH_KEY
   every few minutes; the server fetches the last two days from the eSSL
   cloud and stores any new punches. */
async function esslAutoPull(req: Request, url: URL): Promise<Response> {
  const json = (o: unknown) => new Response(JSON.stringify(o),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (!ESSL_PUSH_KEY || esslPickKey(req, url) !== ESSL_PUSH_KEY) return json({ ok: false, error: 'bad key' });
  try {
    // deno-lint-ignore no-explicit-any
    const res = await (handle as any).autoPull();
    console.log('essl-cloud pull:', JSON.stringify(res).slice(0, 400));
    return json({ ok: true, data: res });
  } catch (e) {
    console.log('essl-cloud pull error:', String((e as Error)?.message ?? e));
    return json({ ok: false, error: String((e as Error)?.message ?? e) });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  if (req.method === 'POST' && url.pathname.endsWith('/pull')) return await esslAutoPull(req, url);
  if (req.method === 'POST' &&
      (url.pathname.endsWith('/push') || url.searchParams.has('essl') || url.searchParams.has('push'))) {
    return await esslPush(req, url);
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST only' }),
      { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  let out;
  try {
    out = await handle(await req.json());
  } catch (e) {
    out = { ok: false, error: String((e as Error)?.message ?? e) };
  }
  /* Always 200 with { ok } inside, the way the Apps Script version answered:
     both front ends read the body, and a 4xx would have them show the
     browser's error instead of ours. */
  return new Response(JSON.stringify(out),
    { headers: { ...CORS, 'Content-Type': 'application/json' } });
});

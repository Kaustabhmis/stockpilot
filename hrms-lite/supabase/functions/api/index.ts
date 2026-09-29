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
 *   TOKEN_SECRET      yours - a long random string, used to sign sessions
 *                     (supabase secrets set TOKEN_SECRET="...")
 *   COMPANY_TZ        optional, defaults to Asia/Kolkata
 */

import postgres from 'npm:postgres@3.4.5';
import { createRouter } from './router.js';

const DB_URL = Deno.env.get('SUPABASE_DB_URL') ?? Deno.env.get('DB_URL');
if (!DB_URL) throw new Error('SUPABASE_DB_URL is not set');

const TOKEN_SECRET = Deno.env.get('TOKEN_SECRET');
if (!TOKEN_SECRET || TOKEN_SECRET.length < 24) {
  /* A guessable signing key means anybody can mint a session as the owner.
     Better to refuse to start than to run open. */
  throw new Error('TOKEN_SECRET is missing or too short - set a long random one');
}

/* hrms is where the tables are; extensions is where Supabase keeps
   pgcrypto, and without it on the path crypt() and gen_salt() are not
   found and every password check fails. */
const sql = postgres(DB_URL, {
  max: 5, prepare: false,
  connection: { search_path: 'hrms, public, extensions' }
});

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
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

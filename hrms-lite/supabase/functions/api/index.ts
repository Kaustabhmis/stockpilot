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

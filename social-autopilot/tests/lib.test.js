/**
 * Unit tests for the pure helpers: encryption, session tokens, cookie parsing,
 * Sheet value conversion and validation. Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.SESSION_SECRET = crypto.randomBytes(48).toString('base64url');

const { encrypt, decrypt } = await import('../netlify/functions/lib/crypto.js');
const { createSessionToken, verifySessionToken, parseCookies, requireAuth, SESSION_COOKIE } = await import(
  '../netlify/functions/lib/session.js'
);
const { serialize, toRecord } = await import('../netlify/functions/lib/sheets.js');
const { cleanFields } = await import('../netlify/functions/lib/validate.js');

test('encrypt/decrypt round-trips and uses a fresh IV each time', () => {
  const secret = 'EAAB-long-lived-token-value';
  const a = encrypt(secret);
  const b = encrypt(secret);
  assert.notEqual(a, b);
  assert.equal(decrypt(a), secret);
  assert.equal(decrypt(b), secret);
});

test('decrypt rejects a tampered payload', () => {
  const [iv, tag, data] = encrypt('token').split('.');
  const flipped = Buffer.from(data, 'base64url');
  flipped[0] ^= 0xff;
  assert.throws(() => decrypt([iv, tag, flipped.toString('base64url')].join('.')));
});

test('session token verifies, and fails when expired or altered', () => {
  const now = Date.now();
  const token = createSessionToken(now);
  assert.equal(verifySessionToken(token, now + 1000), true);
  assert.equal(verifySessionToken(token, now + 31 * 24 * 3600 * 1000), false);
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'owner', exp: now + 1e12 })).toString('base64url');
  assert.equal(verifySessionToken(`${forged}.${sig}`, now), false);
  assert.equal(verifySessionToken(`${payload}.bad`, now), false);
  assert.equal(verifySessionToken(undefined, now), false);
});

test('requireAuth lets a valid cookie through and returns 401 otherwise', async () => {
  const token = createSessionToken();
  const ok = new Request('https://x.test/api/data/Posts', { headers: { cookie: `other=1; ${SESSION_COOKIE}=${token}` } });
  assert.equal(requireAuth(ok), null);
  const denied = requireAuth(new Request('https://x.test/api/data/Posts'));
  assert.equal(denied.status, 401);
});

test('parseCookies reads every cookie pair', () => {
  const req = new Request('https://x.test', { headers: { cookie: 'a=1; b=two=2 ; c=' } });
  assert.deepEqual(parseCookies(req), { a: '1', b: 'two=2', c: '' });
});

test('serialize and toRecord convert booleans and JSON columns', () => {
  assert.equal(serialize(true), 'TRUE');
  assert.equal(serialize(false), 'FALSE');
  assert.equal(serialize(undefined), '');
  assert.equal(serialize(['/media/a.jpg']), '["/media/a.jpg"]');
  const record = toRecord({ _row: 2, id: 'x', active: 'TRUE', media_urls: '["/media/a.jpg"]', video_plan: '' });
  assert.deepEqual(record, { id: 'x', active: true, media_urls: ['/media/a.jpg'], video_plan: null });
});

test('cleanFields keeps known columns, drops id and unknown keys, and rejects bad values', () => {
  const clean = cleanFields('Posts', { id: 'hack', master_text: 'Hello', evil: 1, status: 'draft' });
  assert.deepEqual(clean, { master_text: 'Hello', status: 'draft' });
  assert.throws(() => cleanFields('Posts', { status: 'deleted' }), /status must be one of/);
  assert.throws(() => cleanFields('Posts', { media_urls: ['https://evil.test/x'.repeat(40)] }), /media_urls/);
  assert.throws(() => cleanFields('Posts', { media_urls: ['javascript:alert(1)'] }), /media_urls/);
  assert.throws(() => cleanFields('Targets', { caption: 'x'.repeat(63207) }), /caption is longer/);
});

import { env } from '../../src/lib/config.js';
import { safeEquals } from '../../src/lib/util.js';
import { hmacHex, settlePayment } from '../../src/routes/money.js';

/**
 * Razorpay webhook.
 *
 * THIS IS THE THING APPS SCRIPT COULD NOT DO. Apps Script's doPost exposes no
 * request headers, so X-Razorpay-Signature was unreadable and the webhook body
 * had to be treated as an unauthenticated hint. Here the header is available, so
 * the payload is authenticated properly with the webhook secret before anything
 * is acted on.
 *
 * Set RAZORPAY_WEBHOOK_SECRET to the secret configured in the Razorpay
 * dashboard, and point the dashboard at /webhooks/razorpay.
 */
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ ok: false }) };
  }

  const secret = env.razorpayWebhookSecret();
  if (!secret) {
    console.error('webhook: RAZORPAY_WEBHOOK_SECRET is not set — refusing to process');
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ ok: false, error: 'not configured' }) };
  }

  // The signature covers the exact bytes Razorpay sent, so verify before any
  // parsing and never re-serialise the body first.
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const signature = event.headers['x-razorpay-signature']
                 || event.headers['X-Razorpay-Signature'] || '';

  if (!signature || !safeEquals(hmacHex(raw, secret), signature)) {
    // 401 rather than 200: a genuine Razorpay delivery always signs correctly,
    // so an unsigned request is either misconfiguration or forgery.
    console.warn('webhook: signature rejected');
    return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ ok: false, error: 'bad signature' }) };
  }

  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    // A parse failure will never succeed on retry, so acknowledge it.
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: false, error: 'unparseable' }) };
  }

  const entity = payload?.payload?.payment?.entity;
  if (!entity?.order_id || !entity?.id) {
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true, ignored: 'no payment entity' }) };
  }

  try {
    // settlePayment re-fetches the payment from Razorpay and does its whole
    // read-check-write under the spreadsheet lock, so a duplicated delivery —
    // or this webhook racing the browser callback — cannot grant twice.
    const result = JSON.parse((await settlePayment(entity.order_id, entity.id, true)).body);
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: result.ok === true, event: payload.event || '' })
    };
  } catch (err) {
    console.error('webhook: settlement failed', err);
    // 500 asks Razorpay to retry, which is exactly what we want for a transient
    // fault — the Sheets quota being briefly exhausted, or the lock being held.
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ ok: false }) };
  }
};

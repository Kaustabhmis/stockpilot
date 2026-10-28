import { createHmac, timingSafeEqual } from 'node:crypto';

// Unsubscribe links are signed so only the email we sent them can be opted out.
export function signUnsubscribe(email, secret) {
  return createHmac('sha256', secret).update(email.toLowerCase()).digest('base64url');
}

export function verifyUnsubscribe(email, token, secret) {
  const expected = Buffer.from(signUnsubscribe(email, secret));
  const given = Buffer.from(String(token));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function unsubscribeUrl(baseUrl, email, secret) {
  const token = signUnsubscribe(email, secret);
  return `${baseUrl}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
}

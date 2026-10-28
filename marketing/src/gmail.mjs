// Sends mail through the Gmail API with an OAuth refresh token.
// Required env: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_FROM.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

let cached = { token: null, expiresAt: 0 };

async function accessToken(env) {
  if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Gmail token refresh failed: ${res.status}`);
  const data = await res.json();
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

// Encode a plain-text + HTML message as a base64url RFC 2822 string.
export function buildRawMessage({ from, to, subject, text, html, unsubscribeUrl }) {
  const boundary = `mp_${Math.random().toString(36).slice(2)}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `List-Unsubscribe: <${unsubscribeUrl}>`,
    'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join('\r\n');
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    text,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    html,
    `--${boundary}--`,
  ].join('\r\n');
  return Buffer.from(`${headers}\r\n\r\n${body}`).toString('base64url');
}

export async function sendEmail(message, env = process.env) {
  const token = await accessToken(env);
  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: buildRawMessage({ ...message, from: env.GMAIL_FROM }) }),
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${res.status} ${await res.text()}`);
  return res.json();
}

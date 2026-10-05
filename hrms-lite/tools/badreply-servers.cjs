/* Three ways a workspace address can answer with something that is not JSON.
   CORS headers on purpose: Apps Script sends them, so the browser lets the
   reply through and the app gets to read it. Without them the browser blocks
   it first and we would be testing CORS, not the message. */
const http = require('http');
const html = (code, body) => http.createServer((q, r) => {
  const h = { 'content-type': 'text/html', 'access-control-allow-origin': '*',
              'access-control-allow-headers': '*' };
  if (q.method === 'OPTIONS') { r.writeHead(204, h); return r.end(); }
  r.writeHead(code, h); r.end(body);
});
html(200, '<!DOCTYPE html><html><head><title>Sign in - Google Accounts</title></head>' +
          '<body>Sign in to continue to accounts.google.com</body></html>').listen(8111);
html(404, '<!DOCTYPE html><html><body>Sorry, unable to open the file at this time.</body></html>').listen(8112);
html(500, '<!DOCTYPE html><html><body>Script error</body></html>').listen(8113);
console.log('bad-reply servers with CORS on 8111-8113');

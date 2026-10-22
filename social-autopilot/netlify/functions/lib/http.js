/**
 * Shared HTTP helpers for the Netlify functions.
 */

/** An error whose message is safe to show to the browser. */
export class HttpError extends Error {
  /**
   * @param {number} status HTTP status to return
   * @param {string} message Human-readable message
   */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * JSON response. API responses are never cached.
 * @param {unknown} body
 * @param {number} [status=200]
 * @param {Record<string, string>} [headers]
 * @returns {Response}
 */
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/**
 * Error response in the shape `{ error }` that the browser shows as a toast.
 * @param {number} status
 * @param {string} message
 * @param {Record<string, string>} [headers]
 * @returns {Response}
 */
export function errorResponse(status, message, headers = {}) {
  return json({ error: message }, status, headers);
}

/**
 * Reads a JSON object from the request body.
 * @param {Request} req
 * @param {number} [maxBytes=256 KiB]
 * @returns {Promise<Record<string, any>>}
 */
export async function readJson(req, maxBytes = 256 * 1024) {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request body is too large');
  if (!text) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
  return parsed;
}

/**
 * Wraps a function handler so that HttpError becomes its status and message, and
 * anything else is logged and returned as a generic 500 (no internals leak to the browser).
 * @param {(req: Request, context: any) => Promise<Response>} handler
 */
export function withErrors(handler) {
  return async (req, context) => {
    try {
      return await handler(req, context);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.status, err.message);
      console.error(err);
      return errorResponse(500, 'Something went wrong on the server');
    }
  };
}

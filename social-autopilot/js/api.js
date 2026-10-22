/**
 * Fetch wrapper for the /api/* functions. Sends the session cookie, parses JSON,
 * and turns every failure into an ApiError with a message ready for a toast.
 */

export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status HTTP status, 0 for network failures
   */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Calls the API.
 * @param {string} path e.g. `/api/data/Posts`
 * @param {{ method?: string, body?: object | Blob, headers?: Record<string, string> }} [options]
 *   Objects are sent as JSON. A Blob is sent as the raw body (used for image uploads).
 * @returns {Promise<any>} parsed JSON, or null for 204 responses
 */
export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const init = { method, credentials: 'same-origin', headers: { ...headers } };
  if (body instanceof Blob) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError('Network error. Check your connection and try again.', 0);
  }

  const onLoginPage = location.pathname.endsWith('/login.html');
  if (res.status === 401 && !onLoginPage) {
    location.href = `login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    throw new ApiError('Please log in again', 401);
  }
  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  return data;
}

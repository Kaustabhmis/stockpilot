/**
 * Input validation for values written to the Sheet. Unknown columns are dropped silently,
 * known columns are checked and every failure is a 400 with the column name.
 */
import { MEDIA_TYPES, PLATFORMS, POST_STATUSES, SHEET_SCHEMA } from './config.js';
import { HttpError } from './http.js';

const ENUMS = { status: POST_STATUSES, media_type: MEDIA_TYPES, platform: PLATFORMS };
const DATE_COLUMNS = new Set(['scheduled_at', 'published_at', 'connected_at', 'expires_at', 'created_at', 'updated_at']);
const BOOLEAN_COLUMNS = new Set(['auto_approve', 'active']);
const TEXT_LIMITS = { master_text: 20000, caption: 63206, error: 2000 };
const DEFAULT_TEXT_LIMIT = 500;
const MAX_MEDIA = 10;

/** @param {string} column @param {string} message */
const invalid = (column, message) => new HttpError(400, `${column} ${message}`);

/**
 * @param {string} column
 * @param {unknown} value
 * @returns {unknown}
 */
function checkField(column, value) {
  if (BOOLEAN_COLUMNS.has(column)) return Boolean(value);
  if (value === null || value === undefined) return '';

  if (column === 'media_urls') {
    if (!Array.isArray(value) || value.length > MAX_MEDIA) throw invalid(column, `must be a list of up to ${MAX_MEDIA} URLs`);
    for (const url of value) {
      if (typeof url !== 'string' || url.length > 500 || !(url.startsWith('/media/') || url.startsWith('https://'))) {
        throw invalid(column, 'must contain only /media/ paths or https:// URLs');
      }
    }
    return value;
  }
  if (column === 'video_plan') {
    if (JSON.stringify(value).length > 20000) throw invalid(column, 'is too large');
    return value;
  }
  if (typeof value === 'object') throw invalid(column, 'must be a text value');

  const text = String(value);
  if (ENUMS[column] && !ENUMS[column].includes(text)) throw invalid(column, `must be one of: ${ENUMS[column].join(', ')}`);
  if (DATE_COLUMNS.has(column) && text && Number.isNaN(Date.parse(text))) throw invalid(column, 'must be an ISO 8601 date');
  const limit = TEXT_LIMITS[column] ?? DEFAULT_TEXT_LIMIT;
  if (text.length > limit) throw invalid(column, `is longer than ${limit} characters`);
  return text;
}

/**
 * Keeps the known columns of `table` that appear in `input`, checks each one, and returns the result.
 * The `id` column is never taken from the client; the server assigns it.
 * @param {keyof typeof SHEET_SCHEMA} table
 * @param {Record<string, unknown>} input
 * @returns {Record<string, unknown>}
 */
export function cleanFields(table, input) {
  const out = {};
  for (const column of SHEET_SCHEMA[table]) {
    if (column === 'id' || !Object.hasOwn(input, column)) continue;
    out[column] = checkField(column, input[column]);
  }
  return out;
}

/**
 * Throws a 400 unless `value` is a non-empty string.
 * @param {unknown} value
 * @param {string} name
 * @returns {string}
 */
export function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${name} is required`);
  return value;
}

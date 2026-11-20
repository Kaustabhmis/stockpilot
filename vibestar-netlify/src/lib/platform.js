/**
 * Platform primitives, picked at load time.
 *
 * The Apps Script bundler inlines platform-gas.js and never runs this file, but
 * the runtime check matters anyway: it is what lets the test suite exercise the
 * Apps Script implementations under a mocked Utilities, so the same route spec
 * can be run against all three targets.
 */
const isAppsScript = typeof globalThis.SpreadsheetApp !== 'undefined';

const impl = isAppsScript
  ? await import('./platform-gas.js')
  : await import('./platform-node.js');

export const {
  PLATFORM, randomHex, base64Encode, base64DecodeToBytes, byteLength,
  hmacSha256Hex, sha256Hex, safeEquals, envGet, sleep,
  SUPPORTED_ALGOS, scryptHex, pbkdf2Hex, presentPrivateMedia
} = impl;

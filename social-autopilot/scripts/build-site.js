#!/usr/bin/env node
/**
 * Copies the browser files (pages, CSS, JS, assets) into dist/ for deployment.
 * Only the allow-listed paths are copied, so .env, scripts and function source stay private.
 */
import { cp, mkdir, rm, access } from 'node:fs/promises';

const PUBLIC_PATHS = [
  'login.html',
  'index.html',
  'compose.html',
  'accounts.html',
  'calendar.html',
  'settings.html',
  'css',
  'js',
  'assets',
];

await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const path of PUBLIC_PATHS) {
  try {
    await access(path);
  } catch {
    continue; // pages added in later phases are copied once they exist
  }
  await cp(path, `dist/${path}`, { recursive: true });
}
console.log(`Static site copied to dist/ (${PUBLIC_PATHS.length} entries checked).`);

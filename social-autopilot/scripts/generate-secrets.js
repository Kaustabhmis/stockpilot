#!/usr/bin/env node
/**
 * Prints fresh values for SESSION_SECRET and TOKEN_ENCRYPTION_KEY.
 * Copy them into .env (locally) and into Netlify with netlify env:set.
 * Run with:  npm run secrets
 */
import crypto from 'node:crypto';

console.log(`SESSION_SECRET=${crypto.randomBytes(48).toString('base64url')}`);
console.log(`TOKEN_ENCRYPTION_KEY=${crypto.randomBytes(32).toString('base64')}`);

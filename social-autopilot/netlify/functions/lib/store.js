/**
 * Netlify Blobs stores. Strong consistency so a read right after a write always sees it.
 * Docs: https://docs.netlify.com/blobs/overview/
 */
import { getStore } from '@netlify/blobs';
import { MEDIA_STORE, RATE_LIMIT_STORE } from './config.js';

/** @returns {import('@netlify/blobs').Store} images and videos served from /media/ */
export const mediaStore = () => getStore({ name: MEDIA_STORE, consistency: 'strong' });

/** @returns {import('@netlify/blobs').Store} failed-login counters */
export const rateLimitStore = () => getStore({ name: RATE_LIMIT_STORE, consistency: 'strong' });

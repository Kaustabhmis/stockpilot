import { transact } from '../../src/lib/store.js';
import { markExpiredPosts } from '../../src/routes/content.js';
import { pruneNotifications } from '../../src/routes/social.js';
import { sendExpiryReminders } from '../../src/routes/money.js';

/**
 * Scheduled daily by netlify.toml, replacing the Apps Script time-based trigger.
 *
 * The whole sweep runs against ONE store inside ONE lock, so the entire nightly
 * job costs a single read and a single write. That matters more here than
 * anywhere else in the app: this is the one place that touches every table at
 * once, and doing it as separate passes would spend a serious share of the
 * daily quota on housekeeping.
 *
 * Note that expiry here is only bookkeeping. Readers already treat a post whose
 * 30-day window has closed as expired by comparing timestamps, so if this job
 * fails to run, nothing becomes visible that should not be — the stored status
 * just lags until the next successful run.
 */
export const handler = async () => {
  const started = Date.now();

  try {
    const result = await transact(
      ['Posts', 'Subscriptions', 'Users', 'Notifications'],
      async (store) => {
        const now = Date.now();

        // Each step is independent, so one failure must not skip the others.
        const out = { expired: 0, expiringReminders: 0, lapsedReminders: 0, prunedNotifications: 0 };
        const failures = [];

        const steps = [
          ['expired', () => { out.expired = markExpiredPosts(store, now); }],
          ['reminders', () => {
            const sent = sendExpiryReminders(store, now);
            out.expiringReminders = sent.expiringReminders;
            out.lapsedReminders = sent.lapsedReminders;
          }],
          ['prune', () => { out.prunedNotifications = pruneNotifications(store, now); }]
        ];

        for (const [name, run] of steps) {
          try { run(); } catch (err) {
            failures.push(name);
            console.error(`maintenance:${name}`, err);
          }
        }

        return { ...out, failures };
      }
    );

    console.log('maintenance complete', { ...result, ms: Date.now() - started });
    return {
      statusCode: result.failures.length ? 500 : 200,
      body: JSON.stringify({ ok: !result.failures.length, ...result })
    };
  } catch (err) {
    // A failure to reach the spreadsheet at all, or to take the lock.
    console.error('maintenance: could not run', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err.message || err) }) };
  }
};

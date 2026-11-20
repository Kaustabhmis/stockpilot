/* eslint-disable no-undef */
import * as auth from '../routes/auth.js';
import * as content from '../routes/content.js';
import * as social from '../routes/social.js';
import * as money from '../routes/money.js';
import * as admin from '../routes/admin.js';
import * as media from '../routes/media.js';
import { openStore, createSpreadsheetTabs, transact } from '../lib/store-gas.js';
import { resolveUser } from '../lib/auth.js';
import { isAdminUser } from '../lib/util.js';
import { pruneSessions } from './kv-gas.js';
import { markExpiredPosts } from '../routes/content.js';
import { pruneNotifications } from '../routes/social.js';
import { sendExpiryReminders } from '../routes/money.js';

/**
 * APPS SCRIPT ENTRY POINTS
 *
 * The Netlify build routes over HTTP; here the client calls in through
 * google.script.run, which hands JavaScript values straight across. The routing
 * table is the same shape and carries the same two declarations per route —
 * authorisation level, and which tables to load — so authorisation stays a
 * property of the table rather than something each handler remembers.
 */
const ROUTES = {
  signUp:                    { level: 'PUBLIC', fn: auth.signUp,            tables: [] },
  logIn:                     { level: 'PUBLIC', fn: auth.logIn,             tables: ['Users'] },
  logOut:                    { level: 'PUBLIC', fn: auth.logOut,            tables: [] },
  getSharedPost:             { level: 'PUBLIC', fn: content.getSharedPost,  tables: ['Posts', 'Users', 'Likes', 'Comments'] },

  resumeSession:             { level: 'USER', fn: auth.resumeSession,       tables: [] },
  getProfile:                { level: 'USER', fn: auth.getProfile,          tables: ['Posts', 'Follows', 'Subscriptions', 'Likes', 'Comments'] },
  updateProfile:             { level: 'USER', fn: auth.updateProfile,       tables: [] },
  changePassword:            { level: 'USER', fn: auth.changePassword,      tables: [] },
  getChatThemes:             { level: 'USER', fn: auth.getChatThemes,       tables: [] },
  setChatTheme:              { level: 'USER', fn: auth.setChatTheme,        tables: [] },

  getPublicFeed:             { level: 'USER', fn: content.getPublicFeed,    tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'] },
  getCreators:               { level: 'USER', fn: content.getCreators,      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions'] },
  search:                    { level: 'USER', fn: content.search,           tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'] },
  toggleSave:                { level: 'USER', fn: content.toggleSave,       tables: ['Posts', 'Saves', 'Subscriptions'] },
  getSavedPosts:             { level: 'USER', fn: content.getSavedPosts,    tables: ['Posts', 'Saves', 'Likes', 'Comments', 'Subscriptions'] },
  createPost:                { level: 'USER', fn: content.createPost,       tables: ['Posts'] },
  deletePost:                { level: 'USER', fn: content.deletePost,       tables: ['Posts'] },
  toggleLike:                { level: 'USER', fn: content.toggleLike,       tables: ['Posts', 'Likes', 'Subscriptions', 'Notifications'] },
  addComment:                { level: 'USER', fn: content.addComment,       tables: ['Posts', 'Comments', 'Subscriptions', 'Notifications'] },
  getComments:               { level: 'USER', fn: content.getComments,      tables: ['Posts', 'Comments', 'Subscriptions'] },
  deleteComment:             { level: 'USER', fn: content.deleteComment,    tables: ['Posts', 'Comments'] },
  getShareLink:              { level: 'USER', fn: content.getShareLink,     tables: ['Posts'] },
  getCreatorGallery:         { level: 'USER', fn: content.getCreatorGallery, tables: ['Posts', 'Likes', 'Comments', 'Subscriptions', 'Saves'] },

  followUser:                { level: 'USER', fn: social.followUser,        tables: [] },
  unfollowUser:              { level: 'USER', fn: social.unfollowUser,      tables: ['Follows'] },
  getFollowList:             { level: 'USER', fn: social.getFollowList,     tables: ['Follows'] },
  getConversations:          { level: 'USER', fn: social.getConversations,  tables: ['Subscriptions', 'Messages'] },
  getChatMessages:           { level: 'USER', fn: social.getChatMessages,   tables: ['Subscriptions', 'Messages', 'Notifications'] },
  sendMessage:               { level: 'USER', fn: social.sendMessage,       tables: ['Subscriptions', 'Messages', 'Notifications'] },
  getNotifications:          { level: 'USER', fn: social.getNotifications,  tables: ['Notifications'] },
  markNotificationsRead:     { level: 'USER', fn: social.markNotificationsRead, tables: ['Notifications'] },

  getPaymentConfig:          { level: 'USER', fn: money.getPaymentConfig,   tables: [] },
  createPaymentOrder:        { level: 'USER', fn: money.createPaymentOrder, tables: ['Payments'] },
  confirmPayment:            { level: 'USER', fn: money.confirmPayment,     tables: ['Payments'] },
  processSubscription:       { level: 'USER', fn: money.processSubscription, tables: [] },
  cancelSubscription:        { level: 'USER', fn: money.cancelSubscription, tables: ['Subscriptions'] },
  getMyPayments:             { level: 'USER', fn: money.getMyPayments,      tables: ['Payments'] },
  getCreatorEarnings:        { level: 'USER', fn: money.getCreatorEarnings, tables: ['Payments'] },
  getVerificationState:      { level: 'USER', fn: money.getVerificationState, tables: ['VerificationRequests'] },
  submitVerificationRequest: { level: 'USER', fn: money.submitVerificationRequest, tables: [] },
  cancelVerificationRequest: { level: 'USER', fn: money.cancelVerificationRequest, tables: ['VerificationRequests'] },

  uploadMedia:               { level: 'USER', fn: media.uploadMedia,        tables: ['Media'] },
  getMediaLimits:            { level: 'USER', fn: media.getMediaLimits,     tables: [] },
  deleteMedia:               { level: 'USER', fn: media.deleteMedia,        tables: ['Media'] },

  adminGetOverview:          { level: 'ADMIN', fn: admin.adminGetOverview,  tables: ['Posts', 'Subscriptions', 'Messages', 'Follows', 'Likes', 'Comments', 'Notifications', 'Media', 'VerificationRequests'] },
  adminGetRevenue:           { level: 'ADMIN', fn: admin.adminGetRevenue,   tables: ['Payments'] },
  adminListUsers:            { level: 'ADMIN', fn: admin.adminListUsers,    tables: ['Posts', 'Follows', 'Subscriptions'] },
  adminSetUserStatus:        { level: 'ADMIN', fn: admin.adminSetUserStatus, tables: [] },
  adminSetUserRole:          { level: 'ADMIN', fn: admin.adminSetUserRole,  tables: [] },
  adminSetUserAdmin:         { level: 'ADMIN', fn: admin.adminSetUserAdmin, tables: [] },
  adminListPosts:            { level: 'ADMIN', fn: admin.adminListPosts,    tables: ['Posts'] },
  adminSetPostStatus:        { level: 'ADMIN', fn: admin.adminSetPostStatus, tables: ['Posts'] },
  adminListPayments:         { level: 'ADMIN', fn: admin.adminListPayments, tables: ['Payments'] },
  adminListMedia:            { level: 'ADMIN', fn: admin.adminListMedia,    tables: ['Media'] },
  listVerificationRequests:  { level: 'ADMIN', fn: admin.listVerificationRequests, tables: ['VerificationRequests'] },
  reviewVerificationRequest: { level: 'ADMIN', fn: admin.reviewVerificationRequest, tables: [] },
  setVerifiedFollowerCount:  { level: 'ADMIN', fn: admin.setVerifiedFollowerCount, tables: [] }
};

/**
 * The single function the client calls, through google.script.run.
 *
 * Returns a JSON STRING rather than an object on purpose: google.script.run
 * serialises return values with its own rules, which drop undefined, convert
 * Dates and choke on anything non-plain. A string crosses the bridge untouched
 * and the client parses it, so the payload the browser sees is byte-identical to
 * the one the Netlify deployment produces.
 */
async function apiCall(action, payload, token) {
  const route = ROUTES[action];
  if (!route) return JSON.stringify({ ok: false, error: 'Not found' });

  const body = payload && typeof payload === 'object' ? payload : {};

  try {
    const tables = [...route.tables];
    if (route.level !== 'PUBLIC' || token) tables.push('Users');
    const store = await openStore(tables);

    let user = null;
    if (route.level !== 'PUBLIC') {
      user = await resolveUser(store, token);
      if (!user) return JSON.stringify({ ok: false, error: 'SESSION_EXPIRED' });
      if (route.level === 'ADMIN' && !isAdminUser(user)) {
        return JSON.stringify({ ok: false, error: 'FORBIDDEN' });
      }
    } else if (token) {
      user = await resolveUser(store, token);
    }

    const result = await route.fn({ store, user, body, token, event: { headers: {} } });
    await store.flush();
    return result.body;
  } catch (err) {
    // Logged in full for the operator; the client gets something generic, so a
    // stack trace cannot disclose the spreadsheet's structure.
    console.error(`apiCall:${action}`, err && err.stack ? err.stack : err);
    const message = String((err && err.message) || '');

    // Two failures are worth naming because the user can act on them.
    if (/busy/i.test(message)) {
      return JSON.stringify({ ok: false, error: 'The app is briefly busy. Try again in a moment.' });
    }
    if (/password format/i.test(message)) {
      return JSON.stringify({ ok: false, error: message });
    }
    return JSON.stringify({ ok: false, error: 'Something went wrong.' });
  }
}

/** Serves the app. */
function doGet(e) {
  const parameter = (e && e.parameter) || {};

  // /exec?p=<postId> is the share link. Rendered by the same page, which reads
  // the parameter and asks for the post — there is no server-rendered Open Graph
  // card here, because Apps Script serves the page inside a googleusercontent
  // iframe that crawlers cannot read. That is a real limitation of this target;
  // the Netlify deployment does render real preview cards.
  const template = HtmlService.createTemplateFromFile('Index');
  template.sharedPostId = parameter.p ? String(parameter.p) : '';

  return template.evaluate()
    .setTitle('VibeStar')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Razorpay webhook target.
 *
 * NOTE, and it matters: Apps Script's doPost exposes no request headers, so
 * X-Razorpay-Signature cannot be read and therefore cannot be verified. The body
 * is treated as an untrusted hint — it is used only to learn WHICH payment to
 * ask about, and the payment is then re-fetched from Razorpay before anything is
 * granted. The Netlify deployment verifies the signature properly; if payments
 * matter to you, run that one.
 */
function doPost(e) {
  const output = (body) => ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);

  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const entity = payload && payload.payload && payload.payload.payment
      && payload.payload.payment.entity;

    if (!entity || !entity.order_id || !entity.id) return output({ ok: true, ignored: true });

    // settlePayment re-fetches from Razorpay and settles under LockService, so a
    // forged body cannot grant anything and a duplicate delivery cannot grant
    // twice.
    const settled = JSON.parse(settlePaymentSync(entity.order_id, entity.id, false));
    return output({ ok: settled.ok === true });
  } catch (err) {
    console.error('doPost', err);
    return output({ ok: false });
  }
}

/** Lets Index.html pull in shared partials if it grows. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ------------------------------------------------------------ operations
/** Run once from the editor: creates every tab, and grants the OAuth scopes. */
function setUpSpreadsheet() {
  const message = createSpreadsheetTabs();

  // Touching DriveApp here is deliberate. Apps Script derives its OAuth scopes
  // from the code it can see, and only prompts on an editor run — so without
  // this, the first upload would fail with a permission error for a user who
  // cannot grant it themselves.
  const folder = DriveApp.getRootFolder();
  const probe = folder.createFile(
    Utilities.newBlob('vibestar authorisation probe', 'text/plain', 'vibestar-auth-check.txt'));
  probe.setTrashed(true);

  return `${message} Drive access granted.`;
}

/** Daily trigger: expiry, reminders, pruning. Install with installTrigger(). */
async function runMaintenance() {
  const result = await transact(
    ['Posts', 'Subscriptions', 'Users', 'Notifications'],
    async (store) => {
      const now = Date.now();
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
        try { run(); } catch (err) { failures.push(name); console.error(`maintenance:${name}`, err); }
      }
      return { ...out, failures };
    }
  );

  result.prunedSessions = pruneSessions();
  console.log('maintenance complete', JSON.stringify(result));
  return result;
}

/** Installs the nightly trigger. Run once from the editor. */
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'runMaintenance')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('runMaintenance').timeBased().atHour(3).everyDays(1).create();
  return 'Nightly maintenance installed for ~3am.';
}

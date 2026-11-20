import * as auth from '../../src/routes/auth.js';
import * as content from '../../src/routes/content.js';
import * as social from '../../src/routes/social.js';
import * as money from '../../src/routes/money.js';
import * as admin from '../../src/routes/admin.js';
import * as media from '../../src/routes/media.js';
import { openStore } from '../../src/lib/store.js';
import { resolveUser, tokenFrom, SessionExpired, Forbidden } from '../../src/lib/auth.js';
import { HTTP, isAdminUser } from '../../src/lib/util.js';

/**
 * ONE FUNCTION, ONE ROUTER.
 *
 * Each Netlify Function pays its own cold start, so a single router keeps one
 * warm container for the whole API surface.
 *
 * Authorisation is a property of this table rather than something each handler
 * has to remember:
 *   PUBLIC — no session required
 *   USER   — any active session
 *   ADMIN  — active session with admin rights
 *
 * `tables` is the second half of that idea. Google Sheets bills per API call,
 * not per row, and allows only about 300 reads a minute for the whole project.
 * Declaring a route's tables here means the request loads all of them in ONE
 * batched call before the handler runs, and writes everything back in one more
 * on the way out — however many tables the handler happens to touch.
 */
const ROUTES = {
  // ------------------------------------------------------------- public
  signUp:                    { level: 'PUBLIC', fn: auth.signUp,            tables: [] },
  logIn:                     { level: 'PUBLIC', fn: auth.logIn,             tables: ['Users'] },
  logOut:                    { level: 'PUBLIC', fn: auth.logOut,            tables: [] },
  getSharedPost:             { level: 'PUBLIC', fn: content.getSharedPost,  tables: ['Posts', 'Users', 'Likes', 'Comments'] },

  // --------------------------------------------------------------- user
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

  // -------------------------------------------------------------- admin
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

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: JSON_HEADERS };
  if (event.httpMethod !== 'POST') {
    return { ...HTTP.badRequest('Use POST.'), headers: JSON_HEADERS };
  }

  // /api/<action> — the trailing segment names the route.
  const action = (event.path || '').split('/').filter(Boolean).pop();
  const route = ROUTES[action];
  if (!route) return { ...HTTP.notFound(), headers: JSON_HEADERS };

  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body);
    } catch {
      return { ...HTTP.badRequest('Malformed JSON body.'), headers: JSON_HEADERS };
    }
  }

  const token = tokenFrom(event, body);

  try {
    // Users comes along for every authenticated route because resolving the
    // caller needs it, and the handler almost always does too.
    const needsUser = route.level !== 'PUBLIC' || Boolean(token);
    const tables = [...route.tables, ...(needsUser || route.tables.length ? ['Users'] : [])];
    const store = await openStore(tables);

    let user = null;
    if (route.level !== 'PUBLIC') {
      user = await resolveUser(store, token);
      if (!user) throw new SessionExpired();
      if (route.level === 'ADMIN' && !isAdminUser(user)) throw new Forbidden();
    } else if (token) {
      // Public routes still resolve an optional session, so a signed-in viewer
      // gets their own state (liked, following) on shared content.
      user = await resolveUser(store, token);
    }

    const result = await route.fn({ event, body, token, user, store });

    // One write for everything the handler changed. Handlers that had to take
    // the spreadsheet lock will have flushed their own store already; this
    // flushes whatever is left on the request's store, and is a no-op when the
    // handler only read.
    await store.flush();

    return { ...result, headers: { ...JSON_HEADERS, ...(result.headers || {}) } };
  } catch (err) {
    if (err instanceof SessionExpired || err?.message === 'SESSION_EXPIRED') {
      return { ...HTTP.unauthorized(), headers: JSON_HEADERS };
    }
    if (err instanceof Forbidden || err?.message === 'FORBIDDEN') {
      return { ...HTTP.forbidden(), headers: JSON_HEADERS };
    }

    // Log the detail, return something generic: a stack trace or an API error
    // can disclose the spreadsheet id and the shape of the data.
    console.error(`api:${action}`, err);

    // Quota exhaustion is the one failure worth naming, because the operator
    // can act on it and the user should be told to simply try again.
    if (err?.rateLimited || /busy|quota/i.test(String(err?.message))) {
      return {
        ...HTTP.serverError('The app is briefly at its Google Sheets rate limit. Try again in a moment.'),
        headers: JSON_HEADERS
      };
    }
    return { ...HTTP.serverError(), headers: JSON_HEADERS };
  }
};

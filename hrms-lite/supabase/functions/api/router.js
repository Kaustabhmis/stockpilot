/* One endpoint, the same contract the sheet version answered.
 *
 * { action, payload, token }  ->  { ok:true, data, rev }  |  { ok:false, error }
 */

import { createApi, AUTH_PREFIX } from './hrms.js';
import { createActions } from './actions.js';

export function createRouter(db, opts = {}) {
  const api = createApi(db, opts);
  const act = createActions(api, db, opts);

  async function route(action, p, caller, dirty) {
    switch (action) {
      case 'ping':          return { service: 'BISCS OS', store: 'postgres' };
      case 'rev':           return api.currentRevision(caller);
      case 'login':         return act.login(p.email, p.password, p.months);
      case 'bootstrap':     return act.bootstrap(caller, p && p.months);

      case 'list':          return api.listSheet(p.sheet);
      case 'save':          return api.upsertRow(p.sheet, p.row, dirty);
      case 'saveMany':      return api.upsertMany(p.sheet, p.rows, dirty);
      case 'remove':        return api.removeRow(p.sheet, p.id, dirty);
      case 'removeMany':    return api.removeMany(p.sheet, p.ids, dirty);
      case 'saveSettings':  return api.saveSettings(p.settings, dirty);

      case 'listUsers':     return act.listUsers();
      case 'saveUser':      return act.saveUser(p.user, caller, dirty);
      case 'removeUser':    return act.removeUser(p.email, caller, dirty);
      case 'changePassword':return act.changePassword(caller.email || p.email,
                                                      p.oldPassword, p.newPassword);
      case 'makeLogins':    return act.backfillAccounts(dirty);

      case 'myMonth':       return act.myMonth(caller && caller.emp_code, p.month);
      case 'monthAtt':      return act.monthAtt(p.month);

      case 'punchState':    return act.punchState(
                              api.isHrOrAbove(caller.role) && p.emp_code
                                ? p.emp_code : caller.emp_code);
      case 'webPunch':      return act.webPunch(p.emp_code, p.kind, p.note, p.geo, caller, dirty);
      case 'punchLog':      return act.punchLog(p.from, p.to);
      case 'ingestPunches': return act.ingestPunches(p.punches, p.source, dirty);

      case 'decide':        return act.decide(p.sheet, p.id, p.status, p.note, caller, dirty);

      /* moving in from the sheet */
      case 'importTab':     dirty[p.sheet] = 1;
                            return api.importTab(p.sheet, p.rows, { replace: !!p.replace });
      case 'tally':         return act.tally();
      case 'payslipMailLog':return act.payslipMailLog(p.month);

      default: throw new Error('Unknown action: ' + action);
    }
  }

  /* Actions that only read. Everything else is treated as a write for the
     revision stamp. No lock: Postgres handles concurrent readers itself, and
     the single global queue that made the sheet version take minutes has no
     equivalent here. */
  const READ_ACTIONS = new Set(['ping', 'rev', 'bootstrap', 'login', 'list',
    'myMonth', 'monthAtt', 'punchState', 'punchLog', 'listUsers', 'payslipMailLog',
    'tally']);

  return async function handle(body) {
    const action = String((body && body.action) || '');
    const payload = (body && body.payload) || {};
    const token = (body && body.token) || '';
    try {
      const caller = await api.authenticate(action, token);
      await api.authorize(action, payload, caller);
      const dirty = {};
      const data = await route(action, payload, caller, dirty);
      const out = { ok: true, data };
      if (!READ_ACTIONS.has(action)) {
        const moved = await api.bumpRevision(dirty);
        if (moved) out.rev = api.isHrOrAbove(caller.role) ? moved.rev : moved.staff;
      }
      return out;
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (msg.indexOf(AUTH_PREFIX) === 0) {
        return { ok: false, authFailed: true, error: msg.slice(AUTH_PREFIX.length) };
      }
      return { ok: false, error: msg };
    }
  };
}

#!/usr/bin/env node
/**
 * HRMS Lite - eSSL / biometric sync agent
 *
 * Runs on a machine INSIDE your network (the one that can see the eSSL
 * SQL Server), reads punch rows, and posts them to the HRMS Lite web app.
 * Google's servers cannot reach a LAN address, so this agent is the
 * supported way to get biometric data in when your device or SQL box is
 * on the office network.
 *
 *   npm install mssql
 *   node essl-sync.js --days 2
 *   node essl-sync.js --from 2026-09-01 --to 2026-09-30
 *   node essl-sync.js --csv exported-punches.csv      (no SQL Server needed)
 *   node essl-sync.js --dry-run                       (show, do not send)
 *
 * Schedule it with Task Scheduler (Windows) or cron every 15-30 minutes.
 * Re-sending the same punches is safe: a day is keyed by employee + date,
 * so a repeat import overwrites that day rather than duplicating it.
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.HRMS_SYNC_CONFIG || path.join(__dirname, 'essl-sync.config.json');

const DEFAULTS = {
  hrmsUrl: '',            // the /exec URL of your Apps Script web app
  ingestToken: '',        // Settings > Integrations > ingest token
  sql: {
    server: 'localhost\\SQLEXPRESS',
    database: 'etimetracklite1',
    user: 'sa',
    password: '',
    table: 'DeviceLogs',
    columns: {            // rename these to match your eSSL schema
      deviceId: 'UserId',
      punchTime: 'LogDate',
      device: 'DeviceId',
      direction: 'C1'
    },
    options: { encrypt: false, trustServerCertificate: true }
  }
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2));
    console.error('Wrote a starter config to ' + CONFIG_PATH + '\nFill it in and run again.');
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!cfg.hrmsUrl) { console.error('hrmsUrl is empty in ' + CONFIG_PATH); process.exit(1); }
  return cfg;
}

function parseArgs(argv) {
  const args = { days: 1, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--days') args.days = parseInt(argv[++i], 10);
    else if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--csv') args.csv = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
      process.exit(0);
    }
  }
  if (!args.from) {
    const d = new Date();
    d.setDate(d.getDate() - (args.days - 1));
    args.from = d.toISOString().slice(0, 10);
  }
  if (!args.to) args.to = new Date().toISOString().slice(0, 10);
  return args;
}

/* ---------------------------- sources ---------------------------- */

async function readFromSql(cfg, from, to) {
  let sql;
  try {
    sql = require('mssql');
  } catch (e) {
    console.error('The "mssql" package is missing. Run:  npm install mssql');
    process.exit(1);
  }
  const c = cfg.sql, col = c.columns;
  const pool = await sql.connect({
    server: c.server.split('\\')[0],
    database: c.database,
    user: c.user,
    password: c.password,
    options: Object.assign({ instanceName: c.server.split('\\')[1] }, c.options || {})
  });
  const query =
    'SELECT [' + col.deviceId + '] AS device_id, [' + col.punchTime + '] AS punch_time' +
    (col.device ? ', [' + col.device + '] AS device' : '') +
    (col.direction ? ', [' + col.direction + '] AS direction' : '') +
    ' FROM [' + c.table + '] WHERE [' + col.punchTime + '] >= @from' +
    ' AND [' + col.punchTime + '] < DATEADD(day, 1, @to)' +
    ' ORDER BY [' + col.punchTime + ']';
  const result = await pool.request()
    .input('from', sql.VarChar, from)
    .input('to', sql.VarChar, to)
    .query(query);
  await pool.close();
  return result.recordset.map(function (r) {
    return {
      device_id: String(r.device_id == null ? '' : r.device_id).trim(),
      punch_time: r.punch_time instanceof Date ? isoLocal(r.punch_time) : String(r.punch_time),
      device: r.device || '',
      direction: r.direction || ''
    };
  });
}

function isoLocal(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function readFromCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  const find = names => headers.findIndex(h => names.indexOf(h) >= 0);
  const iId = find(['deviceid', 'userid', 'enrollno', 'empcode', 'employeecode']);
  const iTime = find(['punchtime', 'logdate', 'datetime', 'attdatetime', 'timestamp']);
  if (iId < 0 || iTime < 0) {
    console.error('CSV needs an employee/device column and a punch time column.');
    process.exit(1);
  }
  const isCode = ['empcode', 'employeecode'].indexOf(headers[iId]) >= 0;
  return lines.slice(1).map(function (l) {
    const c = l.split(',');
    return isCode
      ? { emp_code: (c[iId] || '').trim(), punch_time: (c[iTime] || '').trim() }
      : { device_id: (c[iId] || '').trim(), punch_time: (c[iTime] || '').trim() };
  }).filter(p => p.punch_time);
}

/* ----------------------------- sink ------------------------------ */

async function postPunches(cfg, punches) {
  const res = await fetch(cfg.hrmsUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'ingestPunches',
      payload: { punches: punches, token: cfg.ingestToken, source: 'sql-agent' }
    })
  });
  const body = await res.json().catch(() => ({ ok: false, error: 'Non-JSON reply from the web app' }));
  if (!body.ok) throw new Error(body.error || 'The web app rejected the punches');
  return body.data;
}

/* ----------------------------- main ------------------------------ */

(async function main() {
  const args = parseArgs(process.argv);   /* --help must work before any config exists */
  const cfg = loadConfig();
  console.log('Reading punches ' + args.from + ' to ' + args.to + '...');

  const punches = args.csv ? readFromCsv(args.csv) : await readFromSql(cfg, args.from, args.to);
  console.log('Found ' + punches.length + ' punch rows.');
  if (!punches.length) return;

  if (args.dryRun) {
    console.log(JSON.stringify(punches.slice(0, 10), null, 2));
    console.log('--dry-run: nothing sent.');
    return;
  }

  /* Post in batches so a big backfill does not time out. */
  const BATCH = 800;
  let days = 0, skipped = 0, guarded = 0;
  for (let i = 0; i < punches.length; i += BATCH) {
    const out = await postPunches(cfg, punches.slice(i, i + BATCH));
    days += out.days; skipped += out.skippedCount; guarded += out.protectedDays;
    if (out.skipped && out.skipped.length) out.skipped.forEach(s => console.warn('  ! ' + s));
  }
  console.log('Wrote ' + days + ' attendance day(s).');
  if (skipped) console.log(skipped + ' punch row(s) skipped - see the warnings above.');
  if (guarded) console.log(guarded + ' day(s) left alone (approved leave, or a finalised payroll month).');
})().catch(function (err) {
  console.error('Sync failed: ' + err.message);
  process.exit(1);
});

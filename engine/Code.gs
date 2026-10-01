/**
 * AIISV Intern Time Tracker — engine
 * ---------------------------------------------------------------
 * Lives inside the "AIISV Intern Time Tracker" Google Sheet
 * (Extensions → Apps Script). It:
 *   • serves the JSON API used by https://time.aiisv.org
 *   • stores every save in the Entries tab and every change in Change Log
 *   • locks weeks older than N months (Settings → Lock After Months)
 *   • emails weekly / monthly / quarterly / yearly reports and Friday reminders
 *   • adds a "Time Tracker" menu for adding, deactivating and managing interns
 *
 * First-time setup: run  setup()  once from the editor, then
 * Deploy → New deployment → Web app (Execute as: Me, Access: Anyone).
 */

var SHEET_ID = '1HOt_71-EWBIOph8jTIcbYfqH1rutzZ7TraeraJ_qElY';
var TZ = 'America/Los_Angeles';
var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

var TAB = {
  roster: 'Roster', managers: 'Managers', entries: 'Entries',
  log: 'Change Log', unlocks: 'Unlocks', settings: 'Settings'
};

/* =================================================================
 * Pure helpers (no Google services) — date math and aggregation
 * ================================================================= */

function pad2_(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

/** Normalises a Date or a 'yyyy-mm-dd'-ish string to 'yyyy-MM-dd' (Pacific). */
function ymd_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return typeof Utilities !== 'undefined'
      ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd')
      : v.getFullYear() + '-' + pad2_(v.getMonth() + 1) + '-' + pad2_(v.getDate());
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + pad2_(m[1]) + '-' + pad2_(m[2]);
  return '';
}

function toUtc_(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
function fromUtc_(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate()); }
function addDays_(s, n) { return fromUtc_(toUtc_(s) + n * 86400000); }
function dayIndex_(s) { return (new Date(toUtc_(s)).getUTCDay() + 6) % 7; } // Mon=0 … Sun=6
function mondayOf_(s) { return addDays_(s, -dayIndex_(s)); }
function daysBetween_(a, b) { return Math.round((toUtc_(b) - toUtc_(a)) / 86400000); }

function addMonths_(s, n) {
  var p = s.split('-'), y = +p[0], m = +p[1] - 1 + n, d = +p[2];
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return y + '-' + pad2_(m + 1) + '-' + pad2_(Math.min(d, last));
}

function round2_(x) { return Math.round((Number(x) || 0) * 100) / 100; }

/** Weeks (Mondays) from a to b inclusive. */
function weeksBetween_(fromMonday, toMonday) {
  var out = [];
  for (var w = fromMonday; w <= toMonday; w = addDays_(w, 7)) out.push(w);
  return out;
}

/** True when the week is older than the lock window and has no active unlock. */
function isLocked_(weekStart, today, lockMonths, unlockedUntil) {
  if (!lockMonths || lockMonths <= 0) return false;
  var weekEnd = addDays_(weekStart, 6);
  var cutoff = addMonths_(today, -lockMonths);
  if (weekEnd >= cutoff) return false;
  return !(unlockedUntil && unlockedUntil >= today);
}

/** Splits daily totals into regular and overtime. entries: [{date, hours}] */
function splitOvertime_(entries, threshold) {
  var byDay = {};
  entries.forEach(function (e) { byDay[e.date] = (byDay[e.date] || 0) + e.hours; });
  var reg = 0, ot = 0;
  Object.keys(byDay).forEach(function (d) {
    var h = byDay[d];
    if (threshold > 0 && h > threshold) { reg += threshold; ot += h - threshold; } else reg += h;
  });
  return { regular: round2_(reg), overtime: round2_(ot), total: round2_(reg + ot) };
}

/** Converts grid rows [{task, desc, hours[7]}] into flat entries for a week. */
function gridToEntries_(weekStart, rows) {
  var out = [];
  rows.forEach(function (r, i) {
    for (var d = 0; d < 7; d++) {
      var h = round2_(r.hours[d]);
      if (h > 0) out.push({ row: i + 1, date: addDays_(weekStart, d), day: DAYS[d], task: r.task, desc: r.desc, hours: h });
    }
  });
  return out;
}

/** Rebuilds grid rows from flat entries (keeps the intern's row order). */
function entriesToGrid_(weekStart, entries) {
  var rows = {}, order = [];
  entries.forEach(function (e) {
    var key = e.row + '|' + e.task + '|' + e.desc;
    if (!rows[key]) { rows[key] = { task: e.task, desc: e.desc, hours: [0, 0, 0, 0, 0, 0, 0], _r: Number(e.row) || 0 }; order.push(key); }
    var d = daysBetween_(weekStart, e.date);
    if (d >= 0 && d < 7) rows[key].hours[d] = round2_(rows[key].hours[d] + e.hours);
  });
  return order.map(function (k) { return rows[k]; })
    .sort(function (a, b) { return a._r - b._r; })
    .map(function (r) { return { task: r.task, desc: r.desc, hours: r.hours }; });
}

/** Compares old vs new entries for one week. Returns only real changes. */
function diffEntries_(oldE, newE) {
  function sum(list) {
    var m = {};
    list.forEach(function (e) {
      var k = e.date + '|' + e.task + '|' + (e.desc || '');
      m[k] = round2_((m[k] || 0) + e.hours);
    });
    return m;
  }
  var a = sum(oldE), b = sum(newE), keys = {}, out = [];
  Object.keys(a).forEach(function (k) { keys[k] = 1; });
  Object.keys(b).forEach(function (k) { keys[k] = 1; });
  Object.keys(keys).sort().forEach(function (k) {
    var o = a[k] || 0, n = b[k] || 0;
    if (o !== n) { var p = k.split('|'); out.push({ date: p[0], task: p[1], desc: p.slice(2).join('|'), old: o, new: n }); }
  });
  return out;
}

/** Validates and cleans grid rows sent from the site. Throws a friendly message on bad input. */
function cleanRows_(rows, taskTypes, requireDesc) {
  if (!Array.isArray(rows)) throw new Error('Nothing to save.');
  if (rows.length > 40) throw new Error('Too many task rows for one week.');
  var out = [], dayTotals = [0, 0, 0, 0, 0, 0, 0];
  rows.forEach(function (r) {
    var hours = [];
    for (var d = 0; d < 7; d++) {
      var h = Number((r.hours || [])[d]) || 0;
      if (h < 0 || h > 24) throw new Error('Hours must be between 0 and 24.');
      h = round2_(h); hours.push(h); dayTotals[d] += h;
    }
    var any = hours.some(function (h) { return h > 0; });
    if (!any) return; // drop empty rows silently
    var task = String(r.task || '').trim();
    if (taskTypes.indexOf(task) < 0) throw new Error('Unknown task type: ' + task);
    var desc = String(r.desc || '').trim().slice(0, 300);
    if (requireDesc && !desc) throw new Error('Add a short description for each task row with hours.');
    out.push({ task: task, desc: desc, hours: hours });
  });
  dayTotals.forEach(function (t, d) { if (t > 24) throw new Error(DAYS[d] + ' adds up to more than 24 hours.'); });
  return out;
}

/** Period [from, to] that a report sent on runDate covers. */
function reportPeriod_(kind, runDate) {
  var p = runDate.split('-'), y = +p[0], m = +p[1];
  if (kind === 'weekly') { var mon = mondayOf_(runDate); return { from: addDays_(mon, -7), to: addDays_(mon, -1) }; }
  if (kind === 'monthly') { var first = y + '-' + pad2_(m) + '-01'; return { from: addMonths_(first, -1), to: addDays_(first, -1) }; }
  if (kind === 'quarterly') { var qStart = y + '-' + pad2_(Math.floor((m - 1) / 3) * 3 + 1) + '-01'; return { from: addMonths_(qStart, -3), to: addDays_(qStart, -1) }; }
  if (kind === 'yearly') { return { from: (y - 1) + '-01-01', to: (y - 1) + '-12-31' }; }
  throw new Error('Unknown report type ' + kind);
}

/** Which reports go out on a given date. */
function reportsDue_(runDate) {
  var p = runDate.split('-'), m = +p[1], d = +p[2], due = [];
  if (dayIndex_(runDate) === 0) due.push('weekly');
  if (d === 1) due.push('monthly');
  if (d === 1 && (m - 1) % 3 === 0) due.push('quarterly');
  if (d === 1 && m === 1) due.push('yearly');
  return due;
}

/** Same-length period immediately before [from, to]. */
function priorPeriod_(kind, period) {
  if (kind === 'weekly') return { from: addDays_(period.from, -7), to: addDays_(period.to, -7) };
  var months = kind === 'monthly' ? 1 : kind === 'quarterly' ? 3 : 12;
  var from = addMonths_(period.from, -months);
  return { from: from, to: addDays_(period.from, -1) };
}

/** Is the intern active at any point in [from, to]? */
function activeIn_(intern, from, to) {
  if (intern.start && intern.start > to) return false;
  if (intern.end && intern.end < from) return false;
  return true;
}

/** Summary for a set of interns over [from, to]. */
function summarize_(interns, entries, from, to, threshold) {
  var inRange = entries.filter(function (e) { return e.date >= from && e.date <= to; });
  var byIntern = {}, byTask = {}, total = 0, ot = 0;
  interns.forEach(function (i) { byIntern[i.id] = []; });
  inRange.forEach(function (e) { if (byIntern[e.internId]) byIntern[e.internId].push(e); });
  var rows = interns.map(function (i) {
    var es = byIntern[i.id], s = splitOvertime_(es, threshold), tasks = {}, notes = {};
    es.forEach(function (e) {
      tasks[e.task] = round2_((tasks[e.task] || 0) + e.hours);
      byTask[e.task] = round2_((byTask[e.task] || 0) + e.hours);
      var nk = e.task + '|' + (e.desc || '');
      notes[nk] = round2_((notes[nk] || 0) + e.hours);
    });
    total += s.total; ot += s.overtime;
    var expectedWeeks = weeksBetween_(mondayOf_(i.start && i.start > from ? i.start : from), mondayOf_(i.end && i.end < to ? i.end : to));
    var logged = {}; es.forEach(function (e) { logged[mondayOf_(e.date)] = 1; });
    // only weeks that have fully ended by `to` can count as missing
    var missing = activeIn_(i, from, to) ? expectedWeeks.filter(function (w) { return !logged[w] && addDays_(w, 6) <= to; }) : [];
    return {
      id: i.id, name: i.name, manager: i.manager, managerEmail: i.managerEmail, status: i.status,
      regular: s.regular, overtime: s.overtime, total: s.total,
      tasks: tasks, missingWeeks: missing, active: activeIn_(i, from, to),
      notes: Object.keys(notes).map(function (k) { var p = k.split('|'); return { task: p[0], desc: p.slice(1).join('|'), hours: notes[k] }; })
    };
  });
  return { from: from, to: to, total: round2_(total), overtime: round2_(ot), byTask: byTask, interns: rows };
}

/* =================================================================
 * Sheet access
 * ================================================================= */

function ss_() { return SpreadsheetApp.openById(SHEET_ID); }
function sh_(name) { return ss_().getSheetByName(name); }

function readTable_(name) {
  var sh = sh_(name), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
}

function settings_() {
  var rows = readTable_(TAB.settings), s = {};
  rows.forEach(function (r) { if (r[0]) s[String(r[0]).trim()] = r[1]; });
  var tasks = String(s['Task Types'] || '').split(',').map(function (t) { return t.trim(); }).filter(String);
  return {
    siteUrl: String(s['Site URL'] || 'https://time.aiisv.org').replace(/\/+$/, ''),
    taskTypes: tasks,
    lockMonths: Number(s['Lock After Months']) || 0,
    otThreshold: Number(s['Overtime Daily Threshold']) || 8,
    reportHour: Number(s['Report Hour']) || 7,
    reminderDay: String(s['Reminder Day'] || 'Friday'),
    reminderHour: Number(s['Reminder Hour']) || 14,
    trackingStart: ymd_(s['Tracking Start']) || '2025-12-29',
    fromName: String(s['From Name'] || 'AIISV Time Tracker'),
    lastReport: ymd_(s['Last Report Sent']),
    requireDesc: String(s['Require Description'] || 'Yes').toLowerCase().indexOf('y') === 0
  };
}

function setSetting_(key, value) {
  var sh = sh_(TAB.settings), vals = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]).trim() === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  sh.appendRow([key, value, '']);
}

function interns_() {
  return readTable_(TAB.roster).map(function (r, i) {
    return {
      rowNum: i + 2, id: String(r[0]).trim(), name: String(r[1]).trim(), email: String(r[2]).trim(),
      phone: String(r[3]).trim(), manager: String(r[4]).trim(), managerEmail: String(r[5]).trim().toLowerCase(),
      start: ymd_(r[6]), end: ymd_(r[7]), status: String(r[8] || 'Active').trim(), token: String(r[9]).trim()
    };
  }).filter(function (i) { return i.id && i.name; });
}

function managers_() {
  return readTable_(TAB.managers).map(function (r, i) {
    return {
      rowNum: i + 2, name: String(r[0]).trim(), email: String(r[1]).trim().toLowerCase(),
      role: String(r[2] || 'Manager').trim().toLowerCase() === 'admin' ? 'admin' : 'manager',
      token: String(r[3]).trim(), reports: String(r[4] || 'Yes').toLowerCase().indexOf('n') !== 0
    };
  }).filter(function (m) { return m.email; });
}

function entries_() {
  return readTable_(TAB.entries).map(function (r) {
    return {
      internId: String(r[0]).trim(), intern: r[1], week: ymd_(r[2]), date: ymd_(r[3]), day: r[4],
      row: Number(r[5]) || 1, task: String(r[6]), desc: String(r[7] || ''), hours: round2_(r[8]),
      savedAt: r[9], savedBy: r[10]
    };
  }).filter(function (e) { return e.internId && e.date && e.hours; });
}

function unlockedUntil_(internId, week) {
  var best = '';
  readTable_(TAB.unlocks).forEach(function (r) {
    if (String(r[0]).trim() === internId && ymd_(r[2]) === week) { var u = ymd_(r[3]); if (u > best) best = u; }
  });
  return best;
}

function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowStamp_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function newToken_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); }

/* =================================================================
 * Web API  (called by time.aiisv.org)
 * ================================================================= */

function doGet(e) { return handle_(e && e.parameter ? e.parameter : {}); }

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { body = {}; }
  return handle_(Object.assign({}, e.parameter || {}, body));
}

function handle_(req) {
  var out;
  try {
    var who = resolve_(String(req.t || ''));
    if (!who) throw new Error('This link is not valid. Ask your manager for a new one.');
    var action = String(req.action || 'me');
    if (action === 'me') out = apiMe_(who);
    else if (action === 'week') out = apiWeek_(who, req);
    else if (action === 'save') out = apiSave_(who, req);
    else if (action === 'dashboard') out = apiDashboard_(who, req);
    else throw new Error('Unknown action.');
    out.ok = true;
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function resolve_(token) {
  if (!token || token.length < 16) return null;
  var ints = interns_();
  for (var i = 0; i < ints.length; i++) if (ints[i].token === token) return { role: 'intern', intern: ints[i], interns: ints };
  var mgrs = managers_();
  for (var j = 0; j < mgrs.length; j++) if (mgrs[j].token === token) return { role: mgrs[j].role, manager: mgrs[j], interns: ints };
  return null;
}

/** Interns this person may see. */
function scope_(who) {
  if (who.role === 'intern') return [who.intern];
  if (who.role === 'admin') return who.interns;
  return who.interns.filter(function (i) { return i.managerEmail === who.manager.email; });
}

function publicIntern_(i) { return { id: i.id, name: i.name, manager: i.manager, status: i.status, start: i.start, end: i.end }; }

function apiMe_(who) {
  var s = settings_();
  var base = {
    role: who.role, taskTypes: s.taskTypes, lockMonths: s.lockMonths, otThreshold: s.otThreshold,
    requireDesc: s.requireDesc, today: today_(), trackingStart: s.trackingStart
  };
  if (who.role === 'intern') {
    base.name = who.intern.name; base.intern = publicIntern_(who.intern);
    base.canEdit = who.intern.status.toLowerCase() === 'active';
  } else {
    base.name = who.manager.name;
    base.interns = scope_(who).map(publicIntern_);
  }
  return base;
}

function apiWeek_(who, req) {
  var s = settings_(), today = today_();
  var allowed = scope_(who), intern = null;
  var id = who.role === 'intern' ? who.intern.id : String(req.intern || '');
  for (var i = 0; i < allowed.length; i++) if (allowed[i].id === id) intern = allowed[i];
  if (!intern) throw new Error('You do not have access to that timesheet.');

  var thisMonday = mondayOf_(today);
  var week = ymd_(req.week) ? mondayOf_(ymd_(req.week)) : thisMonday;
  if (week > thisMonday) week = thisMonday;

  var all = entries_().filter(function (e) { return e.internId === intern.id; });
  var mine = all.filter(function (e) { return e.week === week; });
  var unlock = unlockedUntil_(intern.id, week);
  var locked = isLocked_(week, today, s.lockMonths, unlock);
  var active = intern.status.toLowerCase() === 'active';
  var saved = mine.reduce(function (m, e) { return String(e.savedAt) > m ? String(e.savedAt) : m; }, '');

  // week strip: from start (or tracking start) to this week
  var first = mondayOf_(intern.start && intern.start > s.trackingStart ? intern.start : s.trackingStart);
  var lastW = intern.end && intern.end < today ? mondayOf_(intern.end) : thisMonday;
  var hoursByWeek = {};
  all.forEach(function (e) { hoursByWeek[e.week] = round2_((hoursByWeek[e.week] || 0) + e.hours); });
  var strip = weeksBetween_(first, lastW).map(function (w) {
    return { week: w, hours: hoursByWeek[w] || 0, locked: isLocked_(w, today, s.lockMonths, '') };
  });

  return {
    intern: publicIntern_(intern), week: week, rows: entriesToGrid_(week, mine),
    locked: locked, unlockedUntil: unlock,
    canEdit: !locked && active && (who.role === 'intern' || who.role === 'admin'),
    lastSaved: saved, weeks: strip
  };
}

function apiSave_(who, req) {
  if (who.role === 'manager') throw new Error('Managers can view timesheets but not edit them.');
  var s = settings_(), today = today_();
  var intern = who.role === 'intern' ? who.intern : null;
  if (who.role === 'admin') who.interns.forEach(function (i) { if (i.id === String(req.intern || '')) intern = i; });
  if (!intern) throw new Error('Timesheet not found.');
  if (intern.status.toLowerCase() !== 'active') throw new Error('This timesheet is closed. Contact your manager.');

  var week = mondayOf_(ymd_(req.week) || today);
  if (week > mondayOf_(today)) throw new Error('You can’t log hours for a future week.');
  var unlock = unlockedUntil_(intern.id, week);
  if (isLocked_(week, today, s.lockMonths, unlock)) throw new Error('This week is locked. Ask your manager to unlock it.');

  var rows = cleanRows_(req.rows, s.taskTypes, s.requireDesc);
  var fresh = gridToEntries_(week, rows);
  var by = who.role === 'intern' ? intern.email || intern.name : who.manager.email;
  var stamp = nowStamp_();

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sh_(TAB.entries), last = sh.getLastRow();
    var data = last > 1 ? sh.getRange(2, 1, last - 1, 11).getValues() : [];
    var keep = [], old = [];
    data.forEach(function (r) {
      if (String(r[0]).trim() === intern.id && ymd_(r[2]) === week) {
        old.push({ date: ymd_(r[3]), task: String(r[6]), desc: String(r[7] || ''), hours: round2_(r[8]) });
      } else keep.push(r);
    });
    var changes = diffEntries_(old, fresh);
    if (!changes.length) return { saved: false, message: 'No changes to save.', lastSaved: '' };

    var newRows = fresh.map(function (e) {
      return [intern.id, intern.name, week, e.date, e.day, e.row, e.task, e.desc, e.hours, stamp, by];
    });
    var all = keep.concat(newRows);
    if (last > 1) sh.getRange(2, 1, last - 1, 11).clearContent();
    if (all.length) sh.getRange(2, 1, all.length, 11).setValues(all);
    sh.getRange(2, 3, Math.max(all.length, 1), 2).setNumberFormat('yyyy-mm-dd');

    var late = s.lastReport && addDays_(week, 6) < s.lastReport ? 'Yes' : '';
    var logRows = changes.map(function (c) {
      return [stamp, intern.id, intern.name, week, c.date, c.task, c.desc, c.old, c.new, by, late];
    });
    var lg = sh_(TAB.log);
    lg.getRange(lg.getLastRow() + 1, 1, logRows.length, 11).setValues(logRows);
  } finally {
    lock.releaseLock();
  }
  return { saved: true, message: 'Saved', lastSaved: stamp, changes: changes.length };
}

function apiDashboard_(who, req) {
  if (who.role === 'intern') throw new Error('Not available.');
  var s = settings_(), today = today_();
  var from = ymd_(req.from) || mondayOf_(today), to = ymd_(req.to) || today;
  if (to < from) { var t = from; from = to; to = t; }
  var ints = scope_(who), ids = {};
  ints.forEach(function (i) { ids[i.id] = 1; });
  var es = entries_().filter(function (e) { return ids[e.internId]; });
  var sum = summarize_(ints, es, from, to, s.otThreshold);

  // weekly series (total + per intern) across the range
  var weeks = weeksBetween_(mondayOf_(from), mondayOf_(to));
  var series = weeks.map(function (w) {
    var end = addDays_(w, 6), per = {};
    es.forEach(function (e) {
      if (e.date >= w && e.date <= end && e.date >= from && e.date <= to) per[e.internId] = round2_((per[e.internId] || 0) + e.hours);
    });
    var tot = 0; Object.keys(per).forEach(function (k) { tot += per[k]; });
    return { week: w, total: round2_(tot), byIntern: per };
  });

  var lastSaved = {};
  es.forEach(function (e) { var v = String(e.savedAt); if (!lastSaved[e.internId] || v > lastSaved[e.internId]) lastSaved[e.internId] = v; });
  sum.interns.forEach(function (r) { r.lastSaved = lastSaved[r.id] || ''; delete r.managerEmail; });

  var edits = readTable_(TAB.log).filter(function (r) { return ids[String(r[1]).trim()] && r[10] === 'Yes'; })
    .slice(-25).reverse().map(function (r) {
      return { at: String(r[0]), intern: r[2], week: ymd_(r[3]), date: ymd_(r[4]), task: r[5], old: r[7], new: r[8] };
    });

  return { summary: sum, series: series, lateEdits: edits, role: who.role };
}

/* =================================================================
 * Emails — reports and reminders
 * ================================================================= */

/** Daily trigger: sends whichever reports are due today. */
function runDailyJobs() {
  var today = today_(), due = reportsDue_(today);
  due.forEach(function (kind) { sendReports_(kind, today, null); });
  if (due.indexOf('weekly') >= 0) setSetting_('Last Report Sent', today);
}

function sendReports_(kind, runDate, onlyTo) {
  var s = settings_(), period = reportPeriod_(kind, runDate), prior = priorPeriod_(kind, period);
  var ints = interns_(), mgrs = managers_(), es = entries_();
  var lateEdits = readTable_(TAB.log).filter(function (r) {
    return r[10] === 'Yes' && (!s.lastReport || ymd_(r[0]) >= s.lastReport);
  });

  mgrs.filter(function (m) { return m.reports && m.token; }).forEach(function (m) {
    if (onlyTo && m.email !== onlyTo.toLowerCase()) return;
    var mine = m.role === 'admin' ? ints : ints.filter(function (i) { return i.managerEmail === m.email; });
    mine = mine.filter(function (i) { return activeIn_(i, period.from, period.to); });
    if (!mine.length) return;
    var ids = {}; mine.forEach(function (i) { ids[i.id] = 1; });
    var mineEs = es.filter(function (e) { return ids[e.internId]; });
    var cur = summarize_(mine, mineEs, period.from, period.to, s.otThreshold);
    var prev = summarize_(mine, mineEs, prior.from, prior.to, s.otThreshold);
    var edits = lateEdits.filter(function (r) { return ids[String(r[1]).trim()]; });
    var html = reportHtml_(kind, cur, prev, edits, m, s);
    MailApp.sendEmail({
      to: m.email, name: s.fromName,
      subject: titleFor_(kind) + ' intern hours · ' + rangeLabel_(period.from, period.to),
      htmlBody: html
    });
  });
}

function titleFor_(kind) { return { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' }[kind]; }

function fmtDate_(s, withYear) {
  var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], p = s.split('-');
  return M[+p[1] - 1] + ' ' + (+p[2]) + (withYear ? ', ' + p[0] : '');
}
function rangeLabel_(a, b) { return fmtDate_(a, a.slice(0, 4) !== b.slice(0, 4)) + ' – ' + fmtDate_(b, true); }
function h_(n) { n = round2_(n); return (n % 1 === 0 ? n.toFixed(0) : n.toFixed(2).replace(/0$/, '')); }
function esc_(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function reportHtml_(kind, cur, prev, edits, mgr, s) {
  var gold = '#e9bf35', ink = '#262b2d', soft = '#6b6b66', line = '#e8e5dc';
  var td = 'padding:8px 10px;border-bottom:1px solid ' + line + ';font-size:14px;';
  var th = 'padding:8px 10px;border-bottom:2px solid ' + ink + ';font-size:12px;text-align:left;color:' + soft + ';text-transform:uppercase;letter-spacing:.04em;';
  var logged = cur.interns.filter(function (i) { return i.total > 0; }).length;
  var delta = round2_(cur.total - prev.total);
  var deltaTxt = prev.total ? (delta >= 0 ? '+' : '') + h_(delta) + ' h vs previous ' + kind.replace('ly', '') : '';
  var isAdmin = mgr.role === 'admin';

  var html = '<div style="font-family:Calibri,Segoe UI,Roboto,Arial,sans-serif;color:' + ink + ';max-width:680px">';
  html += '<div style="background:#141414;color:#f7f5ef;padding:18px 22px;border-radius:10px 10px 0 0">'
    + '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:' + gold + '">AIISV Intern Time Tracker</div>'
    + '<div style="font-family:Cambria,Georgia,serif;font-size:22px;font-weight:bold;margin-top:4px">' + titleFor_(kind) + ' hours · ' + rangeLabel_(cur.from, cur.to) + '</div></div>';
  html += '<div style="border:1px solid ' + line + ';border-top:none;padding:18px 22px;border-radius:0 0 10px 10px">';

  html += '<table style="width:100%;border-collapse:collapse;margin-bottom:18px"><tr>'
    + stat_('Total hours', h_(cur.total), deltaTxt)
    + stat_('Interns logging', logged + ' of ' + cur.interns.length, '')
    + stat_('Overtime', h_(cur.overtime) + ' h', 'over ' + s.otThreshold + ' h in a day')
    + '</tr></table>';

  html += '<h3 style="font-family:Cambria,Georgia,serif;margin:18px 0 6px">By intern</h3><table style="width:100%;border-collapse:collapse"><tr>'
    + '<th style="' + th + '">Intern</th>' + (isAdmin ? '<th style="' + th + '">Manager</th>' : '')
    + '<th style="' + th + 'text-align:right">Regular</th><th style="' + th + 'text-align:right">OT</th><th style="' + th + 'text-align:right">Total</th></tr>';
  cur.interns.slice().sort(function (a, b) { return b.total - a.total; }).forEach(function (i) {
    var miss = i.total === 0 ? ' <span style="color:#b26b00;font-size:12px">no hours</span>' : '';
    html += '<tr><td style="' + td + '">' + esc_(i.name) + miss + '</td>' + (isAdmin ? '<td style="' + td + 'color:' + soft + '">' + esc_(i.manager) + '</td>' : '')
      + '<td style="' + td + 'text-align:right">' + h_(i.regular) + '</td><td style="' + td + 'text-align:right">' + h_(i.overtime) + '</td>'
      + '<td style="' + td + 'text-align:right;font-weight:bold">' + h_(i.total) + '</td></tr>';
  });
  html += '</table>';

  var tasks = Object.keys(cur.byTask).sort(function (a, b) { return cur.byTask[b] - cur.byTask[a]; });
  if (tasks.length) {
    html += '<h3 style="font-family:Cambria,Georgia,serif;margin:22px 0 6px">By task type</h3><table style="width:100%;border-collapse:collapse">';
    tasks.forEach(function (t) {
      var pct = cur.total ? Math.round(cur.byTask[t] / cur.total * 100) : 0;
      html += '<tr><td style="' + td + 'width:38%">' + esc_(t) + '</td><td style="' + td + '"><div style="background:' + gold + ';height:10px;border-radius:5px;width:' + Math.max(pct, 2) + '%"></div></td>'
        + '<td style="' + td + 'text-align:right;width:70px">' + h_(cur.byTask[t]) + ' h</td><td style="' + td + 'text-align:right;width:50px;color:' + soft + '">' + pct + '%</td></tr>';
    });
    html += '</table>';
  }

  if (kind === 'weekly' || kind === 'monthly') {
    var withNotes = cur.interns.filter(function (i) { return i.notes.length; });
    if (withNotes.length) {
      html += '<h3 style="font-family:Cambria,Georgia,serif;margin:22px 0 6px">What they worked on</h3>';
      withNotes.forEach(function (i) {
        html += '<div style="margin:10px 0 4px;font-weight:bold">' + esc_(i.name) + '</div><ul style="margin:0 0 6px 18px;padding:0">';
        i.notes.sort(function (a, b) { return b.hours - a.hours; }).slice(0, 12).forEach(function (n) {
          html += '<li style="margin:2px 0;font-size:14px">' + esc_(n.task) + (n.desc ? ' — ' + esc_(n.desc) : '') + ' <span style="color:' + soft + '">(' + h_(n.hours) + ' h)</span></li>';
        });
        html += '</ul>';
      });
    }
  }

  var missing = cur.interns.filter(function (i) { return i.active && i.missingWeeks.length; });
  if (missing.length) {
    html += '<h3 style="font-family:Cambria,Georgia,serif;margin:22px 0 6px">Missing weeks</h3><ul style="margin:0 0 0 18px;padding:0">';
    missing.forEach(function (i) {
      html += '<li style="margin:2px 0;font-size:14px">' + esc_(i.name) + ': ' + i.missingWeeks.map(function (w) { return 'week of ' + fmtDate_(w); }).join(', ') + '</li>';
    });
    html += '</ul>';
  }

  if (edits.length) {
    html += '<h3 style="font-family:Cambria,Georgia,serif;margin:22px 0 6px">Late edits since last report</h3><ul style="margin:0 0 0 18px;padding:0">';
    edits.slice(-20).forEach(function (r) {
      var d = round2_(r[8] - r[7]);
      html += '<li style="margin:2px 0;font-size:14px">' + esc_(r[2]) + ' changed ' + fmtDate_(ymd_(r[4])) + ' ' + esc_(r[5]) + ': ' + h_(r[7]) + ' → ' + h_(r[8]) + ' h (' + (d >= 0 ? '+' : '') + h_(d) + ') on ' + esc_(String(r[0]).slice(0, 10)) + '</li>';
    });
    html += '</ul>';
  }

  html += '<div style="margin-top:24px"><a href="' + s.siteUrl + '/?t=' + mgr.token + '" style="background:' + gold + ';color:#141414;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;display:inline-block">Open dashboard</a></div>';
  html += '</div></div>';
  return html;
}

function stat_(label, value, sub) {
  return '<td style="width:33%;padding:10px 12px;background:#f7f5ef;border-radius:8px;border:4px solid #fff;vertical-align:top">'
    + '<div style="font-size:12px;color:#6b6b66">' + label + '</div><div style="font-size:22px;font-weight:bold">' + value + '</div>'
    + (sub ? '<div style="font-size:12px;color:#6b6b66">' + sub + '</div>' : '') + '</td>';
}

/** Daily trigger: on the reminder day, nudges interns with no hours this week. */
function runReminders() {
  var s = settings_(), today = today_();
  var dayName = Utilities.formatDate(new Date(), TZ, 'EEEE');
  if (dayName.toLowerCase() !== s.reminderDay.toLowerCase()) return;
  var monday = mondayOf_(today), es = entries_();
  interns_().forEach(function (i) {
    if (i.status.toLowerCase() !== 'active' || !i.email || !i.token) return;
    if (i.start && i.start > today) return;
    var mine = es.filter(function (e) { return e.internId === i.id; });
    var thisWeek = mine.some(function (e) { return e.week === monday; });
    var logged = {}; mine.forEach(function (e) { logged[e.week] = 1; });
    var first = mondayOf_(i.start && i.start > s.trackingStart ? i.start : s.trackingStart);
    var missed = weeksBetween_(first, addDays_(monday, -7)).filter(function (w) { return !logged[w]; }).slice(-6);
    if (thisWeek && !missed.length) return;
    var link = s.siteUrl + '/?t=' + i.token;
    var body = '<div style="font-family:Calibri,Segoe UI,Roboto,Arial,sans-serif;color:#262b2d;font-size:15px;max-width:560px">'
      + '<p>Hi ' + esc_(i.name.split(' ')[0]) + ',</p>'
      + (thisWeek ? '' : '<p>You haven’t logged any hours for this week (week of ' + fmtDate_(monday) + ') yet.</p>')
      + (missed.length ? '<p>These earlier weeks are also empty: ' + missed.map(function (w) { return fmtDate_(w); }).join(', ') + '. If you worked those weeks, you can still fill them in.</p>' : '')
      + '<p><a href="' + link + '" style="background:#e9bf35;color:#141414;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;display:inline-block">Open my timesheet</a></p>'
      + '<p style="color:#6b6b66;font-size:13px">If you didn’t work those weeks, you can ignore this email.</p></div>';
    MailApp.sendEmail({ to: i.email, name: s.fromName, subject: 'Reminder: log your intern hours', htmlBody: body });
  });
}

function sendInternLink_(i) {
  var s = settings_(), link = s.siteUrl + '/?t=' + i.token;
  var body = '<div style="font-family:Calibri,Segoe UI,Roboto,Arial,sans-serif;color:#262b2d;font-size:15px;max-width:560px">'
    + '<p>Hi ' + esc_(i.name.split(' ')[0]) + ',</p>'
    + '<p>This is your personal link for logging intern hours at the AI Institute of Silicon Valley. Bookmark it — it opens straight to your timesheet.</p>'
    + '<p><a href="' + link + '" style="background:#e9bf35;color:#141414;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;display:inline-block">Open my timesheet</a></p>'
    + '<p><b>How it works</b></p><ul>'
    + '<li>Fill in one week at a time: one row per task type, hours under each day.</li>'
    + '<li>Use quarter hours (0.25 = 15 min, 0.5 = 30 min, 0.75 = 45 min).</li>'
    + '<li>Add a short note on what you worked on for each row.</li>'
    + '<li>Missed a week? Use the arrows or the week strip to go back and fill it in. Weeks older than ' + s.lockMonths + ' months are locked.</li>'
    + '<li>Overtime (over ' + s.otThreshold + ' hours in a day) is calculated for you.</li></ul>'
    + '<p>Your manager is ' + esc_(i.manager) + '.</p>'
    + '<p style="color:#6b6b66;font-size:13px">Keep this link private — anyone with it can edit your timesheet.</p></div>';
  MailApp.sendEmail({ to: i.email, name: s.fromName, subject: 'Your AIISV timesheet link', htmlBody: body });
  sh_(TAB.roster).getRange(i.rowNum, 11).setValue(nowStamp_());
}

function sendManagerLink_(m) {
  var s = settings_(), link = s.siteUrl + '/?t=' + m.token;
  var body = '<div style="font-family:Calibri,Segoe UI,Roboto,Arial,sans-serif;color:#262b2d;font-size:15px;max-width:560px">'
    + '<p>Hi ' + esc_(m.name.split(' ')[0]) + ',</p>'
    + '<p>Here is your link to the AIISV intern hours dashboard. It shows ' + (m.role === 'admin' ? 'all interns' : 'the interns who report to you') + ', and you can open any of their timesheets.</p>'
    + '<p><a href="' + link + '" style="background:#e9bf35;color:#141414;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;display:inline-block">Open dashboard</a></p>'
    + '<p>You’ll also get a summary email every Monday, plus monthly, quarterly and yearly roll-ups.</p>'
    + '<p style="color:#6b6b66;font-size:13px">Keep this link private.</p></div>';
  MailApp.sendEmail({ to: m.email, name: s.fromName, subject: 'Your AIISV intern dashboard link', htmlBody: body });
}

/* =================================================================
 * Sheet menu and admin actions
 * ================================================================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Time Tracker')
    .addItem('Add intern…', 'menuAddIntern')
    .addItem('Deactivate intern…', 'menuDeactivate')
    .addItem('Send links to all active interns', 'menuSendAllLinks')
    .addItem('Resend intern link…', 'menuResend')
    .addItem('Reset intern link…', 'menuReset')
    .addSeparator()
    .addItem('Unlock a week…', 'menuUnlock')
    .addSeparator()
    .addItem('Send manager links…', 'menuManagerLinks')
    .addItem('Send me a test weekly report', 'menuTestReport')
    .addSeparator()
    .addItem('Setup / repair', 'setup')
    .addToUi();
}

function dialog_(title, fields, submitFn, note) {
  var html = '<style>body{font-family:Calibri,Segoe UI,Arial,sans-serif;font-size:14px;color:#262b2d}label{display:block;margin:10px 0 4px;font-weight:bold}'
    + 'input,select{width:100%;padding:7px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;font-size:14px}'
    + 'button{margin-top:16px;background:#e9bf35;border:0;padding:9px 18px;border-radius:6px;font-weight:bold;cursor:pointer}#msg{margin-top:10px;color:#a32d2d}.n{color:#6b6b66;font-size:12px;margin-top:6px}</style>';
  if (note) html += '<div class="n">' + note + '</div>';
  html += '<form id="f">';
  fields.forEach(function (f) {
    html += '<label>' + f.label + '</label>';
    if (f.options) {
      html += '<select name="' + f.name + '">' + f.options.map(function (o) { return '<option value="' + esc_(o.value) + '">' + esc_(o.label) + '</option>'; }).join('') + '</select>';
    } else {
      html += '<input name="' + f.name + '" type="' + (f.type || 'text') + '" value="' + esc_(f.value || '') + '"' + (f.required ? ' required' : '') + '>';
    }
  });
  html += '<button type="submit">Save</button><div id="msg"></div></form><script>'
    + 'document.getElementById("f").onsubmit=function(e){e.preventDefault();var o={};new FormData(this).forEach(function(v,k){o[k]=v});'
    + 'document.getElementById("msg").textContent="Working…";'
    + 'google.script.run.withSuccessHandler(function(r){document.getElementById("msg").style.color="#0f6e56";document.getElementById("msg").textContent=r;setTimeout(function(){google.script.host.close()},1800)})'
    + '.withFailureHandler(function(err){document.getElementById("msg").style.color="#a32d2d";document.getElementById("msg").textContent=err.message})["' + submitFn + '"](o)};</script>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(420).setHeight(110 + fields.length * 64), title);
}

function internOptions_(onlyActive) {
  return interns_().filter(function (i) { return !onlyActive || i.status.toLowerCase() === 'active'; })
    .map(function (i) { return { value: i.id, label: i.name + ' (' + i.id + ')' }; });
}

function menuAddIntern() {
  var mgrs = managers_().map(function (m) { return { value: m.email, label: m.name }; });
  dialog_('Add intern', [
    { name: 'name', label: 'Full name', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone (optional)' },
    { name: 'manager', label: 'Manager', options: mgrs },
    { name: 'start', label: 'Start date', type: 'date', value: today_(), required: true }
  ], 'addIntern', 'The intern gets a welcome email with their personal link.');
}

function addIntern(o) {
  var name = String(o.name || '').trim(), email = String(o.email || '').trim();
  if (!name || !email) throw new Error('Name and email are required.');
  var mgr = managers_().filter(function (m) { return m.email === String(o.manager).toLowerCase(); })[0];
  if (!mgr) throw new Error('Pick a manager.');
  var ints = interns_();
  if (ints.some(function (i) { return i.email.toLowerCase() === email.toLowerCase() && i.status.toLowerCase() === 'active'; }))
    throw new Error('An active intern with that email already exists.');
  var max = 0; ints.forEach(function (i) { var n = parseInt(i.id.replace(/\D/g, ''), 10); if (n > max) max = n; });
  var id = 'INT-' + ('00' + (max + 1)).slice(-3);
  var sh = sh_(TAB.roster), token = newToken_();
  // Use the original-case manager email for display
  var mgrRow = readTable_(TAB.managers)[mgr.rowNum - 2];
  sh.appendRow([id, name, email, o.phone || '', mgr.name, mgrRow[1], ymd_(o.start) || today_(), '', 'Active', token, '', '']);
  var intern = interns_().filter(function (i) { return i.id === id; })[0];
  sendInternLink_(intern);
  return name + ' added as ' + id + ' and emailed their link.';
}

function menuDeactivate() {
  dialog_('Deactivate intern', [
    { name: 'id', label: 'Intern', options: internOptions_(true) },
    { name: 'end', label: 'Last day', type: 'date', value: today_(), required: true }
  ], 'deactivateIntern', 'Their link stops accepting new hours. Past hours stay in every report.');
}

function deactivateIntern(o) {
  var i = interns_().filter(function (x) { return x.id === o.id; })[0];
  if (!i) throw new Error('Intern not found.');
  var sh = sh_(TAB.roster);
  sh.getRange(i.rowNum, 8).setValue(ymd_(o.end) || today_());
  sh.getRange(i.rowNum, 9).setValue('Inactive');
  return i.name + ' deactivated.';
}

function menuSendAllLinks() {
  var ui = SpreadsheetApp.getUi();
  var list = interns_().filter(function (i) { return i.status.toLowerCase() === 'active' && i.email; });
  if (ui.alert('Send links', 'Email a timesheet link to ' + list.length + ' active intern(s)?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  list.forEach(function (i) {
    if (!i.token) { i.token = newToken_(); sh_(TAB.roster).getRange(i.rowNum, 10).setValue(i.token); }
    sendInternLink_(i);
  });
  ui.alert(list.length + ' link(s) sent.');
}

function menuResend() { dialog_('Resend intern link', [{ name: 'id', label: 'Intern', options: internOptions_(true) }], 'resendLink', 'Sends the same link again.'); }
function resendLink(o) {
  var i = interns_().filter(function (x) { return x.id === o.id; })[0];
  if (!i) throw new Error('Intern not found.');
  if (!i.token) { i.token = newToken_(); sh_(TAB.roster).getRange(i.rowNum, 10).setValue(i.token); }
  sendInternLink_(i);
  return 'Link sent to ' + i.email + '.';
}

function menuReset() { dialog_('Reset intern link', [{ name: 'id', label: 'Intern', options: internOptions_(false) }], 'resetLink', 'Creates a new link and turns off the old one. The intern is emailed the new link.'); }
function resetLink(o) {
  var i = interns_().filter(function (x) { return x.id === o.id; })[0];
  if (!i) throw new Error('Intern not found.');
  i.token = newToken_();
  sh_(TAB.roster).getRange(i.rowNum, 10).setValue(i.token);
  if (i.status.toLowerCase() === 'active') sendInternLink_(i);
  return 'New link created for ' + i.name + '.';
}

function menuUnlock() {
  dialog_('Unlock a week', [
    { name: 'id', label: 'Intern', options: internOptions_(false) },
    { name: 'week', label: 'Any date in the week', type: 'date', required: true },
    { name: 'days', label: 'Keep unlocked for (days)', type: 'number', value: '14' },
    { name: 'reason', label: 'Reason', required: true }
  ], 'unlockWeek', 'Lets the intern correct a week older than the lock window. Logged in the Unlocks tab.');
}

function unlockWeek(o) {
  var i = interns_().filter(function (x) { return x.id === o.id; })[0];
  if (!i) throw new Error('Intern not found.');
  var week = mondayOf_(ymd_(o.week));
  if (!week) throw new Error('Pick a date.');
  var until = addDays_(today_(), Math.max(1, Number(o.days) || 14));
  var by = Session.getActiveUser().getEmail() || 'admin';
  sh_(TAB.unlocks).appendRow([i.id, i.name, week, until, by, o.reason || '']);
  return 'Week of ' + fmtDate_(week, true) + ' unlocked for ' + i.name + ' until ' + fmtDate_(until, true) + '.';
}

function menuManagerLinks() {
  var opts = [{ value: '*', label: 'Everyone on the Managers tab' }].concat(managers_().map(function (m) { return { value: m.email, label: m.name }; }));
  dialog_('Send manager links', [{ name: 'email', label: 'Send to', options: opts }], 'sendManagerLinks', 'Emails each manager their private dashboard link.');
}
function sendManagerLinks(o) {
  var n = 0;
  managers_().forEach(function (m) { if (o.email === '*' || m.email === o.email) { if (m.token) { sendManagerLink_(m); n++; } } });
  return n + ' link' + (n === 1 ? '' : 's') + ' sent.';
}

function menuTestReport() {
  var me = (Session.getActiveUser().getEmail() || '').toLowerCase();
  var admin = managers_().filter(function (m) { return m.role === 'admin'; })[0];
  var target = managers_().filter(function (m) { return m.email === me; })[0] || admin;
  if (!target) { SpreadsheetApp.getUi().alert('Add yourself to the Managers tab as Admin first.'); return; }
  sendReports_('weekly', today_(), target.email);
  SpreadsheetApp.getUi().alert('Test weekly report sent to ' + target.email + '.');
}

/* =================================================================
 * Setup
 * ================================================================= */

/** Run once (and any time something seems off): fills missing tokens, formats tabs, installs triggers. */
function setup() {
  var s = settings_();
  var rs = sh_(TAB.roster);
  interns_().forEach(function (i) { if (!i.token) rs.getRange(i.rowNum, 10).setValue(newToken_()); });
  var ms = sh_(TAB.managers);
  managers_().forEach(function (m) { if (!m.token) ms.getRange(m.rowNum, 4).setValue(newToken_()); });

  sh_(TAB.roster).getRange('G:H').setNumberFormat('yyyy-mm-dd');
  sh_(TAB.entries).getRange('C:D').setNumberFormat('yyyy-mm-dd');
  sh_(TAB.unlocks).getRange('C:D').setNumberFormat('yyyy-mm-dd');

  var status = sh_(TAB.roster).getRange('I2:I');
  status.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Active', 'Inactive'], true).build());
  sh_(TAB.managers).getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Admin', 'Manager'], true).build());
  sh_(TAB.managers).getRange('E2:E').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).build());

  [TAB.log, TAB.unlocks].forEach(function (n) {
    var p = sh_(n).protect().setDescription(n + ' is written by the system');
    p.setWarningOnly(true);
  });

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['runDailyJobs', 'runReminders'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runDailyJobs').timeBased().everyDays(1).atHour(s.reportHour).inTimezone(TZ).create();
  ScriptApp.newTrigger('runReminders').timeBased().everyDays(1).atHour(s.reminderHour).inTimezone(TZ).create();

  try {
    SpreadsheetApp.getUi().alert('Setup complete',
      'Tokens created and email schedule installed.\n\nNext: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone), then send the web app URL to Claude.',
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* running without UI */ }
}

// Node test hook (ignored by Apps Script)
if (typeof module !== 'undefined') module.exports = {
  ymd_: ymd_, addDays_: addDays_, mondayOf_: mondayOf_, addMonths_: addMonths_, isLocked_: isLocked_,
  splitOvertime_: splitOvertime_, gridToEntries_: gridToEntries_, entriesToGrid_: entriesToGrid_,
  diffEntries_: diffEntries_, cleanRows_: cleanRows_, reportPeriod_: reportPeriod_, reportsDue_: reportsDue_,
  priorPeriod_: priorPeriod_, summarize_: summarize_, weeksBetween_: weeksBetween_, reportHtml_: reportHtml_
};

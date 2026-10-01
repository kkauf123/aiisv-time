(function () {
  'use strict';

  var API = window.AIISV_API;
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var app = document.getElementById('app');
  var tip = document.getElementById('tip');

  /* ---------- token ---------- */
  var params = new URLSearchParams(location.search);
  var token = params.get('t') || '';
  try {
    if (token) localStorage.setItem('aiisv_t', token);
    else token = localStorage.getItem('aiisv_t') || '';
  } catch (e) { /* storage unavailable */ }

  /* ---------- date helpers (all in 'yyyy-mm-dd', UTC math) ---------- */
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function toMs(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function fromMs(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()); }
  function addDays(s, n) { return fromMs(toMs(s) + n * 864e5); }
  function dIdx(s) { return (new Date(toMs(s)).getUTCDay() + 6) % 7; }
  function monday(s) { return addDays(s, -dIdx(s)); }
  function fmt(s, yr) { var p = s.split('-'); return MON[+p[1] - 1] + ' ' + (+p[2]) + (yr ? ', ' + p[0] : ''); }
  function range(a, b) { return fmt(a, a.slice(0, 4) !== b.slice(0, 4)) + ' – ' + fmt(b, true); }
  function h(n) { n = Math.round((+n || 0) * 100) / 100; return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0$/, ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function addMonths(s, n) {
    var p = s.split('-'), y = +p[0], m = +p[1] - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + p2(m + 1) + '-01';
  }
  function stampLabel(s) {
    if (!s) return '';
    var m = String(s).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) return String(s);
    var hr = +m[2], ap = hr >= 12 ? 'PM' : 'AM'; hr = hr % 12 || 12;
    return fmt(m[1]) + ', ' + hr + ':' + m[3] + ' ' + ap;
  }

  /* ---------- API ---------- */
  function get(action, extra) {
    var q = new URLSearchParams(Object.assign({ action: action, t: token }, extra || {}));
    return fetch(API + '?' + q.toString()).then(parse);
  }
  function post(action, body) {
    return fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action, t: token }, body))
    }).then(parse);
  }
  function parse(r) {
    return r.json().then(function (j) { if (!j.ok) throw new Error(j.error || 'Something went wrong.'); return j; });
  }

  /* ---------- state ---------- */
  var me = null;
  var S = { week: null, data: null, rows: [], dirty: false, internId: null, readOnly: true };

  function fail(msg) {
    app.innerHTML = '<div class="wrap center"><h1>Can’t open your timesheet</h1><p class="sub">' + esc(msg) + '</p></div>';
  }

  if (!API || API.indexOf('PASTE') === 0) { fail('The site isn’t connected yet.'); return; }
  if (!token) {
    app.innerHTML = '<div class="wrap center"><h1>Open your personal link</h1><p class="sub">Use the link in your welcome email from AIISV Time Tracker. If you can’t find it, ask your manager to resend it.</p></div>';
    return;
  }

  get('me').then(function (r) {
    me = r;
    document.getElementById('who').innerHTML = esc(me.name) + (me.role !== 'intern' ? ' <span class="pill">' + (me.role === 'admin' ? 'Admin' : 'Manager') + '</span>' : '');
    if (me.role === 'intern') renderIntern(); else renderManager();
  }).catch(function (e) { fail(e.message); });

  window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* =========================================================
   * Timesheet (intern view, and manager/admin drill-in)
   * ========================================================= */

  function renderIntern() {
    app.innerHTML = '<div class="wrap"><h1>Hi ' + esc(me.name.split(' ')[0]) + '</h1>'
      + '<p class="sub">Manager: ' + esc(me.intern.manager) + ' · Log your hours one week at a time. You can go back to any earlier week.</p>'
      + '<div id="sheet"></div></div><div id="bar"></div>';
    S.internId = me.intern.id;
    loadWeek(null);
  }

  function loadWeek(week) {
    var box = document.getElementById('sheet');
    box.style.opacity = '.55';
    var q = week ? { week: week } : {};
    if (me.role !== 'intern') q.intern = S.internId;
    return get('week', q).then(function (r) {
      S.data = r; S.week = r.week; S.dirty = false;
      S.readOnly = !r.canEdit;
      S.rows = r.rows.length ? r.rows.map(cloneRow) : (S.readOnly ? [] : [blankRow()]);
      drawSheet();
      box.style.opacity = '';
    }).catch(function (e) { box.style.opacity = ''; box.innerHTML = '<div class="banner err">' + esc(e.message) + '</div>'; });
  }

  function cloneRow(r) { return { task: r.task, desc: r.desc, hours: r.hours.slice() }; }
  function blankRow(task) { return { task: task || me.taskTypes[0], desc: '', hours: [0, 0, 0, 0, 0, 0, 0] }; }

  function goWeek(w) {
    if (S.dirty && !confirm('You have unsaved changes for this week. Leave without saving?')) return;
    loadWeek(w);
  }

  function drawSheet() {
    var r = S.data, wk = S.week, today = me.today, thisMon = monday(today);
    var box = document.getElementById('sheet');
    var logged = S.rows.some(function (x) { return x.hours.some(function (v) { return v > 0; }); });

    var status;
    if (r.locked) status = '<span class="status lock">Locked</span>';
    else if (r.lastSaved) status = '<span class="status ok" id="st">Saved ' + esc(stampLabel(r.lastSaved)) + '</span>';
    else status = '<span class="status miss" id="st">Not logged yet</span>';

    var html = '<div class="card">'
      + '<div class="weeknav">'
      + '<button class="btn icon" id="prev" aria-label="Previous week">‹</button>'
      + '<div class="label">' + range(wk, addDays(wk, 6)) + '</div>'
      + '<button class="btn icon" id="next" aria-label="Next week"' + (wk >= thisMon ? ' disabled' : '') + '>›</button>'
      + (wk !== thisMon ? '<button class="btn ghost" id="thisweek">This week</button>' : '')
      + status + '</div>'
      + stripHtml(r.weeks, wk, thisMon)
      + '<div class="legend"><span class="l-ok">Hours logged</span><span class="l-miss">No hours yet</span><span class="l-now">This week</span></div>'
      + '</div>';

    html += '<div class="card">';
    if (r.locked) html += '<div class="banner lock">This week is older than ' + me.lockMonths + ' months, so it’s locked. Ask your manager if it needs a correction.</div>';
    else if (r.unlockedUntil) html += '<div class="banner info">This week was unlocked for corrections until ' + fmt(r.unlockedUntil, true) + '.</div>';
    else if (me.role === 'manager') html += '<div class="banner info">You’re viewing ' + esc(r.intern.name) + '’s timesheet. Only the intern can edit it.</div>';
    else if (me.role === 'intern' && !me.canEdit) html += '<div class="banner lock">Your timesheet is closed. You can still view past weeks.</div>';
    else if (me.role === 'admin') html += '<div class="banner info">Admin edit: changes are saved and logged under your name.</div>';

    if (!S.rows.length) {
      html += '<p class="empty">No hours logged for this week.</p>';
    } else {
      html += '<table class="grid"><thead><tr><th>Task and what you worked on</th>';
      for (var d = 0; d < 7; d++) {
        var date = addDays(wk, d);
        html += '<th class="' + (date === today ? 'today' : '') + '"><b>' + DAYS[d] + '</b>' + (+date.slice(8)) + '</th>';
      }
      html += '<th>Total</th><th><span class="sr">Remove</span></th></tr></thead><tbody>';
      S.rows.forEach(function (row, i) {
        var dis = S.readOnly ? ' disabled' : '';
        html += '<tr data-i="' + i + '"><td class="tc"><div class="taskcell"><select data-f="task" aria-label="Task type"' + dis + '>'
          + taskOptions(row.task) + '</select>'
          + '<input type="text" data-f="desc" maxlength="300" placeholder="What you worked on, e.g. LMS course outline" value="' + esc(row.desc) + '"' + dis + ' aria-label="Description"></div></td>';
        for (var d2 = 0; d2 < 7; d2++) {
          var v = row.hours[d2];
          var future = addDays(wk, d2) > today;
          html += '<td class="dc" data-d="' + DAYS[d2] + '"><input class="hr' + (v > 0 ? ' has' : '') + '" data-d="' + d2 + '" type="number" inputmode="decimal" min="0" max="24" step="0.25" value="' + (v > 0 ? h(v) : '') + '"'
            + (S.readOnly ? ' disabled' : '') + ' aria-label="' + DAYS[d2] + ' hours"' + (future ? ' placeholder="·"' : '') + '></td>';
        }
        html += '<td class="tot" data-tot="' + i + '"></td><td class="rm">'
          + (S.readOnly ? '' : '<button class="btn ghost icon" data-rm="' + i + '" aria-label="Remove row" title="Remove row">×</button>') + '</td></tr>';
      });
      html += '</tbody><tfoot><tr><td>Daily total</td>';
      for (var d3 = 0; d3 < 7; d3++) html += '<td id="dt' + d3 + '"></td>';
      html += '<td class="tot" id="gt"></td><td></td></tr></tfoot></table>';
    }

    if (!S.readOnly) {
      html += '<div class="rowtools"><button class="btn" id="add">+ Add task row</button>'
        + '<button class="btn ghost" id="copy">Copy task rows from previous week</button></div>';
    }
    html += '</div>';
    box.innerHTML = html;

    // sticky save bar
    var bar = document.getElementById('bar');
    bar.innerHTML = '<div class="savebar"><div class="wrap"><div class="totals">'
      + '<span>Regular <b id="treg">0</b></span><span>Overtime <b id="tot">0</b></span><span>Total <b id="tall">0</b></span></div>'
      + '<span class="msg" id="msg"></span>'
      + (S.readOnly ? '' : '<button class="btn primary" id="save">Save week</button>') + '</div></div>';

    wireSheet();
    totals();
    var sel = box.querySelector('.chip.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function taskOptions(cur) {
    var list = me.taskTypes.slice();
    if (cur && list.indexOf(cur) < 0) list.push(cur);
    return list.map(function (t) { return '<option' + (t === cur ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');
  }

  function stripHtml(weeks, sel, thisMon) {
    var groups = [], cur = null;
    weeks.forEach(function (w) {
      var key = w.week.slice(0, 7);
      if (!cur || cur.key !== key) { cur = { key: key, items: [] }; groups.push(cur); }
      cur.items.push(w);
    });
    return '<div class="strip" role="list">' + groups.map(function (g) {
      var p = g.key.split('-');
      return '<div class="month"><small>' + MON[+p[1] - 1] + ' ' + p[0] + '</small><div>' + g.items.map(function (w) {
        var cls = 'chip ' + (w.hours > 0 ? 'ok' : 'miss') + (w.locked ? ' lock' : '') + (w.week === thisMon ? ' now' : '') + (w.week === sel ? ' sel' : '');
        var label = w.hours > 0 ? h(w.hours) + ' h' : (w.week === thisMon ? 'open' : '—');
        return '<button role="listitem" class="' + cls + '" data-w="' + w.week + '" title="Week of ' + fmt(w.week, true) + (w.locked ? ' (locked)' : '') + '"><b>' + (+w.week.slice(8)) + '</b><i>' + label + '</i></button>';
      }).join('') + '</div></div>';
    }).join('') + '</div>';
  }

  function wireSheet() {
    var box = document.getElementById('sheet');
    box.querySelector('#prev').onclick = function () { goWeek(addDays(S.week, -7)); };
    box.querySelector('#next').onclick = function () { goWeek(addDays(S.week, 7)); };
    var tw = box.querySelector('#thisweek'); if (tw) tw.onclick = function () { goWeek(monday(me.today)); };
    box.querySelectorAll('.chip').forEach(function (c) { c.onclick = function () { goWeek(c.getAttribute('data-w')); }; });

    box.querySelectorAll('tbody tr').forEach(function (tr) {
      var i = +tr.getAttribute('data-i'), row = S.rows[i];
      tr.querySelector('select').onchange = function () { row.task = this.value; markDirty(); };
      tr.querySelector('input[data-f=desc]').oninput = function () { row.desc = this.value; this.classList.remove('bad'); markDirty(); };
      tr.querySelectorAll('input.hr').forEach(function (inp) {
        var d = +inp.getAttribute('data-d');
        inp.oninput = function () {
          var v = parseFloat(inp.value);
          row.hours[d] = isNaN(v) ? 0 : Math.max(0, Math.min(24, v));
          inp.classList.toggle('has', row.hours[d] > 0);
          inp.classList.remove('bad');
          markDirty(); totals();
        };
        inp.onblur = function () {
          var v = row.hours[d];
          var q = Math.round(v * 4) / 4;
          if (q !== v) { row.hours[d] = q; totals(); }
          inp.value = q > 0 ? h(q) : '';
        };
      });
    });
    box.querySelectorAll('[data-rm]').forEach(function (b) {
      b.onclick = function () { S.rows.splice(+b.getAttribute('data-rm'), 1); if (!S.rows.length) S.rows.push(blankRow()); markDirty(); drawSheet(); };
    });
    var add = box.querySelector('#add');
    if (add) add.onclick = function () { S.rows.push(blankRow()); markDirty(); drawSheet(); focusLast(); };
    var copy = box.querySelector('#copy');
    if (copy) copy.onclick = copyPrevious;
    var save = document.getElementById('save');
    if (save) save.onclick = saveWeek;
  }

  function focusLast() {
    var rows = document.querySelectorAll('tbody tr');
    if (rows.length) rows[rows.length - 1].querySelector('input[data-f=desc]').focus();
  }

  function markDirty() {
    S.dirty = true;
    var st = document.getElementById('st');
    if (st) { st.className = 'status dirty'; st.textContent = 'Unsaved changes'; }
    var m = document.getElementById('msg'); if (m) { m.textContent = ''; m.className = 'msg'; }
  }

  function totals() {
    var th = me.otThreshold, reg = 0, ot = 0, all = 0;
    for (var d = 0; d < 7; d++) {
      var s = S.rows.reduce(function (a, r) { return a + (r.hours[d] || 0); }, 0);
      var o = s > th ? s - th : 0;
      reg += s - o; ot += o; all += s;
      var c = document.getElementById('dt' + d);
      if (c) c.innerHTML = (s ? h(s) : '–') + (o ? '<span class="ot">+' + h(o) + ' OT</span>' : '');
    }
    S.rows.forEach(function (r, i) {
      var c = document.querySelector('[data-tot="' + i + '"]');
      if (c) { var t = r.hours.reduce(function (a, b) { return a + b; }, 0); c.textContent = t ? h(t) : '–'; }
    });
    var g = document.getElementById('gt'); if (g) g.textContent = h(all);
    document.getElementById('treg').textContent = h(reg);
    document.getElementById('tot').textContent = h(ot);
    document.getElementById('tall').textContent = h(all);
  }

  function copyPrevious() {
    var prev = addDays(S.week, -7), q = { week: prev };
    if (me.role !== 'intern') q.intern = S.internId;
    get('week', q).then(function (r) {
      if (!r.rows.length) { msg('The previous week has no task rows to copy.', 'err'); return; }
      var have = {};
      S.rows.forEach(function (x) { have[x.task + '|' + x.desc] = 1; });
      S.rows = S.rows.filter(function (x) { return x.hours.some(function (v) { return v > 0; }) || x.desc; });
      r.rows.forEach(function (x) { if (!have[x.task + '|' + x.desc]) S.rows.push({ task: x.task, desc: x.desc, hours: [0, 0, 0, 0, 0, 0, 0] }); });
      markDirty(); drawSheet(); markDirty();
      msg('Task rows copied. Fill in this week’s hours.', 'ok');
    }).catch(function (e) { msg(e.message, 'err'); });
  }

  function msg(t, kind) { var m = document.getElementById('msg'); if (m) { m.textContent = t; m.className = 'msg ' + (kind || ''); } }

  function saveWeek() {
    // client-side checks mirror the server
    var bad = false;
    document.querySelectorAll('tbody tr').forEach(function (tr) {
      var row = S.rows[+tr.getAttribute('data-i')];
      var has = row.hours.some(function (v) { return v > 0; });
      if (has && me.requireDesc && !row.desc.trim()) { tr.querySelector('input[data-f=desc]').classList.add('bad'); bad = true; }
    });
    if (bad) { msg('Add a short description for each row with hours.', 'err'); return; }
    for (var d = 0; d < 7; d++) {
      var s = S.rows.reduce(function (a, r) { return a + (r.hours[d] || 0); }, 0);
      if (s > 24) { msg(DAYS[d] + ' adds up to more than 24 hours.', 'err'); return; }
    }
    var btn = document.getElementById('save');
    btn.disabled = true; btn.textContent = 'Saving…';
    var body = { week: S.week, rows: S.rows };
    if (me.role !== 'intern') body.intern = S.internId;
    post('save', body).then(function (r) {
      S.dirty = false;
      btn.disabled = false; btn.textContent = 'Save week';
      if (!r.saved) { msg(r.message, 'ok'); return; }
      return loadWeek(S.week).then(function () { msg('Saved', 'ok'); });
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = 'Save week';
      msg(e.message, 'err');
    });
  }

  /* =========================================================
   * Manager / admin view
   * ========================================================= */

  var D = { tab: 'dash', preset: 'lastweek', from: null, to: null };

  function renderManager() {
    var scope = me.role === 'admin' ? 'all interns' : 'your interns';
    app.innerHTML = '<div class="wrap"><h1>Intern hours</h1><p class="sub">' + me.interns.length + ' intern' + (me.interns.length === 1 ? '' : 's') + ' · showing ' + scope + '</p>'
      + '<div class="tabs" role="tablist"><button class="tab on" data-tab="dash" role="tab">Dashboard</button><button class="tab" data-tab="sheets" role="tab">Timesheets</button></div>'
      + '<div id="pane"></div></div><div id="bar"></div>';
    app.querySelectorAll('.tab').forEach(function (b) {
      b.onclick = function () {
        if (S.dirty && !confirm('Leave without saving?')) return;
        S.dirty = false;
        app.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x === b); });
        D.tab = b.getAttribute('data-tab');
        D.tab === 'dash' ? drawDash() : drawSheets();
      };
    });
    drawDash();
  }

  function presetRange(p) {
    var t = me.today, m = monday(t), y = t.slice(0, 4), mo = t.slice(0, 7) + '-01';
    var q = y + '-' + p2(Math.floor((+t.slice(5, 7) - 1) / 3) * 3 + 1) + '-01';
    return {
      thisweek: [m, t], lastweek: [addDays(m, -7), addDays(m, -1)],
      thismonth: [mo, t], lastmonth: [addMonths(mo, -1), addDays(mo, -1)],
      thisquarter: [q, t], thisyear: [y + '-01-01', t]
    }[p];
  }

  function drawDash() {
    document.getElementById('bar').innerHTML = '';
    var pane = document.getElementById('pane');
    if (D.preset !== 'custom') { var r = presetRange(D.preset); D.from = r[0]; D.to = r[1]; }
    var presets = [['thisweek', 'This week'], ['lastweek', 'Last week'], ['thismonth', 'This month'], ['lastmonth', 'Last month'], ['thisquarter', 'This quarter'], ['thisyear', 'This year']];
    pane.innerHTML = '<div class="filters"><div class="seg">' + presets.map(function (p) {
      return '<button data-p="' + p[0] + '" class="' + (D.preset === p[0] ? 'on' : '') + '">' + p[1] + '</button>';
    }).join('') + '</div><input type="date" id="from" value="' + D.from + '" aria-label="From"> to <input type="date" id="to" value="' + D.to + '" aria-label="To"></div>'
      + '<div id="dash"><div class="center"><div class="spinner"></div></div></div>';
    pane.querySelectorAll('.seg button').forEach(function (b) { b.onclick = function () { D.preset = b.getAttribute('data-p'); drawDash(); }; });
    ['from', 'to'].forEach(function (id) {
      pane.querySelector('#' + id).onchange = function () {
        D.preset = 'custom'; D.from = pane.querySelector('#from').value; D.to = pane.querySelector('#to').value;
        if (D.from && D.to) drawDash();
      };
    });
    get('dashboard', { from: D.from, to: D.to }).then(drawDashData).catch(function (e) {
      document.getElementById('dash').innerHTML = '<div class="banner err">' + esc(e.message) + '</div>';
    });
  }

  function drawDashData(r) {
    var s = r.summary, el = document.getElementById('dash');
    var active = s.interns.filter(function (i) { return i.active; });
    var logging = active.filter(function (i) { return i.total > 0; }).length;
    var missing = active.reduce(function (a, i) { return a + i.missingWeeks.length; }, 0);

    var html = '<div class="kpis">'
      + kpi('Total hours', h(s.total), range(s.from, s.to))
      + kpi('Interns logging', logging + ' <small style="font-size:16px;color:var(--ink-soft)">of ' + active.length + '</small>', 'logged at least one hour')
      + kpi('Overtime', h(s.overtime), 'hours over ' + me.otThreshold + ' in a day')
      + kpi('Missing weeks', missing, 'active interns, weeks with no hours')
      + '</div>';

    html += '<div class="two"><div class="card"><h2>Hours per week</h2>' + chartHtml(r.series) + '</div>'
      + '<div class="card"><h2>By task type</h2>' + taskHtml(s) + '</div></div>';

    html += '<div class="card"><h2>By intern</h2><table class="list"><thead><tr><th>Intern</th>' + (me.role === 'admin' ? '<th class="hide-sm">Manager</th>' : '')
      + '<th class="n">Regular</th><th class="n">OT</th><th class="n">Total</th><th class="hide-sm">Missing</th><th class="hide-sm">Last saved</th><th></th></tr></thead><tbody>';
    s.interns.slice().sort(function (a, b) { return b.total - a.total; }).forEach(function (i) {
      var m = !i.active ? '<span class="tag off">' + (i.status === 'Inactive' ? 'Inactive' : 'Not started') + '</span>'
        : i.missingWeeks.length ? '<span class="tag miss" title="' + i.missingWeeks.map(function (w) { return 'Week of ' + fmt(w); }).join(', ') + '">' + i.missingWeeks.length + ' week' + (i.missingWeeks.length === 1 ? '' : 's') + '</span>'
          : '<span class="tag ok">None</span>';
      html += '<tr><td>' + esc(i.name) + '</td>' + (me.role === 'admin' ? '<td class="hide-sm">' + esc(i.manager) + '</td>' : '')
        + '<td class="n">' + h(i.regular) + '</td><td class="n">' + h(i.overtime) + '</td><td class="n"><b>' + h(i.total) + '</b></td>'
        + '<td class="hide-sm">' + m + '</td><td class="hide-sm">' + esc(stampLabel(i.lastSaved)) + '</td>'
        + '<td><button class="btn ghost" data-open="' + esc(i.id) + '">Timesheet ›</button></td></tr>';
    });
    html += '</tbody></table></div>';

    var notes = s.interns.filter(function (i) { return i.notes.length; });
    if (notes.length) {
      html += '<div class="card"><h2>What they worked on</h2>';
      notes.forEach(function (i) {
        html += '<p style="margin:12px 0 4px"><b>' + esc(i.name) + '</b></p><ul style="margin:0;padding-left:20px">'
          + i.notes.sort(function (a, b) { return b.hours - a.hours; }).slice(0, 10).map(function (n) {
            return '<li>' + esc(n.task) + (n.desc ? ' — ' + esc(n.desc) : '') + ' <span style="color:var(--ink-soft)">(' + h(n.hours) + ' h)</span></li>';
          }).join('') + '</ul>';
      });
      html += '</div>';
    }

    html += '<div class="card"><h2>Late edits</h2>';
    if (!r.lateEdits.length) html += '<p class="empty">No changes to weeks that were already reported.</p>';
    else html += '<table class="list"><thead><tr><th>When</th><th>Intern</th><th>Day</th><th class="hide-sm">Task</th><th class="n">Change</th></tr></thead><tbody>'
      + r.lateEdits.map(function (e) {
        return '<tr><td>' + esc(stampLabel(e.at)) + '</td><td>' + esc(e.intern) + '</td><td>' + fmt(e.date) + '</td><td class="hide-sm">' + esc(e.task) + '</td><td class="n">' + h(e.old) + ' → ' + h(e.new) + '</td></tr>';
      }).join('') + '</tbody></table>';
    html += '</div>';

    el.innerHTML = html;
    el.querySelectorAll('[data-open]').forEach(function (b) {
      b.onclick = function () {
        S.internId = b.getAttribute('data-open');
        app.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-tab') === 'sheets'); });
        D.tab = 'sheets'; drawSheets();
      };
    });
    wireChart(el);
  }

  function kpi(label, val, sub) { return '<div class="kpi"><small>' + label + '</small><div>' + val + '</div><span>' + sub + '</span></div>'; }

  function niceMax(v) {
    if (v <= 0) return 4;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  function chartHtml(series) {
    if (!series.length) return '<p class="empty">No weeks in this range.</p>';
    var max = niceMax(Math.max.apply(null, series.map(function (s) { return s.total; })));
    var every = Math.ceil(series.length / 8);
    var html = '<div class="chart" role="img" aria-label="Bar chart of total intern hours per week">'
      + '<div class="axis"><span>' + h(max) + '</span><span>' + h(max / 2) + '</span><span>0</span></div>'
      + '<div class="gl" style="top:0"></div><div class="gl" style="top:calc((100% - 22px) / 2)"></div>';
    series.forEach(function (s, i) {
      var pct = s.total / max * 100;
      html += '<div class="col" data-tip="Week of ' + fmt(s.week, true) + ': ' + h(s.total) + ' h"><div class="bar" style="height:' + pct + '%"></div>'
        + (i % every === 0 ? '<span class="x">' + fmt(s.week) + '</span>' : '') + '</div>';
    });
    html += '</div><table class="sr"><caption>Hours per week</caption>' + series.map(function (s) { return '<tr><td>' + s.week + '</td><td>' + s.total + '</td></tr>'; }).join('') + '</table>';
    return html;
  }

  function wireChart(el) {
    el.querySelectorAll('[data-tip]').forEach(function (c) {
      c.onmouseenter = function () {
        var r = c.getBoundingClientRect(), bar = c.querySelector('.bar').getBoundingClientRect();
        tip.textContent = c.getAttribute('data-tip'); tip.style.display = 'block';
        tip.style.left = (r.left + r.width / 2 + scrollX) + 'px';
        tip.style.top = (Math.min(bar.top, r.bottom - 22) + scrollY - 4) + 'px';
      };
      c.onmouseleave = function () { tip.style.display = 'none'; };
    });
  }

  function taskHtml(s) {
    var keys = Object.keys(s.byTask).sort(function (a, b) { return s.byTask[b] - s.byTask[a]; });
    if (!keys.length) return '<p class="empty">No hours in this range.</p>';
    var max = s.byTask[keys[0]];
    return keys.map(function (k) {
      var pct = Math.round(s.byTask[k] / s.total * 100);
      return '<div class="hbar" title="' + esc(k) + ': ' + h(s.byTask[k]) + ' h (' + pct + '%)"><span>' + esc(k) + '</span><div class="track"><div class="fill" style="width:' + (s.byTask[k] / max * 100) + '%"></div></div><span class="v">' + h(s.byTask[k]) + ' h</span></div>';
    }).join('');
  }

  function drawSheets() {
    var pane = document.getElementById('pane');
    if (!S.internId && me.interns.length) S.internId = me.interns[0].id;
    pane.innerHTML = '<div class="picker"><label for="ip"><b>Intern</b></label><select id="ip">' + me.interns.map(function (i) {
      return '<option value="' + esc(i.id) + '"' + (i.id === S.internId ? ' selected' : '') + '>' + esc(i.name) + (i.status === 'Inactive' ? ' (inactive)' : '') + '</option>';
    }).join('') + '</select></div><div id="sheet"></div>';
    if (!me.interns.length) { pane.innerHTML = '<p class="empty">No interns assigned to you yet.</p>'; return; }
    pane.querySelector('#ip').onchange = function () {
      if (S.dirty && !confirm('Leave without saving?')) { this.value = S.internId; return; }
      S.internId = this.value; loadWeek(S.week);
    };
    loadWeek(S.week);
  }
})();

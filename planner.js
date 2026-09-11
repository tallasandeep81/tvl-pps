/* TVL PPS — planning board */

const ADD_NEW = '__ADD_NEW__';
const OP_SEP = ' + ';

const S = {
  dept: null,
  start: nextWorkingDay(todayISO()),
  days: CFG.DAYS || 6,
  cells: new Map(),                 // "date|shift|res" -> {product, operator, plan, actual, rej, remarks}
  dirty: new Set(),
  demand: [],
  notes: '',
  notesDirty: false
};

const ck = (date, shift, res) => [date, shift, res].join('|');

function cell(date, shift, res) {
  const k = ck(date, shift, res);
  if (!S.cells.has(k)) {
    S.cells.set(k, { product: '', operator: '', plan: '', actual: '', rej: '', remarks: '' });
  }
  return S.cells.get(k);
}

/* Several people can share one slot. They live in the one OPERATOR cell, joined by " + ". */
function opList(v) { return String(v || '').split(/\s*\+\s*/).map(x => x.trim()).filter(Boolean); }
function opJoin(list) { return list.join(OP_SEP); }

/* "TEAM A - NARENDRA/RAJU/GOVIND/AMAN" -> label "TEAM A", members listed separately */
function opLabel(name) {
  const i = String(name || '').indexOf(' - ');
  return i > 0 ? name.slice(0, i) : name;
}
function opMembers(name) {
  const i = String(name || '').indexOf(' - ');
  return i > 0 ? name.slice(i + 3).split(/[\/,]/).map(x => x.trim()).filter(Boolean) : [];
}

/** A slot is complete once it has a product, and a person too where one is needed. */
function cellReady(c) {
  const d = Store.dept(S.dept);
  return !!c.product && (!d.hasOperator || !!c.operator);
}

/* ----------------------------------------------------------------- boot */

async function start() {
  if (!await Auth.gate()) { $('#board').innerHTML = '<p class="loading">Sign in to load the board.</p>'; return; }
  $('#who').textContent = Auth.user;
  try {
    await Store.bootstrap();
  } catch (e) {
    $('#board').innerHTML = '<p class="loading">' + e.message + '</p>';
    return;
  }
  S.dept = Store.boot.depts[0].code;
  buildTabs();
  $('#weekDate').value = S.start;
  $('#dayCount').value = String(S.days);
  await loadWeek();
}

function buildTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  Store.boot.depts.forEach(d => {
    tabs.appendChild(el('button', {
      class: 'tab', role: 'tab', 'aria-selected': String(d.code === S.dept),
      text: d.name,
      onclick: () => switchDept(d.code)
    }));
  });
  const d = Store.dept(S.dept);
  $('#mgOperators').style.display = d && d.hasOperator ? '' : 'none';
}

async function switchDept(code) {
  if ((S.dirty.size || S.notesDirty) && !confirm('You have unsaved changes. Leave them?')) return;
  S.dept = code;
  buildTabs();
  await loadWeek();
}

async function loadWeek() {
  closePicker();
  S.cells.clear(); S.dirty.clear(); S.notesDirty = false; markDirty();
  $('#board').innerHTML = '<p class="loading">Loading plan…</p>';

  const days = workingDays(S.start, S.days);
  const data = await api('board', {
    dept: S.dept, from: days[0], to: days[days.length - 1], week: weekStart(days[0])
  });

  S.demand = (data.demand || []).filter(x => x.dept === S.dept);
  (data.plan.cells || []).forEach(c => {
    S.cells.set(ck(c.date, c.shift, c.res), {
      product: c.product, operator: c.operator,
      plan: c.plan === '' ? '' : c.plan,
      actual: c.actual, rej: c.rej, remarks: c.remarks || ''
    });
  });

  const n = data.notes || {};
  S.notes = n.notes || '';
  $('#notes').value = S.notes;
  $('#notesMeta').textContent = n.updatedBy
    ? 'last edited by ' + n.updatedBy + ' · ' + String(n.updatedAt).slice(0, 16) : '';

  render();
}

/* --------------------------------------------------------------- render */

function render() {
  const d = Store.dept(S.dept);
  const days = workingDays(S.start, S.days);
  const resources = Store.resources(S.dept);
  const shifts = d.hasShift ? ['DAY', 'NIGHT'] : ['DAY'];
  const today = todayISO();

  const wrap = $('.board-wrap');
  const keepTop = wrap ? wrap.scrollTop : 0;
  const keepLeft = wrap ? wrap.scrollLeft : 0;

  const table = el('table', { class: 'board' });
  const hr = el('tr');
  hr.appendChild(el('th', { class: 'res', text: d.resourceLabel }));
  if (d.hasShift) hr.appendChild(el('th', { class: 'shift', text: 'Shift' }));
  days.forEach(day => {
    const th = el('th', { class: day === today ? 'today' : '', text: shortDate(day) });
    th.appendChild(el('small', { text: day === today ? 'Today' : day.split('-').reverse().join('.') }));
    hr.appendChild(th);
  });
  table.appendChild(el('thead', {}, hr));

  const tbody = el('tbody');
  resources.forEach(r => {
    shifts.forEach((sh, si) => {
      const tr = el('tr', { class: sh === 'NIGHT' ? 'night' : '' });
      if (si === 0) {
        const th = el('th', { class: 'res', rowspan: shifts.length });
        th.appendChild(el('div', { text: r.name }));
        th.appendChild(el('span', { class: 'type', text: r.type }));
        th.appendChild(el('button', {
          class: 'btn', style: 'margin-top:5px;padding:2px 8px;font-size:11px',
          text: 'Fill week', title: 'Copy the first day across this row',
          onclick: () => fillRow(r.id)
        }));
        tr.appendChild(th);
      }
      if (d.hasShift) tr.appendChild(el('th', { class: 'shift', text: sh === 'DAY' ? 'Day' : 'Night' }));
      days.forEach(day => {
        const td = el('td', { class: 'cell' });
        td.dataset.key = ck(day, sh, r.id);
        paintCell(td);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  });
  table.appendChild(tbody);

  const box = el('div', { class: 'board-wrap' });
  box.appendChild(table);
  box.addEventListener('scroll', closePicker, { passive: true });
  $('#board').innerHTML = '';
  $('#board').appendChild(box);
  box.scrollTop = keepTop;
  box.scrollLeft = keepLeft;

  validate();
  coverage();
}

/** Draws one cell. Cheap — plain text plus a single number input. */
function paintCell(td) {
  const [day, shift, resId] = td.dataset.key.split('|');
  const dept = Store.dept(S.dept);
  const c = cell(day, shift, resId);

  td.innerHTML = '';
  td.className = 'cell' + (c.product ? '' : ' idle') + (S.dirty.has(td.dataset.key) ? ' changed' : '');
  const stack = el('div', { class: 'stack' });

  /* product */
  stack.appendChild(el('button', {
    class: 'pick prod' + (c.product ? '' : ' empty'),
    text: c.product || '— idle —',
    title: c.product || 'Choose a product',
    onclick: e => openPicker('product', td, e.currentTarget)
  }));

  /* people */
  if (dept.hasOperator) {
    const crew = opList(c.operator);
    if (dept.multiOperator && crew.length) {
      const box = el('div', { class: 'crew' });
      crew.forEach(nm => box.appendChild(el('span', { class: 'chip' }, el('b', { text: opLabel(nm), title: nm }))));
      box.addEventListener('click', e => openPicker('operator', td, e.currentTarget));
      stack.appendChild(box);
      stack.appendChild(el('button', {
        class: 'pick op small',
        text: '+ add ' + dept.operatorLabel.toLowerCase(),
        onclick: e => openPicker('operator', td, e.currentTarget)
      }));
    } else {
      stack.appendChild(el('button', {
        class: 'pick op' + (crew.length ? '' : ' empty'),
        text: crew.length ? crew.map(opLabel).join(', ') : '— not assigned —',
        title: c.operator || 'Assign somebody',
        onclick: e => openPicker('operator', td, e.currentTarget)
      }));
      const members = opMembers(c.operator);
      if (members.length) {
        const mb = el('div', { class: 'members' });
        members.forEach(m => mb.appendChild(el('span', { text: m })));
        stack.appendChild(mb);
      }
    }
  }

  /* plan */
  const planRow = el('div', { class: 'line' });
  planRow.appendChild(el('b', { text: 'Plan' }));
  const qty = el('input', { class: 'qty', type: 'number', min: '0', step: '10', value: c.plan === '' ? '' : c.plan });
  qty.addEventListener('input', () => {
    c.plan = qty.value === '' ? '' : Number(qty.value);
    S.dirty.add(td.dataset.key);
    td.classList.add('changed');
    markDirty();
    scheduleRecalc();
  });
  planRow.appendChild(qty);
  stack.appendChild(planRow);

  /* actual */
  const actRow = el('div', { class: 'line' });
  actRow.appendChild(el('b', { text: 'Actual' }));
  const has = c.actual !== '' && c.actual !== null && c.actual !== undefined;
  if (has) {
    const v = Number(c.actual) - Number(c.plan || 0);
    actRow.appendChild(el('span', {
      class: 'actval ' + (v < 0 ? 'var-behind' : 'var-ahead'),
      title: 'Reported from Shift entry',
      text: fmt(c.actual) + (v ? '  ' + (v > 0 ? '+' : '') + fmt(v) : '')
    }));
  } else {
    actRow.appendChild(el('span', { class: 'actval actval--none', text: '—' }));
  }
  stack.appendChild(actRow);

  if (c.remarks) stack.appendChild(el('div', { class: 'reason-note', title: c.remarks, text: c.remarks }));

  td.appendChild(stack);
}

/** Repaints one cell without touching the rest of the board. */
function repaint(key) {
  const td = $('[data-key="' + key + '"]');
  if (td) paintCell(td);
}

let recalcTimer = null;
function scheduleRecalc() {
  clearTimeout(recalcTimer);
  recalcTimer = setTimeout(() => { coverage(); validate(); }, 180);
}

function markDirty() {
  const n = S.dirty.size + (S.notesDirty ? 1 : 0);
  $('#saveBtn').disabled = n === 0;
  $('#toolbar').classList.toggle('dirty', n > 0);
  $('#dirtyCount').textContent = n ? n + ' unsaved' : 'All saved';
}

function touchCell(key) {
  S.dirty.add(key);
  markDirty();
  repaint(key);
  scheduleRecalc();
}

/* ---------------------------------------------------------------- picker */

let PICK = null;      // {mode, key, anchor}

function closePicker() {
  const p = $('#picker');
  if (p) p.remove();
  PICK = null;
  document.removeEventListener('mousedown', outsidePicker, true);
}

function outsidePicker(e) {
  const p = $('#picker');
  if (p && !p.contains(e.target)) closePicker();
}

function placePicker(pop, anchor) {
  const r = anchor.getBoundingClientRect();
  pop.style.visibility = 'hidden';
  document.body.appendChild(pop);
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let left = r.left, top = r.bottom + 6;
  if (left + w > window.innerWidth - 12) left = window.innerWidth - w - 12;
  if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 6);
  pop.style.left = Math.max(12, left) + 'px';
  pop.style.top = Math.max(12, top) + 'px';
  pop.style.visibility = '';
}

function pickerShell(title, sub) {
  const pop = el('div', { id: 'picker', class: 'picker' });
  pop.appendChild(el('div', { class: 'pick-head' }, [
    el('b', { text: title }),
    el('span', { text: sub })
  ]));
  return pop;
}

/**
 * One picker, shared by every cell. Type to filter, Enter takes the first
 * match, Escape closes. Nothing is built until it is opened, which is what
 * keeps the board fast.
 */
function openPicker(mode, td, anchor) {
  closePicker();
  const key = td.dataset.key;
  const [day, shift, resId] = key.split('|');
  const dept = Store.dept(S.dept);
  const res = Store.resources(S.dept).find(r => r.id === resId);
  const c = cell(day, shift, resId);

  const pop = pickerShell(
    res.name,
    shortDate(day) + (dept.hasShift ? ' · ' + shift.toLowerCase() : '')
  );
  PICK = { mode, key, anchor };

  const search = el('input', {
    class: 'pick-search', type: 'text',
    placeholder: mode === 'product' ? 'Type a product…' : 'Type a name…'
  });
  pop.appendChild(search);

  const list = el('div', { class: 'pick-list' });
  const multi = mode === 'operator' && dept.multiOperator;
  let chosen = mode === 'operator' ? opList(c.operator) : [];

  const rows = [];
  const addRow = (value, label, note, selected) => {
    const row = el('button', {
      class: 'pick-row' + (selected ? ' on' : ''),
      onclick: () => choose(value)
    });
    row.appendChild(el('span', { class: 'pl', text: label }));
    if (note) row.appendChild(el('span', { class: 'pn', text: note }));
    row.dataset.find = (label + ' ' + (note || '')).toLowerCase();
    list.appendChild(row);
    rows.push(row);
    return row;
  };

  if (mode === 'product') {
    addRow('', '— idle —', 'nothing on this machine', !c.product);
    Store.products(S.dept).forEach(p => {
      const std = Store.stdQty(resId, p.code);
      addRow(p.code, p.code, std ? fmt(std) + ' / shift' : '', p.code === c.product);
    });
  } else {
    let lastSection = null;
    Store.operators(S.dept).forEach(o => {
      const sec = o.section || 'Other';
      if (sec !== lastSection) {
        list.appendChild(el('div', { class: 'pick-group', text: sec }));
        lastSection = sec;
      }
      addRow(o.name, opLabel(o.name), sec, chosen.indexOf(o.name) >= 0);
    });
    if (!multi) addRow('', '— not assigned —', '', !c.operator);
  }
  addRow(ADD_NEW, mode === 'product' ? '+ Add new product…' : '+ Add new person…', '', false);
  pop.appendChild(list);

  if (multi) {
    pop.appendChild(el('div', { class: 'pick-foot' }, [
      el('span', { class: 'empty', id: 'pickCount', text: chosen.length + ' assigned' }),
      el('button', { class: 'btn btn--primary', text: 'Done', onclick: () => finish() })
    ]));
  }

  async function choose(value) {
    if (value === ADD_NEW) {
      try {
        const added = mode === 'product'
          ? await Store.addProduct(S.dept, resId)
          : await Store.addOperator(S.dept, shift);
        if (!added) return;
        if (mode === 'product') { c.product = added; c.plan = Store.stdQty(resId, added) || ''; }
        else if (multi) { chosen = chosen.concat(added); }
        else { c.operator = added; }
        touchCell(key);
        closePicker();
        if (!multi && cellReady(c)) askRepeat(key);
      } catch (e) { toast(e.message, 'err'); }
      return;
    }

    if (mode === 'product') {
      const prevStd = Store.stdQty(resId, c.product);
      c.product = value;
      if (!value) c.plan = '';
      else if (c.plan === '' || c.plan === prevStd) c.plan = Store.stdQty(resId, value) || '';
      touchCell(key);
      if (cellReady(c)) showRepeat(pop, key);
      else closePicker();
      return;
    }

    if (multi) {
      chosen = chosen.indexOf(value) >= 0 ? chosen.filter(x => x !== value) : chosen.concat(value);
      c.operator = opJoin(chosen);
      touchCell(key);
      rows.forEach(r => { /* refresh ticks */ });
      Array.from(list.querySelectorAll('.pick-row')).forEach(r => {
        const lbl = r.querySelector('.pl').textContent;
        const hit = chosen.some(n => opLabel(n) === lbl);
        r.classList.toggle('on', hit);
      });
      $('#pickCount').textContent = chosen.length + ' assigned';
      return;
    }

    c.operator = value;
    touchCell(key);
    if (cellReady(c)) showRepeat(pop, key);
    else closePicker();
  }

  function finish() {
    const cc = cell(day, shift, resId);
    if (cellReady(cc)) showRepeat(pop, key);
    else closePicker();
  }

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    rows.forEach(r => {
      const hit = !q || r.dataset.find.indexOf(q) >= 0;
      r.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    Array.from(list.querySelectorAll('.pick-group')).forEach(g => {
      g.style.display = q ? 'none' : '';
    });
    list.scrollTop = 0;
  });

  search.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePicker(); return; }
    if (e.key === 'Enter') {
      const first = rows.find(r => r.style.display !== 'none');
      if (first) first.click();
    }
  });

  placePicker(pop, anchor);
  setTimeout(() => {
    search.focus();
    const on = list.querySelector('.pick-row.on');
    if (on) on.scrollIntoView({ block: 'center' });
    document.addEventListener('mousedown', outsidePicker, true);
  }, 0);
}

/* ----------------------------------------------- carry forward, in place */

/** Turns the open picker into "how many days?" so it can never appear off screen. */
function showRepeat(pop, key) {
  const [day, shift, resId] = key.split('|');
  const days = workingDays(S.start, S.days);
  const i = days.indexOf(day);
  const ahead = days.length - i - 1;
  const c = cell(day, shift, resId);

  if (sessionStorage.getItem('pps_norepeat') === '1' || ahead < 1) { closePicker(); return; }

  pop.innerHTML = '';
  const res = Store.resources(S.dept).find(r => r.id === resId);
  pop.appendChild(el('div', { class: 'pick-head' }, [
    el('b', { text: c.product }),
    el('span', {
      text: (c.operator ? opList(c.operator).map(opLabel).join(', ') + ' · ' : '') + res.name
    })
  ]));
  pop.appendChild(el('p', { class: 'pick-q', text: 'How many days should this run?' }));

  const opts = el('div', { class: 'pick-opts' });
  const max = ahead + 1;
  const choices = [];
  for (let n = 2; n <= Math.min(max, 5); n++) choices.push(n);
  if (max > 5) choices.push(max);
  choices.forEach(n => {
    opts.appendChild(el('button', {
      class: 'btn' + (n === max ? ' btn--primary' : ''),
      text: n === max ? 'All ' + n + ' days' : n + ' days',
      onclick: () => repeatForward(key, n)
    }));
  });
  pop.appendChild(opts);

  pop.appendChild(el('div', { class: 'pick-foot' }, [
    el('button', { class: 'linkish', text: 'Just this day', onclick: closePicker }),
    el('button', {
      class: 'linkish', text: "Don't ask again",
      onclick: () => { sessionStorage.setItem('pps_norepeat', '1'); closePicker(); }
    })
  ]));

  if (PICK && PICK.anchor && document.body.contains(PICK.anchor)) placePicker(pop, PICK.anchor);
}

/** Opens the carry-forward question on its own, when no picker is showing. */
function askRepeat(key) {
  const td = $('[data-key="' + key + '"]');
  if (!td) return;
  const pop = pickerShell('', '');
  PICK = { mode: 'repeat', key, anchor: td };
  placePicker(pop, td);
  showRepeat(pop, key);
  setTimeout(() => document.addEventListener('mousedown', outsidePicker, true), 0);
}

function repeatForward(key, n) {
  const [day, shift, resId] = key.split('|');
  const days = workingDays(S.start, S.days);
  const i = days.indexOf(day);
  const src = cell(day, shift, resId);
  for (let k = 1; k < n; k++) {
    const target = days[i + k];
    if (!target) break;
    const t = cell(target, shift, resId);
    t.product = src.product;
    t.operator = src.operator;
    t.plan = src.plan;
    S.dirty.add(ck(target, shift, resId));
    repaint(ck(target, shift, resId));
  }
  markDirty();
  closePicker();
  scheduleRecalc();
  toast('Carried forward for ' + n + ' days', 'ok');
}

/* ------------------------------------------------------------ row tools */

function fillRow(resId) {
  const days = workingDays(S.start, S.days);
  const shifts = Store.dept(S.dept).hasShift ? ['DAY', 'NIGHT'] : ['DAY'];
  shifts.forEach(sh => {
    const src = cell(days[0], sh, resId);
    days.slice(1).forEach(day => {
      const t = cell(day, sh, resId);
      t.product = src.product; t.operator = src.operator; t.plan = src.plan;
      S.dirty.add(ck(day, sh, resId));
      repaint(ck(day, sh, resId));
    });
  });
  markDirty();
  scheduleRecalc();
}

async function copyLastWeek() {
  if (!confirm('Copy the previous ' + S.days + ' working days onto this view? Existing entries will be overwritten.')) return;
  const prev = shiftWorkingDays(S.start, -S.days);
  await api('copyRange', {
    dept: S.dept, fromStart: prev,
    fromEnd: workingDays(prev, S.days)[S.days - 1], toStart: S.start
  });
  toast('Previous period copied across', 'ok');
  await loadWeek();
}

/* ----------------------------------------------------------- validation */

function validate() {
  const days = workingDays(S.start, S.days);
  const dept = Store.dept(S.dept);
  const shifts = dept.hasShift ? ['DAY', 'NIGHT'] : ['DAY'];
  const issues = [];
  $$('.cell.clash').forEach(td => td.classList.remove('clash'));

  days.forEach(day => {
    shifts.forEach(sh => {
      const seen = new Map();
      Store.resources(S.dept).forEach(r => {
        const c = cell(day, sh, r.id);
        if (dept.hasOperator) {
          opList(c.operator).forEach(person => {
            if (seen.has(person)) {
              issues.push({
                kind: 'err',
                text: person + ' is on ' + seen.get(person) + ' and ' + r.name + ' — ' + shortDate(day) + ' ' + sh.toLowerCase()
              });
              [seen.get(person), r.name].forEach(n => {
                const other = Store.resources(S.dept).find(x => x.name === n);
                if (!other) return;
                const td = $('[data-key="' + ck(day, sh, other.id) + '"]');
                if (td) td.classList.add('clash');
              });
            } else seen.set(person, r.name);
          });
        }
        if (c.product && dept.hasOperator && !c.operator) {
          issues.push({ kind: 'warn', text: r.name + ' has nobody assigned — ' + shortDate(day) + ' ' + sh.toLowerCase() });
        }
        if (c.product && c.plan !== '') {
          const std = Store.stdQty(r.id, c.product);
          if (std && Number(c.plan) > std * 1.15) {
            issues.push({ kind: 'warn', text: r.name + ' planned ' + fmt(c.plan) + ' vs rated ' + fmt(std) + ' — ' + shortDate(day) + ' ' + sh.toLowerCase() });
          }
        }
      });
    });
  });

  const box = $('#issues');
  box.innerHTML = '';
  if (!issues.length) {
    box.appendChild(el('p', { class: 'empty', text: 'No clashes. Every loaded machine has a product and a person.' }));
  } else {
    issues.slice(0, 40).forEach(i => box.appendChild(el('div', { class: 'issue ' + (i.kind === 'warn' ? 'warn' : ''), text: i.text })));
    if (issues.length > 40) box.appendChild(el('p', { class: 'empty', text: (issues.length - 40) + ' more' }));
  }
  const cnt = $('#issueCount');
  cnt.textContent = issues.length ? issues.length : 'clear';
  cnt.className = 'pill' + (issues.length ? '' : ' pill--ok');
}

/* -------------------------------------------------------------- coverage */

function coverage() {
  const days = workingDays(S.start, S.days);
  const shifts = Store.dept(S.dept).hasShift ? ['DAY', 'NIGHT'] : ['DAY'];
  const totals = new Map();
  let slots = 0, loaded = 0, planTotal = 0;

  days.forEach(day => shifts.forEach(sh => Store.resources(S.dept).forEach(r => {
    const c = cell(day, sh, r.id);
    slots++;
    if (!c.product) return;
    loaded++;
    planTotal += Number(c.plan) || 0;
    totals.set(c.product, (totals.get(c.product) || 0) + (Number(c.plan) || 0));
  })));

  const dem = new Map();
  S.demand.forEach(d => dem.set(d.product, (dem.get(d.product) || 0) + d.qty));

  const rows = Array.from(new Set([...totals.keys(), ...dem.keys()])).map(p => ({
    product: p, plan: totals.get(p) || 0, demand: dem.get(p) || 0
  })).sort((a, b) => b.plan - a.plan);

  const t = el('table', { class: 'list' });
  t.appendChild(el('thead', {}, el('tr', {}, [
    el('th', { text: 'Product' }), el('th', { class: 'n', text: 'Period plan' }),
    el('th', { class: 'n', text: 'Open demand' }), el('th', { text: 'Cover' })
  ])));
  const tb = el('tbody');
  rows.forEach(r => {
    const pct = r.demand ? Math.min(100, Math.round(r.plan / r.demand * 100)) : (r.plan ? 100 : 0);
    const meter = el('div', { class: 'meter' });
    meter.appendChild(el('i', { class: pct >= 100 ? 'full' : '', style: 'width:' + pct + '%' }));
    tb.appendChild(el('tr', {}, [
      el('td', { text: r.product }),
      el('td', { class: 'n', text: fmt(r.plan) }),
      el('td', { class: 'n', text: r.demand ? fmt(r.demand) : '—' }),
      el('td', {}, meter)
    ]));
  });
  t.appendChild(tb);
  $('#coverage').innerHTML = '';
  $('#coverage').appendChild(t);

  $('#kpiPlan').textContent = fmt(planTotal);
  $('#kpiSlots').textContent = loaded + ' / ' + slots;
  $('#kpiLoad').textContent = Math.round(loaded / (slots || 1) * 100) + '%';
  $('#kpiIdle').textContent = (slots - loaded);
  $('#kpiRange').textContent = shortDate(days[0]) + ' – ' + shortDate(days[days.length - 1]);

  const span = [];
  for (let d = days[0]; d <= days[days.length - 1]; d = addDays(d, 1)) span.push(d);
  const skipped = span.filter(d => holidayName(d))
    .map(d => holidayName(d) + ' ' + d.slice(8) + '/' + d.slice(5, 7));
  $('#kpiSkip').textContent = skipped.length ? 'Holiday: ' + skipped.join(', ') : 'Sundays and holidays excluded';

  $('#phDept').textContent = Store.dept(S.dept).name;
  $('#phPeriod').textContent = shortDate(days[0]) + ' – ' + shortDate(days[days.length - 1]) +
    '  ·  ' + days[0].split('-').reverse().join('.') + ' to ' + days[days.length - 1].split('-').reverse().join('.');
}

/* ------------------------------------------------------------------ save */

async function save() {
  if (!S.dirty.size && !S.notesDirty) return;
  const btn = $('#saveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const days = workingDays(S.start, S.days);

  const cells = Array.from(S.dirty).map(k => {
    const [date, shift, res] = k.split('|');
    const c = S.cells.get(k);
    return { dept: S.dept, date, shift, res, product: c.product, operator: c.operator, plan: c.plan };
  });

  try {
    let saved = 0;
    if (cells.length) saved = (await api('savePlan', { cells, mode: 'plan' })).saved;
    if (S.notesDirty) {
      await api('saveNotes', { dept: S.dept, week: weekStart(days[0]), notes: S.notes });
      S.notesDirty = false;
      $('#notesMeta').textContent = 'last edited by ' + Auth.user + ' · just now';
    }
    const keys = Array.from(S.dirty);
    S.dirty.clear();
    keys.forEach(repaint);
    toast(saved ? 'Saved — ' + saved + ' slots' : 'Notes saved', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.textContent = 'Save plan';
    markDirty();
  }
}

/* ------------------------------------------------------------ focus mode */

function toggleFocus() {
  const on = document.body.classList.toggle('focus-mode');
  if (on && !$('#focusHint')) {
    document.body.appendChild(el('div', {
      id: 'focusHint', text: 'Full screen board — Ctrl+Shift+F to bring the menus back',
      onclick: toggleFocus
    }));
  } else if (!on) {
    const h = $('#focusHint');
    if (h) h.remove();
  }
  closePicker();
}

/* ---------------------------------------------------------- roster sync */

async function syncRoster() {
  const adminPin = Auth.needAdmin();
  if (!adminPin) return;
  const btn = $('#syncBtn');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Syncing…';
  try {
    const out = await api('syncRoster', { adminPin });
    await Store.bootstrap(true);
    await loadWeek();
    toast(out.message || 'Roster synced', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

/* --------------------------------------------------------- master editor */

function closeModal() {
  const m = $('#modal');
  if (m) { m.innerHTML = ''; m.classList.remove('open'); }
}

function openManager(kind) {
  const dept = Store.dept(S.dept);
  const isProduct = kind === 'product';
  const items = isProduct ? Store.products(S.dept) : Store.operators(S.dept);
  const title = isProduct ? 'Products' : dept.operatorLabel + 's';

  const box = $('#modal');
  box.innerHTML = '';
  box.classList.add('open');

  const panel = el('div', { class: 'modal' });
  panel.appendChild(el('div', { class: 'modal-head' }, [
    el('h3', { text: 'Edit ' + title.toLowerCase() + ' — ' + dept.name }),
    el('button', { class: 'btn', text: 'Close', onclick: closeModal })
  ]));

  const body = el('div', { class: 'modal-body' });
  const filter = el('input', {
    class: 'pick-search', type: 'text', placeholder: 'Type to filter…', style: 'margin:8px 0'
  });
  body.appendChild(filter);
  if (!items.length) body.appendChild(el('p', { class: 'empty', text: 'Nothing here yet.' }));

  const rowEls = [];
  items.forEach(it => {
    const oldName = isProduct ? it.code : it.name;
    const name = el('input', {
      type: 'text', value: oldName,
      title: isProduct ? '' : (it.section ? 'Roster section: ' + it.section : '')
    });
    const extra = isProduct
      ? el('input', { type: 'number', min: '0', step: '10', value: it.std || 0 })
      : (() => {
          const sel = el('select');
          [['', 'Any'], ['DAY', 'Day'], ['NIGHT', 'Night']].forEach(([v, t]) => {
            const o = el('option', { value: v, text: t });
            if ((it.shift || '') === v) o.selected = true;
            sel.appendChild(o);
          });
          return sel;
        })();
    const st = el('select');
    [['ACTIVE', 'Active'], ['INACTIVE', 'Hidden']].forEach(([v, t]) => {
      st.appendChild(el('option', { value: v, text: t }));
    });

    const save = el('button', { class: 'btn btn--primary', text: 'Save' });
    save.addEventListener('click', async () => {
      const newName = name.value.trim().toUpperCase();
      if (!newName) { toast('Name cannot be blank', 'err'); return; }
      const adminPin = Auth.needAdmin();
      if (!adminPin) return;
      save.disabled = true; save.textContent = '…';
      try {
        const out = await api('updateMaster', {
          kind, dept: S.dept, oldName, newName, adminPin, status: st.value,
          std: isProduct ? Number(extra.value) || 0 : undefined,
          shift: isProduct ? undefined : extra.value
        });
        await Store.bootstrap(true);
        toast(oldName === newName ? 'Saved'
          : 'Renamed to ' + newName + (out.cascaded ? ' — ' + out.cascaded + ' existing rows updated' : ''), 'ok');
        closeModal();
        await loadWeek();
      } catch (e) {
        toast(e.message, 'err');
        save.disabled = false; save.textContent = 'Save';
      }
    });

    const row = el('div', { class: 'mrow' }, [name, extra, st, save]);
    row.dataset.find = (oldName + ' ' + (it.section || '')).toLowerCase();
    rowEls.push(row);
    body.appendChild(row);
  });

  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    rowEls.forEach(r => { r.style.display = !q || r.dataset.find.indexOf(q) >= 0 ? '' : 'none'; });
  });

  panel.appendChild(body);
  panel.appendChild(el('div', { class: 'modal-foot' }, [
    el('span', { class: 'empty', text: 'Renaming also updates every plan row, routing and demand line that used the old name.' }),
    el('button', {
      class: 'btn', text: '+ Add new',
      onclick: async () => {
        try {
          const added = isProduct ? await Store.addProduct(S.dept, null) : await Store.addOperator(S.dept, '');
          if (added) { closeModal(); await loadWeek(); }
        } catch (e) { toast(e.message, 'err'); }
      }
    })
  ]));

  box.appendChild(panel);
  box.addEventListener('click', e => { if (e.target === box) closeModal(); });
  setTimeout(() => filter.focus(), 0);
}

/* --------------------------------------------------------- blank format */

function printBlank() {
  const d = Store.dept(S.dept);
  const days = workingDays(S.start, S.days);
  const shifts = d.hasShift ? ['DAY', 'NIGHT'] : ['DAY'];
  const lines = d.hasOperator ? ['Product', d.operatorLabel, 'Plan', 'Actual'] : ['Product', 'Plan', 'Actual'];

  const wrap = el('div', { class: 'blank-sheet' });
  const head = el('div', { class: 'print-head' });
  const left = el('div', { class: 'ph-left' });
  left.appendChild(el('img', { src: 'logo.png', alt: 'TVL' }));
  const brand = el('div');
  brand.appendChild(el('b', { text: 'Trans Valves India Private Limited' }));
  brand.appendChild(el('span', { text: 'When Safety Matters' }));
  left.appendChild(brand);
  head.appendChild(left);
  head.appendChild(el('div', { class: 'ph-mid' }, el('b', { text: 'PRODUCTION PLANNING' })));
  const right = el('div', { class: 'ph-right' });
  right.appendChild(el('b', { text: d.name }));
  right.appendChild(el('span', {
    text: days[0].split('-').reverse().join('.') + ' to ' + days[days.length - 1].split('-').reverse().join('.')
  }));
  head.appendChild(right);
  wrap.appendChild(head);

  const table = el('table', { class: 'board blank' });
  const hr = el('tr');
  hr.appendChild(el('th', { class: 'res', text: d.resourceLabel }));
  if (d.hasShift) hr.appendChild(el('th', { class: 'shift', text: 'Shift' }));
  days.forEach(day => {
    const th = el('th', { text: shortDate(day) });
    th.appendChild(el('small', { text: day.split('-').reverse().join('.') }));
    hr.appendChild(th);
  });
  table.appendChild(el('thead', {}, hr));

  const tb = el('tbody');
  Store.resources(S.dept).forEach(r => {
    shifts.forEach((sh, si) => {
      const tr = el('tr', { class: sh === 'NIGHT' ? 'night' : '' });
      if (si === 0) {
        const th = el('th', { class: 'res', rowspan: shifts.length });
        th.appendChild(el('div', { text: r.name }));
        th.appendChild(el('span', { class: 'type', text: r.type }));
        tr.appendChild(th);
      }
      if (d.hasShift) tr.appendChild(el('th', { class: 'shift', text: sh === 'DAY' ? 'Day' : 'Night' }));
      days.forEach(() => {
        const td = el('td', { class: 'cell' });
        const stack = el('div', { class: 'stack' });
        lines.forEach(label => {
          const line = el('div', { class: 'line' });
          line.appendChild(el('b', { text: label }));
          line.appendChild(el('span', { class: 'blankbox' }));
          stack.appendChild(line);
        });
        td.appendChild(stack);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
  });
  table.appendChild(tb);
  wrap.appendChild(table);

  const nbox = el('div', { class: 'blank-notes' });
  nbox.appendChild(el('b', { text: 'Notes and instructions' }));
  nbox.appendChild(el('div', { class: 'blanklines' }));
  wrap.appendChild(nbox);

  const foot = el('div', { class: 'blank-foot' });
  foot.appendChild(el('span', { text: 'Planned by ______________________' }));
  foot.appendChild(el('span', { text: 'Checked by ______________________' }));
  foot.appendChild(el('span', { text: 'Approved by ______________________' }));
  wrap.appendChild(foot);

  const box = $('#blankWrap');
  box.innerHTML = '';
  box.appendChild(wrap);
  document.body.classList.add('printing-blank');

  const cleanup = () => {
    document.body.classList.remove('printing-blank');
    box.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 120);
}

/* ------------------------------------------------------------------ wire */

window.addEventListener('DOMContentLoaded', () => {
  $('#prevWeek').onclick = () => { S.start = shiftWorkingDays(S.start, -S.days); $('#weekDate').value = S.start; loadWeek(); };
  $('#nextWeek').onclick = () => { S.start = shiftWorkingDays(S.start, S.days); $('#weekDate').value = S.start; loadWeek(); };
  $('#todayBtn').onclick = () => { S.start = nextWorkingDay(todayISO()); $('#weekDate').value = S.start; loadWeek(); };
  $('#weekDate').onchange = e => { S.start = nextWorkingDay(e.target.value); e.target.value = S.start; loadWeek(); };
  $('#dayCount').onchange = e => { S.days = Number(e.target.value); loadWeek(); };
  $('#copyBtn').onclick = () => copyLastWeek().catch(e => toast(e.message, 'err'));
  $('#saveBtn').onclick = () => save();
  $('#printBtn').onclick = () => window.print();
  $('#blankBtn').onclick = () => printBlank();
  $('#mgProducts').onclick = () => openManager('product');
  $('#mgOperators').onclick = () => openManager('operator');
  $('#syncBtn').onclick = () => syncRoster();
  $('#notes').addEventListener('input', e => { S.notes = e.target.value; S.notesDirty = true; markDirty(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closePicker(); }
    if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); toggleFocus(); }
  });

  window.addEventListener('beforeprint', () => {
    const ta = $('#notes');
    if (ta) { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 6) + 'px'; }
  });
  window.addEventListener('afterprint', () => { const ta = $('#notes'); if (ta) ta.style.height = ''; });
  window.addEventListener('resize', closePicker);
  window.addEventListener('beforeunload', e => {
    if (S.dirty.size || S.notesDirty) { e.preventDefault(); e.returnValue = ''; }
  });

  start().catch(e => toast(e.message, 'err'));
});

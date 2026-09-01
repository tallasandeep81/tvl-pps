/* TVL PPS — weekly planning board */

const S = {
  dept: null,
  start: weekStart(todayISO()),
  days: CFG.DAYS,
  cells: new Map(),      // "date|shift|res" -> {product, operator, plan, actual, rej}
  dirty: new Set(),
  demand: []
};

const ck = (date, shift, res) => [date, shift, res].join('|');

function cell(date, shift, res) {
  const k = ck(date, shift, res);
  if (!S.cells.has(k)) S.cells.set(k, { product: '', operator: '', plan: '', actual: '', rej: '' });
  return S.cells.get(k);
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
}

async function switchDept(code) {
  if (S.dirty.size && !confirm('You have unsaved changes. Leave them?')) return;
  S.dept = code;
  buildTabs();
  await loadWeek();
}

async function loadWeek() {
  S.cells.clear(); S.dirty.clear(); markDirty();
  $('#board').innerHTML = '<p class="loading">Loading plan…</p>';
  const days = weekDays(S.start, S.days);
  const [plan, demand] = await Promise.all([
    api('getPlan', { dept: S.dept, from: days[0], to: days[days.length - 1] }),
    api('getDemand', {})
  ]);
  S.demand = demand.filter(d => d.dept === S.dept);
  plan.cells.forEach(c => {
    S.cells.set(ck(c.date, c.shift, c.res), {
      product: c.product, operator: c.operator,
      plan: c.plan === '' ? '' : c.plan,
      actual: c.actual, rej: c.rej
    });
  });
  render();
}

/* --------------------------------------------------------------- render */

function render() {
  const d = Store.dept(S.dept);
  const days = weekDays(S.start, S.days);
  const resources = Store.resources(S.dept);
  const shifts = d.hasShift ? ['DAY', 'NIGHT'] : ['DAY'];

  const table = el('table', { class: 'board' });
  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', { class: 'res', text: d.resourceLabel }));
  if (d.hasShift) hr.appendChild(el('th', { class: 'shift', text: 'Shift' }));
  days.forEach(day => {
    const th = el('th', { text: shortDate(day) });
    th.appendChild(el('small', { text: day.split('-').reverse().join('.') }));
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody');
  resources.forEach(r => {
    shifts.forEach((sh, si) => {
      const tr = el('tr', { class: sh === 'NIGHT' ? 'night' : '' });
      if (si === 0) {
        const th = el('th', { class: 'res', rowspan: shifts.length });
        th.appendChild(el('div', { text: r.name }));
        th.appendChild(el('span', { class: 'type', text: r.type }));
        th.appendChild(el('button', {
          class: 'btn', style: 'margin-top:4px;padding:1px 6px;font-size:12px',
          text: 'Fill week', title: 'Copy the first day across this row',
          onclick: () => fillRow(r.id)
        }));
        tr.appendChild(th);
      }
      if (d.hasShift) tr.appendChild(el('th', { class: 'shift', text: sh === 'DAY' ? 'Day' : 'Night' }));
      days.forEach(day => tr.appendChild(renderCell(d, r, day, sh)));
      tbody.appendChild(tr);
    });
  });
  table.appendChild(tbody);

  const wrap = el('div', { class: 'board-wrap' });
  wrap.appendChild(table);
  $('#board').innerHTML = '';
  $('#board').appendChild(wrap);

  validate();
  coverage();
}

function renderCell(dept, res, day, shift) {
  const c = cell(day, shift, res.id);
  const td = el('td', { class: 'cell' });
  td.dataset.key = ck(day, shift, res.id);
  const stack = el('div', { class: 'stack' });

  const prod = el('select', { class: 'prod' });
  prod.appendChild(el('option', { value: '', text: '— idle —' }));
  Store.products(S.dept).forEach(p => {
    const o = el('option', { value: p.code, text: p.code });
    if (p.code === c.product) o.selected = true;
    prod.appendChild(o);
  });
  prod.addEventListener('change', () => {
    const prev = c.product;
    c.product = prod.value;
    const prevStd = Store.stdQty(res.id, prev);
    if (!c.product) c.plan = '';
    else if (c.plan === '' || c.plan === prevStd) c.plan = Store.stdQty(res.id, c.product) || '';
    touch(td, day, shift, res.id);
    render();
  });
  stack.appendChild(prod);

  if (dept.hasOperator) {
    const op = el('select', { class: 'op' });
    op.appendChild(el('option', { value: '', text: '— ' + dept.operatorLabel.toLowerCase() + ' not assigned —' }));
    Store.operators(S.dept).forEach(o => {
      const opt = el('option', { value: o.name, text: o.name });
      if (o.name === c.operator) opt.selected = true;
      op.appendChild(opt);
    });
    op.addEventListener('change', () => { c.operator = op.value; touch(td, day, shift, res.id); validate(); });
    stack.appendChild(op);
  }

  const qtyRow = el('div', { class: 'qtyrow' });
  const qty = el('input', { class: 'qty', type: 'number', min: '0', step: '10', value: c.plan === '' ? '' : c.plan });
  qty.addEventListener('input', () => {
    c.plan = qty.value === '' ? '' : Number(qty.value);
    touch(td, day, shift, res.id); coverage(); validate();
  });
  qtyRow.appendChild(qty);

  if (c.actual !== '' && c.actual !== null && c.actual !== undefined) {
    const v = Number(c.actual) - Number(c.plan || 0);
    qtyRow.appendChild(el('span', {
      class: 'actual ' + (v < 0 ? 'var-behind' : 'var-ahead'),
      title: 'Actual reported',
      text: 'act ' + fmt(c.actual) + (v ? ' (' + (v > 0 ? '+' : '') + fmt(v) + ')' : '')
    }));
  }
  stack.appendChild(qtyRow);

  td.appendChild(stack);
  if (!c.product) td.classList.add('idle');
  if (S.dirty.has(ck(day, shift, res.id))) td.classList.add('changed');
  return td;
}

function touch(td, day, shift, res) {
  S.dirty.add(ck(day, shift, res));
  if (td) td.classList.add('changed');
  markDirty();
}

function markDirty() {
  $('#saveBtn').disabled = S.dirty.size === 0;
  $('#toolbar').classList.toggle('dirty', S.dirty.size > 0);
  $('#dirtyCount').textContent = S.dirty.size ? S.dirty.size + ' unsaved' : 'All saved';
}

/* ------------------------------------------------------------ row tools */

function fillRow(resId) {
  const days = weekDays(S.start, S.days);
  const shifts = Store.dept(S.dept).hasShift ? ['DAY', 'NIGHT'] : ['DAY'];
  shifts.forEach(sh => {
    const src = cell(days[0], sh, resId);
    days.slice(1).forEach(day => {
      const t = cell(day, sh, resId);
      t.product = src.product; t.operator = src.operator; t.plan = src.plan;
      S.dirty.add(ck(day, sh, resId));
    });
  });
  markDirty();
  render();
}

async function copyLastWeek() {
  if (!confirm('Copy last week\'s plan onto this week? Existing entries for this week will be overwritten.')) return;
  const prev = addDays(S.start, -7);
  const days = S.days;
  await api('copyRange', {
    dept: S.dept,
    fromStart: prev, fromEnd: addDays(prev, days - 1),
    toStart: S.start
  });
  toast('Last week copied across', 'ok');
  await loadWeek();
}

/* ------------------------------------------------------------ validation */

function validate() {
  const days = weekDays(S.start, S.days);
  const dept = Store.dept(S.dept);
  const shifts = dept.hasShift ? ['DAY', 'NIGHT'] : ['DAY'];
  const issues = [];
  $$('.cell.clash').forEach(td => td.classList.remove('clash'));

  days.forEach(day => {
    shifts.forEach(sh => {
      const seen = new Map();
      Store.resources(S.dept).forEach(r => {
        const c = cell(day, sh, r.id);
        if (dept.hasOperator && c.operator) {
          if (seen.has(c.operator)) {
            issues.push({
              kind: 'err',
              text: c.operator + ' is on ' + seen.get(c.operator) + ' and ' + r.name + ' — ' + shortDate(day) + ' ' + sh.toLowerCase()
            });
            [seen.get(c.operator), r.name].forEach(n => {
              const other = Store.resources(S.dept).find(x => x.name === n);
              if (!other) return;
              const td = $('[data-key="' + ck(day, sh, other.id) + '"]');
              if (td) td.classList.add('clash');
            });
          } else seen.set(c.operator, r.name);
        }
        if (c.product && dept.hasOperator && !c.operator) {
          issues.push({ kind: 'warn', text: r.name + ' has no ' + dept.operatorLabel.toLowerCase() + ' — ' + shortDate(day) + ' ' + sh.toLowerCase() });
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
  $('#issueCount').textContent = issues.length ? issues.length : '';
}

/* -------------------------------------------------------------- coverage */

function coverage() {
  const days = weekDays(S.start, S.days);
  const shifts = Store.dept(S.dept).hasShift ? ['DAY', 'NIGHT'] : ['DAY'];
  const totals = new Map();
  let slots = 0, loaded = 0;

  days.forEach(day => shifts.forEach(sh => Store.resources(S.dept).forEach(r => {
    const c = cell(day, sh, r.id);
    slots++;
    if (!c.product) return;
    loaded++;
    totals.set(c.product, (totals.get(c.product) || 0) + (Number(c.plan) || 0));
  })));

  const dem = new Map();
  S.demand.forEach(d => dem.set(d.product, (dem.get(d.product) || 0) + d.qty));

  const rows = Array.from(new Set([...totals.keys(), ...dem.keys()])).map(p => ({
    product: p, plan: totals.get(p) || 0, demand: dem.get(p) || 0
  })).sort((a, b) => b.plan - a.plan);

  const t = el('table', { class: 'list' });
  t.appendChild(el('thead', {}, el('tr', {}, [
    el('th', { text: 'Product' }), el('th', { class: 'n', text: 'Week plan' }),
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

  $('#load').textContent = loaded + ' of ' + slots + ' shift slots loaded (' +
    Math.round(loaded / (slots || 1) * 100) + '%)';
}

/* ------------------------------------------------------------------ save */

async function save() {
  if (!S.dirty.size) return;
  const btn = $('#saveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const cells = Array.from(S.dirty).map(k => {
    const [date, shift, res] = k.split('|');
    const c = S.cells.get(k);
    return {
      dept: S.dept, date, shift, res,
      product: c.product, operator: c.operator, plan: c.plan
    };
  });
  try {
    const out = await api('savePlan', { cells, mode: 'plan' });
    S.dirty.clear();
    toast('Plan saved — ' + out.saved + ' slots', 'ok');
    render();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.textContent = 'Save plan'; markDirty();
  }
}

/* ------------------------------------------------------------------ wire */

window.addEventListener('DOMContentLoaded', () => {
  $('#prevWeek').onclick = () => { S.start = addDays(S.start, -7); $('#weekDate').value = S.start; loadWeek(); };
  $('#nextWeek').onclick = () => { S.start = addDays(S.start, 7); $('#weekDate').value = S.start; loadWeek(); };
  $('#weekDate').onchange = e => { S.start = weekStart(e.target.value); e.target.value = S.start; loadWeek(); };
  $('#dayCount').onchange = e => { S.days = Number(e.target.value); loadWeek(); };
  $('#copyBtn').onclick = () => copyLastWeek().catch(e => toast(e.message, 'err'));
  $('#saveBtn').onclick = () => save();
  $('#printBtn').onclick = () => window.print();
  window.addEventListener('beforeunload', e => { if (S.dirty.size) { e.preventDefault(); e.returnValue = ''; } });
  start().catch(e => toast(e.message, 'err'));
});

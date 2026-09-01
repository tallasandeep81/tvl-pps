/* TVL PPS — planning board */

const ADD_NEW = '__ADD_NEW__';

const S = {
  dept: null,
  start: nextWorkingDay(todayISO()),   // today onwards, Sundays skipped
  days: CFG.DAYS || 6,
  cells: new Map(),                   // "date|shift|res" -> {product, operator, plan, actual, rej}
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
}

async function switchDept(code) {
  if (S.dirty.size && !confirm('You have unsaved changes. Leave them?')) return;
  S.dept = code;
  buildTabs();
  $('#mgOperators').style.display = Store.dept(S.dept).hasOperator ? '' : 'none';
  await loadWeek();
}

async function loadWeek() {
  S.cells.clear(); S.dirty.clear(); markDirty();
  $('#board').innerHTML = '<p class="loading">Loading plan…</p>';
  const days = workingDays(S.start, S.days);
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
  const days = workingDays(S.start, S.days);
  const resources = Store.resources(S.dept);
  const shifts = d.hasShift ? ['DAY', 'NIGHT'] : ['DAY'];
  const today = todayISO();

  const table = el('table', { class: 'board' });
  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', { class: 'res', text: d.resourceLabel }));
  if (d.hasShift) hr.appendChild(el('th', { class: 'shift', text: 'Shift' }));
  days.forEach(day => {
    const th = el('th', { class: day === today ? 'today' : '', text: shortDate(day) });
    th.appendChild(el('small', { text: day === today ? 'Today' : day.split('-').reverse().join('.') }));
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
          class: 'btn', style: 'margin-top:5px;padding:2px 8px;font-size:11px',
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

  /* product */
  const prod = el('select', { class: 'prod' });
  prod.appendChild(el('option', { value: '', text: '— idle —' }));
  Store.products(S.dept).forEach(p => {
    const o = el('option', { value: p.code, text: p.code });
    if (p.code === c.product) o.selected = true;
    prod.appendChild(o);
  });
  prod.appendChild(el('option', { value: ADD_NEW, text: '+ Add new product…' }));
  prod.addEventListener('change', async () => {
    if (prod.value === ADD_NEW) {
      prod.value = c.product;
      try {
        const code = await Store.addProduct(S.dept, res.id);
        if (code) { c.product = code; c.plan = Store.stdQty(res.id, code) || ''; touch(td, day, shift, res.id); }
      } catch (e) { toast(e.message, 'err'); }
      render();
      return;
    }
    const prev = c.product;
    c.product = prod.value;
    const prevStd = Store.stdQty(res.id, prev);
    if (!c.product) c.plan = '';
    else if (c.plan === '' || c.plan === prevStd) c.plan = Store.stdQty(res.id, c.product) || '';
    touch(td, day, shift, res.id);
    render();
  });
  stack.appendChild(prod);

  /* operator */
  if (dept.hasOperator) {
    const op = el('select', { class: 'op' });
    op.appendChild(el('option', { value: '', text: '— not assigned —' }));
    Store.operators(S.dept).forEach(o => {
      const opt = el('option', { value: o.name, text: o.name });
      if (o.name === c.operator) opt.selected = true;
      op.appendChild(opt);
    });
    op.appendChild(el('option', { value: ADD_NEW, text: '+ Add new ' + dept.operatorLabel.toLowerCase() + '…' }));
    op.addEventListener('change', async () => {
      if (op.value === ADD_NEW) {
        op.value = c.operator;
        try {
          const name = await Store.addOperator(S.dept, shift);
          if (name) { c.operator = name; touch(td, day, shift, res.id); }
        } catch (e) { toast(e.message, 'err'); }
        render();
        return;
      }
      c.operator = op.value;
      touch(td, day, shift, res.id);
      validate();
    });
    stack.appendChild(op);
  }

  /* quantity — plan row and actual row, like the Excel sheet */
  const planRow = el('div', { class: 'line' });
  planRow.appendChild(el('b', { text: 'Plan' }));
  const qty = el('input', { class: 'qty', type: 'number', min: '0', step: '10', value: c.plan === '' ? '' : c.plan });
  qty.addEventListener('input', () => {
    c.plan = qty.value === '' ? '' : Number(qty.value);
    touch(td, day, shift, res.id); coverage(); validate(); paintActual();
  });
  planRow.appendChild(qty);
  stack.appendChild(planRow);

  const actRow = el('div', { class: 'line' });
  actRow.appendChild(el('b', { text: 'Actual' }));
  const actVal = el('span', { class: 'actval', title: 'Reported from Shift entry' });
  actRow.appendChild(actVal);
  stack.appendChild(actRow);

  function paintActual() {
    const has = c.actual !== '' && c.actual !== null && c.actual !== undefined;
    if (!has) {
      actVal.textContent = '—';
      actVal.className = 'actval actval--none';
      return;
    }
    const v = Number(c.actual) - Number(c.plan || 0);
    actVal.textContent = fmt(c.actual) + (v ? '  ' + (v > 0 ? '+' : '') + fmt(v) : '');
    actVal.className = 'actval ' + (v < 0 ? 'var-behind' : 'var-ahead');
  }
  paintActual();

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
  const days = workingDays(S.start, S.days);
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
  if (!confirm('Copy the previous ' + S.days + ' working days onto this view? Existing entries will be overwritten.')) return;
  const prev = shiftWorkingDays(S.start, -S.days);
  await api('copyRange', {
    dept: S.dept,
    fromStart: prev, fromEnd: workingDays(prev, S.days)[S.days - 1],
    toStart: S.start
  });
  toast('Previous period copied across', 'ok');
  await loadWeek();
}

/* ------------------------------------------------------------ validation */

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

  const pct = Math.round(loaded / (slots || 1) * 100);
  $('#kpiPlan').textContent = fmt(planTotal);
  $('#kpiSlots').textContent = loaded + ' / ' + slots;
  $('#kpiLoad').textContent = pct + '%';
  $('#kpiIdle').textContent = (slots - loaded);
  $('#kpiRange').textContent = shortDate(days[0]) + ' – ' + shortDate(days[days.length - 1]);
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
  if (!items.length) body.appendChild(el('p', { class: 'empty', text: 'Nothing here yet.' }));

  const head = el('div', { class: 'mrow mrow--head' }, [
    el('span', { text: 'Name' }),
    el('span', { text: isProduct ? 'Std / shift' : 'Shift' }),
    el('span', { text: 'Status' }),
    el('span', { text: '' })
  ]);
  if (items.length) body.appendChild(head);

  items.forEach(it => {
    const oldName = isProduct ? it.code : it.name;
    const name = el('input', { type: 'text', value: oldName });
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
          kind, dept: S.dept, oldName, newName, adminPin,
          status: st.value,
          std: isProduct ? Number(extra.value) || 0 : undefined,
          shift: isProduct ? undefined : extra.value
        });
        await Store.bootstrap(true);
        toast(oldName === newName
          ? 'Saved'
          : 'Renamed to ' + newName + (out.cascaded ? ' — ' + out.cascaded + ' existing rows updated' : ''), 'ok');
        closeModal();
        await loadWeek();
      } catch (e) {
        toast(e.message, 'err');
        save.disabled = false; save.textContent = 'Save';
      }
    });

    body.appendChild(el('div', { class: 'mrow' }, [name, extra, st, save]));
  });

  panel.appendChild(body);
  panel.appendChild(el('div', { class: 'modal-foot' }, [
    el('span', { class: 'empty', text: 'Renaming also updates every plan row, routing and demand line that used the old name.' }),
    el('button', {
      class: 'btn', text: '+ Add new',
      onclick: async () => {
        try {
          const added = isProduct
            ? await Store.addProduct(S.dept, null)
            : await Store.addOperator(S.dept, '');
          if (added) { closeModal(); await loadWeek(); }
        } catch (e) { toast(e.message, 'err'); }
      }
    })
  ]));

  box.appendChild(panel);
  box.addEventListener('click', e => { if (e.target === box) closeModal(); });
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
  $('#mgProducts').onclick = () => openManager('product');
  $('#mgOperators').onclick = () => openManager('operator');
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  window.addEventListener('beforeunload', e => { if (S.dirty.size) { e.preventDefault(); e.returnValue = ''; } });
  start().catch(e => toast(e.message, 'err'));
});

/* TVL PPS — shift actual entry (phone friendly) */

const A = { dept: null, date: todayISO(), shift: 'DAY', rows: [], dirty: new Set() };

async function boot() {
  if (!await Auth.gate()) return;
  $('#who').textContent = Auth.user;
  await Store.bootstrap();
  const sel = $('#dept');
  Store.boot.depts.forEach(d => sel.appendChild(el('option', { value: d.code, text: d.name })));
  A.dept = sel.value;
  $('#date').value = A.date;
  await load();
}

async function load() {
  A.dept = $('#dept').value;
  A.date = $('#date').value;
  A.shift = $('#shift').value;
  A.dirty.clear(); markDirty();
  $('#list').innerHTML = '<p class="loading">Loading shift…</p>';

  const d = Store.dept(A.dept);
  const plan = await api('getPlan', { dept: A.dept, from: A.date, to: A.date });
  const shift = d.hasShift ? A.shift : 'DAY';
  $('#shift').disabled = !d.hasShift;

  A.rows = Store.resources(A.dept).map(r => {
    const c = plan.cells.find(x => x.res === r.id && x.shift === shift) || {};
    return {
      res: r.id, name: r.name, product: c.product || '', operator: c.operator || '',
      plan: c.plan === undefined ? '' : c.plan,
      actual: c.actual === undefined ? '' : c.actual,
      reason: c.remarks || ''
    };
  }).filter(r => r.product);

  render();
}

function render() {
  const list = $('#list');
  list.innerHTML = '';
  if (!A.rows.length) {
    list.appendChild(el('p', { class: 'loading', text: 'Nothing planned on this date and shift. Check the planning board first.' }));
    $('#summary').textContent = '';
    return;
  }

  list.appendChild(el('div', { class: 'entry-row entry-row--head' }, [
    el('div', { text: 'Machine and product' }),
    el('div', { style: 'text-align:right', text: 'Produced' }),
    el('div', { text: 'Reason, if short of plan' })
  ]));

  A.rows.forEach((r, i) => {
    const what = el('div', { class: 'what' }, [
      el('b', { text: r.name + ' · ' + r.product }),
      el('small', { text: (r.operator ? r.operator + ' · ' : '') + 'plan ' + fmt(r.plan) })
    ]);
    const act = el('input', {
      type: 'number', min: '0', inputmode: 'numeric',
      value: r.actual === '' ? '' : r.actual, 'aria-label': 'Produced on ' + r.name
    });

    const reasons = CFG.REASONS || [];
    const sel = el('select', { class: 'reason', 'aria-label': 'Reason on ' + r.name });
    sel.appendChild(el('option', { value: '', text: '—' }));
    reasons.forEach(x => sel.appendChild(el('option', { value: x, text: x })));
    const known = r.reason && reasons.indexOf(r.reason) >= 0;
    if (known) sel.value = r.reason;
    else if (r.reason) {
      sel.appendChild(el('option', { value: r.reason, text: r.reason }));
      sel.value = r.reason;
    }

    const row = el('div', { class: 'entry-row' }, [what, act, sel]);

    function shortfall() {
      const p = Number(r.plan) || 0, a = Number(r.actual);
      return r.actual !== '' && a < p;
    }
    function paint() {
      row.classList.toggle('needs-reason', shortfall() && !r.reason);
      sel.classList.toggle('required', shortfall() && !r.reason);
    }

    act.addEventListener('input', () => {
      r.actual = act.value === '' ? '' : Number(act.value);
      A.dirty.add(i); markDirty(); summarise(); paint();
    });
    sel.addEventListener('change', () => {
      if (sel.value === 'Other') {
        const txt = (prompt('Type the reason') || '').trim();
        if (!txt) { sel.value = r.reason || ''; return; }
        let o = Array.from(sel.options).find(x => x.value === txt);
        if (!o) { o = el('option', { value: txt, text: txt }); sel.appendChild(o); }
        sel.value = txt;
      }
      r.reason = sel.value;
      A.dirty.add(i); markDirty(); paint();
    });

    paint();
    list.appendChild(row);
  });
  summarise();
}

function summarise() {
  const plan = A.rows.reduce((s, r) => s + (Number(r.plan) || 0), 0);
  const act = A.rows.reduce((s, r) => s + (Number(r.actual) || 0), 0);
  const v = act - plan;
  $('#summary').textContent = 'plan ' + fmt(plan) + ' · actual ' + fmt(act) +
    (act ? ' · ' + (v >= 0 ? '+' : '') + fmt(v) : '');
}

function markDirty() {
  $('#saveBtn').disabled = A.dirty.size === 0;
  $('#toolbar').classList.toggle('dirty', A.dirty.size > 0);
  $('#dirtyCount').textContent = A.dirty.size ? A.dirty.size + ' unsaved' : 'All saved';
}

async function save() {
  const d = Store.dept(A.dept);
  const shift = d.hasShift ? A.shift : 'DAY';

  const missing = A.rows.filter(r =>
    r.actual !== '' && Number(r.actual) < (Number(r.plan) || 0) && !r.reason);
  if (missing.length) {
    toast('Give a reason for ' + missing.slice(0, 3).map(r => r.name).join(', ') +
      (missing.length > 3 ? ' and ' + (missing.length - 3) + ' more' : ''), 'err');
    return;
  }

  const cells = Array.from(A.dirty).map(i => {
    const r = A.rows[i];
    return { dept: A.dept, date: A.date, shift, res: r.res, actual: r.actual, remarks: r.reason };
  });
  const btn = $('#saveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await api('savePlan', { cells, mode: 'actual' });
    A.dirty.clear();
    toast('Actuals saved', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.textContent = 'Save actuals'; markDirty();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  $('#loadBtn').onclick = () => load().catch(e => toast(e.message, 'err'));
  $('#dept').onchange = () => load().catch(e => toast(e.message, 'err'));
  $('#saveBtn').onclick = save;
  boot().catch(e => toast(e.message, 'err'));
});

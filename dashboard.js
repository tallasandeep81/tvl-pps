/* TVL PPS — plan vs actual */

function pctCell(plan, actual) {
  const p = Number(plan) || 0, a = Number(actual) || 0;
  const pct = p ? Math.round(a / p * 100) : 0;
  return el('td', { class: 'n ' + (pct >= 100 ? 'var-ahead' : pct >= 90 ? '' : 'var-behind'), text: p ? pct + '%' : '—' });
}

function table(headers, rows) {
  const t = el('table', { class: 'list' });
  t.appendChild(el('thead', {}, el('tr', {}, headers.map(h =>
    el('th', { class: h.n ? 'n' : '', text: h.t })))));
  const tb = el('tbody');
  rows.forEach(r => tb.appendChild(r));
  t.appendChild(tb);
  return t;
}

/** A visible, actionable box — used instead of ever leaving "Loading…" stuck
 *  forever with no explanation. btnLabel/onClick are optional. */
function statusBox(msg, btnLabel, onClick) {
  const children = [el('p', { text: msg })];
  if (btnLabel && onClick) {
    const btn = el('button', { class: 'btn', text: btnLabel });
    btn.addEventListener('click', onClick);
    children.push(btn);
  }
  return el('div', { class: 'empty' }, children);
}

/** Puts a fresh copy of a status box (with a working click handler) into each panel. */
function showStatusEverywhere(msg, btnLabel, onClick) {
  ['#depts', '#products', '#idle'].forEach(sel => {
    const target = $(sel);
    if (target) { target.innerHTML = ''; target.appendChild(statusBox(msg, btnLabel, onClick)); }
  });
}

async function load() {
  const from = $('#from').value, to = $('#to').value;
  $('#depts').innerHTML = '<p class="loading">Loading…</p>';

  let d;
  try {
    await Store.bootstrap();
    d = await api('dashboard', { from, to });
  } catch (e) {
    // Previously this just threw and left "Loading…" on screen forever if the
    // caller's toast was missed (it auto-dismisses in ~3.6s). Now the real
    // reason stays visible until you retry.
    toast(e.message, 'err');
    showStatusEverywhere('Could not load: ' + e.message, 'Retry', () => load().catch(err => toast(err.message, 'err')));
    return;
  }

  const name = c => (Store.boot.depts.find(x => x.code === c) || {}).name || c;

  const tot = d.depts.reduce((a, r) => ({
    plan: a.plan + r.plan, actual: a.actual + r.actual, rej: a.rej + r.rej
  }), { plan: 0, actual: 0, rej: 0 });
  document.querySelector('#kpiPlan').textContent = fmt(tot.plan);
  document.querySelector('#kpiActual').textContent = fmt(tot.actual);
  document.querySelector('#kpiPct').textContent = tot.plan ? Math.round(tot.actual / tot.plan * 100) + '%' : '—';
  document.querySelector('#kpiRej').textContent = fmt(Math.max(0, tot.plan - tot.actual));
  document.querySelector('#kpiIdle').textContent = d.idleCount;

  $('#depts').innerHTML = '';
  $('#depts').appendChild(table(
    [{ t: 'Department' }, { t: 'Plan', n: 1 }, { t: 'Actual', n: 1 }, { t: 'Short', n: 1 }, { t: 'Met', n: 1 }, { t: 'Idle slots', n: 1 }],
    d.depts.sort((a, b) => b.plan - a.plan).map(r => el('tr', {}, [
      el('td', { text: name(r.dept) }),
      el('td', { class: 'n', text: fmt(r.plan) }),
      el('td', { class: 'n', text: fmt(r.actual) }),
      el('td', { class: 'n', text: fmt(Math.max(0, r.plan - r.actual)) }),
      pctCell(r.plan, r.actual),
      el('td', { class: 'n', text: r.idle + ' / ' + r.slots })
    ]))
  ));

  $('#products').innerHTML = '';
  $('#products').appendChild(table(
    [{ t: 'Product' }, { t: 'Dept' }, { t: 'Plan', n: 1 }, { t: 'Actual', n: 1 }, { t: 'Met', n: 1 }, { t: 'Open demand', n: 1 }],
    d.products.map(r => el('tr', {}, [
      el('td', { text: r.product }),
      el('td', { text: r.dept }),
      el('td', { class: 'n', text: fmt(r.plan) }),
      el('td', { class: 'n', text: fmt(r.actual) }),
      pctCell(r.plan, r.actual),
      el('td', { class: 'n', text: r.demand ? fmt(r.demand) : '—' })
    ]))
  ));

  const idleBox = $('#idle');
  idleBox.innerHTML = '';
  if (!d.idleCount) {
    idleBox.appendChild(el('p', { class: 'empty', text: 'Every machine and line was loaded in this period.' }));
  } else {
    idleBox.appendChild(el('p', { class: 'empty', text: d.idleCount + ' shift slots had no product planned.' }));
    const byRes = {};
    d.idle.forEach(c => { byRes[c.dept + ' · ' + c.res] = (byRes[c.dept + ' · ' + c.res] || 0) + 1; });
    idleBox.appendChild(table(
      [{ t: 'Machine or line' }, { t: 'Idle shifts', n: 1 }],
      Object.keys(byRes).sort((a, b) => byRes[b] - byRes[a]).map(k =>
        el('tr', {}, [el('td', { text: k }), el('td', { class: 'n', text: byRes[k] })]))
    ));
  }
}

async function boot() {
  const signedIn = await Auth.gate();
  if (!signedIn) {
    // Auth.gate() returns false both when the name/PIN prompt is cancelled
    // AND when the browser has silently auto-blocked repeated prompt()
    // dialogs from this site (Chrome does this after several reloads) —
    // either way nothing used to happen at all. A real click below is a
    // fresh user gesture, so the browser will show the prompt again.
    showStatusEverywhere(
      'Not signed in — the name/PIN prompt didn\'t go through (it may have been cancelled, or the browser blocked it after repeated reloads).',
      'Click to sign in',
      async () => { if (await Auth.gate()) location.reload(); }
    );
    return;
  }
  $('#who').textContent = Auth.user;
  const start = nextWorkingDay(todayISO());
  $('#from').value = start;
  $('#to').value = workingDays(start, CFG.DAYS)[CFG.DAYS - 1];
  $('#go').onclick = () => load().catch(e => toast(e.message, 'err'));
  $('#printBtn').onclick = () => window.print();
  load().catch(e => toast(e.message, 'err'));
}

window.addEventListener('DOMContentLoaded', () => { boot(); });

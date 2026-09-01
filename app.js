/* TVL PPS — shared client */

const CFG = window.PPS_CONFIG;

/* ---------------------------------------------------------------- auth */

const Auth = {
  get pin() { return sessionStorage.getItem('pps_pin') || ''; },
  set pin(v) { sessionStorage.setItem('pps_pin', v); },
  get user() { return localStorage.getItem('pps_user') || ''; },
  set user(v) { localStorage.setItem('pps_user', v); },

  async gate() {
    if (this.pin && this.user) return true;
    const name = prompt('Your name (goes on every entry you save)', this.user || '');
    if (!name) return false;
    const pin = prompt('Planning PIN');
    if (!pin) return false;
    this.user = name.trim().toUpperCase();
    this.pin = pin.trim();
    return true;
  },

  clear() { sessionStorage.removeItem('pps_pin'); }
};

/* ----------------------------------------------------------------- api */

async function api(action, payload = {}) {
  const body = JSON.stringify(Object.assign({ action, pin: Auth.pin, user: Auth.user }, payload));
  const res = await fetch(CFG.API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
    body,
    redirect: 'follow'
  });
  const text = await res.text();
  let out;
  try { out = JSON.parse(text); }
  catch (e) { throw new Error('Server did not return JSON. Check the /exec URL and that access is set to Anyone.'); }
  if (!out.ok) {
    if (/PIN/i.test(out.error)) Auth.clear();
    throw new Error(out.error);
  }
  return out.data;
}

/* --------------------------------------------------------------- dates */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function iso(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function parseISO(s) { return new Date(s + 'T00:00:00'); }
function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); }

function weekStart(dateISO) {
  const d = parseISO(dateISO);
  const diff = (d.getDay() - CFG.WEEK_START + 7) % 7;
  d.setDate(d.getDate() - diff);
  return iso(d);
}
function weekDays(startISO, n) {
  return Array.from({ length: n }, (_, i) => addDays(startISO, i));
}
function shortDate(s) {
  const d = parseISO(s);
  return DAY_NAMES[d.getDay()] + ' ' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}
function todayISO() { return iso(new Date()); }

/* ----------------------------------------------------------------- dom */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach(c => c && n.appendChild(c));
  return n;
}

function toast(msg, kind = 'info') {
  let box = $('#toast');
  if (!box) { box = el('div', { id: 'toast' }); document.body.appendChild(box); }
  const t = el('div', { class: 'toast toast--' + kind, text: msg });
  box.appendChild(t);
  setTimeout(() => t.classList.add('toast--out'), 2600);
  setTimeout(() => t.remove(), 3200);
}

function fmt(n) {
  if (n === '' || n === null || n === undefined || isNaN(n)) return '';
  return Number(n).toLocaleString('en-IN');
}

/* --------------------------------------------------------------- cache */

const Store = {
  boot: null,
  async bootstrap(force) {
    if (this.boot && !force) return this.boot;
    this.boot = await api('bootstrap');
    return this.boot;
  },
  dept(code) { return this.boot.depts.find(d => d.code === code); },
  resources(code) { return this.boot.resources.filter(r => r.dept === code); },
  products(code) { return this.boot.products.filter(p => p.dept === code); },
  operators(code) { return this.boot.operators.filter(o => o.dept === code); },
  stdQty(res, product) {
    const r = this.boot.routing[res + '|' + product];
    if (r !== undefined && r !== '') return r;
    const p = this.boot.products.find(x => x.code === product);
    return p ? p.std : '';
  }
};

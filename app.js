/* TVL PPS — shared client */

const CFG = window.PPS_CONFIG;

/* ---------------------------------------------------------------- auth */

const Auth = {
  get pin() { return sessionStorage.getItem('pps_pin') || ''; },
  set pin(v) { sessionStorage.setItem('pps_pin', v); },
  get user() { return localStorage.getItem('pps_user') || ''; },
  set user(v) { localStorage.setItem('pps_user', v); },
  get adminPin() { return sessionStorage.getItem('pps_admin') || ''; },
  set adminPin(v) { sessionStorage.setItem('pps_admin', v); },

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

  needAdmin() {
    if (this.adminPin) return this.adminPin;
    const p = prompt('Admin PIN (needed to add products or operators)');
    if (!p) return '';
    this.adminPin = p.trim();
    return this.adminPin;
  },

  clear() { sessionStorage.removeItem('pps_pin'); },
  clearAdmin() { sessionStorage.removeItem('pps_admin'); }
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
    if (/^Wrong PIN/i.test(out.error)) Auth.clear();
    if (/admin PIN/i.test(out.error)) Auth.clearAdmin();
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
function isSunday(s) { return parseISO(s).getDay() === 0; }

/** Next working day on or after the given date (Sunday is a holiday). */
function nextWorkingDay(s) { return isSunday(s) ? addDays(s, 1) : s; }

/** n working days starting at startISO, Sundays skipped. */
function workingDays(startISO, n) {
  const out = [];
  let d = nextWorkingDay(startISO);
  while (out.length < n) {
    out.push(d);
    d = nextWorkingDay(addDays(d, 1));
  }
  return out;
}

/** Move forward or back by n working days. */
function shiftWorkingDays(startISO, n) {
  let d = startISO, step = n > 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(n); i++) {
    do { d = addDays(d, step); } while (isSunday(d));
  }
  return d;
}

function weekStart(dateISO) {
  const d = parseISO(dateISO);
  const diff = (d.getDay() - (CFG.WEEK_START || 1) + 7) % 7;
  d.setDate(d.getDate() - diff);
  return iso(d);
}
function weekDays(startISO, n) { return workingDays(startISO, n); }

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
  setTimeout(() => t.classList.add('toast--out'), 3000);
  setTimeout(() => t.remove(), 3600);
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
  },

  /** Adds a product to M_PRODUCT (and a routing rate for this machine). */
  async addProduct(dept, res) {
    const code = (prompt('New product name (as it should appear on the board)') || '').trim().toUpperCase();
    if (!code) return null;
    const std = prompt('Standard quantity per shift on this machine', '0');
    if (std === null) return null;
    const adminPin = Auth.needAdmin();
    if (!adminPin) return null;
    await api('addProduct', { dept, res, code, std: Number(std) || 0, adminPin });
    await this.bootstrap(true);
    toast('Product "' + code + '" added', 'ok');
    return code;
  },

  /** Adds an operator to M_OPERATOR. */
  async addOperator(dept, shift) {
    const name = (prompt('New ' + (Store.dept(dept).operatorLabel || 'operator').toLowerCase() + ' name') || '').trim().toUpperCase();
    if (!name) return null;
    const adminPin = Auth.needAdmin();
    if (!adminPin) return null;
    await api('addOperator', { dept, name, shift: shift || '', adminPin });
    await this.bootstrap(true);
    toast('"' + name + '" added', 'ok');
    return name;
  }
};

/* --------------------------------------------------------------- chrome */

function mastheadLogo() {
  const img = $('.bar .logo');
  if (img) img.addEventListener('error', () => img.remove());
}
window.addEventListener('DOMContentLoaded', mastheadLogo);

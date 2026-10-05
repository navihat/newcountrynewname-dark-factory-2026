// Shared helpers for the Pocketful stage-1 black-box acceptance suite.
import assert from 'node:assert/strict';

export const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');

export async function http(method, path, { token, key, body, raw, headers = {}, noKey } = {}) {
  const h = { ...headers };
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (key !== undefined && !noKey) h['Idempotency-Key'] = key;
  let payload;
  if (raw !== undefined) {
    payload = raw;
    h['Content-Type'] = 'application/json';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h['Content-Type'] = 'application/json';
  }
  const res = await fetch(BASE_URL + path, { method, headers: h, body: payload });
  const text = await res.text();
  let json;
  try { json = text.length ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: res.status, json, text, headers: res.headers };
}

let keyCounter = 0;
export const uniq = (p = 'k') => `${p}-${Date.now().toString(36)}-${(keyCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const PW = 'correct horse';

export function user(id, handle, balance, extra = {}) {
  return { id, email: `${handle}@example.com`, password: PW, display_name: handle.toUpperCase(), handle, balance, ...extra };
}

export function fixture(over = {}) {
  const base = {
    currency: 'EUR',
    minor_units: 2,
    users: [
      user('u_ada', 'ada', 10000),
      user('u_bob', 'bob', 2500),
      user('u_cy', 'cy', 0),
      user('u_dee', 'dee', 500),
      user('u_op', 'op', 100000),
    ],
    payments: [],
    requests: [],
    settlement_operator_ids: ['u_op'],
    ...over,
  };
  if (!('settlement_operator_ids' in over)) base.settlement_operator_ids = base.settlement_operator_ids.filter((id) => base.users.some((u) => u.id === id));
  return base;
}

export async function reset(fx = fixture()) {
  const r = await http('POST', '/_test/reset', { body: fx });
  assert.equal(r.status, 204, `reset failed: ${r.status} ${r.text}`);
  return fx;
}

export async function login(handle, password = PW) {
  const r = await http('POST', '/auth/login', { body: { email: `${handle}@example.com`, password } });
  assert.equal(r.status, 200, `login ${handle}: ${r.status} ${r.text}`);
  return r.json.token;
}

/** reset + log in a set of handles; returns { fx, t: {handle: token} } */
export async function setup(fx = fixture(), handles = ['ada', 'bob', 'cy', 'dee', 'op']) {
  await reset(fx);
  const t = {};
  for (const h of handles) if (fx.users.some((u) => u.handle === h)) t[h] = await login(h);
  return { fx, t };
}

export async function balance(token) {
  const r = await http('GET', '/me', { token });
  assert.equal(r.status, 200, r.text);
  return r.json.balance;
}

export async function totalBalance(t) {
  let s = 0;
  for (const tok of Object.values(t)) s += await balance(tok);
  return s;
}

export function expectErr(r, status, code) {
  assert.equal(r.status, status, `expected ${status} ${code}, got ${r.status} ${r.text}`);
  assert.ok(r.json && r.json.error, `error envelope missing: ${r.text}`);
  assert.equal(typeof r.json.error.message, 'string', 'error.message must be a string');
  if (code) assert.equal(r.json.error.code, code, r.text);
}

export const pay = (token, body, key = uniq('pay')) => http('POST', '/payments', { token, key, body });
export const mkReq = (token, body, key = uniq('rq')) => http('POST', '/requests', { token, key, body });
export const payReq = (token, id, body = {}, key = uniq('pr')) => http('POST', `/requests/${id}/pay`, { token, key, body });
export const split = (token, body, key = uniq('sp')) => http('POST', '/splits', { token, key, body });
export const settle = (token, body, key = uniq('st')) => http('POST', '/settlements', { token, key, body });
export const get = (token, path) => http('GET', path, { token });

export const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// ---------------- stage 2 additions ----------------
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString().replace(/\.\d+Z$/, '+00:00');
export const HOUR = 3600 * 1000;

/** seeded authorization record (fixture format §Model) */
export function seedAuth(id, from, to, amount, over = {}) {
  return { id, from_user_id: from, to_user_id: to, amount, note: '', visibility: 'public', status: 'open', expires_at: iso(2 * HOUR), ...over };
}

export const mkAuth = (token, body, key = uniq('au')) => http('POST', '/authorizations', { token, key, body });
export const capture = (token, id, body = {}, key = uniq('cap')) => http('POST', `/authorizations/${id}/capture`, { token, key, body });
export const voidAuth = (token, id) => http('POST', `/authorizations/${id}/void`, { token });
export const me = async (token) => { const r = await http('GET', '/me', { token }); assert.equal(r.status, 200, r.text); return r.json; };
export const auths = async (token, q = '') => { const r = await http('GET', `/authorizations${q}`, { token }); assert.equal(r.status, 200, r.text); return r.json; };
export const authById = async (token, id) => (await auths(token, '?limit=200')).authorizations.find((a) => a.authorization_id === id);

/** assert the §/me invariants: balance == total, available = total - held, held >= 0, available >= 0 */
export function assertMeInvariants(m) {
  assert.equal(m.balance, m.total, 'balance must equal total');
  assert.equal(m.available, m.total - m.held, 'available = total - held');
  assert.ok(m.held >= 0, 'held >= 0');
  assert.ok(m.available >= 0, 'available >= 0');
}

export function expectMe(m, { total, available, held }) {
  assertMeInvariants(m);
  assert.equal(m.total, total, 'total'); assert.equal(m.balance, total, 'balance');
  assert.equal(m.available, available, 'available'); assert.equal(m.held, held, 'held');
}

/** reset + log in. fx2 users as stage-1 */
export async function setup2(over = {}, handles) {
  return setup(fixture(over), handles);
}

// ---------------- stage 3 additions ----------------
export const DAY = 24 * HOUR;
/** RFC 3339 instant (UTC offset written as +00:00) */
export const at = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, '+00:00');
export const atMs = (ms) => new Date(ms).toISOString().replace('Z', '+00:00'); // keeps milliseconds
export const ms = (s) => { const v = Date.parse(s); assert.ok(!Number.isNaN(v), `not an RFC 3339 instant: ${s}`); return v; };
/** nanosecond-precision parse of an RFC 3339 instant (for strict-ordering checks) */
export function ns(s) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(s);
  assert.ok(m, `not RFC 3339: ${s}`);
  const base = BigInt(Date.parse(`${m[1]}${m[3]}`)) * 1000000n;
  const frac = BigInt((m[2] || '').padEnd(9, '0').slice(0, 9) || '0');
  return base + frac;
}
const q = (params) => {
  const e = Object.entries(params || {}).filter(([, v]) => v !== undefined);
  return e.length ? '?' + e.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
};
export const meQ = (token, params) => http('GET', `/me${q(params)}`, { token });
export const meAt = async (token, params) => { const r = await meQ(token, params); assert.equal(r.status, 200, r.text); return r.json; };
export const stmtQ = (token, params) => http('GET', `/statement${q(params)}`, { token });
export const stmt = async (token, params) => { const r = await stmtQ(token, params); assert.equal(r.status, 200, r.text); return r.json; };
/** every page of a statement window using the given limit; returns {first, entries} */
export async function stmtAll(token, params = {}, limit = 200) {
  const first = await stmt(token, { ...params, limit, offset: 0 });
  const entries = [...first.entries];
  let page = first;
  while (page.has_more) { page = await stmt(token, { ...params, limit, offset: entries.length }); entries.push(...page.entries); }
  return { first, entries };
}
export const correct = (token, id, body, key = uniq('cor')) => http('POST', `/payments/${id}/corrections`, { token, key, body });
export const revisions = (token, id) => http('GET', `/payments/${id}/revisions`, { token });
export const corrBody = (over = {}) => ({ expected_revision: 1, amount: 100, effective_at: at(Date.now() - HOUR), reason: 'fix', ...over });

/** seeded payment record for a fixture */
export function seedPay(id, from, to, amount, created_at, over = {}) {
  const p = { id, from_user_id: from, to_user_id: to, amount, note: '', visibility: 'public', ...over };
  if (created_at !== undefined) p.created_at = created_at;
  return p;
}

/**
 * Reference ledger model.  openings: {userId: opening}; pays: [{id, from, to, revs:[{revision, amount, effective, recorded}]}]
 * times are epoch ms.  Mirrors the stage-3 rules: select latest revision recorded <= known_at, apply by effective time.
 */
export class Ledger {
  constructor(openings) { this.openings = { ...openings }; this.pays = []; }
  add(p) { this.pays.push(p); return this; }
  selected(p, knownAt = Infinity) {
    let best = null;
    for (const r of p.revs) if (r.recorded <= knownAt && (!best || r.revision > best.revision)) best = r;
    return best;
  }
  moves(user, knownAt = Infinity) {
    const out = [];
    for (const p of this.pays) {
      if (p.from !== user && p.to !== user) continue;
      const r = this.selected(p, knownAt); if (!r) continue;
      out.push({ id: p.id, effective: r.effective, recorded: r.recorded, revision: r.revision, amount: r.amount, delta: p.to === user ? r.amount : -r.amount });
    }
    out.sort((a, b) => a.effective - b.effective || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
  }
  balanceAt(user, asOf = Infinity, knownAt = Infinity) {
    return this.openings[user] + this.moves(user, knownAt).filter((m) => m.effective <= asOf).reduce((s, m) => s + m.delta, 0);
  }
  statement(user, from = -Infinity, to = Infinity, knownAt = Infinity) {
    const mv = this.moves(user, knownAt);
    const opening = this.openings[user] + mv.filter((m) => m.effective < from).reduce((s, m) => s + m.delta, 0);
    let bal = opening; const entries = [];
    for (const m of mv.filter((x) => x.effective >= from && x.effective < to)) { bal += m.delta; entries.push({ ...m, balance_after: bal }); }
    return { opening, entries, closing: bal };
  }
}

/** sum of every listed token's balance in one historical view */
export async function sumView(tokens, params) {
  let s = 0;
  for (const tk of tokens) { const m = await meAt(tk, params); assert.equal(m.balance, m.total); assert.equal(m.available, m.total - m.held); s += m.balance; }
  return s;
}

export const PAYMENT_KEYS = ['payment_id', 'from_user_id', 'from_handle', 'to_user_id', 'to_handle', 'amount', 'currency', 'note', 'visibility', 'request_id', 'created_at'];
export function assertPaymentShape(p, label = 'payment') {
  for (const k of PAYMENT_KEYS) assert.ok(k in p, `${label}.${k} missing`);
  assert.match(p.created_at, RFC3339, `${label}.created_at`);
}

/** standard historical fixture S (see README): 4 seeded payments at now-5d..now-2d */
export function fixtureS(now = Date.now()) {
  const d = (n) => at(now - n * DAY);
  return fixture({
    users: [user('u_ada', 'ada', 10000), user('u_bob', 'bob', 2500), user('u_cy', 'cy', 200), user('u_dee', 'dee', 500), user('u_op', 'op', 100000), user('u_zed', 'zed', 0)],
    payments: [
      seedPay('p_1', 'u_ada', 'u_bob', 500, d(5), { note: 'one' }),
      seedPay('p_2', 'u_bob', 'u_ada', 1200, d(4), { note: 'two', visibility: 'private' }),
      seedPay('p_3', 'u_ada', 'u_cy', 300, d(3), { note: 'three' }),
      seedPay('p_4', 'u_cy', 'u_dee', 100, d(2), { note: 'four' }),
    ],
  });
}
// openings for fixtureS: ada 9600, bob 3200, cy 0, dee 400, op 100000, zed 0
export const S_OPEN = { u_ada: 9600, u_bob: 3200, u_cy: 0, u_dee: 400, u_op: 100000, u_zed: 0 };
export const S_TOTAL = 10000 + 2500 + 200 + 500 + 100000;
export function ledgerS(now) {
  const L = new Ledger(S_OPEN); const d = (n) => now - n * DAY;
  L.add({ id: 'p_1', from: 'u_ada', to: 'u_bob', revs: [{ revision: 1, amount: 500, effective: d(5), recorded: d(5) }] });
  L.add({ id: 'p_2', from: 'u_bob', to: 'u_ada', revs: [{ revision: 1, amount: 1200, effective: d(4), recorded: d(4) }] });
  L.add({ id: 'p_3', from: 'u_ada', to: 'u_cy', revs: [{ revision: 1, amount: 300, effective: d(3), recorded: d(3) }] });
  L.add({ id: 'p_4', from: 'u_cy', to: 'u_dee', revs: [{ revision: 1, amount: 100, effective: d(2), recorded: d(2) }] });
  return L;
}
/** find a payment in a list by (from, to, amount[, note]) — ids of seeded payments are not assumed */
export const findPay = (list, from, to, amount, note) => list.find((p) => p.from_handle === from && p.to_handle === to && p.amount === amount && (note === undefined || p.note === note));

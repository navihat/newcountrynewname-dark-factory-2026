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
  return {
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

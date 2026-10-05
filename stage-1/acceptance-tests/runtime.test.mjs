import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  http, fixture, user, reset, setup, login, balance, totalBalance, expectErr, pay, mkReq, payReq, split, settle, get, uniq, PW, RFC3339,
} from './lib.mjs';

test('§3.2 GET /health -> 200 {"status":"ok"}', async () => {
  const r = await http('GET', '/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { status: 'ok' });
});

test('§3.3 reset returns 204 with empty body; seeded users log in immediately with given password', async () => {
  const r = await http('POST', '/_test/reset', { body: fixture() });
  assert.equal(r.status, 204);
  assert.equal(r.text, '');
  const l = await http('POST', '/auth/login', { body: { email: 'ada@example.com', password: PW } });
  assert.equal(l.status, 200);
  assert.equal(l.json.user_id, 'u_ada');
  assert.equal(l.json.display_name, 'ADA');
  assert.equal(typeof l.json.token, 'string');
});

test('§8 GET /me shape for EUR, JPY (0) and BHD (3) fixtures', async () => {
  for (const [cur, mu] of [['EUR', 2], ['JPY', 0], ['BHD', 3]]) {
    await reset(fixture({ currency: cur, minor_units: mu }));
    const tok = await login('ada');
    const r = await get(tok, '/me');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { user_id: 'u_ada', display_name: 'ADA', handle: 'ada', balance: 10000, currency: cur, minor_units: mu });
    const p = await pay(tok, { to_handle: 'bob', amount: 7 });
    assert.equal(p.status, 201);
    assert.equal(p.json.currency, cur);
  }
});

test('§3.3 reset replaces all state: tokens, signups, payments and requests from earlier state vanish', async () => {
  const { t } = await setup();
  const s = await http('POST', '/auth/signup', { body: { email: 'newbie@example.com', password: 'longenough1', display_name: 'N' } });
  assert.equal(s.status, 201);
  assert.equal((await pay(t.ada, { to_handle: 'bob', amount: 100 })).status, 201);
  await reset(fixture({ users: [user('u_ada', 'ada', 42)] }));
  expectErr(await get(t.ada, '/me'), 401, 'unauthenticated');
  expectErr(await get(s.json.token, '/me'), 401, 'unauthenticated');
  const l = await http('POST', '/auth/login', { body: { email: 'newbie@example.com', password: 'longenough1' } });
  expectErr(l, 401, 'unauthenticated');
  const tok = await login('ada');
  assert.equal(await balance(tok), 42);
  const a = await get(tok, '/activity');
  assert.deepEqual(a.json.payments, []);
  const rq = await get(tok, '/requests');
  assert.deepEqual(rq.json.requests, []);
  // bob no longer exists
  expectErr(await pay(tok, { to_handle: 'bob', amount: 1 }), 404, 'not_found');
});

test('§3.3 repeated resets are supported (5 in a row, idempotency keys cleared too)', async () => {
  const key = 'same-key-across-resets';
  for (let i = 0; i < 5; i++) {
    await reset();
    const tok = await login('ada');
    assert.equal(await balance(tok), 10000);
    const r = await http('POST', '/payments', { token: tok, key, body: { to_handle: 'bob', amount: 100 } });
    assert.equal(r.status, 201, 'key from before reset must not be remembered');
  }
});

test('§4 fixture: negative balance -> 422 validation_failed and nothing changes', async () => {
  const { t } = await setup();
  await pay(t.ada, { to_handle: 'bob', amount: 100 });
  const bad = fixture({ users: [user('u_x', 'x', 100), user('u_y', 'y', -1)] });
  expectErr(await http('POST', '/_test/reset', { body: bad }), 422, 'validation_failed');
  // previous state intact: old token valid, old balance
  assert.equal(await balance(t.ada), 9900);
  assert.equal(await balance(t.bob), 2600);
  const l = await http('POST', '/auth/login', { body: { email: 'x@example.com', password: PW } });
  expectErr(l, 401, 'unauthenticated');
});

test('§4 fixture: seeded payments and requests are visible; balances are NOT replayed from seeded payments', async () => {
  const fx = fixture({
    users: [user('u_ada', 'ada', 10000), user('u_bob', 'bob', 2500)],
    payments: [{ id: 'p_1', from_user_id: 'u_ada', to_user_id: 'u_bob', amount: 500, note: 'coffee', visibility: 'public' }],
    requests: [{ id: 'rq_1', requester_id: 'u_bob', payer_id: 'u_ada', amount: 1200, note: 'taxi', status: 'pending' }],
    settlement_operator_ids: [],
  });
  await reset(fx);
  const ta = await login('ada');
  const tb = await login('bob');
  assert.equal(await balance(ta), 10000);
  assert.equal(await balance(tb), 2500);
  const a = await get(ta, '/activity');
  assert.equal(a.json.payments.length, 1);
  const p = a.json.payments[0];
  assert.equal(p.from_handle, 'ada'); assert.equal(p.to_handle, 'bob'); assert.equal(p.amount, 500);
  assert.equal(p.note, 'coffee'); assert.equal(p.visibility, 'public'); assert.equal(p.request_id, null);
  const rq = await get(ta, '/requests?direction=incoming');
  assert.equal(rq.json.requests.length, 1);
  const r = rq.json.requests[0];
  assert.equal(r.requester_handle, 'bob'); assert.equal(r.payer_handle, 'ada'); assert.equal(r.amount, 1200);
  assert.equal(r.status, 'pending'); assert.equal(r.payment_id, null); assert.equal(r.note, 'taxi');
  // seeded request can be paid
  const pr = await payReq(ta, r.request_id, {});
  assert.equal(pr.status, 201);
  assert.equal(pr.json.request_id, r.request_id);
  assert.equal(await balance(ta), 8800);
  assert.equal(await balance(tb), 3700);
});

test('§3.4 unknown body fields and unknown query params are ignored; timestamps are RFC 3339 with offset', async () => {
  const { t } = await setup();
  const r = await pay(t.ada, { to_handle: 'bob', amount: 100, bogus: { a: 1 }, extra: [1] });
  assert.equal(r.status, 201);
  assert.match(r.json.created_at, RFC3339);
  assert.ok(r.json.payment_id.length <= 64);
  const a = await get(t.ada, '/activity?foo=bar&limit=5&zzz=1');
  assert.equal(a.status, 200);
  const q = await get(t.ada, '/requests?foo=bar');
  assert.equal(q.status, 200);
  const l = await http('POST', '/auth/login', { body: { email: 'ada@example.com', password: PW, junk: 1 } });
  assert.equal(l.status, 200);
  assert.match(l.headers.get('content-type') || '', /application\/json/);
});

test('§5 error envelope on 4xx: {error:{code,message}}', async () => {
  const { t } = await setup();
  const r = await get(undefined, '/me');
  expectErr(r, 401, 'unauthenticated');
  expectErr(await pay(t.ada, { to_handle: 'nobody', amount: 5 }), 404, 'not_found');
});

// ---------------- export / import ----------------

async function exportState() {
  const r = await http('GET', '/_test/export');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.track, 'pocketful');
  assert.equal(r.json.format_version, 1);
  assert.equal(typeof r.json.state, 'object');
  assert.ok(r.json.state !== null);
  return r.json;
}
const importState = (obj) => http('POST', '/_test/import', { body: obj });

test('§10 export has track/format_version/state, needs no auth', async () => {
  await setup();
  await exportState();
});

test('§10 round trip: export -> reset to other fixture -> import restores tokens, logins, balances, payments, requests, receipts, replays', async () => {
  const { t } = await setup();
  const s = await http('POST', '/auth/signup', { body: { email: 'zed@example.com', password: 'longenough1', display_name: 'Zed' } });
  assert.equal(s.status, 201);
  const keyP = uniq('p'), keyR = uniq('r'), keyPay = uniq('pay'), keySp = uniq('sp'), keySt = uniq('st');
  const bodyP = { to_handle: 'bob', amount: 1234, note: 'héllo 🌍', visibility: 'private' };
  const p = await http('POST', '/payments', { token: t.ada, key: keyP, body: bodyP });
  assert.equal(p.status, 201);
  const rq = await http('POST', '/requests', { token: t.bob, key: keyR, body: { payer_handle: 'ada', amount: 700, note: 'x' } });
  assert.equal(rq.status, 201);
  const pr = await http('POST', `/requests/${rq.json.request_id}/pay`, { token: t.ada, key: keyPay, body: { visibility: 'private' } });
  assert.equal(pr.status, 201);
  const rq2 = await mkReq(t.bob, { payer_handle: 'cy', amount: 50 });
  assert.equal(rq2.status, 201);
  const sp = await http('POST', '/splits', { token: t.ada, key: keySp, body: { amount: 1000, participant_handles: ['ada', 'bob', 'cy'] } });
  assert.equal(sp.status, 201);
  const st = await http('POST', '/settlements', { token: t.op, key: keySt, body: { transfers: [{ from_handle: 'op', to_handle: 'cy', amount: 300 }] } });
  assert.equal(st.status, 201);
  // a failed key (4xx) that must remain reusable
  const failKey = uniq('fail');
  expectErr(await http('POST', '/payments', { token: t.ada, key: failKey, body: { to_handle: 'bob', amount: 0 } }), 422, 'validation_failed');

  const bals = { ada: await balance(t.ada), bob: await balance(t.bob), cy: await balance(t.cy), zed: await balance(s.json.token) };
  const feedA = (await get(t.ada, '/activity')).json;
  const reqsB = (await get(t.bob, '/requests')).json;
  const exp = await exportState();

  // change state afterwards (must not alter the snapshot) and reset to something else entirely
  assert.equal((await pay(t.ada, { to_handle: 'bob', amount: 1 })).status, 201);
  await reset(fixture({ users: [user('u_q', 'q', 1)] }));
  expectErr(await get(t.ada, '/me'), 401, 'unauthenticated');

  const imp = await importState(exp);
  assert.equal(imp.status, 204, imp.text);
  assert.equal(imp.text, '');

  // existing tokens still valid, balances exactly as at export time (the extra 1-unit payment is gone)
  assert.equal(await balance(t.ada), bals.ada);
  assert.equal(await balance(t.bob), bals.bob);
  assert.equal(await balance(t.cy), bals.cy);
  assert.equal(await balance(s.json.token), bals.zed);
  // logins (hashed password) and signup user login
  assert.equal((await http('POST', '/auth/login', { body: { email: 'zed@example.com', password: 'longenough1' } })).json.user_id, s.json.user_id);
  assert.equal((await http('POST', '/auth/login', { body: { email: 'ada@example.com', password: PW } })).status, 200);
  expectErr(await http('POST', '/auth/login', { body: { email: 'ada@example.com', password: 'wrong-pass' } }), 401, 'unauthenticated');
  // history identical, nothing regenerated
  assert.deepEqual((await get(t.ada, '/activity')).json, feedA);
  assert.deepEqual((await get(t.bob, '/requests')).json, reqsB);
  // retries still valid: replay returns 200 with the original body
  for (const [tok, path, key, body, orig] of [
    [t.ada, '/payments', keyP, bodyP, p.json],
    [t.bob, '/requests', keyR, { payer_handle: 'ada', amount: 700, note: 'x' }, rq.json],
    [t.ada, `/requests/${rq.json.request_id}/pay`, keyPay, { visibility: 'private' }, pr.json],
    [t.ada, '/splits', keySp, { amount: 1000, participant_handles: ['ada', 'bob', 'cy'] }, sp.json],
    [t.op, '/settlements', keySt, { transfers: [{ from_handle: 'op', to_handle: 'cy', amount: 300 }] }, st.json],
  ]) {
    const rr = await http('POST', path, { token: tok, key, body });
    assert.equal(rr.status, 200, `${path}: ${rr.text}`);
    assert.deepEqual(rr.json, orig, path);
    const diff = await http('POST', path, { token: tok, key, body: { ...body, amount: 999 } });
    expectErr(diff, 409, 'idempotency_key_reuse');
  }
  // replays moved no money
  assert.equal(await balance(t.ada), bals.ada);
  // failed key is reusable
  const ok = await http('POST', '/payments', { token: t.ada, key: failKey, body: { to_handle: 'bob', amount: 5 } });
  assert.equal(ok.status, 201);
  // operator permission preserved
  assert.equal((await settle(t.op, { transfers: [{ from_handle: 'op', to_handle: 'cy', amount: 1 }] })).status, 201);
  expectErr(await settle(t.ada, { transfers: [{ from_handle: 'ada', to_handle: 'cy', amount: 1 }] }), 403, 'forbidden');
  // payments made after import get fresh ids (no collision with imported ones)
  const np = await pay(t.ada, { to_handle: 'cy', amount: 2 });
  assert.equal(np.status, 201);
  assert.notEqual(np.json.payment_id, p.json.payment_id);
  assert.notEqual(np.json.payment_id, pr.json.payment_id);
});

test('§10 import is replacement not merge; repeating import is stable; reset clears imported state', async () => {
  const { t } = await setup();
  assert.equal((await pay(t.ada, { to_handle: 'bob', amount: 111 })).status, 201);
  const exp = await exportState();
  const before = (await get(t.ada, '/activity')).json;
  // add a user + payment after export
  const s = await http('POST', '/auth/signup', { body: { email: 'late@example.com', password: 'longenough1', display_name: 'L' } });
  assert.equal(s.status, 201);
  await pay(t.ada, { to_handle: 'late', amount: 5 });
  for (let i = 0; i < 3; i++) {
    assert.equal((await importState(exp)).status, 204);
    assert.deepEqual((await get(t.ada, '/activity')).json, before, 'no duplication on repeated import');
    assert.equal(await balance(t.ada), 9889);
  }
  // late user removed along with their token and credentials
  expectErr(await get(s.json.token, '/me'), 401, 'unauthenticated');
  expectErr(await http('POST', '/auth/login', { body: { email: 'late@example.com', password: 'longenough1' } }), 401, 'unauthenticated');
  // and the late@ handle is free again
  const again = await http('POST', '/auth/signup', { body: { email: 'late@example.com', password: 'longenough1', display_name: 'L' } });
  assert.equal(again.status, 201);
  // reset clears imported state
  await reset(fixture({ users: [user('u_ada', 'ada', 5)] }));
  expectErr(await get(t.ada, '/me'), 401, 'unauthenticated');
  const tok = await login('ada');
  assert.deepEqual((await get(tok, '/activity')).json.payments, []);
});

test('§10 export is an isolated snapshot: later writes do not alter it', async () => {
  const { t } = await setup();
  const exp = await exportState();
  const frozen = JSON.stringify(exp);
  assert.equal((await pay(t.ada, { to_handle: 'bob', amount: 1000 })).status, 201);
  assert.equal(await balance(t.ada), 9000);
  // importing the earlier snapshot returns to 10000
  assert.equal(JSON.stringify(exp), frozen);
  assert.equal((await importState(exp)).status, 204);
  assert.equal(await balance(t.ada), 10000);
  assert.deepEqual((await get(t.ada, '/activity')).json.payments, []);
  // a second export taken after writes differs, an earlier one does not mutate
  await pay(t.ada, { to_handle: 'bob', amount: 1 });
  const exp2 = await exportState();
  assert.notEqual(JSON.stringify(exp2), frozen);
});

test('§10 import validation: bad JSON 400, missing fields / wrong track / wrong version / invalid state 422, destination unchanged', async () => {
  const { t } = await setup();
  await pay(t.ada, { to_handle: 'bob', amount: 100 });
  const exp = await exportState();
  const snapshotBefore = async () => JSON.stringify([await balance(t.ada), (await get(t.ada, '/activity')).json]);
  const ref = await snapshotBefore();

  expectErr(await http('POST', '/_test/import', { raw: '{not json' }), 400, 'malformed_request');
  const cases = {
    'no track': { format_version: 1, state: exp.state },
    'no format_version': { track: 'pocketful', state: exp.state },
    'no state': { track: 'pocketful', format_version: 1 },
    'wrong track': { ...exp, track: 'other' },
    'wrong version': { ...exp, format_version: 2 },
    'version 0': { ...exp, format_version: 0 },
    'state null': { ...exp, state: null },
    'state number': { ...exp, state: 5 },
    'state garbage': { ...exp, state: { nonsense: [1, 2, 3] } },
    'empty object': {},
  };
  for (const [name, body] of Object.entries(cases)) {
    const r = await importState(body);
    assert.ok(r.status === 422 || r.status === 400, `${name}: got ${r.status}`);
    if (['no track', 'no format_version', 'no state', 'wrong track', 'wrong version', 'empty object'].includes(name)) {
      expectErr(r, 422, 'validation_failed');
    } else {
      expectErr(r, r.status, r.status === 422 ? 'validation_failed' : 'malformed_request');
    }
    assert.equal(await snapshotBefore(), ref, `${name}: destination changed by failed import`);
    assert.equal(await balance(t.ada), 9900, `${name}: token must still work`);
  }
});

test('§10 export contains credentials so imported accounts can log in after a reset to an unrelated fixture', async () => {
  await setup();
  const s = await http('POST', '/auth/signup', { body: { email: 'only.in.export@example.com', password: 'sup3rsecret', display_name: 'E' } });
  assert.equal(s.status, 201);
  const exp = await exportState();
  await reset(fixture({ users: [user('u_other', 'other', 9)] }));
  assert.equal((await importState(exp)).status, 204);
  const l = await http('POST', '/auth/login', { body: { email: 'only.in.export@example.com', password: 'sup3rsecret' } });
  assert.equal(l.status, 200);
  assert.equal(l.json.user_id, s.json.user_id);
  assert.equal(await balance(s.json.token), 0);
  assert.equal(await balance(l.json.token), 0);
});

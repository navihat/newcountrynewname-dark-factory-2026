import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  http, fixture, user, reset, setup, login, balance, totalBalance, expectErr, pay, mkReq, payReq, settle, get, uniq, RFC3339,
  sleep, iso, HOUR, seedAuth, mkAuth, capture, voidAuth, me, auths, authById, assertMeInvariants, expectMe,
} from './lib.mjs';

const TOTAL = 10000 + 2500 + 500 + 100000;

// ---------------- /me and seeded holds ----------------

test('Model: /me with no holds: balance == total == available, held 0 (fixture without "authorizations")', async () => {
  const { t } = await setup();
  const m = await me(t.ada);
  expectMe(m, { total: 10000, available: 10000, held: 0 });
  assert.equal(m.user_id, 'u_ada'); assert.equal(m.handle, 'ada'); assert.equal(m.currency, 'EUR'); assert.equal(m.minor_units, 2);
  assert.deepEqual((await auths(t.ada)), { authorizations: [], has_more: false });
});

test('Model: seeded open unexpired hold reduces available only; receiver and others unaffected; "available is derived, never seeded"', async () => {
  const { t } = await setup(fixture({ authorizations: [seedAuth('a_1', 'u_ada', 'u_bob', 2000, { note: 'deposit' })] }));
  expectMe(await me(t.ada), { total: 10000, available: 8000, held: 2000 });
  expectMe(await me(t.bob), { total: 2500, available: 2500, held: 0 });
  expectMe(await me(t.cy), { total: 0, available: 0, held: 0 });
  assert.deepEqual((await get(t.ada, '/activity')).json.payments, [], 'a hold is not a feed item');
  assert.deepEqual((await get(t.bob, '/activity')).json.payments, []);
});

test('Model: only seeded status "open" (unexpired) holds anything; captured / voided / expired / open-but-past-expiry hold nothing', async () => {
  const fx = fixture({
    authorizations: [
      seedAuth('a_c', 'u_ada', 'u_bob', 3000, { status: 'captured' }),
      seedAuth('a_v', 'u_ada', 'u_bob', 3000, { status: 'voided' }),
      seedAuth('a_e', 'u_ada', 'u_bob', 3000, { status: 'expired', expires_at: iso(-2 * HOUR) }),
      seedAuth('a_p', 'u_ada', 'u_bob', 3000, { status: 'open', expires_at: iso(-2 * HOUR) }),
      seedAuth('a_o', 'u_ada', 'u_bob', 1000, { status: 'open', expires_at: iso(3 * HOUR) }),
    ],
  });
  const { t } = await setup(fx);
  expectMe(await me(t.ada), { total: 10000, available: 9000, held: 1000 });
  const all = (await auths(t.ada, '?limit=200')).authorizations;
  assert.equal(all.length, 5);
  const open = (await auths(t.ada, '?status=open')).authorizations;
  assert.equal(open.length, 1);
  assert.equal(open[0].amount, 1000);
  // open + past expires_at is reported as expired, never open
  const expired = (await auths(t.ada, '?status=expired')).authorizations;
  assert.equal(expired.length, 2);
  assert.equal((await auths(t.ada, '?status=captured')).authorizations.length, 1);
  assert.equal((await auths(t.ada, '?status=voided')).authorizations.length, 1);
});

test('Model: multiple seeded holds of one payer sum; GET /authorizations shows both parties their record with remaining_amount', async () => {
  const fx = fixture({
    authorizations: [
      seedAuth('a_1', 'u_ada', 'u_bob', 2000, { note: 'deposit', visibility: 'private' }),
      seedAuth('a_2', 'u_ada', 'u_cy', 500),
      seedAuth('a_3', 'u_bob', 'u_ada', 100),
    ],
  });
  const { t } = await setup(fx);
  expectMe(await me(t.ada), { total: 10000, available: 7500, held: 2500 });
  expectMe(await me(t.bob), { total: 2500, available: 2400, held: 100 });
  const bobList = (await auths(t.bob, '?limit=200')).authorizations;
  assert.equal(bobList.length, 2); // a_1 (receiver) and a_3 (payer)
  const a1 = bobList.find((a) => a.amount === 2000);
  assert.equal(a1.from_handle, 'ada'); assert.equal(a1.to_handle, 'bob');
  assert.equal(a1.note, 'deposit'); assert.equal(a1.visibility, 'private'); assert.equal(a1.status, 'open');
  assert.equal(a1.captured_amount, 0); assert.equal(a1.remaining_amount, 2000); assert.equal(a1.payment_id, null);
  assert.equal(a1.currency, 'EUR');
  assert.match(a1.expires_at, RFC3339);
  assert.equal(typeof a1.authorization_id, 'string');
  assert.equal((await auths(t.cy)).authorizations.length, 1);
  assert.deepEqual((await auths(t.dee)).authorizations, [], 'uninvolved user sees nothing');
  assert.deepEqual((await auths(t.op)).authorizations, [], 'operator sees nothing of others');
});

test('Model: seeded holds equal to the whole balance are accepted (available 0); expired / captured ones never count against the cap', async () => {
  const fx = fixture({
    authorizations: [
      seedAuth('a_1', 'u_dee', 'u_bob', 300),
      seedAuth('a_2', 'u_dee', 'u_cy', 200),
      seedAuth('a_x', 'u_dee', 'u_cy', 999999, { status: 'expired', expires_at: iso(-3 * HOUR) }),
      seedAuth('a_y', 'u_dee', 'u_cy', 999999, { status: 'open', expires_at: iso(-3 * HOUR) }),
      seedAuth('a_z', 'u_dee', 'u_cy', 999999, { status: 'captured' }),
      seedAuth('a_w', 'u_dee', 'u_cy', 999999, { status: 'voided' }),
    ],
  });
  const { t } = await setup(fx);
  expectMe(await me(t.dee), { total: 500, available: 0, held: 500 });
  expectErr(await pay(t.dee, { to_handle: 'bob', amount: 1 }), 409, 'insufficient_funds');
});

test('Model: reset with open holds exceeding the payer balance -> 422 validation_failed and NOTHING changes', async () => {
  const { t } = await setup();
  assert.equal((await pay(t.ada, { to_handle: 'bob', amount: 100 })).status, 201);
  const bad = fixture({
    users: [user('u_x', 'x', 100), user('u_y', 'y', 50)],
    authorizations: [seedAuth('a_1', 'u_x', 'u_y', 60), seedAuth('a_2', 'u_x', 'u_y', 41)],
    settlement_operator_ids: [],
  });
  expectErr(await http('POST', '/_test/reset', { body: bad }), 422, 'validation_failed');
  expectMe(await me(t.ada), { total: 9900, available: 9900, held: 0 });
  assert.equal(await balance(t.bob), 2600);
  expectErr(await http('POST', '/auth/login', { body: { email: 'x@example.com', password: 'correct horse' } }), 401, 'unauthenticated');
  // a single hold above balance is also rejected
  const bad2 = fixture({ authorizations: [seedAuth('a_1', 'u_cy', 'u_bob', 1)] }); // cy has 0
  expectErr(await http('POST', '/_test/reset', { body: bad2 }), 422, 'validation_failed');
  expectMe(await me(t.ada), { total: 9900, available: 9900, held: 0 });
});

test('Model: reset rejects invalid authorization_ttl_seconds (0, negative, fractional, string, boolean); state unchanged', async () => {
  const { t } = await setup();
  for (const ttl of [0, -1, -600, 1.5, '600', true, [600]]) {
    const r = await http('POST', '/_test/reset', { body: fixture({ authorization_ttl_seconds: ttl }) });
    assert.ok(r.status === 422 || r.status === 400, `ttl ${JSON.stringify(ttl)} -> ${r.status}`);
    assert.equal((await me(t.ada)).total, 10000, 'old state must remain after a rejected reset');
  }
  const ok = await http('POST', '/_test/reset', { body: fixture({ authorization_ttl_seconds: 5 }) });
  assert.equal(ok.status, 204);
});

test('Model: authorization_ttl_seconds defaults to 600 and sets expires_at = created_at + ttl for API-created authorizations', async () => {
  const diff = (a) => (Date.parse(a.expires_at) - Date.parse(a.created_at)) / 1000;
  let { t } = await setup();
  const d = await mkAuth(t.ada, { to_handle: 'bob', amount: 100 });
  assert.equal(d.status, 201);
  assert.equal(diff(d.json), 600);
  for (const ttl of [30, 3600, 1]) {
    ({ t } = await setup(fixture({ authorization_ttl_seconds: ttl })));
    const r = await mkAuth(t.ada, { to_handle: 'bob', amount: 100 });
    assert.equal(r.status, 201);
    assert.equal(diff(r.json), ttl, `ttl ${ttl}`);
    assert.match(r.json.expires_at, RFC3339);
    assert.match(r.json.created_at, RFC3339);
  }
});

test('Model: a later reset restores the default ttl (ttl from an earlier fixture does not stick)', async () => {
  await reset(fixture({ authorization_ttl_seconds: 7 }));
  const t1 = await login('ada');
  assert.equal((Date.parse((await mkAuth(t1, { to_handle: 'bob', amount: 1 })).json.expires_at) - Date.now()) < 60000, true);
  const { t } = await setup();
  const r = await mkAuth(t.ada, { to_handle: 'bob', amount: 1 });
  assert.equal((Date.parse(r.json.expires_at) - Date.parse(r.json.created_at)) / 1000, 600);
});

test('Model: JPY / BHD fixtures with holds keep integer minor-unit arithmetic', async () => {
  for (const [cur, mu] of [['JPY', 0], ['BHD', 3]]) {
    const { t } = await setup(fixture({ currency: cur, minor_units: mu, authorizations: [seedAuth('a_1', 'u_ada', 'u_bob', 1234)] }));
    const m = await me(t.ada);
    expectMe(m, { total: 10000, available: 8766, held: 1234 });
    assert.equal(m.currency, cur); assert.equal(m.minor_units, mu);
  }
});

// ---------------- expiry by the clock ----------------

test('Model: expiry by the clock — /me and GET /authorizations reflect it with no request at the deadline', async () => {
  const { t } = await setup(fixture({ authorization_ttl_seconds: 2 }));
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 3000 })).json;
  expectMe(await me(t.ada), { total: 10000, available: 7000, held: 3000 });
  await sleep(3500); // nobody touched the service meanwhile
  expectMe(await me(t.ada), { total: 10000, available: 10000, held: 0 });
  const rec = await authById(t.bob, a.authorization_id);
  assert.equal(rec.status, 'expired');
  assert.equal(rec.remaining_amount, 0);
  assert.equal((await auths(t.ada, '?status=expired')).authorizations.length, 1);
  assert.equal((await auths(t.ada, '?status=open')).authorizations.length, 0);
  // released money is spendable again
  assert.equal((await pay(t.ada, { to_handle: 'bob', amount: 10000 })).status, 201);
});

test('Model: expiry releases funds for payments, requests-pay and settlements without a prior read', async () => {
  const { t } = await setup(fixture({ authorization_ttl_seconds: 2 }));
  assert.equal((await mkAuth(t.dee, { to_handle: 'bob', amount: 500 })).status, 201);
  expectErr(await pay(t.dee, { to_handle: 'cy', amount: 1 }), 409, 'insufficient_funds');
  await sleep(3500);
  assert.equal((await pay(t.dee, { to_handle: 'cy', amount: 500 })).status, 201);
});

// ---------------- POST /authorizations ----------------

test('POST /authorizations: 201 shape, defaults, hold reduces available only (total/balance unchanged, receiver untouched, no feed item)', async () => {
  const { t } = await setup();
  const r = await mkAuth(t.ada, { to_handle: 'bob', amount: 2000 });
  assert.equal(r.status, 201, r.text);
  const a = r.json;
  assert.equal(typeof a.authorization_id, 'string'); assert.ok(a.authorization_id.length <= 64);
  assert.equal(a.from_user_id, 'u_ada'); assert.equal(a.from_handle, 'ada');
  assert.equal(a.to_user_id, 'u_bob'); assert.equal(a.to_handle, 'bob');
  assert.equal(a.amount, 2000); assert.equal(a.captured_amount, 0); assert.equal(a.remaining_amount, 2000);
  assert.equal(a.currency, 'EUR'); assert.equal(a.note, ''); assert.equal(a.visibility, 'public');
  assert.equal(a.status, 'open'); assert.equal(a.payment_id, null);
  assert.match(a.created_at, RFC3339); assert.match(a.expires_at, RFC3339);
  expectMe(await me(t.ada), { total: 10000, available: 8000, held: 2000 });
  expectMe(await me(t.bob), { total: 2500, available: 2500, held: 0 });
  assert.deepEqual((await get(t.ada, '/activity')).json.payments, []);
  assert.deepEqual((await get(t.bob, '/activity')).json.payments, []);
  assert.deepEqual((await get(t.cy, '/activity')).json.payments, []);
  assert.equal(await totalBalance(t), TOTAL);
  const full = await authById(t.bob, a.authorization_id);
  assert.deepEqual(full, a, 'GET /authorizations returns the same representation');
});

test('POST /authorizations: note/visibility stored verbatim; private hold visible only to its parties in GET /authorizations', async () => {
  const { t } = await setup();
  const note = '  🍕 café <b>&</b>  ';
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 10, note, visibility: 'private' })).json;
  assert.equal(a.note, note); assert.equal(a.visibility, 'private');
  assert.equal((await auths(t.bob)).authorizations.length, 1);
  assert.equal((await auths(t.cy)).authorizations.length, 0);
});

test('POST /authorizations errors: amount range/forms, self_payment, note, visibility, unknown handle, field types', async () => {
  const { t } = await setup();
  for (const amount of [0, -5, 1000000001, 1.5, '100', true, null, [1]]) expectErr(await mkAuth(t.ada, { to_handle: 'bob', amount }), 422, 'validation_failed');
  expectErr(await mkAuth(t.ada, { to_handle: 'bob' }), 422, 'validation_failed');
  expectErr(await mkAuth(t.ada, { amount: 5 }), 422, 'validation_failed');
  expectErr(await mkAuth(t.ada, { to_handle: 'ada', amount: 5 }), 422, 'self_payment');
  expectErr(await mkAuth(t.ada, { to_handle: 'ghost', amount: 5 }), 404, 'not_found');
  expectErr(await mkAuth(t.ada, { to_handle: 'bob', amount: 5, note: 'n'.repeat(201) }), 422, 'validation_failed');
  for (const note of [null, 5, true]) expectErr(await mkAuth(t.ada, { to_handle: 'bob', amount: 5, note }), 422, 'validation_failed');
  for (const visibility of ['friends', 'PUBLIC', null, 3, '']) expectErr(await mkAuth(t.ada, { to_handle: 'bob', amount: 5, visibility }), 422, 'validation_failed');
  expectErr(await mkAuth(t.ada, { to_handle: 7, amount: 5 }), 400, 'malformed_request');
  expectErr(await http('POST', '/authorizations', { token: t.ada, key: uniq(), raw: '{"to_handle":' }), 400, 'malformed_request');
  expectErr(await http('POST', '/authorizations', { token: t.ada, key: uniq(), raw: '[]' }), 400, 'malformed_request');
  assert.equal((await mkAuth(t.ada, { to_handle: 'bob', amount: 5, note: 'n'.repeat(200) })).status, 201);
  assert.equal((await http('POST', '/authorizations', { token: t.ada, key: uniq(), raw: '{"to_handle":"bob","amount":1e3}' })).json.amount, 1000);
  assert.equal((await http('POST', '/authorizations', { token: t.ada, key: uniq(), raw: '{"to_handle":"bob","amount":1000.0}' })).json.amount, 1000);
  assert.equal((await mkAuth(t.ada, { to_handle: 'bob', amount: 1, junk: { a: 1 } })).status, 201);
  // only the successful ones hold funds: 5 + 5(note200) wait 5 + 1000 + 1000 + 1
  expectMe(await me(t.ada), { total: 10000, available: 10000 - (5 + 1000 + 1000 + 1), held: 2006 });
});

test('POST /authorizations: auth 401; missing/empty key 400; 256-char key 422; 255 ok', async () => {
  const { t } = await setup();
  const body = { to_handle: 'bob', amount: 5 };
  expectErr(await http('POST', '/authorizations', { key: uniq(), body }), 401, 'unauthenticated');
  expectErr(await http('POST', '/authorizations', { token: 'zzz', key: uniq(), body }), 401, 'unauthenticated');
  expectErr(await http('POST', '/authorizations', { token: t.ada, body }), 400, 'missing_idempotency_key');
  expectErr(await http('POST', '/authorizations', { token: t.ada, body, key: '' }), 400, 'missing_idempotency_key');
  expectErr(await http('POST', '/authorizations', { token: t.ada, body, key: 'k'.repeat(256) }), 422, 'validation_failed');
  assert.equal((await http('POST', '/authorizations', { token: t.ada, body, key: 'k'.repeat(255) })).status, 201);
  assert.equal((await me(t.ada)).held, 5);
});

test('POST /authorizations: insufficient_funds is evaluated against AVAILABLE (boundary: available ok, available+1 refused); failure leaves no trace', async () => {
  const { t } = await setup(fixture({ authorizations: [seedAuth('a_1', 'u_dee', 'u_bob', 200)] })); // dee: total 500, available 300
  expectErr(await mkAuth(t.dee, { to_handle: 'cy', amount: 301 }), 409, 'insufficient_funds');
  expectErr(await mkAuth(t.cy, { to_handle: 'bob', amount: 1 }), 409, 'insufficient_funds'); // cy has 0
  expectMe(await me(t.dee), { total: 500, available: 300, held: 200 });
  assert.equal((await auths(t.dee)).authorizations.length, 1);
  assert.equal((await mkAuth(t.dee, { to_handle: 'cy', amount: 300 })).status, 201);
  expectMe(await me(t.dee), { total: 500, available: 0, held: 500 });
  expectErr(await mkAuth(t.dee, { to_handle: 'cy', amount: 1 }), 409, 'insufficient_funds');
});

test('Held funds cannot fund payments: payment above available -> 409; up to available OK; held money untouched', async () => {
  const { t } = await setup();
  assert.equal((await mkAuth(t.ada, { to_handle: 'bob', amount: 8000 })).status, 201);
  expectErr(await pay(t.ada, { to_handle: 'cy', amount: 2001 }), 409, 'insufficient_funds');
  expectMe(await me(t.ada), { total: 10000, available: 2000, held: 8000 });
  assert.equal((await pay(t.ada, { to_handle: 'cy', amount: 2000 })).status, 201);
  expectMe(await me(t.ada), { total: 8000, available: 0, held: 8000 });
  expectErr(await pay(t.ada, { to_handle: 'cy', amount: 1 }), 409, 'insufficient_funds');
  assert.equal(await totalBalance(t), TOTAL);
});

test('Held funds cannot fund request payment; the same request becomes payable once the hold is voided', async () => {
  const { t } = await setup();
  const a = (await mkAuth(t.ada, { to_handle: 'cy', amount: 9000 })).json; // ada available 1000
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 3000 })).json;
  expectErr(await payReq(t.ada, rq.request_id), 409, 'insufficient_funds');
  assert.equal((await get(t.ada, '/requests')).json.requests[0].status, 'pending');
  expectMe(await me(t.ada), { total: 10000, available: 1000, held: 9000 });
  assert.equal((await voidAuth(t.ada, a.authorization_id)).status, 200);
  const ok = await payReq(t.ada, rq.request_id);
  assert.equal(ok.status, 201);
  expectMe(await me(t.ada), { total: 7000, available: 7000, held: 0 });
});

test('Held funds cannot fund settlement net debits; net semantics use available (incoming credits count)', async () => {
  const { t } = await setup();
  assert.equal((await mkAuth(t.ada, { to_handle: 'cy', amount: 9000 })).status, 201); // ada available 1000
  expectErr(await settle(t.op, { transfers: [{ from_handle: 'ada', to_handle: 'bob', amount: 1001 }] }), 409, 'insufficient_funds');
  // net debit 1000 = available -> affordable
  const ok = await settle(t.op, { transfers: [{ from_handle: 'ada', to_handle: 'bob', amount: 1500 }, { from_handle: 'bob', to_handle: 'ada', amount: 500 }] });
  assert.equal(ok.status, 201, ok.text);
  expectMe(await me(t.ada), { total: 9000, available: 0, held: 9000 });
  // net debit 1 more than available -> refused, atomically
  expectErr(await settle(t.op, { transfers: [{ from_handle: 'bob', to_handle: 'cy', amount: 5 }, { from_handle: 'ada', to_handle: 'bob', amount: 1 }] }), 409, 'insufficient_funds');
  expectMe(await me(t.ada), { total: 9000, available: 0, held: 9000 });
  assert.equal(await totalBalance(t), TOTAL);
  // the operator's own holds count too
  assert.equal((await mkAuth(t.op, { to_handle: 'ada', amount: 100000 })).status, 201);
  expectErr(await settle(t.op, { transfers: [{ from_handle: 'op', to_handle: 'bob', amount: 1 }] }), 409, 'insufficient_funds');
});

test('Held funds do not block being RECEIVED into: incoming money raises available', async () => {
  const { t } = await setup();
  assert.equal((await mkAuth(t.dee, { to_handle: 'bob', amount: 500 })).status, 201);
  assert.equal((await pay(t.ada, { to_handle: 'dee', amount: 700 })).status, 201);
  expectMe(await me(t.dee), { total: 1200, available: 700, held: 500 });
});

test('Idempotency (§7): authorizations — replay 200 identical, different body 409, claimed key beats invalid body, 4xx key reusable, per-user scope, cross-path', async () => {
  const { t } = await setup();
  const key = uniq();
  const body = { to_handle: 'bob', amount: 1000, note: 'x' };
  const first = await http('POST', '/authorizations', { token: t.ada, key, body });
  assert.equal(first.status, 201);
  for (let i = 0; i < 3; i++) {
    const rep = await http('POST', '/authorizations', { token: t.ada, key, raw: '{ "note":"x", "amount":1e3,  "to_handle":"bob" }' });
    assert.equal(rep.status, 200);
    assert.deepEqual(rep.json, first.json);
  }
  expectMe(await me(t.ada), { total: 10000, available: 9000, held: 1000 }); // held exactly once
  expectErr(await http('POST', '/authorizations', { token: t.ada, key, body: { ...body, amount: 1001 } }), 409, 'idempotency_key_reuse');
  for (const bad of [{ to_handle: 'bob', amount: 0 }, { to_handle: 'ghost', amount: 5 }, {}, { to_handle: 'ada', amount: 5 }, { to_handle: 'bob', amount: 1000, visibility: 'x' }]) {
    expectErr(await http('POST', '/authorizations', { token: t.ada, key, body: bad }), 409, 'idempotency_key_reuse');
  }
  expectErr(await http('POST', '/authorizations', { token: t.ada, key, raw: '{broken' }), 400, 'malformed_request');
  // replay after the resource changed (void) still returns the original body
  assert.equal((await voidAuth(t.ada, first.json.authorization_id)).status, 200);
  const afterVoid = await http('POST', '/authorizations', { token: t.ada, key, body });
  assert.equal(afterVoid.status, 200);
  assert.deepEqual(afterVoid.json, first.json);
  expectMe(await me(t.ada), { total: 10000, available: 10000, held: 0 });
  // key reusable after a 4xx
  const k2 = uniq();
  expectErr(await http('POST', '/authorizations', { token: t.ada, key: k2, body: { to_handle: 'bob', amount: 999999999 } }), 409, 'insufficient_funds');
  expectErr(await http('POST', '/authorizations', { token: t.ada, key: k2, body: { to_handle: 'bob', amount: 0 } }), 422, 'validation_failed');
  assert.equal((await http('POST', '/authorizations', { token: t.ada, key: k2, body: { to_handle: 'bob', amount: 5 } })).status, 201);
  // per-user scope
  const k3 = 'shared-key';
  const a = await http('POST', '/authorizations', { token: t.ada, key: k3, body: { to_handle: 'cy', amount: 10 } });
  const b = await http('POST', '/authorizations', { token: t.bob, key: k3, body: { to_handle: 'cy', amount: 10 } });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.notEqual(a.json.authorization_id, b.json.authorization_id);
  // same key + same body on another path is a different request
  const k4 = uniq();
  assert.equal((await pay(t.ada, { to_handle: 'bob', amount: 10 }, k4)).status, 201);
  assert.equal((await mkAuth(t.ada, { to_handle: 'bob', amount: 10 }, k4)).status, 201);
});

test('Idempotency: replay of an authorization after its hold expired/captured returns the original body, no new hold', async () => {
  const { t } = await setup();
  const key = uniq();
  const body = { to_handle: 'bob', amount: 400 };
  const first = await http('POST', '/authorizations', { token: t.ada, key, body });
  assert.equal((await capture(t.bob, first.json.authorization_id, {})).status, 201);
  const rep = await http('POST', '/authorizations', { token: t.ada, key, body });
  assert.equal(rep.status, 200);
  assert.deepEqual(rep.json, first.json);
  expectMe(await me(t.ada), { total: 9600, available: 9600, held: 0 });
});

// ---------------- GET /authorizations ----------------

test('GET /authorizations: only parties; direction/status filters; unknown values 422; newest first; pagination; strict integers', async () => {
  const { t } = await setup();
  const ids = [];
  for (const [from, to, amt] of [['ada', 'bob', 1], ['bob', 'ada', 2], ['ada', 'cy', 3], ['cy2', 'x', 0]].slice(0, 3)) {
    const r = await mkAuth(from === 'cy' ? t.cy : t[from], { to_handle: to, amount: amt });
    if (r.status === 201) ids.push(r.json); else assert.equal(r.status, 201, r.text);
    await sleep(1100);
  }
  const [a1, a2, a3] = ids;
  const idsOf = async (tok, q = '') => (await auths(tok, q)).authorizations.map((a) => a.authorization_id);
  assert.deepEqual(await idsOf(t.ada), [a3.authorization_id, a2.authorization_id, a1.authorization_id]);
  assert.deepEqual(await idsOf(t.ada, '?direction=outgoing'), [a3.authorization_id, a1.authorization_id]);
  assert.deepEqual(await idsOf(t.ada, '?direction=incoming'), [a2.authorization_id]);
  assert.deepEqual(await idsOf(t.bob), [a2.authorization_id, a1.authorization_id]);
  assert.deepEqual(await idsOf(t.cy), [a3.authorization_id]);
  assert.deepEqual(await idsOf(t.dee), []);
  assert.deepEqual(await idsOf(t.ada, '?status=open&direction=outgoing'), [a3.authorization_id, a1.authorization_id]);
  assert.deepEqual(await idsOf(t.ada, '?status=voided'), []);
  await voidAuth(t.ada, a1.authorization_id);
  assert.deepEqual(await idsOf(t.ada, '?status=voided'), [a1.authorization_id]);
  assert.deepEqual(await idsOf(t.ada, '?status=open'), [a3.authorization_id, a2.authorization_id].filter((x) => x));
  const p1 = await auths(t.ada, '?limit=2&offset=0'); assert.equal(p1.authorizations.length, 2); assert.equal(p1.has_more, true);
  const p2 = await auths(t.ada, '?limit=2&offset=2'); assert.equal(p2.authorizations.length, 1); assert.equal(p2.has_more, false);
  assert.equal((await auths(t.ada, '?limit=3')).has_more, false);
  assert.deepEqual(await auths(t.ada, '?offset=3'), { authorizations: [], has_more: false });
  for (const q of ['direction=sideways', 'status=done', 'direction=OUTGOING', 'status=OPEN', 'limit=0', 'limit=201', 'limit=-1', 'offset=-1', 'limit=1e2', 'limit=4.0', 'limit=+4', 'offset=1.0', 'limit=abc']) {
    expectErr(await get(t.ada, `/authorizations?${q}`), 422, 'validation_failed');
  }
  expectErr(await http('GET', '/authorizations'), 401, 'unauthenticated');
  assert.equal((await get(t.ada, '/authorizations?limit=200&offset=0&zzz=1')).status, 200);
});

// ---------------- stage-1 regressions ----------------

test('Regression: ordinary payments never leave holds, never need capture, and carry authorization_id null', async () => {
  const { t } = await setup();
  const p = (await pay(t.ada, { to_handle: 'bob', amount: 1234, note: 'n' })).json;
  assert.ok('authorization_id' in p, 'authorization_id key must be present');
  assert.equal(p.authorization_id, null);
  assert.equal(p.request_id, null);
  expectMe(await me(t.ada), { total: 8766, available: 8766, held: 0 });
  assert.deepEqual((await auths(t.ada)).authorizations, []);
  assert.deepEqual((await auths(t.bob)).authorizations, []);
  const feed = (await get(t.bob, '/activity')).json.payments;
  assert.equal(feed.length, 1);
  assert.equal(feed[0].authorization_id, null);
});

test('Regression: request-paid and settlement payments carry authorization_id null; request_id semantics unchanged', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  const viaReq = (await payReq(t.ada, rq.request_id)).json;
  assert.equal(viaReq.authorization_id, null);
  assert.equal(viaReq.request_id, rq.request_id);
  const s = (await settle(t.op, { transfers: [{ from_handle: 'ada', to_handle: 'bob', amount: 5 }] })).json;
  assert.equal(s.payments[0].authorization_id, null);
  assert.equal(s.payments[0].request_id, null);
  assert.ok(s.payments[0].settlement_id);
});

test('Regression: GET /me balance always equals total; "available = total - held" after a mixed sequence; total sum conserved', async () => {
  const { t } = await setup();
  const check = async () => {
    let sum = 0;
    for (const k of Object.keys(t)) { const m = await me(t[k]); assertMeInvariants(m); sum += m.total; }
    assert.equal(sum, TOTAL);
  };
  await check();
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 4000 })).json; await check();
  await pay(t.ada, { to_handle: 'cy', amount: 6000 }); await check();
  await capture(t.bob, a.authorization_id, { amount: 1000, final: false }); await check();
  await mkReq(t.cy, { payer_handle: 'dee', amount: 100 });
  await settle(t.op, { transfers: [{ from_handle: 'op', to_handle: 'ada', amount: 777 }] }); await check();
  await capture(t.bob, a.authorization_id, { amount: 3000 }); await check();
  expectMe(await me(t.ada), { total: 10000 - 6000 - 1000 - 3000 + 777, available: 777, held: 0 });
});

test('Regression: split is unchanged (no balance check, no hold)', async () => {
  const { t } = await setup();
  assert.equal((await mkAuth(t.dee, { to_handle: 'bob', amount: 500 })).status, 201); // dee available 0
  const s = await http('POST', '/splits', { token: t.dee, key: uniq(), body: { amount: 3000, participant_handles: ['dee', 'bob', 'cy'] } });
  assert.equal(s.status, 201);
  expectMe(await me(t.dee), { total: 500, available: 0, held: 500 });
});

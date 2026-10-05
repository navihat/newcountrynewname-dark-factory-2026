import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  http, fixture, user, setup, balance, totalBalance, expectErr, pay, get, uniq, RFC3339,
  sleep, iso, HOUR, seedAuth, mkAuth, capture, voidAuth, me, auths, authById, expectMe,
} from './lib.mjs';

const TOTAL = 10000 + 2500 + 500 + 100000;
const open = async (t, over = {}) => {
  const r = await mkAuth(t.ada, { to_handle: 'bob', amount: 2000, note: 'deposit', visibility: 'private', ...over });
  assert.equal(r.status, 201, r.text);
  return r.json;
};

test('Capture default: {} captures the whole remaining amount; 201 payment shape; authorization captured', async () => {
  const { t } = await setup();
  const a = await open(t);
  const r = await capture(t.bob, a.authorization_id, {});
  assert.equal(r.status, 201, r.text);
  const p = r.json;
  assert.equal(typeof p.payment_id, 'string');
  assert.equal(p.from_user_id, 'u_ada'); assert.equal(p.from_handle, 'ada');
  assert.equal(p.to_user_id, 'u_bob'); assert.equal(p.to_handle, 'bob');
  assert.equal(p.amount, 2000); assert.equal(p.currency, 'EUR');
  assert.equal(p.note, 'deposit'); assert.equal(p.visibility, 'private');
  assert.equal(p.request_id, null); assert.equal(p.authorization_id, a.authorization_id);
  assert.match(p.created_at, RFC3339);
  expectMe(await me(t.ada), { total: 8000, available: 8000, held: 0 });
  expectMe(await me(t.bob), { total: 4500, available: 4500, held: 0 });
  const rec = await authById(t.ada, a.authorization_id);
  assert.equal(rec.status, 'captured'); assert.equal(rec.captured_amount, 2000); assert.equal(rec.remaining_amount, 0);
  assert.equal(rec.payment_id, p.payment_id); assert.deepEqual(rec.payment_ids, [p.payment_id]);
  assert.equal(await totalBalance(t), TOTAL);
});

test('Capture: partial amount with default final releases the remainder immediately (1500 of 2000 returns 500)', async () => {
  const { t } = await setup();
  const a = await open(t);
  expectMe(await me(t.ada), { total: 10000, available: 8000, held: 2000 });
  const r = await capture(t.bob, a.authorization_id, { amount: 1500 });
  assert.equal(r.status, 201);
  assert.equal(r.json.amount, 1500);
  expectMe(await me(t.ada), { total: 8500, available: 8500, held: 0 });
  assert.equal(await balance(t.bob), 4000);
  const rec = await authById(t.bob, a.authorization_id);
  assert.equal(rec.status, 'captured'); assert.equal(rec.captured_amount, 1500); assert.equal(rec.remaining_amount, 0);
  assert.equal(rec.amount, 2000);
  // final capture closed it: a second capture is not_open
  expectErr(await capture(t.bob, a.authorization_id, { amount: 1 }), 409, 'authorization_not_open');
  expectErr(await capture(t.bob, a.authorization_id, {}), 409, 'authorization_not_open');
  assert.equal(await balance(t.bob), 4000);
});

test('Capture: payment follows ordinary feed visibility (private: only parties; public: everyone); authorization_id in feed; hold never a feed item before capture', async () => {
  const { t } = await setup();
  const priv = await open(t, { visibility: 'private' });
  const pub = await open(t, { visibility: 'public', note: 'pub' });
  for (const k of ['ada', 'bob', 'cy']) assert.deepEqual((await get(t[k], '/activity')).json.payments, []);
  const pp = (await capture(t.bob, priv.authorization_id, {})).json;
  const pq = (await capture(t.bob, pub.authorization_id, {})).json;
  const ids = async (k) => (await get(t[k], '/activity?limit=200')).json.payments.map((p) => p.payment_id).sort();
  assert.deepEqual(await ids('ada'), [pp.payment_id, pq.payment_id].sort());
  assert.deepEqual(await ids('bob'), [pp.payment_id, pq.payment_id].sort());
  assert.deepEqual(await ids('cy'), [pq.payment_id]);
  assert.deepEqual(await ids('op'), [pq.payment_id]);
  const fromFeed = (await get(t.cy, '/activity')).json.payments[0];
  assert.deepEqual(fromFeed, pq);
  assert.equal(fromFeed.authorization_id, pub.authorization_id);
});

test('Capture: forms of amount (1e3, 1000.0) accepted; 0, -1, 1.5, string, boolean -> 422 validation_failed; nothing changes', async () => {
  const { t } = await setup();
  const a = await open(t);
  for (const lit of ['0', '-1', '1.5', '"100"', 'true', 'false', '[5]']) {
    expectErr(await http('POST', `/authorizations/${a.authorization_id}/capture`, { token: t.bob, key: uniq(), raw: `{"amount":${lit}}` }), 422, 'validation_failed');
  }
  expectMe(await me(t.ada), { total: 10000, available: 8000, held: 2000 });
  assert.equal((await authById(t.bob, a.authorization_id)).status, 'open');
  const ok = await http('POST', `/authorizations/${a.authorization_id}/capture`, { token: t.bob, key: uniq(), raw: '{"amount":1e3,"final":false}' });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.amount, 1000);
  const ok2 = await http('POST', `/authorizations/${a.authorization_id}/capture`, { token: t.bob, key: uniq(), raw: '{"amount":500.0,"final":false}' });
  assert.equal(ok2.json.amount, 500);
});

test('Capture: "final" must be boolean (wrong type rejected 400/422); default is true', async () => {
  const { t } = await setup();
  const a = await open(t);
  for (const f of ['"yes"', '1', '0', 'null', '"false"']) {
    const r = await http('POST', `/authorizations/${a.authorization_id}/capture`, { token: t.bob, key: uniq(), raw: `{"amount":100,"final":${f}}` });
    assert.ok(r.status === 400 || r.status === 422, `final=${f}: ${r.status} ${r.text}`);
    assert.ok(r.json && r.json.error);
  }
  assert.equal((await authById(t.bob, a.authorization_id)).status, 'open');
  const r = await capture(t.bob, a.authorization_id, { amount: 100, final: true });
  assert.equal(r.status, 201);
  assert.equal((await authById(t.bob, a.authorization_id)).status, 'captured');
});

test('Extended mode: {amount:700, final:false} keeps remainder held, status open; cumulative captured_amount; payment_id is latest; payment_ids ordered', async () => {
  const { t } = await setup();
  const a = await open(t);
  const c1 = await capture(t.bob, a.authorization_id, { amount: 700, final: false });
  assert.equal(c1.status, 201);
  assert.equal(c1.json.amount, 700); assert.equal(c1.json.authorization_id, a.authorization_id);
  let rec = await authById(t.bob, a.authorization_id);
  assert.equal(rec.status, 'open'); assert.equal(rec.captured_amount, 700); assert.equal(rec.remaining_amount, 1300);
  assert.equal(rec.payment_id, c1.json.payment_id); assert.deepEqual(rec.payment_ids, [c1.json.payment_id]);
  expectMe(await me(t.ada), { total: 9300, available: 8000, held: 1300 });
  expectMe(await me(t.bob), { total: 3200, available: 3200, held: 0 });
  const c2 = await capture(t.bob, a.authorization_id, { amount: 500, final: false });
  assert.equal(c2.status, 201);
  rec = await authById(t.bob, a.authorization_id);
  assert.equal(rec.status, 'open'); assert.equal(rec.captured_amount, 1200); assert.equal(rec.remaining_amount, 800);
  assert.equal(rec.payment_id, c2.json.payment_id); assert.deepEqual(rec.payment_ids, [c1.json.payment_id, c2.json.payment_id]);
  expectMe(await me(t.ada), { total: 8800, available: 8000, held: 800 });
  // omitted amount defaults to the REMAINING amount and (final true by default) closes it
  const c3 = await capture(t.bob, a.authorization_id, {});
  assert.equal(c3.status, 201);
  assert.equal(c3.json.amount, 800);
  rec = await authById(t.bob, a.authorization_id);
  assert.equal(rec.status, 'captured'); assert.equal(rec.captured_amount, 2000); assert.equal(rec.remaining_amount, 0);
  assert.deepEqual(rec.payment_ids, [c1.json.payment_id, c2.json.payment_id, c3.json.payment_id]);
  assert.equal(rec.payment_id, c3.json.payment_id);
  expectMe(await me(t.ada), { total: 8000, available: 8000, held: 0 });
  assert.equal(await balance(t.bob), 4500);
  assert.equal(new Set([c1, c2, c3].map((c) => c.json.payment_id)).size, 3);
});

test('Extended mode: capturing the ENTIRE remainder closes the authorization even with final:false', async () => {
  const { t } = await setup();
  const a = await open(t);
  assert.equal((await capture(t.bob, a.authorization_id, { amount: 700, final: false })).status, 201);
  const last = await capture(t.bob, a.authorization_id, { amount: 1300, final: false });
  assert.equal(last.status, 201);
  const rec = await authById(t.bob, a.authorization_id);
  assert.equal(rec.status, 'captured'); assert.equal(rec.remaining_amount, 0); assert.equal(rec.captured_amount, 2000);
  expectMe(await me(t.ada), { total: 8000, available: 8000, held: 0 });
  expectErr(await capture(t.bob, a.authorization_id, { amount: 1, final: false }), 409, 'authorization_not_open');
  // full amount on the first capture with final:false closes immediately too
  const b = await open(t);
  assert.equal((await capture(t.bob, b.authorization_id, { amount: 2000, final: false })).status, 201);
  assert.equal((await authById(t.bob, b.authorization_id)).status, 'captured');
});

test('Extended mode: a later FINAL capture closes it and releases only the uncaptured remainder', async () => {
  const { t } = await setup();
  const a = await open(t);
  await capture(t.bob, a.authorization_id, { amount: 700, final: false });
  const fin = await capture(t.bob, a.authorization_id, { amount: 500 }); // final default true
  assert.equal(fin.status, 201);
  const rec = await authById(t.bob, a.authorization_id);
  assert.equal(rec.status, 'captured'); assert.equal(rec.captured_amount, 1200); assert.equal(rec.remaining_amount, 0);
  expectMe(await me(t.ada), { total: 8800, available: 8800, held: 0 });
  assert.equal(rec.payment_ids.length, 2);
  expectErr(await capture(t.bob, a.authorization_id, { amount: 1 }), 409, 'authorization_not_open');
});

test('Capture: capture_exceeds_authorization compares with the REMAINING amount (422), no state change', async () => {
  const { t } = await setup();
  const a = await open(t);
  expectErr(await capture(t.bob, a.authorization_id, { amount: 2001 }), 422, 'capture_exceeds_authorization');
  expectErr(await capture(t.bob, a.authorization_id, { amount: 2001, final: false }), 422, 'capture_exceeds_authorization');
  expectMe(await me(t.ada), { total: 10000, available: 8000, held: 2000 });
  assert.equal((await authById(t.bob, a.authorization_id)).status, 'open');
  await capture(t.bob, a.authorization_id, { amount: 700, final: false });
  expectErr(await capture(t.bob, a.authorization_id, { amount: 1301, final: false }), 422, 'capture_exceeds_authorization');
  expectErr(await capture(t.bob, a.authorization_id, { amount: 2000, final: false }), 422, 'capture_exceeds_authorization'); // full original amount, only 1300 left
  expectErr(await capture(t.bob, a.authorization_id, { amount: 1301 }), 422, 'capture_exceeds_authorization');
  expectMe(await me(t.ada), { total: 9300, available: 8000, held: 1300 });
  assert.equal((await capture(t.bob, a.authorization_id, { amount: 1300 })).status, 201);
});

test('Capture: not_open precedence over amount errors on a closed authorization; closed hold can never be captured again', async () => {
  const { t } = await setup();
  const a = await open(t);
  await capture(t.bob, a.authorization_id, { amount: 100 });
  expectErr(await capture(t.bob, a.authorization_id, { amount: 99999 }), 409, 'authorization_not_open');
  const v = await open(t);
  await voidAuth(t.ada, v.authorization_id);
  expectErr(await capture(t.bob, v.authorization_id, {}), 409, 'authorization_not_open');
  expectErr(await capture(t.bob, v.authorization_id, { amount: 1, final: false }), 409, 'authorization_not_open');
});

test('Capture permissions: only the receiver (403 for payer, third party, operator); unknown id 404; 401 and key checks', async () => {
  const { t } = await setup();
  const a = await open(t);
  expectErr(await capture(t.ada, a.authorization_id, {}), 403, 'forbidden');
  expectErr(await capture(t.cy, a.authorization_id, {}), 403, 'forbidden');
  expectErr(await capture(t.op, a.authorization_id, {}), 403, 'forbidden');
  expectErr(await capture(t.bob, 'a_does_not_exist', {}), 404, 'not_found');
  expectErr(await http('POST', `/authorizations/${a.authorization_id}/capture`, { key: uniq(), body: {} }), 401, 'unauthenticated');
  expectErr(await http('POST', `/authorizations/${a.authorization_id}/capture`, { token: t.bob, body: {} }), 400, 'missing_idempotency_key');
  expectErr(await http('POST', `/authorizations/${a.authorization_id}/capture`, { token: t.bob, body: {}, key: '' }), 400, 'missing_idempotency_key');
  expectErr(await http('POST', `/authorizations/${a.authorization_id}/capture`, { token: t.bob, body: {}, key: 'k'.repeat(256) }), 422, 'validation_failed');
  expectErr(await http('POST', `/authorizations/${a.authorization_id}/capture`, { token: t.bob, key: uniq(), raw: '{bad' }), 400, 'malformed_request');
  expectMe(await me(t.ada), { total: 10000, available: 8000, held: 2000 });
  assert.equal((await authById(t.ada, a.authorization_id)).status, 'open');
});

test('Capture: payer cannot capture even after the receiver has partially captured; third parties cannot see the hold', async () => {
  const { t } = await setup();
  const a = await open(t);
  await capture(t.bob, a.authorization_id, { amount: 100, final: false });
  expectErr(await capture(t.ada, a.authorization_id, { amount: 100, final: false }), 403, 'forbidden');
  assert.equal((await auths(t.cy)).authorizations.length, 0);
});

test('Capture may spend the reserved money: payer\'s whole balance held, receiver captures everything, payer ends at 0', async () => {
  const { t } = await setup();
  const a = (await mkAuth(t.dee, { to_handle: 'bob', amount: 500 })).json;
  expectMe(await me(t.dee), { total: 500, available: 0, held: 500 });
  const r = await capture(t.bob, a.authorization_id, {});
  assert.equal(r.status, 201, r.text);
  expectMe(await me(t.dee), { total: 0, available: 0, held: 0 });
  assert.equal(await totalBalance(t), TOTAL);
});

test('Capture with several holds on one payer: each capture draws only its own reservation', async () => {
  const { t } = await setup();
  const a1 = (await mkAuth(t.dee, { to_handle: 'bob', amount: 300 })).json;
  const a2 = (await mkAuth(t.dee, { to_handle: 'cy', amount: 200 })).json;
  expectMe(await me(t.dee), { total: 500, available: 0, held: 500 });
  assert.equal((await capture(t.bob, a1.authorization_id, { amount: 100 })).status, 201); // releases 200
  expectMe(await me(t.dee), { total: 400, available: 200, held: 200 });
  assert.equal((await capture(t.cy, a2.authorization_id, {})).status, 201);
  expectMe(await me(t.dee), { total: 200, available: 200, held: 0 });
  assert.equal(await balance(t.cy), 200); assert.equal(await balance(t.bob), 2600);
});

test('Capture replay rule: {} and {"amount":N} are different bodies even when equivalent -> 409 idempotency_key_reuse', async () => {
  const { t } = await setup();
  const a = await open(t);
  const key = uniq();
  const first = await capture(t.bob, a.authorization_id, {}, key);
  assert.equal(first.status, 201);
  expectErr(await capture(t.bob, a.authorization_id, { amount: 2000 }, key), 409, 'idempotency_key_reuse');
  expectErr(await capture(t.bob, a.authorization_id, { amount: 2000, final: true }, key), 409, 'idempotency_key_reuse');
  const rep = await capture(t.bob, a.authorization_id, {}, key);
  assert.equal(rep.status, 200);
  assert.deepEqual(rep.json, first.json);
  // the other direction
  const b = await open(t);
  const k2 = uniq();
  const f2 = await capture(t.bob, b.authorization_id, { amount: 2000 }, k2);
  assert.equal(f2.status, 201);
  expectErr(await capture(t.bob, b.authorization_id, {}, k2), 409, 'idempotency_key_reuse');
  // key order / whitespace do not matter
  const c = await open(t);
  const k3 = uniq();
  const f3 = await http('POST', `/authorizations/${c.authorization_id}/capture`, { token: t.bob, key: k3, raw: '{"amount":700,"final":false}' });
  const r3 = await http('POST', `/authorizations/${c.authorization_id}/capture`, { token: t.bob, key: k3, raw: ' { "final" : false ,\n "amount" : 700 } ' });
  assert.equal(f3.status, 201); assert.equal(r3.status, 200); assert.deepEqual(r3.json, f3.json);
  // an explicit default final:true differs from omission
  expectErr(await http('POST', `/authorizations/${c.authorization_id}/capture`, { token: t.bob, key: k3, body: { amount: 700, final: false, extra: 1 } }), 409, 'idempotency_key_reuse');
});

test('Capture idempotency: replay returns original 200 even after the authorization closed/changed; money moves once', async () => {
  const { t } = await setup();
  const a = await open(t);
  const key = uniq();
  const body = { amount: 700, final: false };
  const first = await capture(t.bob, a.authorization_id, body, key);
  assert.equal(first.status, 201);
  await capture(t.bob, a.authorization_id, {}); // closes (remaining 1300)
  for (let i = 0; i < 3; i++) {
    const rep = await capture(t.bob, a.authorization_id, body, key);
    assert.equal(rep.status, 200, rep.text);
    assert.deepEqual(rep.json, first.json);
  }
  expectMe(await me(t.ada), { total: 8000, available: 8000, held: 0 });
  assert.equal(await balance(t.bob), 4500);
  assert.equal((await authById(t.bob, a.authorization_id)).payment_ids.length, 2);
  expectErr(await capture(t.bob, a.authorization_id, { amount: 701, final: false }, key), 409, 'idempotency_key_reuse');
});

test('Capture idempotency: claimed key beats invalid body / current-state errors; failed (4xx) key is reusable as first use', async () => {
  const { t } = await setup();
  const a = await open(t);
  const key = uniq();
  assert.equal((await capture(t.bob, a.authorization_id, { amount: 100, final: false }, key)).status, 201);
  for (const bad of [{ amount: 0 }, { amount: 'x' }, { amount: 999999 }, { amount: 100, final: 'maybe' }]) {
    expectErr(await capture(t.bob, a.authorization_id, bad, key), 409, 'idempotency_key_reuse');
  }
  // failed key
  const k2 = uniq();
  expectErr(await capture(t.bob, a.authorization_id, { amount: 999999, final: false }, k2), 422, 'capture_exceeds_authorization');
  expectErr(await capture(t.bob, a.authorization_id, { amount: 0 }, k2), 422, 'validation_failed');
  expectErr(await capture(t.cy, a.authorization_id, { amount: 1 }, k2), 403, 'forbidden');
  const ok = await capture(t.bob, a.authorization_id, { amount: 200, final: false }, k2);
  assert.equal(ok.status, 201);
  // not_open failure leaves the key unclaimed as well
  await capture(t.bob, a.authorization_id, {});
  const k3 = uniq();
  expectErr(await capture(t.bob, a.authorization_id, { amount: 5 }, k3), 409, 'authorization_not_open');
  const b = await open(t);
  assert.equal((await capture(t.bob, b.authorization_id, { amount: 5 }, k3)).status, 201, 'same key on another authorization is a different path');
});

test('Capture idempotency: same key + same body on a different authorization path is a different request', async () => {
  const { t } = await setup();
  const a = await open(t), b = await open(t);
  const key = uniq();
  const ra = await capture(t.bob, a.authorization_id, { amount: 100 }, key);
  const rb = await capture(t.bob, b.authorization_id, { amount: 100 }, key);
  assert.equal(ra.status, 201); assert.equal(rb.status, 201);
  assert.notEqual(ra.json.payment_id, rb.json.payment_id);
  assert.equal(rb.json.authorization_id, b.authorization_id);
});

// ---------------- void ----------------

test('Void: payer releases the hold -> 200 voided, remaining 0, available restored; no money moved', async () => {
  const { t } = await setup();
  const a = await open(t);
  const r = await voidAuth(t.ada, a.authorization_id);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.status, 'voided'); assert.equal(r.json.authorization_id, a.authorization_id);
  assert.equal(r.json.remaining_amount, 0); assert.equal(r.json.captured_amount, 0); assert.equal(r.json.payment_id, null);
  expectMe(await me(t.ada), { total: 10000, available: 10000, held: 0 });
  assert.equal(await balance(t.bob), 2500);
  assert.deepEqual((await get(t.bob, '/activity')).json.payments, []);
  assert.equal((await authById(t.bob, a.authorization_id)).status, 'voided');
});

test('Void: twice is 200 with the current state; only the PAYER may void (receiver, third party, operator -> 403); unknown 404', async () => {
  const { t } = await setup();
  const a = await open(t);
  expectErr(await voidAuth(t.bob, a.authorization_id), 403, 'forbidden'); // receiver cannot void
  expectErr(await voidAuth(t.cy, a.authorization_id), 403, 'forbidden');
  expectErr(await voidAuth(t.op, a.authorization_id), 403, 'forbidden');
  expectErr(await voidAuth(t.ada, 'a_nope'), 404, 'not_found');
  expectErr(await http('POST', `/authorizations/${a.authorization_id}/void`, {}), 401, 'unauthenticated');
  assert.equal((await authById(t.ada, a.authorization_id)).status, 'open');
  const v1 = await voidAuth(t.ada, a.authorization_id);
  const v2 = await voidAuth(t.ada, a.authorization_id);
  assert.equal(v1.status, 200); assert.equal(v2.status, 200);
  assert.deepEqual(v2.json, v1.json);
  expectMe(await me(t.ada), { total: 10000, available: 10000, held: 0 });
});

test('Void: captured or expired authorization -> 409 authorization_not_open; no key required', async () => {
  const { t } = await setup(fixture({ authorization_ttl_seconds: 2 }));
  const c = await open(t);
  await capture(t.bob, c.authorization_id, { amount: 100 });
  expectErr(await voidAuth(t.ada, c.authorization_id), 409, 'authorization_not_open');
  const e = await open(t, { amount: 50 });
  await sleep(3500);
  expectErr(await voidAuth(t.ada, e.authorization_id), 409, 'authorization_not_open');
  assert.equal((await authById(t.ada, e.authorization_id)).status, 'expired');
});

test('Void after partial (extended) capture releases ONLY the remainder and preserves capture records', async () => {
  const { t } = await setup();
  const a = await open(t);
  const c1 = (await capture(t.bob, a.authorization_id, { amount: 700, final: false })).json;
  expectMe(await me(t.ada), { total: 9300, available: 8000, held: 1300 });
  const v = await voidAuth(t.ada, a.authorization_id);
  assert.equal(v.status, 200);
  assert.equal(v.json.status, 'voided'); assert.equal(v.json.captured_amount, 700); assert.equal(v.json.remaining_amount, 0);
  assert.deepEqual(v.json.payment_ids, [c1.payment_id]); assert.equal(v.json.payment_id, c1.payment_id);
  expectMe(await me(t.ada), { total: 9300, available: 9300, held: 0 });
  assert.equal(await balance(t.bob), 3200);
  expectErr(await capture(t.bob, a.authorization_id, { amount: 1, final: false }), 409, 'authorization_not_open');
  // the captured payment remains in the feed
  assert.ok((await get(t.bob, '/activity')).json.payments.some((p) => p.payment_id === c1.payment_id));
});

// ---------------- expiry ----------------

test('Expiry: capture after the deadline -> 409 authorization_expired; hold released with no prior request; nothing moves', async () => {
  const { t } = await setup(fixture({ authorization_ttl_seconds: 2 }));
  const a = await open(t);
  assert.equal((await mkAuth(t.ada, { to_handle: 'cy', amount: 100 })).status, 201);
  await sleep(3500);
  expectErr(await capture(t.bob, a.authorization_id, {}), 409, 'authorization_expired');
  expectErr(await capture(t.bob, a.authorization_id, { amount: 1, final: false }), 409, 'authorization_expired');
  expectMe(await me(t.ada), { total: 10000, available: 10000, held: 0 });
  assert.equal(await balance(t.bob), 2500);
  const rec = await authById(t.bob, a.authorization_id);
  assert.equal(rec.status, 'expired'); assert.equal(rec.remaining_amount, 0); assert.equal(rec.captured_amount, 0);
});

test('Expiry: after a partial extended capture, expiry releases only the remainder and keeps capture records; later capture -> authorization_expired', async () => {
  const { t } = await setup(fixture({ authorization_ttl_seconds: 3 }));
  const a = await open(t);
  const c1 = (await capture(t.bob, a.authorization_id, { amount: 700, final: false })).json;
  expectMe(await me(t.ada), { total: 9300, available: 8000, held: 1300 });
  await sleep(4000);
  expectMe(await me(t.ada), { total: 9300, available: 9300, held: 0 });
  const rec = await authById(t.ada, a.authorization_id);
  assert.equal(rec.status, 'expired'); assert.equal(rec.captured_amount, 700); assert.equal(rec.remaining_amount, 0);
  assert.deepEqual(rec.payment_ids, [c1.payment_id]);
  expectErr(await capture(t.bob, a.authorization_id, { amount: 100, final: false }), 409, 'authorization_expired');
  assert.equal(await balance(t.bob), 3200);
});

test('Expiry: capture replay still returns the original response after the authorization expired', async () => {
  const { t } = await setup(fixture({ authorization_ttl_seconds: 3 }));
  const a = await open(t);
  const key = uniq();
  const body = { amount: 400, final: false };
  const first = await capture(t.bob, a.authorization_id, body, key);
  assert.equal(first.status, 201);
  await sleep(4000);
  const rep = await capture(t.bob, a.authorization_id, body, key);
  assert.equal(rep.status, 200);
  assert.deepEqual(rep.json, first.json);
  assert.equal(await balance(t.bob), 2900);
});

test('Expiry (seeded): open hold with past expires_at is expired -> capture 409 authorization_expired, void 409 authorization_not_open, funds already released', async () => {
  const fx = fixture({
    authorizations: [
      seedAuth('a_p', 'u_ada', 'u_bob', 3000, { expires_at: iso(-2 * HOUR) }),
      seedAuth('a_f', 'u_ada', 'u_bob', 1000, { expires_at: iso(2 * HOUR) }),
      seedAuth('a_e', 'u_ada', 'u_bob', 100, { status: 'expired', expires_at: iso(-2 * HOUR) }),
      seedAuth('a_c', 'u_ada', 'u_bob', 100, { status: 'captured' }),
      seedAuth('a_v', 'u_ada', 'u_bob', 100, { status: 'voided' }),
    ],
  });
  const { t } = await setup(fx);
  const list = (await auths(t.ada, '?limit=200')).authorizations;
  const byAmount = (st) => list.filter((a) => a.status === st).length;
  assert.equal(byAmount('expired'), 2); assert.equal(byAmount('open'), 1); assert.equal(byAmount('captured'), 1); assert.equal(byAmount('voided'), 1);
  const past = list.find((a) => a.amount === 3000);
  const fut = list.find((a) => a.amount === 1000);
  assert.equal(past.status, 'expired');
  expectErr(await capture(t.bob, past.authorization_id, {}), 409, 'authorization_expired');
  expectErr(await voidAuth(t.ada, past.authorization_id), 409, 'authorization_not_open');
  for (const st of ['captured', 'voided']) {
    const a = list.find((x) => x.status === st);
    expectErr(await capture(t.bob, a.authorization_id, {}), 409, 'authorization_not_open');
  }
  const e = list.find((a) => a.status === 'expired' && a.amount === 100);
  const re = await capture(t.bob, e.authorization_id, {});
  assert.equal(re.status, 409); assert.ok(['authorization_expired', 'authorization_not_open'].includes(re.json.error.code)); // either reading of a seeded "expired"
  // the future one works
  const ok = await capture(t.bob, fut.authorization_id, { amount: 400 });
  assert.equal(ok.status, 201);
  expectMe(await me(t.ada), { total: 9600, available: 9600, held: 0 });
});

test('Expiry (seeded): expires_at echoed as RFC 3339; seeded open future hold is capturable with remaining_amount', async () => {
  const exp = iso(5 * HOUR);
  const { t } = await setup(fixture({ authorizations: [seedAuth('a_1', 'u_ada', 'u_bob', 700, { expires_at: exp, note: 'seed', visibility: 'private' })] }));
  const a = (await auths(t.bob)).authorizations[0];
  assert.equal(Date.parse(a.expires_at), Date.parse(exp));
  assert.match(a.expires_at, RFC3339);
  const r = await capture(t.bob, a.authorization_id, {});
  assert.equal(r.status, 201);
  assert.equal(r.json.amount, 700); assert.equal(r.json.note, 'seed'); assert.equal(r.json.visibility, 'private');
  assert.equal(r.json.authorization_id, a.authorization_id);
  expectMe(await me(t.ada), { total: 9300, available: 9300, held: 0 });
});

test('Expiry: a hold created through the API with a short ttl is capturable BEFORE the deadline', async () => {
  const { t } = await setup(fixture({ authorization_ttl_seconds: 5 }));
  const a = await open(t);
  const r = await capture(t.bob, a.authorization_id, { amount: 500 });
  assert.equal(r.status, 201);
});

test('Authorization ids are unique/opaque (<=64 chars); payment ids from captures do not collide with ordinary payments', async () => {
  const { t } = await setup();
  const ids = new Set();
  for (let i = 0; i < 5; i++) {
    const a = await open(t, { amount: 10 });
    assert.ok(a.authorization_id.length <= 64);
    ids.add(a.authorization_id);
    const c = (await capture(t.bob, a.authorization_id, {})).json;
    const p = (await pay(t.ada, { to_handle: 'bob', amount: 1 })).json;
    assert.notEqual(c.payment_id, p.payment_id);
    ids.add(c.payment_id); ids.add(p.payment_id);
  }
  assert.equal(ids.size, 15);
});

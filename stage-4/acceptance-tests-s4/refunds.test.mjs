import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  http, fixture, setup, balance, expectErr, pay, mkReq, payReq, settle, get, uniq, RFC3339, sleep, DAY,
  mkAuth, capture, voidAuth, me, auths, at, ms, meAt, stmt, correct, revisions, refund, fixtureS, sIds, sumView, expectMe, assertMeInvariants, assertPaymentShape,
} from './lib.mjs';

const TOTAL = 10000 + 2500 + 500 + 100000;
const ALL = ['ada', 'bob', 'cy', 'dee', 'op'];
const mk = async (t, amount = 1000, over = {}) => (await pay(t.ada, { to_handle: 'bob', amount, note: 'dinner', visibility: 'private', ...over })).json;

test('Refund: 201 payment in the opposite direction with refund_of, request_id null, authorization_id null, copied note/visibility, created_at', async () => {
  const { t } = await setup();
  const P = await mk(t);
  await sleep(1100);
  const r = await refund(t.bob, P.payment_id, { amount: 300 });
  assert.equal(r.status, 201, r.text);
  const R = r.json;
  assertPaymentShape(R, 'refund');
  assert.notEqual(R.payment_id, P.payment_id);
  assert.equal(R.from_user_id, 'u_bob'); assert.equal(R.from_handle, 'bob');
  assert.equal(R.to_user_id, 'u_ada'); assert.equal(R.to_handle, 'ada');
  assert.equal(R.amount, 300); assert.equal(R.currency, 'EUR');
  assert.equal(R.note, 'dinner'); assert.equal(R.visibility, 'private');
  assert.equal(R.refund_of, P.payment_id); assert.equal(R.request_id, null); assert.equal(R.authorization_id, null);
  assert.ok(ms(R.created_at) > ms(P.created_at) - 1000);
  expectMe(await me(t.ada), { total: 9300, available: 9300, held: 0 });
  expectMe(await me(t.bob), { total: 3200, available: 3200, held: 0 });
  // original payment untouched everywhere
  assert.equal(P.refund_of, null);
  const feed = (await get(t.ada, '/activity?limit=200')).json.payments;
  assert.equal(feed.length, 2);
  assert.deepEqual(feed.find((p) => p.payment_id === P.payment_id), P);
  assert.deepEqual(feed.find((p) => p.payment_id === R.payment_id), R);
  assert.equal(await (async () => (await revisions(t.ada, P.payment_id)).json.revisions.length)(), 1);
});

test('refund_of is present and null on every other payment: direct, request-paid, settlement members, captures, activity, statements', async () => {
  const { t } = await setup();
  const direct = (await pay(t.ada, { to_handle: 'bob', amount: 10 })).json;
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 20 })).json;
  const viaReq = (await payReq(t.ada, rq.request_id)).json;
  const st = (await settle(t.op, { transfers: [{ from_handle: 'ada', to_handle: 'bob', amount: 5 }] })).json;
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 50 })).json;
  const cap = (await capture(t.bob, a.authorization_id, {})).json;
  for (const [l, p] of [['direct', direct], ['request', viaReq], ['settlement', st.payments[0]], ['capture', cap]]) { assert.ok('refund_of' in p, `${l}.refund_of present`); assert.equal(p.refund_of, null, l); }
  for (const p of (await get(t.ada, '/activity?limit=200')).json.payments) assert.equal(p.refund_of, null);
  for (const e of (await stmt(t.ada)).entries) assert.equal(e.payment.refund_of, null);
});

test('Refund permissions: only the receiver (403 for sender, third party, operator); 404 unknown; 401; idempotency key required', async () => {
  const { t } = await setup();
  const P = await mk(t);
  for (const h of ['ada', 'cy', 'op', 'dee']) expectErr(await refund(t[h], P.payment_id, { amount: 100 }), 403, 'forbidden');
  expectErr(await refund(t.bob, 'p_does_not_exist', { amount: 100 }), 404, 'not_found');
  expectErr(await refund(t.ada, 'p_does_not_exist', { amount: 100 }), 404, 'not_found');
  expectErr(await http('POST', `/payments/${P.payment_id}/refunds`, { key: uniq(), body: { amount: 1 } }), 401, 'unauthenticated');
  expectErr(await http('POST', `/payments/${P.payment_id}/refunds`, { token: 'bogus', key: uniq(), body: { amount: 1 } }), 401, 'unauthenticated');
  expectErr(await http('POST', `/payments/${P.payment_id}/refunds`, { token: t.bob, body: { amount: 1 } }), 400, 'missing_idempotency_key');
  expectErr(await http('POST', `/payments/${P.payment_id}/refunds`, { token: t.bob, body: { amount: 1 }, key: '' }), 400, 'missing_idempotency_key');
  expectErr(await http('POST', `/payments/${P.payment_id}/refunds`, { token: t.bob, body: { amount: 1 }, key: 'k'.repeat(256) }), 422, 'validation_failed');
  assert.equal((await http('POST', `/payments/${P.payment_id}/refunds`, { token: t.bob, body: { amount: 1 }, key: 'k'.repeat(255) })).status, 201);
  expectMe(await me(t.ada), { total: 9001, available: 9001, held: 0 });
});

test('Refund amount validation: 0, negative, fraction, string, bool, null, missing, over 1e9 -> 422 validation_failed; forms 1e2 / 100.0 accepted; unknown fields ignored', async () => {
  const { t } = await setup();
  const P = await mk(t, 1000);
  for (const amount of [0, -1, -500, 1.5, 0.5, '100', true, false, null, 1000000001, 5e9]) expectErr(await refund(t.bob, P.payment_id, { amount }), 422, 'validation_failed');
  expectErr(await refund(t.bob, P.payment_id, {}), 422, 'validation_failed');
  expectErr(await refund(t.bob, P.payment_id, { note: 'x' }), 422, 'validation_failed');
  expectErr(await http('POST', `/payments/${P.payment_id}/refunds`, { token: t.bob, key: uniq(), raw: '{"amount":' }), 400, 'malformed_request');
  expectErr(await http('POST', `/payments/${P.payment_id}/refunds`, { token: t.bob, key: uniq(), raw: '[]' }), 400, 'malformed_request');
  expectMe(await me(t.ada), { total: 9000, available: 9000, held: 0 });
  assert.equal((await http('POST', `/payments/${P.payment_id}/refunds`, { token: t.bob, key: uniq(), raw: '{"amount":1e2,"x":{"y":1}}' })).json.amount, 100);
  assert.equal((await http('POST', `/payments/${P.payment_id}/refunds`, { token: t.bob, key: uniq(), raw: '{"amount":100.0}' })).json.amount, 100);
  assert.equal((await refund(t.bob, P.payment_id, { amount: 1, junk: 5 })).status, 201);
});

test('Refund idempotency: replay 200 identical (money once); different body 409; claimed key beats invalid body; failed key reusable; per-user scope; key order irrelevant', async () => {
  const { t } = await setup();
  const P = await mk(t, 1000);
  const key = uniq('rf');
  const first = await refund(t.bob, P.payment_id, { amount: 200 }, key);
  assert.equal(first.status, 201);
  for (let i = 0; i < 3; i++) {
    const rep = await refund(t.bob, P.payment_id, { amount: 200 }, key);
    assert.equal(rep.status, 200); assert.deepEqual(rep.json, first.json);
  }
  assert.equal((await http('POST', `/payments/${P.payment_id}/refunds`, { token: t.bob, key, raw: ' { "amount" : 2e2 } ' })).status, 200);
  expectMe(await me(t.ada), { total: 9200, available: 9200, held: 0 });
  expectErr(await refund(t.bob, P.payment_id, { amount: 201 }, key), 409, 'idempotency_key_reuse');
  for (const bad of [{}, { amount: 0 }, { amount: 'x' }, { amount: 99999 }]) expectErr(await refund(t.bob, P.payment_id, bad, key), 409, 'idempotency_key_reuse');
  expectErr(await http('POST', `/payments/${P.payment_id}/refunds`, { token: t.bob, key, raw: '{broken' }), 400, 'malformed_request');
  // replay after the limit was reached still returns the original
  assert.equal((await refund(t.bob, P.payment_id, { amount: 800 })).status, 201);
  assert.equal((await refund(t.bob, P.payment_id, { amount: 200 }, key)).status, 200);
  // failed attempts do not claim the key
  const k2 = uniq('f');
  const P2 = await mk(t, 100);
  expectErr(await refund(t.bob, P2.payment_id, { amount: 101 }, k2), 422, 'refund_exceeds_payment');
  expectErr(await refund(t.ada, P2.payment_id, { amount: 10 }, k2), 403, 'forbidden');
  assert.equal((await refund(t.bob, P2.payment_id, { amount: 10 }, k2)).status, 201);
  // same key on another payment is another request; per-user scope
  const k3 = 'shared-key';
  const P3 = await mk(t, 100);
  assert.equal((await refund(t.bob, P3.payment_id, { amount: 10 }, k3)).status, 201);
  assert.equal((await refund(t.bob, P2.payment_id, { amount: 10 }, k3)).status, 201);
  const Q = (await pay(t.cy === undefined ? t.ada : t.bob, { to_handle: 'dee', amount: 50 })).json;
  assert.equal((await refund(t.dee, Q.payment_id, { amount: 5 }, k3)).status, 201);
});

test('Cumulative refunds: exact limit allowed, one more unit -> 422 refund_exceeds_payment; failures change nothing and leave the key reusable', async () => {
  const { t } = await setup();
  const P = await mk(t, 1000);
  expectErr(await refund(t.bob, P.payment_id, { amount: 1001 }), 422, 'refund_exceeds_payment');
  assert.equal((await refund(t.bob, P.payment_id, { amount: 300 })).status, 201);
  assert.equal((await refund(t.bob, P.payment_id, { amount: 300 })).status, 201);
  const before = JSON.stringify([await me(t.ada), await me(t.bob), (await get(t.ada, '/activity?limit=200')).json]);
  const key = uniq('over');
  expectErr(await refund(t.bob, P.payment_id, { amount: 401 }, key), 422, 'refund_exceeds_payment');
  assert.equal(JSON.stringify([await me(t.ada), await me(t.bob), (await get(t.ada, '/activity?limit=200')).json]), before, 'rejected refund leaves no trace');
  const last = await refund(t.bob, P.payment_id, { amount: 400 }, key);
  assert.equal(last.status, 201, last.text);
  expectMe(await me(t.ada), { total: 10000, available: 10000, held: 0 });
  expectMe(await me(t.bob), { total: 2500, available: 2500, held: 0 });
  expectErr(await refund(t.bob, P.payment_id, { amount: 1 }), 422, 'refund_exceeds_payment');
  const feed = (await get(t.ada, '/activity?limit=200')).json.payments;
  assert.equal(feed.filter((p) => p.refund_of === P.payment_id).length, 3);
  assert.equal(await sumView(ALL.map((h) => t[h]), {}), TOTAL);
});

test('Refund limit is the payment\'s CURRENT corrected amount; a correction cannot go below the already refunded amount', async () => {
  const { t } = await setup();
  const P = await mk(t, 1000);
  await sleep(1100);
  const eff = P.created_at;
  assert.equal((await correct(t.ada, P.payment_id, { expected_revision: 1, amount: 800, effective_at: eff, reason: 'less' })).status, 201); // bob pays 200 back
  expectMe(await me(t.ada), { total: 9200, available: 9200, held: 0 });
  expectErr(await refund(t.bob, P.payment_id, { amount: 801 }), 422, 'refund_exceeds_payment');
  assert.equal((await refund(t.bob, P.payment_id, { amount: 300 })).status, 201);
  // below already refunded -> 422 refund_exceeds_payment; exactly refunded -> ok
  expectErr(await correct(t.ada, P.payment_id, { expected_revision: 2, amount: 299, effective_at: eff, reason: 'x' }), 422, 'refund_exceeds_payment');
  expectErr(await correct(t.ada, P.payment_id, { expected_revision: 2, amount: 0, effective_at: eff, reason: 'x' }), 422, 'refund_exceeds_payment');
  expectMe(await me(t.ada), { total: 9500, available: 9500, held: 0 });
  assert.equal((await revisions(t.ada, P.payment_id)).json.revisions.length, 2, 'failed corrections add no revision');
  const eq = await correct(t.ada, P.payment_id, { expected_revision: 2, amount: 300, effective_at: eff, reason: 'exactly refunded' });
  assert.equal(eq.status, 201, eq.text);
  // bob had paid 300 (refund) and now another 500 back through the decrease
  expectMe(await me(t.ada), { total: 10000, available: 10000, held: 0 });
  expectMe(await me(t.bob), { total: 2500, available: 2500, held: 0 });
  expectErr(await refund(t.bob, P.payment_id, { amount: 1 }), 422, 'refund_exceeds_payment');
  // increasing again reopens refund room
  assert.equal((await correct(t.ada, P.payment_id, { expected_revision: 3, amount: 600, effective_at: eff, reason: 'up' })).status, 201);
  assert.equal((await refund(t.bob, P.payment_id, { amount: 300 })).status, 201);
  expectErr(await refund(t.bob, P.payment_id, { amount: 1 }), 422, 'refund_exceeds_payment');
  assert.equal(await sumView(ALL.map((h) => t[h]), {}), TOTAL);
});

test('Refund of a refund -> 422 invalid_refund_target; refund payments cannot be corrected (422 linked_payment_immutable)', async () => {
  const { t } = await setup();
  const P = await mk(t, 1000);
  const R = (await refund(t.bob, P.payment_id, { amount: 300 })).json;
  expectErr(await refund(t.ada, R.payment_id, { amount: 100 }), 422, 'invalid_refund_target');
  expectErr(await refund(t.ada, R.payment_id, { amount: 1 }), 422, 'invalid_refund_target');
  await sleep(1100);
  const body = { expected_revision: 1, amount: 100, effective_at: at(Date.now() - 500), reason: 'x' };
  expectErr(await correct(t.bob, R.payment_id, body), 422, 'linked_payment_immutable');
  expectMe(await me(t.ada), { total: 9300, available: 9300, held: 0 });
  assert.equal((await get(t.ada, '/activity?limit=200')).json.payments.length, 2);
  // revisions of the refund are readable by its parties; revision 1 only
  const rv = (await revisions(t.ada, R.payment_id)).json.revisions;
  assert.equal(rv.length, 1); assert.equal(rv[0].revision, 1); assert.equal(rv[0].amount, 300);
  assert.equal((await revisions(t.bob, R.payment_id)).status, 200);
  expectErr(await revisions(t.cy, R.payment_id), 404, 'not_found');
});

test('Refund targets: request payments, captures and settlement members may be refunded; captures cannot be corrected', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 400 })).json;
  const viaReq = (await payReq(t.ada, rq.request_id, { visibility: 'private' })).json;
  const r1 = await refund(t.bob, viaReq.payment_id, { amount: 150 });
  assert.equal(r1.status, 201, r1.text);
  assert.equal(r1.json.refund_of, viaReq.payment_id); assert.equal(r1.json.request_id, null); assert.equal(r1.json.visibility, 'private');
  assert.equal((await get(t.ada, '/requests')).json.requests[0].status, 'paid', 'request is not reopened');
  assert.equal((await get(t.ada, '/requests')).json.requests[0].payment_id, viaReq.payment_id);
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 1000, note: 'dep', visibility: 'public' })).json;
  const cap = (await capture(t.bob, a.authorization_id, { amount: 600 })).json; // final: 400 released
  const authBefore = (await auths(t.ada, '?limit=200')).authorizations.find((x) => x.authorization_id === a.authorization_id);
  expectMe(await me(t.ada), { total: 10000 - 400 + 150 - 600, available: 10000 - 400 + 150 - 600, held: 0 });
  const r2 = await refund(t.bob, cap.payment_id, { amount: 250 });
  assert.equal(r2.status, 201, r2.text);
  assert.equal(r2.json.refund_of, cap.payment_id); assert.equal(r2.json.authorization_id, null); assert.equal(r2.json.note, 'dep'); assert.equal(r2.json.visibility, 'public');
  const authAfter = (await auths(t.ada, '?limit=200')).authorizations.find((x) => x.authorization_id === a.authorization_id);
  assert.deepEqual(authAfter, authBefore, 'authorization is not reopened and the released hold is not restored');
  expectMe(await me(t.ada), { total: 10000 - 400 + 150 - 600 + 250, available: 10000 - 400 + 150 - 600 + 250, held: 0 });
  expectErr(await refund(t.bob, cap.payment_id, { amount: 351 }), 422, 'refund_exceeds_payment');
  await sleep(1100);
  expectErr(await correct(t.ada, cap.payment_id, { expected_revision: 1, amount: 1, effective_at: at(Date.now() - 500), reason: 'x' }), 422, 'linked_payment_immutable');
});

test('Refund of a settlement payment: allowed, membership unchanged, original settlement receipt unchanged, single correction still rejected', async () => {
  const { t } = await setup();
  const key = uniq('st');
  const body = { transfers: [{ from_handle: 'ada', to_handle: 'bob', amount: 100, note: 'm1' }, { from_handle: 'bob', to_handle: 'cy', amount: 40 }] };
  const first = await http('POST', '/settlements', { token: t.op, key, body });
  assert.equal(first.status, 201);
  const [m1, m2] = first.json.payments;
  const r = await refund(t.bob, m1.payment_id, { amount: 60 });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.refund_of, m1.payment_id);
  assert.ok(r.json.settlement_id === null || r.json.settlement_id === undefined, 'a refund is not a settlement member');
  assert.equal(r.json.note, 'm1');
  const rep = await http('POST', '/settlements', { token: t.op, key, body });
  assert.equal(rep.status, 200); assert.deepEqual(rep.json, first.json, 'original settlement receipt unchanged');
  assert.equal(rep.json.payments.length, 2);
  expectErr(await refund(t.cy, m2.payment_id, { amount: 41 }), 422, 'refund_exceeds_payment');
  assert.equal((await refund(t.cy, m2.payment_id, { amount: 40 })).status, 201);
  expectErr(await correct(t.ada, m1.payment_id, { expected_revision: 1, amount: 1, effective_at: at(Date.now() - 500), reason: 'x' }), 422, 'linked_payment_immutable');
  const feed = (await get(t.ada, '/activity?limit=200')).json.payments;
  assert.equal(feed.filter((p) => p.settlement_id === first.json.settlement_id).length, 2, 'membership count unchanged');
  expectMe(await me(t.ada), { total: 9960, available: 9960, held: 0 });
  assert.equal(await sumView(ALL.map((h) => t[h]), {}), TOTAL);
});

test('Refund moves AVAILABLE funds only: held money cannot fund a refund (409 insufficient_funds, exact available allowed, atomic)', async () => {
  const { t } = await setup();
  const P = await mk(t, 1000); // bob 3500
  assert.equal((await mkAuth(t.bob, { to_handle: 'cy', amount: 3000 })).status, 201); // bob available 500
  const key = uniq('rf');
  expectErr(await refund(t.bob, P.payment_id, { amount: 501 }, key), 409, 'insufficient_funds');
  expectMe(await me(t.bob), { total: 3500, available: 500, held: 3000 });
  expectMe(await me(t.ada), { total: 9000, available: 9000, held: 0 });
  assert.equal((await get(t.ada, '/activity?limit=200')).json.payments.length, 1);
  const ok = await refund(t.bob, P.payment_id, { amount: 500 }, key); // same key: failure claimed nothing
  assert.equal(ok.status, 201, ok.text);
  expectMe(await me(t.bob), { total: 3000, available: 0, held: 3000 });
  expectErr(await refund(t.bob, P.payment_id, { amount: 1 }), 409, 'insufficient_funds');
  expectMe(await me(t.ada), { total: 9500, available: 9500, held: 0 });
  assert.equal(await sumView(ALL.map((h) => t[h]), {}), TOTAL);
});

test('Refund visibility follows the copied visibility: public refunds reach the feed of everyone, private ones only the two parties', async () => {
  const { t } = await setup();
  const pub = await mk(t, 500, { visibility: 'public', note: 'pub' });
  const priv = await mk(t, 500, { visibility: 'private', note: 'priv' });
  const rpub = (await refund(t.bob, pub.payment_id, { amount: 100 })).json;
  const rpriv = (await refund(t.bob, priv.payment_id, { amount: 100 })).json;
  assert.equal(rpub.visibility, 'public'); assert.equal(rpriv.visibility, 'private');
  const ids = async (h) => (await get(t[h], '/activity?limit=200')).json.payments.map((p) => p.payment_id).sort();
  assert.deepEqual(await ids('cy'), [pub.payment_id, rpub.payment_id].sort());
  assert.deepEqual(await ids('op'), [pub.payment_id, rpub.payment_id].sort());
  assert.deepEqual(await ids('ada'), [pub.payment_id, priv.payment_id, rpub.payment_id, rpriv.payment_id].sort());
  assert.deepEqual(await ids('bob'), [pub.payment_id, priv.payment_id, rpub.payment_id, rpriv.payment_id].sort());
  // newest first by created_at
  const feed = (await get(t.ada, '/activity?limit=200')).json.payments;
  const times = feed.map((p) => ms(p.created_at)); assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test('Refunds appear in both statements with the right deltas, a balance_after chain and refund_of; third parties do not see them', async () => {
  const { t } = await setup();
  const P = await mk(t, 1000);
  await sleep(1100);
  const R = (await refund(t.bob, P.payment_id, { amount: 250 })).json;
  const sa = await stmt(t.ada), sb = await stmt(t.bob);
  assert.deepEqual(sa.entries.map((e) => [e.payment.payment_id, e.delta, e.balance_after]), [[P.payment_id, -1000, 9000], [R.payment_id, 250, 9250]]);
  assert.deepEqual(sb.entries.map((e) => [e.payment.payment_id, e.delta, e.balance_after]), [[P.payment_id, 1000, 3500], [R.payment_id, -250, 3250]]);
  assert.equal(sa.entries[1].payment.refund_of, P.payment_id);
  assert.equal(sa.entries[1].revision, 1); assert.equal(ms(sa.entries[1].effective_at), ms(R.created_at)); assert.equal(ms(sa.entries[1].recorded_at), ms(R.created_at));
  assert.equal(sa.opening_balance, 10000); assert.equal(sa.closing_balance, 9250); assert.equal(sb.closing_balance, 3250);
  assert.equal((await stmt(t.cy)).entries.length, 0);
  assert.equal((await meAt(t.ada, { as_of: P.created_at })).balance, 9000);
  assert.equal((await meAt(t.ada, { as_of: R.created_at })).balance, 9250);
  assert.equal(await sumView(ALL.map((h) => t[h]), { as_of: P.created_at }), TOTAL);
  // every statement page shows each payment once
  const pages = [await stmt(t.ada, { limit: 1 }), await stmt(t.ada, { limit: 1, offset: 1 })];
  assert.deepEqual(pages.flatMap((p) => p.entries.map((e) => e.payment.payment_id)), [P.payment_id, R.payment_id]);
});

test('Correction debits are checked against AVAILABLE funds (holds): increase vs sender available, decrease vs receiver available', async () => {
  const { t } = await setup();
  const P = await mk(t, 1000); // ada 9000 / bob 3500
  assert.equal((await mkAuth(t.ada, { to_handle: 'cy', amount: 8800 })).status, 201); // ada available 200
  await sleep(1100);
  const eff = P.created_at;
  expectErr(await correct(t.ada, P.payment_id, { expected_revision: 1, amount: 1500, effective_at: eff, reason: 'up' }), 409, 'insufficient_funds');
  expectMe(await me(t.ada), { total: 9000, available: 200, held: 8800 });
  const ok = await correct(t.ada, P.payment_id, { expected_revision: 1, amount: 1200, effective_at: eff, reason: 'up' });
  assert.equal(ok.status, 201, ok.text);
  expectMe(await me(t.ada), { total: 8800, available: 0, held: 8800 });
  // decrease: bob's whole balance is held
  const Q = (await pay(t.ada === undefined ? t.op : t.op, { to_handle: 'dee', amount: 400 })).json; // dee 900
  assert.equal((await mkAuth(t.dee, { to_handle: 'cy', amount: 900 })).status, 201);
  await sleep(1100);
  expectErr(await correct(t.op, Q.payment_id, { expected_revision: 1, amount: 300, effective_at: Q.created_at, reason: 'down' }), 409, 'insufficient_funds');
  expectMe(await me(t.dee), { total: 900, available: 0, held: 900 });
});

test('Refund atomicity: concurrent identical refunds with one key create one payment; nothing partial is ever visible', async () => {
  const { t } = await setup();
  const P = await mk(t, 1000);
  const key = uniq('rf');
  const rs = await Promise.all(Array.from({ length: 20 }, () => refund(t.bob, P.payment_id, { amount: 100 }, key)));
  assert.ok(rs.every((r) => r.status < 500));
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
  for (const r of rs) assert.deepEqual(r.json, rs.find((x) => x.status === 201).json);
  expectMe(await me(t.ada), { total: 9100, available: 9100, held: 0 });
  assert.equal((await get(t.ada, '/activity?limit=200')).json.payments.length, 2);
});

test('Stage-3 behaviours unchanged: ordinary corrections still work, settlement members and captures stay immutable for single corrections', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { p1 } = await sIds(t);
  const c = await correct(t.ada, p1, { expected_revision: 1, amount: 400, effective_at: at(now - 5 * DAY), reason: 'ok' });
  assert.equal(c.status, 201, c.text);
  assert.equal(c.json.revision, 2);
  expectMe(await me(t.ada), { total: 10100, available: 10100, held: 0 });
  assert.equal((await meAt(t.ada, { as_of: at(now - 5 * DAY) })).balance, 9200);
  const st = (await settle(t.op, { transfers: [{ from_handle: 'ada', to_handle: 'bob', amount: 10 }] })).json;
  expectErr(await correct(t.ada, st.payments[0].payment_id, { expected_revision: 1, amount: 1, effective_at: at(Date.now() - 500), reason: 'x' }), 422, 'linked_payment_immutable');
  const rev = (await revisions(t.ada, p1)).json.revisions;
  assert.deepEqual(rev.map((r) => r.revision), [1, 2]);
  assert.ok(rev.every((r) => r.correction_batch_id === undefined || r.correction_batch_id === null), 'single corrections carry no batch id');
});

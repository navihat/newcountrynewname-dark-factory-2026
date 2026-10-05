import { test } from 'node:test';
import assert from 'node:assert/strict';
import { http, fixture, user, setup, balance, totalBalance, expectErr, pay, mkReq, payReq, settle, get, uniq, RFC3339 } from './lib.mjs';

const tr = (from_handle, to_handle, amount, extra = {}) => ({ from_handle, to_handle, amount, ...extra });
const noPayments = async (t) => {
  for (const k of Object.keys(t)) assert.deepEqual((await get(t[k], '/activity')).json.payments.filter((p) => p.settlement_id), [], `no settlement payments visible to ${k}`);
};

test('§11 auth: no token 401, bad token 401, non-operator 403 forbidden, operator 201', async () => {
  const { t } = await setup();
  const body = { transfers: [tr('ada', 'bob', 10)] };
  expectErr(await http('POST', '/settlements', { key: uniq(), body }), 401, 'unauthenticated');
  expectErr(await http('POST', '/settlements', { token: 'bogus', key: uniq(), body }), 401, 'unauthenticated');
  expectErr(await settle(t.ada, body), 403, 'forbidden');
  expectErr(await settle(t.bob, body), 403, 'forbidden');
  expectErr(await settle(t.ada, { transfers: [] }), 403, 'forbidden'); // permission before validation
  assert.equal(await balance(t.ada), 10000);
  assert.equal((await settle(t.op, body)).status, 201);
  assert.equal(await balance(t.ada), 9990);
});

test('§11 settlement_operator_ids defaults to [] (nobody is operator); signed-up users are never operators', async () => {
  const fx = fixture(); delete fx.settlement_operator_ids;
  const { t } = await setup(fx);
  expectErr(await settle(t.op, { transfers: [tr('ada', 'bob', 1)] }), 403, 'forbidden');
  const s = await http('POST', '/auth/signup', { body: { email: 'newop@example.com', password: 'longenough1', display_name: 'N' } });
  expectErr(await settle(s.json.token, { transfers: [tr('ada', 'bob', 1)] }), 403, 'forbidden');
});

test('§11 multiple operators; operator may move money between wallets that are not their own', async () => {
  const { t } = await setup(fixture({ settlement_operator_ids: ['u_op', 'u_dee'] }));
  assert.equal((await settle(t.dee, { transfers: [tr('ada', 'cy', 100)] })).status, 201);
  assert.equal((await settle(t.op, { transfers: [tr('bob', 'ada', 100)] })).status, 201);
  assert.equal(await balance(t.cy), 100);
  expectErr(await settle(t.bob, { transfers: [tr('bob', 'ada', 1)] }), 403, 'forbidden');
});

test('§11 success: 201 {settlement_id, committed_at, payments[]} in input order; members are payments with settlement_id', async () => {
  const { t } = await setup();
  const r = await settle(t.op, { transfers: [tr('ada', 'bob', 100, { note: 'a→b é', visibility: 'private' }), tr('bob', 'cy', 50), tr('ada', 'cy', 7, { ignored: 1 })], whatever: true });
  assert.equal(r.status, 201, r.text);
  const s = r.json;
  assert.equal(typeof s.settlement_id, 'string'); assert.ok(s.settlement_id.length <= 64);
  assert.match(s.committed_at, RFC3339);
  assert.equal(s.payments.length, 3);
  assert.deepEqual(s.payments.map((p) => [p.from_handle, p.to_handle, p.amount]), [['ada', 'bob', 100], ['bob', 'cy', 50], ['ada', 'cy', 7]]);
  assert.deepEqual(s.payments.map((p) => p.visibility), ['private', 'public', 'public']);
  assert.deepEqual(s.payments.map((p) => p.note), ['a→b é', '', '']);
  const ids = new Set();
  for (const p of s.payments) {
    assert.equal(p.settlement_id, s.settlement_id);
    assert.equal(p.request_id, null);
    assert.equal(p.created_at, s.committed_at, 'all members share created_at == committed_at');
    assert.equal(p.currency, 'EUR');
    for (const k of ['payment_id', 'from_user_id', 'to_user_id']) assert.equal(typeof p[k], 'string', k);
    ids.add(p.payment_id);
  }
  assert.equal(ids.size, 3);
  assert.equal(await balance(t.ada), 10000 - 107);
  assert.equal(await balance(t.bob), 2500 + 100 - 50);
  assert.equal(await balance(t.cy), 57);
});

test('§11 members appear in the feed with settlement_id; ordinary payments and request payments expose settlement_id null', async () => {
  const { t } = await setup();
  const normal = (await pay(t.ada, { to_handle: 'bob', amount: 5 })).json;
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 6 })).json;
  const viaReq = (await payReq(t.ada, rq.request_id)).json;
  const s = (await settle(t.op, { transfers: [tr('ada', 'bob', 1), tr('bob', 'cy', 1)] })).json;
  for (const p of [normal, viaReq]) assert.ok('settlement_id' in p && p.settlement_id === null, 'nonmember settlement_id must be null (present)');
  const feed = (await get(t.cy, '/activity?limit=200')).json.payments;
  const byId = Object.fromEntries(feed.map((p) => [p.payment_id, p]));
  assert.equal(byId[normal.payment_id].settlement_id, null);
  assert.equal(byId[viaReq.payment_id].settlement_id, null);
  for (const m of s.payments) {
    assert.equal(byId[m.payment_id].settlement_id, s.settlement_id);
    assert.deepEqual(byId[m.payment_id], m);
  }
});

test('§11 bounds: 0 transfers and 33 transfers -> 422; 1 and 32 accepted', async () => {
  const { t } = await setup();
  expectErr(await settle(t.op, { transfers: [] }), 422, 'validation_failed');
  const many = (n) => Array.from({ length: n }, () => tr('ada', 'bob', 1));
  expectErr(await settle(t.op, { transfers: many(33) }), 422, 'validation_failed');
  expectErr(await settle(t.op, { transfers: many(100) }), 422, 'validation_failed');
  assert.equal(await balance(t.ada), 10000);
  const one = await settle(t.op, { transfers: many(1) });
  assert.equal(one.status, 201);
  const max = await settle(t.op, { transfers: many(32) });
  assert.equal(max.status, 201);
  assert.equal(max.json.payments.length, 32);
  assert.equal(await balance(t.ada), 10000 - 33);
});

test('§11 malformed batch shape -> 422 validation_failed (missing/non-array transfers, non-object entries, missing fields)', async () => {
  const { t } = await setup();
  const bad = [
    {}, { transfers: null }, { transfers: 'x' }, { transfers: {} }, { transfers: 5 },
    { transfers: [null] }, { transfers: ['ada'] }, { transfers: [[]] }, { transfers: [5] },
    { transfers: [{ to_handle: 'bob', amount: 5 }] },
    { transfers: [{ from_handle: 'ada', amount: 5 }] },
    { transfers: [{ from_handle: 'ada', to_handle: 'bob' }] },
  ];
  for (const body of bad) expectErr(await settle(t.op, body), 422, 'validation_failed');
  // ambiguity: wrong JSON type inside an entry may be 400 (§5) or 422 (§11 'malformed batch shape')
  const wt = await settle(t.op, { transfers: [{ from_handle: 5, to_handle: 'bob', amount: 5 }] });
  assert.ok(wt.status === 400 || wt.status === 422, wt.text);
  assert.equal(await totalBalance(t), 10000 + 2500 + 500 + 100000);
  expectErr(await http('POST', '/settlements', { token: t.op, key: uniq(), raw: '{"transfers":[' }), 400, 'malformed_request');
  expectErr(await http('POST', '/settlements', { token: t.op, key: uniq(), raw: '[]' }), 400, 'malformed_request');
});

test('§11 per-entry payment rules: amount range/forms, note > 200, non-string note, bad visibility -> 422', async () => {
  const { t } = await setup();
  for (const amount of [0, -5, 1000000001, 1.5, '5', true, null]) expectErr(await settle(t.op, { transfers: [tr('ada', 'bob', amount)] }), 422, 'validation_failed');
  expectErr(await settle(t.op, { transfers: [tr('ada', 'bob', 5, { note: 'n'.repeat(201) })] }), 422, 'validation_failed');
  expectErr(await settle(t.op, { transfers: [tr('ada', 'bob', 5, { note: null })] }), 422, 'validation_failed');
  expectErr(await settle(t.op, { transfers: [tr('ada', 'bob', 5, { note: 9 })] }), 422, 'validation_failed');
  expectErr(await settle(t.op, { transfers: [tr('ada', 'bob', 5, { visibility: 'friends' })] }), 422, 'validation_failed');
  const ok = await http('POST', '/settlements', { token: t.op, key: uniq(), raw: '{"transfers":[{"from_handle":"ada","to_handle":"bob","amount":1e2,"note":"' + 'n'.repeat(200) + '"}]}' });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.payments[0].amount, 100);
  assert.equal(await balance(t.ada), 9900);
});

test('§11 unknown handle -> 404 not_found (from or to); self-transfer -> 422 self_payment; nothing applied', async () => {
  const { t } = await setup();
  expectErr(await settle(t.op, { transfers: [tr('ada', 'ghost', 5)] }), 404, 'not_found');
  expectErr(await settle(t.op, { transfers: [tr('ghost', 'ada', 5)] }), 404, 'not_found');
  expectErr(await settle(t.op, { transfers: [tr('ada', 'ada', 5)] }), 422, 'self_payment');
  expectErr(await settle(t.op, { transfers: [tr('op', 'op', 5)] }), 422, 'self_payment');
  assert.equal(await balance(t.ada), 10000);
  await noPayments(t);
});

test('§11 entry errors take precedence IN INPUT ORDER, and before insufficient_funds', async () => {
  const { t } = await setup();
  // first bad entry wins
  expectErr(await settle(t.op, { transfers: [tr('ada', 'bob', 5), tr('ada', 'ghost', 5), tr('ada', 'ada', 5)] }), 404, 'not_found');
  expectErr(await settle(t.op, { transfers: [tr('ada', 'bob', 5), tr('ada', 'ada', 5), tr('ada', 'ghost', 5)] }), 422, 'self_payment');
  expectErr(await settle(t.op, { transfers: [tr('ada', 'ghost', 5), tr('ada', 'bob', 0)] }), 404, 'not_found');
  expectErr(await settle(t.op, { transfers: [tr('ada', 'bob', 0), tr('ada', 'ghost', 5)] }), 422, 'validation_failed');
  expectErr(await settle(t.op, { transfers: [tr('ada', 'ada', 5), tr('ada', 'bob', 0)] }), 422, 'self_payment');
  // unaffordable entry first, entry error later: entry error still wins
  expectErr(await settle(t.op, { transfers: [tr('cy', 'ada', 999999), tr('ada', 'ghost', 1)] }), 404, 'not_found');
  expectErr(await settle(t.op, { transfers: [tr('cy', 'ada', 999999), tr('ada', 'ada', 1)] }), 422, 'self_payment');
  expectErr(await settle(t.op, { transfers: [tr('cy', 'ada', 999999), tr('ada', 'bob', 0)] }), 422, 'validation_failed');
  // only insufficient funds
  expectErr(await settle(t.op, { transfers: [tr('cy', 'ada', 1)] }), 409, 'insufficient_funds');
  await noPayments(t);
});

test('§11 net affordability: intermediate wallet funded only by incoming transfers is fine, regardless of order', async () => {
  const { t } = await setup();
  // cy has 0 and passes 5000 through
  const r = await settle(t.op, { transfers: [tr('cy', 'dee', 5000), tr('ada', 'cy', 5000)] });
  assert.equal(r.status, 201, r.text);
  assert.equal(await balance(t.cy), 0);
  assert.equal(await balance(t.dee), 5500);
  assert.equal(await balance(t.ada), 5000);
  // longer chain: bob(2500) -> cy (0) -> dee ... where each hop is funded by the previous, listed in reverse
  const chain = await settle(t.op, { transfers: [tr('dee', 'cy', 5500), tr('cy', 'bob', 5000), tr('bob', 'ada', 7500), tr('ada', 'dee', 100)] });
  // dee 5500 sends 5500 -> cy; cy net: +5500 -5000 = +500; bob +5000 -7500 = -2500 + 2500 balance=0 ok; ada +7500 -100; dee +100 -5500
  assert.equal(chain.status, 201, chain.text);
  assert.equal(await balance(t.bob), 0);
  assert.equal(await balance(t.cy), 500);
  assert.equal(await balance(t.ada), 5000 + 7500 - 100);
  assert.equal(await balance(t.dee), 5500 - 5500 + 100);
});

test('§11 cycles and mutual transfers net out (A->B and B->A for A\'s full balance)', async () => {
  const { t } = await setup();
  const r = await settle(t.op, { transfers: [tr('dee', 'cy', 500), tr('cy', 'dee', 500), tr('cy', 'dee', 1), tr('dee', 'cy', 1)] });
  assert.equal(r.status, 201, r.text);
  assert.equal(await balance(t.dee), 500);
  assert.equal(await balance(t.cy), 0);
  // ring: ada -> bob -> cy -> ada with amounts above any single balance except through the ring
  const ring = await settle(t.op, { transfers: [tr('cy', 'ada', 9000), tr('ada', 'bob', 9000), tr('bob', 'cy', 9000)] });
  assert.equal(ring.status, 201, ring.text);
  assert.equal(await balance(t.cy), 0);
  assert.equal(await balance(t.ada), 10000);
  assert.equal(await balance(t.bob), 2500);
});

test('§11 insufficient collective funds -> 409 insufficient_funds; atomic: nothing moves, no payments, key not claimed', async () => {
  const { t } = await setup();
  const before = await totalBalance(t);
  const key = uniq();
  // last transfer is the unaffordable one: dee only has 500 and receives nothing
  const body = { transfers: [tr('ada', 'bob', 100), tr('bob', 'cy', 100), tr('dee', 'cy', 501)] };
  expectErr(await http('POST', '/settlements', { token: t.op, key, body }), 409, 'insufficient_funds');
  assert.equal(await balance(t.ada), 10000);
  assert.equal(await balance(t.bob), 2500);
  assert.equal(await balance(t.cy), 0);
  assert.equal(await balance(t.dee), 500);
  await noPayments(t);
  for (const k of Object.keys(t)) assert.deepEqual((await get(t[k], '/activity')).json.payments, []);
  // net shortfall of a single wallet across multiple outgoing transfers
  expectErr(await settle(t.op, { transfers: [tr('dee', 'cy', 300), tr('dee', 'bob', 201)] }), 409, 'insufficient_funds');
  // exact boundary works
  expectErr(await settle(t.op, { transfers: [tr('dee', 'cy', 300), tr('dee', 'bob', 201), tr('ada', 'dee', 0)] }), 422, 'validation_failed');
  const exact = await settle(t.op, { transfers: [tr('dee', 'cy', 300), tr('dee', 'bob', 200)] });
  assert.equal(exact.status, 201);
  assert.equal(await balance(t.dee), 0);
  // key was not claimed by the failure: same key with a corrected body works
  const retry = await http('POST', '/settlements', { token: t.op, key, body: { transfers: [tr('ada', 'bob', 100)] } });
  assert.equal(retry.status, 201);
  assert.equal(await totalBalance(t), before);
});

test('§11 failed validation claims no key: same key + corrected body succeeds, later different body conflicts', async () => {
  const { t } = await setup();
  const key = uniq();
  expectErr(await http('POST', '/settlements', { token: t.op, key, body: { transfers: [tr('ada', 'ghost', 1)] } }), 404, 'not_found');
  expectErr(await http('POST', '/settlements', { token: t.op, key, body: { transfers: [] } }), 422, 'validation_failed');
  const ok = await http('POST', '/settlements', { token: t.op, key, body: { transfers: [tr('ada', 'bob', 3)] } });
  assert.equal(ok.status, 201);
  expectErr(await http('POST', '/settlements', { token: t.op, key, body: { transfers: [tr('ada', 'bob', 4)] } }), 409, 'idempotency_key_reuse');
});

test('§11 replay returns 200 with the original complete response (same ids, same committed_at), moves nothing', async () => {
  const { t } = await setup();
  const key = uniq();
  const body = { transfers: [tr('ada', 'bob', 100), tr('bob', 'cy', 100, { visibility: 'private', note: 'r' })] };
  const first = await http('POST', '/settlements', { token: t.op, key, body });
  assert.equal(first.status, 201);
  await new Promise((r) => setTimeout(r, 1200));
  const rep = await http('POST', '/settlements', { token: t.op, key, body });
  assert.equal(rep.status, 200);
  assert.deepEqual(rep.json, first.json);
  assert.equal(await balance(t.ada), 9900);
  assert.equal(await balance(t.cy), 100);
  assert.equal((await get(t.ada, '/activity')).json.payments.length, 1);
  // the other operator-less user cannot replay using the same key (403), and key is per-user
  expectErr(await http('POST', '/settlements', { token: t.ada, key, body }), 403, 'forbidden');
});

test('§11 key scope per user: two operators can reuse the same key string for different settlements', async () => {
  const { t } = await setup(fixture({ settlement_operator_ids: ['u_op', 'u_dee'] }));
  const key = 'same-key';
  const a = await http('POST', '/settlements', { token: t.op, key, body: { transfers: [tr('ada', 'bob', 10)] } });
  const b = await http('POST', '/settlements', { token: t.dee, key, body: { transfers: [tr('ada', 'bob', 20)] } });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.notEqual(a.json.settlement_id, b.json.settlement_id);
  assert.equal(await balance(t.ada), 9970);
});

test('§11 constituent visibility follows the ordinary feed rule: private only to its two parties; operator gets no special access', async () => {
  const { t } = await setup();
  const s = (await settle(t.op, { transfers: [tr('ada', 'bob', 10, { visibility: 'private', note: 'sec' }), tr('bob', 'cy', 10)] })).json;
  const [priv, pub] = s.payments;
  const ids = async (tok) => (await get(tok, '/activity?limit=200')).json.payments.map((p) => p.payment_id);
  assert.deepEqual((await ids(t.ada)).sort(), [priv.payment_id, pub.payment_id].sort()); // pub is public
  assert.deepEqual((await ids(t.bob)).sort(), [priv.payment_id, pub.payment_id].sort());
  assert.deepEqual((await ids(t.cy)).sort(), [pub.payment_id].sort());
  assert.deepEqual(await ids(t.dee), [pub.payment_id]);
  assert.deepEqual(await ids(t.op), [pub.payment_id], 'operator is not a party to either and sees only the public one');
  // operator moving its own money sees it as party
  const own = (await settle(t.op, { transfers: [tr('op', 'cy', 3, { visibility: 'private' })] })).json.payments[0];
  assert.ok((await ids(t.op)).includes(own.payment_id));
  assert.ok(!(await ids(t.ada)).includes(own.payment_id));
  assert.ok((await ids(t.cy)).includes(own.payment_id));
});

test('§11 operator permission does not grant access to others\' requests', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  assert.deepEqual((await get(t.op, '/requests')).json.requests, []);
  assert.deepEqual((await get(t.op, '/requests?direction=incoming')).json.requests, []);
  expectErr(await payReq(t.op, rq.request_id), 403, 'forbidden');
  expectErr(await http('POST', `/requests/${rq.request_id}/decline`, { token: t.op }), 403, 'forbidden');
  expectErr(await http('POST', `/requests/${rq.request_id}/cancel`, { token: t.op }), 403, 'forbidden');
  assert.equal((await get(t.ada, '/requests')).json.requests[0].status, 'pending');
  // a split's requests likewise
  await http('POST', '/splits', { token: t.ada, key: uniq(), body: { amount: 10, participant_handles: ['bob', 'cy'] } });
  assert.deepEqual((await get(t.op, '/requests')).json.requests, []);
});

test('§11 duplicates of the same pair in one settlement are separate payments; sum conserved', async () => {
  const { t } = await setup();
  const before = await totalBalance(t);
  const r = await settle(t.op, { transfers: [tr('ada', 'bob', 100), tr('ada', 'bob', 100), tr('ada', 'bob', 100)] });
  assert.equal(r.status, 201);
  assert.equal(new Set(r.json.payments.map((p) => p.payment_id)).size, 3);
  assert.equal(await balance(t.bob), 2800);
  assert.equal(await totalBalance(t), before);
  const feed = (await get(t.bob, '/activity')).json.payments;
  assert.equal(feed.filter((p) => p.settlement_id === r.json.settlement_id).length, 3);
});

test('§11 settlement and ordinary payments interleave: later normal payment has null settlement_id and different created_at semantics', async () => {
  const { t } = await setup();
  const s = (await settle(t.op, { transfers: [tr('ada', 'bob', 1)] })).json;
  const p = (await pay(t.ada, { to_handle: 'bob', amount: 1 })).json;
  assert.equal(p.settlement_id, null);
  assert.notEqual(p.payment_id, s.payments[0].payment_id);
});

test('§11 amount at the single-request maximum in a settlement is accepted, above is not', async () => {
  const { t } = await setup(fixture({ users: [user('u_op', 'op', 5000000000), user('u_x', 'x', 0), user('u_y', 'y', 0)], settlement_operator_ids: ['u_op'] }), ['op', 'x', 'y']);
  expectErr(await settle(t.op, { transfers: [tr('op', 'x', 1000000001)] }), 422, 'validation_failed');
  const r = await settle(t.op, { transfers: [tr('op', 'x', 1000000000), tr('op', 'y', 1000000000)] });
  assert.equal(r.status, 201);
  assert.equal(await balance(t.x), 1000000000);
  assert.equal(await balance(t.op), 3000000000);
});

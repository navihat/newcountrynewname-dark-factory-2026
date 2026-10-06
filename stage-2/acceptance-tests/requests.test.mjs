import { test } from 'node:test';
import assert from 'node:assert/strict';
import { http, fixture, user, setup, balance, totalBalance, expectErr, pay, mkReq, payReq, get, uniq, RFC3339 } from './lib.mjs';

const act = (tok, id, what) => http('POST', `/requests/${id}/${what}`, { token: tok });
const rawReq = (token, raw, key = uniq('raw')) => http('POST', '/requests', { token, key, raw });

test('§8 POST /requests 201 shape: caller is requester, status pending, payment_id null', async () => {
  const { t } = await setup();
  const r = await mkReq(t.bob, { payer_handle: 'ada', amount: 1200, note: 'taxi' });
  assert.equal(r.status, 201);
  const q = r.json;
  assert.equal(typeof q.request_id, 'string'); assert.ok(q.request_id.length <= 64);
  assert.equal(q.requester_id, 'u_bob'); assert.equal(q.requester_handle, 'bob');
  assert.equal(q.payer_id, 'u_ada'); assert.equal(q.payer_handle, 'ada');
  assert.equal(q.amount, 1200); assert.equal(q.currency, 'EUR'); assert.equal(q.note, 'taxi');
  assert.equal(q.status, 'pending'); assert.equal(q.payment_id, null);
  assert.match(q.created_at, RFC3339);
  // creating a request moves no money
  assert.equal(await balance(t.ada), 10000);
  assert.equal(await balance(t.bob), 2500);
});

test('§8 request note defaults to ""', async () => {
  const { t } = await setup();
  assert.equal((await mkReq(t.bob, { payer_handle: 'ada', amount: 5 })).json.note, '');
});

test('§8 request errors: amount range, self_request, note length, unknown handle, field types', async () => {
  const { t } = await setup();
  for (const amount of [0, -3, 1000000001, 1.5]) expectErr(await mkReq(t.bob, { payer_handle: 'ada', amount }), 422, 'validation_failed');
  for (const lit of ['"100"', 'true', 'null']) expectErr(await rawReq(t.bob, `{"payer_handle":"ada","amount":${lit}}`), 422, 'validation_failed');
  assert.equal((await rawReq(t.bob, '{"payer_handle":"ada","amount":1e3}')).json.amount, 1000);
  assert.equal((await rawReq(t.bob, '{"payer_handle":"ada","amount":1000.0}')).json.amount, 1000);
  assert.equal((await mkReq(t.bob, { payer_handle: 'ada', amount: 1000000000 })).status, 201);
  expectErr(await mkReq(t.bob, { payer_handle: 'bob', amount: 5 }), 422, 'self_request');
  expectErr(await mkReq(t.bob, { payer_handle: 'ada', amount: 5, note: 'x'.repeat(201) }), 422, 'validation_failed');
  expectErr(await mkReq(t.bob, { payer_handle: 'ada', amount: 5, note: null }), 422, 'validation_failed');
  expectErr(await mkReq(t.bob, { payer_handle: 'ada', amount: 5, note: 7 }), 422, 'validation_failed');
  assert.equal((await mkReq(t.bob, { payer_handle: 'ada', amount: 5, note: 'x'.repeat(200) })).status, 201);
  expectErr(await mkReq(t.bob, { payer_handle: 'ghost', amount: 5 }), 404, 'not_found');
  expectErr(await mkReq(t.bob, { amount: 5 }), 422, 'validation_failed');
  expectErr(await mkReq(t.bob, { payer_handle: 'ada' }), 422, 'validation_failed');
  expectErr(await mkReq(t.bob, { payer_handle: 5, amount: 5 }), 400, 'malformed_request');
  expectErr(await rawReq(t.bob, '{oops'), 400, 'malformed_request');
  expectErr(await rawReq(t.bob, '[]'), 400, 'malformed_request');
});

test('§8 note stored verbatim on requests (unicode, emoji, padding)', async () => {
  const { t } = await setup();
  for (const note of ['  sp  ', '🚕 Taxi — café', '<i>&amp;</i>']) {
    const r = await mkReq(t.bob, { payer_handle: 'ada', amount: 5, note });
    assert.equal(r.json.note, note);
    const l = (await get(t.ada, '/requests')).json.requests.find((x) => x.request_id === r.json.request_id);
    assert.equal(l.note, note);
  }
});

test('§4/§8 request larger than payer balance is created pending (no balance check)', async () => {
  const { t } = await setup();
  const r = await mkReq(t.ada, { payer_handle: 'cy', amount: 999999 }); // cy has 0
  assert.equal(r.status, 201);
  assert.equal(r.json.status, 'pending');
});

test('§4 pay while short -> 409 insufficient_funds, changes nothing; after funds arrive the same request is payable', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.ada, { payer_handle: 'cy', amount: 800 })).json;
  const key = uniq('payshort');
  expectErr(await http('POST', `/requests/${rq.request_id}/pay`, { token: t.cy, key, body: {} }), 409, 'insufficient_funds');
  assert.equal(await balance(t.cy), 0);
  assert.equal(await balance(t.ada), 10000);
  assert.equal((await get(t.cy, '/requests')).json.requests[0].status, 'pending');
  assert.deepEqual((await get(t.cy, '/activity')).json.payments, []);
  // money arrives
  assert.equal((await pay(t.bob, { to_handle: 'cy', amount: 800 })).status, 201);
  // same request, key reusable (earlier attempt failed 4xx)
  const ok = await http('POST', `/requests/${rq.request_id}/pay`, { token: t.cy, key, body: {} });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.amount, 800);
  assert.equal(await balance(t.cy), 0);
  assert.equal(await balance(t.ada), 10800);
  // short by exactly one
  const rq2 = (await mkReq(t.ada, { payer_handle: 'dee', amount: 501 })).json;
  expectErr(await payReq(t.dee, rq2.request_id), 409, 'insufficient_funds');
  const rq3 = (await mkReq(t.ada, { payer_handle: 'dee', amount: 500 })).json;
  assert.equal((await payReq(t.dee, rq3.request_id)).status, 201);
  assert.equal(await balance(t.dee), 0);
});

test('§8 pay request: 201 payment with request_id, default public, request becomes paid with payment_id', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 1200, note: 'taxi' })).json;
  const r = await payReq(t.ada, rq.request_id, {});
  assert.equal(r.status, 201);
  const p = r.json;
  assert.equal(p.request_id, rq.request_id);
  assert.equal(p.from_user_id, 'u_ada'); assert.equal(p.to_user_id, 'u_bob');
  assert.equal(p.from_handle, 'ada'); assert.equal(p.to_handle, 'bob');
  assert.equal(p.amount, 1200); assert.equal(p.visibility, 'public'); assert.equal(p.currency, 'EUR');
  assert.equal(typeof p.payment_id, 'string');
  assert.match(p.created_at, RFC3339);
  assert.equal(await balance(t.ada), 8800);
  assert.equal(await balance(t.bob), 3700);
  const after = (await get(t.bob, '/requests')).json.requests[0];
  assert.equal(after.status, 'paid');
  assert.equal(after.payment_id, p.payment_id);
  assert.equal((await get(t.ada, '/requests')).json.requests[0].status, 'paid');
});

test('§8 pay request with private visibility: payer chooses; hidden from third parties, visible to both parties', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  const r = await payReq(t.ada, rq.request_id, { visibility: 'private' });
  assert.equal(r.status, 201);
  assert.equal(r.json.visibility, 'private');
  const has = async (tok) => (await get(tok, '/activity')).json.payments.some((p) => p.payment_id === r.json.payment_id);
  assert.equal(await has(t.ada), true);
  assert.equal(await has(t.bob), true);
  assert.equal(await has(t.cy), false);
  assert.equal(await has(t.op), false);
  // public payment via request visible to third party
  const rq2 = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  const r2 = await payReq(t.ada, rq2.request_id, { visibility: 'public' });
  assert.equal(await (async () => (await get(t.cy, '/activity')).json.payments.some((p) => p.payment_id === r2.json.payment_id))(), true);
});

test('§8 pay request: bad visibility -> 422; requests carry no visibility field of their own; request_id in feed payment', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  assert.ok(!('visibility' in rq));
  for (const visibility of ['secret', null, 3, 'PRIVATE']) expectErr(await payReq(t.ada, rq.request_id, { visibility }), 422, 'validation_failed');
  assert.equal(await balance(t.ada), 10000);
  assert.equal((await get(t.ada, '/requests')).json.requests[0].status, 'pending');
  const ok = await payReq(t.ada, rq.request_id, { visibility: 'private', ignored: true });
  assert.equal(ok.status, 201);
  const feedP = (await get(t.bob, '/activity')).json.payments[0];
  assert.equal(feedP.request_id, rq.request_id);
});

test('§8 pay request: 404 unknown, 403 not payer (requester, third party, operator), request unchanged', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  expectErr(await payReq(t.ada, 'rq_does_not_exist'), 404, 'not_found');
  expectErr(await payReq(t.bob, rq.request_id), 403, 'forbidden'); // requester cannot pay
  expectErr(await payReq(t.cy, rq.request_id), 403, 'forbidden');
  expectErr(await payReq(t.op, rq.request_id), 403, 'forbidden');
  assert.equal(await balance(t.ada), 10000);
  assert.equal((await get(t.ada, '/requests')).json.requests[0].status, 'pending');
});

test('§8 pay request: not pending (paid/declined/cancelled) -> 409 request_not_pending, even when payer cannot afford it', async () => {
  const { t } = await setup();
  const paid = (await mkReq(t.bob, { payer_handle: 'dee', amount: 500 })).json;
  assert.equal((await payReq(t.dee, paid.request_id)).status, 201); // dee now 0
  expectErr(await payReq(t.dee, paid.request_id), 409, 'request_not_pending'); // new key, already paid
  const dec = (await mkReq(t.bob, { payer_handle: 'dee', amount: 500 })).json;
  assert.equal((await act(t.dee, dec.request_id, 'decline')).status, 200);
  expectErr(await payReq(t.dee, dec.request_id), 409, 'request_not_pending');
  const can = (await mkReq(t.bob, { payer_handle: 'dee', amount: 500 })).json;
  assert.equal((await act(t.bob, can.request_id, 'cancel')).status, 200);
  expectErr(await payReq(t.dee, can.request_id), 409, 'request_not_pending');
  assert.equal(await balance(t.dee), 0);
  assert.equal(await balance(t.bob), 3000);
});

test('§1.3 a request moves money at most once: second pay with a NEW key -> 409, balances unchanged', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 1000 })).json;
  assert.equal((await payReq(t.ada, rq.request_id)).status, 201);
  for (let i = 0; i < 3; i++) expectErr(await payReq(t.ada, rq.request_id), 409, 'request_not_pending');
  assert.equal(await balance(t.ada), 9000);
  assert.equal(await balance(t.bob), 3500);
  assert.equal((await get(t.ada, '/activity')).json.payments.length, 1);
});

test('§8 decline: payer -> 200 declined; twice -> 200 current state; paid/cancelled -> 409; non-payer -> 403; unknown 404', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  expectErr(await act(t.bob, rq.request_id, 'decline'), 403, 'forbidden'); // requester cannot decline
  expectErr(await act(t.cy, rq.request_id, 'decline'), 403, 'forbidden');
  expectErr(await act(t.ada, 'rq_nope', 'decline'), 404, 'not_found');
  const d1 = await act(t.ada, rq.request_id, 'decline');
  assert.equal(d1.status, 200);
  assert.equal(d1.json.status, 'declined');
  assert.equal(d1.json.request_id, rq.request_id);
  assert.equal(d1.json.payment_id, null);
  const d2 = await act(t.ada, rq.request_id, 'decline');
  assert.equal(d2.status, 200);
  assert.deepEqual(d2.json, d1.json);
  expectErr(await act(t.bob, rq.request_id, 'cancel'), 409, 'request_not_pending'); // declined
  const paid = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  await payReq(t.ada, paid.request_id);
  expectErr(await act(t.ada, paid.request_id, 'decline'), 409, 'request_not_pending');
  const canc = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  await act(t.bob, canc.request_id, 'cancel');
  expectErr(await act(t.ada, canc.request_id, 'decline'), 409, 'request_not_pending');
});

test('§8 cancel: requester -> 200 cancelled; twice -> 200; paid/declined -> 409; non-requester -> 403 (payer too)', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  expectErr(await act(t.ada, rq.request_id, 'cancel'), 403, 'forbidden'); // payer cannot cancel
  expectErr(await act(t.cy, rq.request_id, 'cancel'), 403, 'forbidden');
  expectErr(await act(t.bob, 'rq_nope', 'cancel'), 404, 'not_found');
  const c1 = await act(t.bob, rq.request_id, 'cancel');
  assert.equal(c1.status, 200); assert.equal(c1.json.status, 'cancelled');
  const c2 = await act(t.bob, rq.request_id, 'cancel');
  assert.equal(c2.status, 200); assert.deepEqual(c2.json, c1.json);
  expectErr(await act(t.ada, rq.request_id, 'decline'), 409, 'request_not_pending'); // cancelled
  const dec = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  await act(t.ada, dec.request_id, 'decline');
  expectErr(await act(t.bob, dec.request_id, 'cancel'), 409, 'request_not_pending');
  const paid = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  await payReq(t.ada, paid.request_id);
  expectErr(await act(t.bob, paid.request_id, 'cancel'), 409, 'request_not_pending');
  // no money moved by decline/cancel
  assert.equal(await balance(t.ada), 9900);
});

test('§8 decline/cancel need no Idempotency-Key header', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  const r = await http('POST', `/requests/${rq.request_id}/decline`, { token: t.ada });
  assert.equal(r.status, 200);
});

test('§8 GET /requests visibility: only requester or payer see it (third party and operator do not)', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  const ids = async (tok) => (await get(tok, '/requests')).json.requests.map((x) => x.request_id);
  assert.deepEqual(await ids(t.ada), [rq.request_id]);
  assert.deepEqual(await ids(t.bob), [rq.request_id]);
  assert.deepEqual(await ids(t.cy), []);
  assert.deepEqual(await ids(t.op), []);
  // third party cannot act on it: 403 or 404 allowed? spec: 403 for authenticated non-party on pay/decline/cancel
  expectErr(await act(t.cy, rq.request_id, 'decline'), 403, 'forbidden');
});

test('§8 GET /requests filters: direction incoming/outgoing/absent, status filter, unknown values -> 422', async () => {
  const { t } = await setup();
  const out1 = (await mkReq(t.ada, { payer_handle: 'bob', amount: 10 })).json; // ada requester
  const in1 = (await mkReq(t.bob, { payer_handle: 'ada', amount: 20 })).json; // ada payer
  const in2 = (await mkReq(t.cy, { payer_handle: 'ada', amount: 30 })).json;
  await act(t.ada, in2.request_id, 'decline');
  await act(t.ada, out1.request_id, 'cancel');
  const q = async (s) => (await get(t.ada, `/requests${s}`));
  const set = async (s) => new Set((await q(s)).json.requests.map((x) => x.request_id));
  assert.deepEqual(await set(''), new Set([out1.request_id, in1.request_id, in2.request_id]));
  assert.deepEqual(await set('?direction=incoming'), new Set([in1.request_id, in2.request_id]));
  assert.deepEqual(await set('?direction=outgoing'), new Set([out1.request_id]));
  assert.deepEqual(await set('?status=pending'), new Set([in1.request_id]));
  assert.deepEqual(await set('?status=declined'), new Set([in2.request_id]));
  assert.deepEqual(await set('?status=cancelled'), new Set([out1.request_id]));
  assert.deepEqual(await set('?status=paid'), new Set());
  assert.deepEqual(await set('?direction=incoming&status=declined'), new Set([in2.request_id]));
  assert.deepEqual(await set('?direction=outgoing&status=pending'), new Set());
  for (const s of ['?direction=sideways', '?status=done', '?direction=INCOMING', '?status=PENDING']) {
    expectErr(await q(s), 422, 'validation_failed');
  }
  assert.equal((await q('?direction=incoming')).json.has_more, false);
});

test('§8 GET /requests newest first and pagination limit/offset/has_more; strict integer parsing', async () => {
  const { t } = await setup();
  const ids = [];
  for (let i = 1; i <= 5; i++) {
    ids.push((await mkReq(t.bob, { payer_handle: 'ada', amount: i })).json.request_id);
    await new Promise((r) => setTimeout(r, 1100));
  }
  const all = (await get(t.ada, '/requests')).json;
  assert.deepEqual(all.requests.map((r) => r.amount), [5, 4, 3, 2, 1]);
  assert.equal(all.has_more, false);
  const a = (await get(t.ada, '/requests?limit=2&offset=0')).json;
  assert.deepEqual(a.requests.map((r) => r.amount), [5, 4]); assert.equal(a.has_more, true);
  const b = (await get(t.ada, '/requests?limit=2&offset=2')).json;
  assert.deepEqual(b.requests.map((r) => r.amount), [3, 2]); assert.equal(b.has_more, true);
  const c = (await get(t.ada, '/requests?limit=2&offset=4')).json;
  assert.deepEqual(c.requests.map((r) => r.amount), [1]); assert.equal(c.has_more, false);
  const d = (await get(t.ada, '/requests?limit=5')).json;
  assert.equal(d.has_more, false);
  assert.deepEqual((await get(t.ada, '/requests?offset=5')).json, { requests: [], has_more: false });
  for (const q of ['limit=0', 'limit=201', 'limit=-1', 'offset=-1', 'limit=1e2', 'limit=4.0', 'limit=+4', 'offset=1e0', 'offset=1.0', 'limit=x']) {
    expectErr(await get(t.ada, `/requests?${q}`), 422, 'validation_failed');
  }
  assert.equal((await get(t.ada, '/requests?limit=200&offset=0')).status, 200);
  assert.equal((await get(t.ada, '/requests?limit=1')).json.requests.length, 1);
});

test('§8 GET /requests: invalid query checked even with otherwise valid filters', async () => {
  const { t } = await setup();
  expectErr(await get(t.ada, '/requests?direction=incoming&status=pending&limit=0'), 422, 'validation_failed');
  expectErr(await get(t.ada, '/requests?direction=bogus&limit=5'), 422, 'validation_failed');
});

test('§5 400 vs 422 on pay body: visibility only is read; unknown fields ignored; non-object body -> 400', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  expectErr(await http('POST', `/requests/${rq.request_id}/pay`, { token: t.ada, key: uniq(), raw: '{bad' }), 400, 'malformed_request');
  expectErr(await http('POST', `/requests/${rq.request_id}/pay`, { token: t.ada, key: uniq(), raw: '[1]' }), 400, 'malformed_request');
  const ok = await payReq(t.ada, rq.request_id, { amount: 1, to_handle: 'cy' });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.amount, 100);
  assert.equal(ok.json.to_handle, 'bob');
});

test('§8 the request list reflects the request after payment of a seeded-style amount with exact arithmetic', async () => {
  const { t } = await setup(fixture({ users: [user('u_a', 'a', 3000000000), user('u_b', 'b', 0)] }), ['a', 'b']);
  const before = await totalBalance(t);
  for (let i = 0; i < 3; i++) {
    const rq = (await mkReq(t.b, { payer_handle: 'a', amount: 1000000000 })).json;
    assert.equal((await payReq(t.a, rq.request_id)).status, 201);
  }
  assert.equal(await balance(t.a), 0);
  assert.equal(await balance(t.b), 3000000000);
  assert.equal(await totalBalance(t), before);
  const rq = (await mkReq(t.b, { payer_handle: 'a', amount: 1 })).json;
  expectErr(await payReq(t.a, rq.request_id), 409, 'insufficient_funds');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  http, fixture, user, setup, balance, expectErr, pay, mkReq, payReq, settle, get, uniq, RFC3339, sleep, HOUR, DAY, PW,
  mkAuth, capture, me, at, ms, ns, meAt, stmt, stmtQ, correct, revisions, refund, batch, bItem, plus2, fixtureS, sIds, sumView, expectMe, assertPaymentShape, seedPay,
} from './lib.mjs';

const TOTAL = 10000 + 2500 + 500 + 100000;
const ALL = ['ada', 'bob', 'cy', 'dee', 'op'];
const mkP = async (t, from = 'ada', to = 'bob', amount = 100, note = '') => (await pay(t[from], { to_handle: to, amount, note })).json;
const rv = async (t, id) => (await revisions(t.ada, id)).json.revisions;
/** a settlement ada->bob 100, bob->cy 40, cy->dee 10 ; returns {S, m:[...], C} */
async function mkSettlement(t, transfers) {
  const body = { transfers: transfers || [{ from_handle: 'ada', to_handle: 'bob', amount: 100, note: 'm1' }, { from_handle: 'bob', to_handle: 'cy', amount: 40, note: 'm2' }, { from_handle: 'cy', to_handle: 'dee', amount: 10, note: 'm3' }] };
  const key = uniq('st');
  const r = await http('POST', '/settlements', { token: t.op, key, body });
  assert.equal(r.status, 201, r.text);
  return { S: r.json, m: r.json.payments, C: r.json.committed_at, key, body };
}
/** full observable state touched by a rejected batch */
async function world(t, ids) {
  return JSON.stringify({
    me: await Promise.all(['ada', 'bob', 'cy', 'dee', 'op'].map((h) => me(t[h]))),
    rev: await Promise.all(ids.map(async (id) => (await http('GET', `/payments/${id}/revisions`, { token: t.ada })).text)),
    st: await Promise.all(['ada', 'bob', 'cy', 'dee'].map(async (h) => { const s = await stmt(t[h], { limit: 200 }); return [s.opening_balance, s.entries, s.closing_balance]; })),
    act: (await get(t.ada, '/activity?limit=200')).json,
  });
}

test('Batch auth: no/bad token 401, non-operator 403 (even the payment\'s own sender), operator 201; key rules', async () => {
  const { t } = await setup();
  const P = await mkP(t); await sleep(1100);
  const body = { corrections: [bItem(P.payment_id, { effective_at: P.created_at, amount: 40 })] };
  expectErr(await http('POST', '/correction-batches', { key: uniq(), body }), 401, 'unauthenticated');
  expectErr(await http('POST', '/correction-batches', { token: 'bogus', key: uniq(), body }), 401, 'unauthenticated');
  for (const h of ['ada', 'bob', 'cy', 'dee']) expectErr(await batch(t[h], body), 403, 'forbidden');
  expectErr(await http('POST', '/correction-batches', { token: t.op, body }), 400, 'missing_idempotency_key');
  expectErr(await http('POST', '/correction-batches', { token: t.op, body, key: '' }), 400, 'missing_idempotency_key');
  expectErr(await http('POST', '/correction-batches', { token: t.op, body, key: 'k'.repeat(256) }), 422, 'validation_failed');
  assert.equal((await rv(t, P.payment_id)).length, 1);
  assert.equal((await http('POST', '/correction-batches', { token: t.op, body, key: 'k'.repeat(255) })).status, 201);
  expectMe(await me(t.ada), { total: 9960, available: 9960, held: 0 });
});

test('Batch shape: corrections required, 1..32 items, distinct payment_ids, object items; 32 items accepted', async () => {
  const { t } = await setup();
  const ps = []; for (let i = 0; i < 33; i++) ps.push(await mkP(t, 'ada', 'bob', 1));
  await sleep(1100);
  const items = (n) => ps.slice(0, n).map((p) => bItem(p.payment_id, { effective_at: p.created_at }));
  for (const body of [{}, { corrections: null }, { corrections: 'x' }, { corrections: {} }, { corrections: 5 }]) {
    const r = await batch(t.op, body);
    assert.ok(r.status === 422 || (r.status === 400 && r.json.error.code === 'malformed_request'), `${JSON.stringify(body)} -> ${r.status}`);
  }
  expectErr(await batch(t.op, {}), 422, 'validation_failed');
  expectErr(await batch(t.op, { corrections: [] }), 422, 'validation_failed');
  expectErr(await batch(t.op, { corrections: items(33) }), 422, 'validation_failed');
  expectErr(await batch(t.op, { corrections: [items(1)[0], items(1)[0]] }), 422, 'validation_failed');
  expectErr(await batch(t.op, { corrections: [items(2)[0], items(2)[1], items(1)[0]] }), 422, 'validation_failed');
  for (const junk of [null, 'x', 5, [], true]) { const r = await batch(t.op, { corrections: [junk] }); assert.ok(r.status === 422 || r.status === 400, `${JSON.stringify(junk)} -> ${r.status}`); assert.ok(r.json.error); }
  expectErr(await http('POST', '/correction-batches', { token: t.op, key: uniq(), raw: '{"corrections":[' }), 400, 'malformed_request');
  expectErr(await http('POST', '/correction-batches', { token: t.op, key: uniq(), raw: '[]' }), 400, 'malformed_request');
  assert.equal(await balance(t.ada), 10000 - 33, 'nothing applied by rejected shapes');
  const ok = await batch(t.op, { corrections: items(32) });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.json.revisions.length, 32);
  assert.deepEqual(ok.json.revisions.map((r) => r.payment_id), ps.slice(0, 32).map((p) => p.payment_id));
  assert.equal(await balance(t.ada), 10000 - 1, 'only the 33rd payment remains in effect');
  assert.equal(await sumView(ALL.map((h) => t[h]), {}), TOTAL);
});

test('Batch item validation: required fields and ordinary correction rules -> 422 validation_failed; nothing applied', async () => {
  const { t } = await setup();
  const P = await mkP(t, 'ada', 'bob', 100); await sleep(1100);
  const good = () => bItem(P.payment_id, { effective_at: P.created_at, amount: 50 });
  for (const f of ['payment_id', 'expected_revision', 'amount', 'effective_at', 'reason']) { const it = good(); delete it[f]; expectErr(await batch(t.op, { corrections: [it] }), 422, 'validation_failed'); }
  const bad = { expected_revision: [0, -1, 1.5], amount: [-1, 1000000001, 1.5, '5', true, null], reason: ['', 'r'.repeat(201)], effective_at: ['2026-09-24T13:20:00', '2026-09-24', '', 'garbage', at(Date.now() + HOUR), at(Date.now() + 5 * DAY)] };
  for (const [k, vals] of Object.entries(bad)) for (const v of vals) expectErr(await batch(t.op, { corrections: [{ ...good(), [k]: v }] }), 422, 'validation_failed');
  for (const [k, v] of [['expected_revision', '1'], ['expected_revision', true], ['reason', 5], ['reason', null], ['effective_at', 5], ['payment_id', 7], ['payment_id', null]]) {
    const r = await batch(t.op, { corrections: [{ ...good(), [k]: v }] });
    assert.ok(r.status === 400 || r.status === 422, `${k}=${JSON.stringify(v)} -> ${r.status}`);
  }
  assert.equal((await rv(t, P.payment_id)).length, 1); assert.equal(await balance(t.ada), 9900);
  const ok = await http('POST', '/correction-batches', { token: t.op, key: uniq(), raw: `{"corrections":[{"payment_id":"${P.payment_id}","expected_revision":1,"amount":5e1,"effective_at":"${P.created_at}","reason":"${'r'.repeat(200)}","junk":[1]}],"also":"ignored"}` });
  assert.equal(ok.status, 201, ok.text); assert.equal(ok.json.revisions[0].amount, 50);
});

test('Batch: unknown payment 404; stale expected revision 409; item errors are taken in INPUT ORDER', async () => {
  const { t } = await setup();
  const P1 = await mkP(t, 'ada', 'bob', 100), P2 = await mkP(t, 'ada', 'cy', 100); await sleep(1100);
  const it1 = bItem(P1.payment_id, { effective_at: P1.created_at, amount: 50 }), it2 = bItem(P2.payment_id, { effective_at: P2.created_at, amount: 50 });
  expectErr(await batch(t.op, { corrections: [it1, bItem('p_nope', { effective_at: P1.created_at })] }), 404, 'not_found');
  expectErr(await batch(t.op, { corrections: [bItem('p_nope', { effective_at: P1.created_at }), it1] }), 404, 'not_found');
  expectErr(await batch(t.op, { corrections: [{ ...it1, expected_revision: 2 }, it2] }), 409, 'stale_revision');
  expectErr(await batch(t.op, { corrections: [it1, { ...it2, expected_revision: 9 }] }), 409, 'stale_revision');
  // first erroneous item decides
  expectErr(await batch(t.op, { corrections: [{ ...it1, expected_revision: 2 }, { ...it2, amount: -1 }] }), 409, 'stale_revision');
  expectErr(await batch(t.op, { corrections: [{ ...it1, amount: -1 }, bItem('p_nope')] }), 422, 'validation_failed');
  expectErr(await batch(t.op, { corrections: [bItem('p_nope', { effective_at: P1.created_at }), { ...it2, expected_revision: 2 }] }), 404, 'not_found');
  expectErr(await batch(t.op, { corrections: [{ ...it1, expected_revision: 3 }, bItem('p_nope')] }), 409, 'stale_revision');
  assert.equal((await rv(t, P1.payment_id)).length, 1); assert.equal(await balance(t.ada), 9800);
  // after a real correction the old revision number is stale
  assert.equal((await correct(t.ada, P1.payment_id, { expected_revision: 1, amount: 90, effective_at: P1.created_at, reason: 'x' })).status, 201);
  expectErr(await batch(t.op, { corrections: [it1] }), 409, 'stale_revision');
  assert.equal((await batch(t.op, { corrections: [{ ...it1, expected_revision: 2 }] })).status, 201);
});

test('Batch: captures and refund payments stay immutable (422 linked_payment_immutable); refunded payments cannot drop below the refunded amount', async () => {
  const { t } = await setup();
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 500 })).json;
  const cap = (await capture(t.bob, a.authorization_id, { amount: 200 })).json;
  const P = await mkP(t, 'ada', 'bob', 1000);
  const R = (await refund(t.bob, P.payment_id, { amount: 300 })).json;
  const O = await mkP(t, 'ada', 'cy', 100);
  await sleep(1100);
  const e = (p) => bItem(p.payment_id, { effective_at: p.created_at, amount: 1 });
  expectErr(await batch(t.op, { corrections: [e(cap)] }), 422, 'linked_payment_immutable');
  expectErr(await batch(t.op, { corrections: [e(R)] }), 422, 'linked_payment_immutable');
  expectErr(await batch(t.op, { corrections: [e(O), e(cap)] }), 422, 'linked_payment_immutable');
  expectErr(await batch(t.op, { corrections: [e(cap), bItem('p_nope')] }), 422, 'linked_payment_immutable');
  expectErr(await batch(t.op, { corrections: [bItem('p_nope'), e(cap)] }), 404, 'not_found');
  expectErr(await batch(t.op, { corrections: [{ ...e(P), amount: 299 }] }), 422, 'refund_exceeds_payment');
  expectErr(await batch(t.op, { corrections: [{ ...e(P), amount: 0 }, e(O)] }), 422, 'refund_exceeds_payment');
  assert.equal((await rv(t, O.payment_id)).length, 1);
  const ok = await batch(t.op, { corrections: [{ ...e(P), amount: 300 }, { ...e(O), amount: 40 }] });
  assert.equal(ok.status, 201, ok.text);
  expectMe(await me(t.cy), { total: 40, available: 40, held: 0 });
});

// ---------------- settlements ----------------

test('Batch settlement completeness: partial -> 422 incomplete_settlement; the whole set (alone or with other payments) is accepted; membership and receipts unchanged', async () => {
  const { t } = await setup();
  const { S, m, C, key, body } = await mkSettlement(t);
  const O = await mkP(t, 'ada', 'dee', 20); await sleep(1100);
  const items = m.map((p) => bItem(p.payment_id, { effective_at: C, amount: 0 }));
  expectErr(await batch(t.op, { corrections: [items[0]] }), 422, 'incomplete_settlement');
  expectErr(await batch(t.op, { corrections: [items[0], items[1]] }), 422, 'incomplete_settlement');
  expectErr(await batch(t.op, { corrections: [items[2], items[0]] }), 422, 'incomplete_settlement');
  expectErr(await batch(t.op, { corrections: [items[0], bItem(O.payment_id, { effective_at: O.created_at, amount: 5 })] }), 422, 'incomplete_settlement');
  expectMe(await me(t.ada), { total: 10000 - 100 - 20, available: 10000 - 100 - 20, held: 0 });
  const ok = await batch(t.op, { corrections: [...items, bItem(O.payment_id, { effective_at: O.created_at, amount: 5 })] });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.json.revisions.length, 4);
  // all three members reversed to zero, ordinary payment decreased to 5
  expectMe(await me(t.ada), { total: 10000 - 5, available: 10000 - 5, held: 0 });
  expectMe(await me(t.bob), { total: 2500, available: 2500, held: 0 });
  expectMe(await me(t.cy), { total: 0, available: 0, held: 0 });
  // original settlement retry and receipts unchanged; membership unchanged
  const rep = await http('POST', '/settlements', { token: t.op, key, body });
  assert.equal(rep.status, 200); assert.deepEqual(rep.json, S);
  const feed = (await get(t.ada, '/activity?limit=200')).json.payments;
  assert.equal(feed.find((p) => p.payment_id === m[0].payment_id).amount, 100, 'activity shows the original');
  assert.equal(feed.find((p) => p.payment_id === m[0].payment_id).settlement_id, S.settlement_id);
  const st = await stmt(t.ada);
  const e0 = st.entries.find((e) => e.payment.payment_id === m[0].payment_id);
  assert.equal(e0.payment.amount, 0); assert.equal(e0.revision, 2); assert.equal(e0.payment.settlement_id, S.settlement_id);
  assert.equal(await sumView(ALL.map((h) => t[h]), {}), TOTAL);
  assert.equal(await sumView(ALL.map((h) => t[h]), { as_of: C }), TOTAL);
});

test('Batch settlement members need IDENTICAL effective instants (offset spellings may differ) -> else 422 validation_failed', async () => {
  const { t } = await setup();
  const { m, C } = await mkSettlement(t);
  await sleep(1100);
  const it = (i, eff, amount = 50) => bItem(m[i].payment_id, { effective_at: eff, amount });
  const earlier = at(ms(C) - 30 * 60e3);
  expectErr(await batch(t.op, { corrections: [it(0, C), it(1, earlier), it(2, C)] }), 422, 'validation_failed');
  expectErr(await batch(t.op, { corrections: [it(0, C), it(1, C), it(2, at(ms(C) + 1000))] }), 422, 'validation_failed');
  assert.equal((await rv(t, m[0].payment_id)).length, 1);
  // same instant, different spellings: +02:00, Z with milliseconds
  const ok = await batch(t.op, { corrections: [it(0, C), it(1, plus2(C)), it(2, new Date(ms(C)).toISOString())] });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.json.revisions.length, 3);
  for (const r of ok.json.revisions) assert.equal(ms(r.effective_at), ms(C));
  // revisions of the members share the instant; a later whole-set batch may move them together (earlier than committed_at is allowed)
  const move = await batch(t.op, { corrections: m.map((p) => bItem(p.payment_id, { effective_at: earlier, amount: 30, expected_revision: 2 })) });
  assert.equal(move.status, 201, move.text);
  const sa = await stmt(t.ada, { to: at(ms(C)) });
  assert.ok(sa.entries.some((e) => e.payment.payment_id === m[0].payment_id), 'moved before committed_at');
  assert.equal(await sumView(ALL.map((h) => t[h]), {}), TOTAL);
});

test('Batch with two settlements: each needs its own complete set, each may use its own instant', async () => {
  const { t } = await setup();
  const A = await mkSettlement(t, [{ from_handle: 'ada', to_handle: 'bob', amount: 30 }, { from_handle: 'bob', to_handle: 'cy', amount: 10 }]);
  await sleep(1100);
  const B = await mkSettlement(t, [{ from_handle: 'ada', to_handle: 'dee', amount: 20 }, { from_handle: 'dee', to_handle: 'bob', amount: 5 }]);
  await sleep(1100);
  const items = (S, amt) => S.m.map((p) => bItem(p.payment_id, { effective_at: S.C, amount: amt }));
  expectErr(await batch(t.op, { corrections: [...items(A, 1), items(B, 1)[0]] }), 422, 'incomplete_settlement');
  const ok = await batch(t.op, { corrections: [...items(A, 5), ...items(B, 2)] });
  assert.equal(ok.status, 201, ok.text);
  assert.deepEqual(ok.json.revisions.map((r) => r.amount), [5, 5, 2, 2]);
});

test('Batch correctness for non-members: ordinary, request-paid and (with complete sets) settlement payments; single corrections remain for non-members', async () => {
  const { t } = await setup();
  const direct = await mkP(t, 'ada', 'bob', 300, 'direct');
  const rq2 = (await mkReq(t.cy, { payer_handle: 'ada', amount: 200 })).json;
  const viaReq = (await payReq(t.ada, rq2.request_id)).json;
  await sleep(1100);
  const r = await batch(t.op, { corrections: [bItem(direct.payment_id, { effective_at: direct.created_at, amount: 100 }), bItem(viaReq.payment_id, { effective_at: viaReq.created_at, amount: 50 })] });
  assert.equal(r.status, 201, r.text);
  expectMe(await me(t.ada), { total: 10000 - 100 - 50, available: 10000 - 150, held: 0 });
  const e = (await stmt(t.cy)).entries[0];
  assert.equal(e.payment.request_id, rq2.request_id); assert.equal(e.payment.amount, 50);
  assert.equal((await get(t.ada, '/requests?status=paid')).json.requests.length, 1, 'requests are not touched');
  // single correction still works for non-members after a batch
  const single = await correct(t.ada, direct.payment_id, { expected_revision: 2, amount: 60, effective_at: direct.created_at, reason: 'single' });
  assert.equal(single.status, 201, single.text);
});

// ---------------- precedence & affordability ----------------

test('Batch precedence: item errors > settlement completeness > current insufficient_funds > historical_overdraft', async () => {
  const { t } = await setup();
  const { m, C } = await mkSettlement(t);
  const O = await mkP(t, 'dee', 'bob', 100, 'o'); // dee 500 -> 400
  await sleep(1100);
  const inc = bItem(m[0].payment_id, { effective_at: C, amount: 0 }); // incomplete on purpose
  const unaffordable = bItem(O.payment_id, { effective_at: O.created_at, amount: 5000 }); // debit dee 4900 > 400
  expectErr(await batch(t.op, { corrections: [inc, bItem('p_nope')] }), 404, 'not_found');
  expectErr(await batch(t.op, { corrections: [inc, { ...bItem(O.payment_id, { effective_at: O.created_at }), expected_revision: 4 }] }), 409, 'stale_revision');
  expectErr(await batch(t.op, { corrections: [inc, { ...unaffordable, amount: -1 }] }), 422, 'validation_failed');
  expectErr(await batch(t.op, { corrections: [inc, unaffordable] }), 422, 'incomplete_settlement');
  expectErr(await batch(t.op, { corrections: [unaffordable] }), 409, 'insufficient_funds');
  expectErr(await batch(t.op, { corrections: [unaffordable, inc] }), 422, 'incomplete_settlement');
});

test('Batch precedence: current insufficient_funds beats historical_overdraft; a purely historical failure is historical_overdraft', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { p3, p4 } = await sIds(t);
  const late = bItem(p3, { amount: 300, effective_at: at(now - DAY) }); // moves cy's inflow after cy's outflow (history only)
  const unaffordable = bItem(p4, { amount: 5000, effective_at: at(now - 2 * DAY) }); // cy current 200
  expectErr(await batch(t.op, { corrections: [late] }), 409, 'historical_overdraft');
  expectErr(await batch(t.op, { corrections: [late, unaffordable] }), 409, 'insufficient_funds');
  expectErr(await batch(t.op, { corrections: [unaffordable, late] }), 409, 'insufficient_funds');
  expectMe(await me(t.cy), { total: 200, available: 200, held: 0 });
  assert.equal((await revisions(t.ada, p3)).json.revisions.length, 1);
});

test('Batch affordability uses the COMBINED effect: one correction funds another (and each alone would fail)', async () => {
  const { t } = await setup();
  const Pup = await mkP(t, 'dee', 'bob', 100, 'up');   // dee 400
  const Pdn = await mkP(t, 'dee', 'cy', 300, 'down');  // dee 100, cy 300
  await sleep(1100);
  const up = bItem(Pup.payment_id, { effective_at: Pup.created_at, amount: 400 });   // debit dee 300 > available 100
  const dn = bItem(Pdn.payment_id, { effective_at: Pdn.created_at, amount: 0 });     // credits dee 300 (cy pays back)
  expectErr(await batch(t.op, { corrections: [up] }), 409, 'insufficient_funds');
  const key = uniq('combined');
  const ok = await batch(t.op, { corrections: [up, dn] }, key);
  assert.equal(ok.status, 201, ok.text);
  expectMe(await me(t.dee), { total: 100, available: 100, held: 0 });
  expectMe(await me(t.bob), { total: 2900, available: 2900, held: 0 });
  expectMe(await me(t.cy), { total: 0, available: 0, held: 0 });
  assert.equal(await sumView(ALL.map((h) => t[h]), {}), TOTAL);
});

test('Batch combined effect respects HOLDS: debits are checked against available funds', async () => {
  const { t } = await setup();
  const P = await mkP(t, 'ada', 'bob', 1000);
  assert.equal((await mkAuth(t.ada, { to_handle: 'cy', amount: 8800 })).status, 201); // ada available 200
  await sleep(1100);
  expectErr(await batch(t.op, { corrections: [bItem(P.payment_id, { effective_at: P.created_at, amount: 1500 })] }), 409, 'insufficient_funds');
  const ok = await batch(t.op, { corrections: [bItem(P.payment_id, { effective_at: P.created_at, amount: 1200 })] });
  assert.equal(ok.status, 201, ok.text);
  expectMe(await me(t.ada), { total: 8800, available: 0, held: 8800 });
});

test('Batch historical_overdraft at effective-time boundaries (moving a payment later than the spending it funded)', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { p3 } = await sIds(t);
  const key = uniq('h');
  expectErr(await batch(t.op, { corrections: [bItem(p3, { amount: 300, effective_at: at(now - DAY) })] }, key), 409, 'historical_overdraft');
  // key unclaimed: reusable with a valid body
  const ok = await batch(t.op, { corrections: [bItem(p3, { amount: 250, effective_at: at(now - 3 * DAY) })] }, key);
  assert.equal(ok.status, 201, ok.text);
});

test('Rejected batches change NOTHING (history, balances, statements, feed) and leave idempotency keys reusable', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { p1, p3, p4 } = await sIds(t);
  const st = await mkSettlement(t); // adds settlement history too
  await sleep(1100);
  const ids = [p1, p3, p4, ...st.m.map((p) => p.payment_id)];
  const before = await world(t, ids);
  const key = uniq('rej');
  const failures = [
    [{ corrections: [bItem(p1, { amount: 1, effective_at: at(now - 5 * DAY) }), bItem('p_nope')] }, 404],
    [{ corrections: [bItem(p1, { amount: 1, effective_at: at(now - 5 * DAY), expected_revision: 3 })] }, 409],
    [{ corrections: [bItem(st.m[0].payment_id, { amount: 0, effective_at: st.C })] }, 422],
    [{ corrections: [bItem(p3, { amount: 300, effective_at: at(now - DAY) })] }, 409],
    [{ corrections: [bItem(p4, { amount: 99999, effective_at: at(now - 2 * DAY) })] }, 409],
    [{ corrections: [bItem(p1, { amount: 1, effective_at: at(now - 5 * DAY) }), bItem(p1, { amount: 2, effective_at: at(now - 5 * DAY) })] }, 422],
  ];
  for (const [body, status] of failures) {
    const r = await batch(t.op, body, key);
    assert.equal(r.status, status, r.text);
    assert.equal(await world(t, ids), before, `state changed by rejected batch ${JSON.stringify(r.json.error)}`);
  }
  const ok = await batch(t.op, { corrections: [bItem(p1, { amount: 450, effective_at: at(now - 5 * DAY) })] }, key);
  assert.equal(ok.status, 201, ok.text);
  assert.notEqual(await world(t, ids), before);
});

// ---------------- 201 shape, idempotency ----------------

test('Batch 201: correction_batch_id, shared recorded_at strictly later than every member\'s previous recorded_at, revisions in input order each carrying the batch id', async () => {
  const { t } = await setup();
  const P1 = await mkP(t, 'ada', 'bob', 100, 'a'), P2 = await mkP(t, 'bob', 'cy', 100, 'b'), P3 = await mkP(t, 'cy', 'dee', 0 + 1, 'c');
  await sleep(1100);
  const c1 = (await correct(t.ada, P1.payment_id, { expected_revision: 1, amount: 90, effective_at: P1.created_at, reason: 'single' })).json;
  const c2 = (await correct(t.bob, P2.payment_id, { expected_revision: 1, amount: 80, effective_at: P2.created_at, reason: 'single' })).json;
  const r = await batch(t.op, { corrections: [
    bItem(P2.payment_id, { expected_revision: 2, amount: 70, effective_at: P2.created_at, reason: 'second' }),
    bItem(P3.payment_id, { expected_revision: 1, amount: 0, effective_at: P3.created_at, reason: 'third' }),
    bItem(P1.payment_id, { expected_revision: 2, amount: 60, effective_at: P1.created_at, reason: 'first' }),
  ] });
  assert.equal(r.status, 201, r.text);
  const B = r.json;
  assert.equal(typeof B.correction_batch_id, 'string'); assert.ok(B.correction_batch_id.length > 0 && B.correction_batch_id.length <= 64);
  assert.match(B.recorded_at, RFC3339);
  assert.deepEqual(B.revisions.map((x) => x.payment_id), [P2.payment_id, P3.payment_id, P1.payment_id], 'input order');
  assert.deepEqual(B.revisions.map((x) => x.revision), [3, 2, 3]);
  assert.deepEqual(B.revisions.map((x) => x.amount), [70, 0, 60]);
  assert.deepEqual(B.revisions.map((x) => x.reason), ['second', 'third', 'first']);
  for (const x of B.revisions) { assert.equal(x.recorded_at, B.recorded_at); assert.equal(x.correction_batch_id, B.correction_batch_id); assert.match(x.effective_at, RFC3339); }
  assert.ok(ns(B.recorded_at) > ns(c1.recorded_at) && ns(B.recorded_at) > ns(c2.recorded_at), 'strictly later than previous recorded_at of every member');
  assert.ok(ns(B.recorded_at) > ns(P3.created_at));
  // the revisions endpoint exposes the batch id and the shared recorded_at
  for (const [tok, P, rev] of [[t.ada, P1, 3], [t.bob, P2, 3], [t.cy, P3, 2]]) {
    const list = (await revisions(tok, P.payment_id)).json.revisions;
    const last = list[list.length - 1];
    assert.equal(last.revision, rev); assert.equal(last.correction_batch_id, B.correction_batch_id); assert.equal(last.recorded_at, B.recorded_at);
    assert.ok(list.slice(0, -1).every((x) => x.correction_batch_id === undefined || x.correction_batch_id === null), 'earlier revisions have no batch id');
  }
  // the operator is not a party: still 404 on revisions
  expectErr(await revisions(t.op, P1.payment_id), 404, 'not_found');
  // a second batch gets a different id and a later recorded_at
  const r2 = await batch(t.op, { corrections: [bItem(P1.payment_id, { expected_revision: 3, amount: 50, effective_at: P1.created_at })] });
  assert.equal(r2.status, 201);
  assert.notEqual(r2.json.correction_batch_id, B.correction_batch_id);
  assert.ok(ns(r2.json.recorded_at) > ns(B.recorded_at));
});

test('Batch immediately after a single correction: recorded_at is still strictly later (no clock-tick ties)', async () => {
  const { t } = await setup();
  const P = await mkP(t, 'ada', 'bob', 500); await sleep(1100);
  let rev = 1; let last = null;
  for (let i = 0; i < 5; i++) {
    const c = await correct(t.ada, P.payment_id, { expected_revision: rev, amount: 400 - i, effective_at: P.created_at, reason: 's' }); rev++;
    assert.equal(c.status, 201);
    const b = await batch(t.op, { corrections: [bItem(P.payment_id, { expected_revision: rev, amount: 300 - i, effective_at: P.created_at })] }); rev++;
    assert.equal(b.status, 201, b.text);
    assert.ok(ns(b.json.recorded_at) > ns(c.json.recorded_at));
    if (last) assert.ok(ns(c.json.recorded_at) > ns(last));
    last = b.json.recorded_at;
  }
});

test('Batch idempotency: replay 200 identical (even after newer revisions); different body 409; claimed key beats invalid body; unparseable stays 400; failed key reusable; per-operator scope', async () => {
  const { t } = await setup(fixture({ settlement_operator_ids: ['u_op', 'u_dee'] }));
  const P = await mkP(t, 'ada', 'bob', 500); await sleep(1100);
  const key = uniq('b');
  const body = { corrections: [bItem(P.payment_id, { amount: 400, effective_at: P.created_at, reason: 'one' })] };
  const first = await batch(t.op, body, key);
  assert.equal(first.status, 201, first.text);
  assert.equal((await correct(t.ada, P.payment_id, { expected_revision: 2, amount: 350, effective_at: P.created_at, reason: 'later' })).status, 201);
  for (let i = 0; i < 3; i++) { const rep = await batch(t.op, body, key); assert.equal(rep.status, 200); assert.deepEqual(rep.json, first.json); }
  const alt = await http('POST', '/correction-batches', { token: t.op, key, raw: ` {"corrections":[{"reason":"one","effective_at":"${P.created_at}","amount":4e2,"expected_revision":1,"payment_id":"${P.payment_id}"}]} ` });
  assert.equal(alt.status, 200); assert.deepEqual(alt.json, first.json);
  assert.equal(await balance(t.ada), 9650);
  expectErr(await batch(t.op, { corrections: [{ ...body.corrections[0], amount: 401 }] }, key), 409, 'idempotency_key_reuse');
  expectErr(await batch(t.op, { corrections: [{ ...body.corrections[0], extra: 1 }] }, key), 409, 'idempotency_key_reuse');
  for (const bad of [{}, { corrections: [] }, { corrections: [{ payment_id: 'p_nope' }] }, { corrections: [{ ...body.corrections[0], amount: -3 }] }]) expectErr(await batch(t.op, bad, key), 409, 'idempotency_key_reuse');
  expectErr(await http('POST', '/correction-batches', { token: t.op, key, raw: '{broken' }), 400, 'malformed_request');
  // a non-operator replaying the key is still 403
  expectErr(await batch(t.ada, body, key), 403, 'forbidden');
  // failed key reusable
  const k2 = uniq('f');
  const P2 = await mkP(t, 'ada', 'cy', 50); await sleep(1100);
  expectErr(await batch(t.op, { corrections: [bItem(P2.payment_id, { expected_revision: 4, effective_at: P2.created_at })] }, k2), 409, 'stale_revision');
  expectErr(await batch(t.op, { corrections: [bItem(P2.payment_id, { amount: -1 })] }, k2), 422, 'validation_failed');
  assert.equal((await batch(t.op, { corrections: [bItem(P2.payment_id, { amount: 20, effective_at: P2.created_at })] }, k2)).status, 201);
  // per-operator scope
  const P3 = await mkP(t, 'ada', 'cy', 10); await sleep(1100);
  const shared = 'same-key';
  assert.equal((await batch(t.op, { corrections: [bItem(P3.payment_id, { amount: 5, effective_at: P3.created_at })] }, shared)).status, 201);
  const P4 = await mkP(t, 'ada', 'cy', 10); await sleep(1100);
  assert.equal((await batch(t.dee, { corrections: [bItem(P4.payment_id, { amount: 5, effective_at: P4.created_at })] }, shared)).status, 201);
});

test('Batch: originals, receipts and retries never change; activity shows the original; statements show new revisions; earlier snapshot tokens stay frozen', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { p1, p3 } = await sIds(t);
  const pkey = uniq('p'), pbody = { to_handle: 'bob', amount: 777, note: 'api' };
  const API = await http('POST', '/payments', { token: t.ada, key: pkey, body: pbody });
  const st = await mkSettlement(t);
  await sleep(1100);
  const snap = await stmt(t.ada, { limit: 2 });
  const frozen = await stmt(t.ada, { snapshot: snap.snapshot, limit: 200 });
  const feedBefore = (await get(t.cy, '/activity?limit=200')).json;
  const r = await batch(t.op, { corrections: [
    bItem(p1, { amount: 400, effective_at: at(now - 5 * DAY) }), bItem(API.json.payment_id, { amount: 700, effective_at: API.json.created_at }),
    ...st.m.map((p) => bItem(p.payment_id, { amount: 0, effective_at: st.C })),
  ] });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual((await get(t.cy, '/activity?limit=200')).json.payments.map((p) => [p.payment_id, p.amount]), feedBefore.payments.map((p) => [p.payment_id, p.amount]), 'feed shows originals');
  const rep = await http('POST', '/payments', { token: t.ada, key: pkey, body: pbody });
  assert.equal(rep.status, 200); assert.deepEqual(rep.json, API.json);
  const srep = await http('POST', '/settlements', { token: t.op, key: st.key, body: st.body });
  assert.equal(srep.status, 200); assert.deepEqual(srep.json, st.S);
  const fresh = await stmt(t.ada, { limit: 200 });
  assert.equal(fresh.entries.find((e) => e.payment.payment_id === p1).payment.amount, 400);
  assert.equal(fresh.entries.find((e) => e.payment.payment_id === API.json.payment_id).revision, 2);
  const old = await stmt(t.ada, { snapshot: snap.snapshot, limit: 200 });
  assert.deepEqual(old.entries, frozen.entries); assert.equal(old.closing_balance, frozen.closing_balance);
  assert.equal(old.entries.find((e) => e.payment.payment_id === p1).payment.amount, 500);
  assert.equal(await sumView(['ada', 'bob', 'cy', 'dee', 'op', 'zed'].map((h) => t[h]), { as_of: at(now - 4.5 * DAY) }), 10000 + 2500 + 200 + 500 + 100000);
  void p3;
});

test('Batch effective_at: not later than now (item error 422); exactly "now" accepted; sum invariant in every historical view after batches', async () => {
  const { t } = await setup();
  const P = await mkP(t, 'ada', 'bob', 100); await sleep(1100);
  expectErr(await batch(t.op, { corrections: [bItem(P.payment_id, { effective_at: at(Date.now() + 60e3) })] }), 422, 'validation_failed');
  const ok = await batch(t.op, { corrections: [bItem(P.payment_id, { amount: 30, effective_at: at(Date.now() - 200) })] });
  assert.equal(ok.status, 201, ok.text);
  const tokens = ALL.map((h) => t[h]);
  for (const off of [-400 * DAY, -1000, 0, DAY]) assert.equal(await sumView(tokens, { as_of: at(Date.now() + off) }), TOTAL);
  assert.equal(await sumView(tokens, { known_at: at(ms(P.created_at) - 5000) }), TOTAL);
});

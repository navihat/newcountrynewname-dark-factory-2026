import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  http, fixture, user, reset, setup, login, balance, expectErr, pay, mkReq, payReq, settle, get, uniq, RFC3339, sleep, HOUR, DAY,
  mkAuth, capture, voidAuth, me, at, ms, ns, meAt, stmt, stmtAll, correct, corrBody, revisions, fixtureS, ledgerS, seedPay, Ledger, S_OPEN, S_TOTAL, sumView, assertPaymentShape,
} from './lib.mjs';

const ALL = ['ada', 'bob', 'cy', 'dee', 'op', 'zed'];
/** note -> payment_id for the S fixture (looked up by content, ids are not assumed) */
async function ids(t) {
  const feed = (await get(t.ada, '/activity?limit=200')).json.payments;
  const f = (note) => feed.find((p) => p.note === note).payment_id;
  return { p1: f('one'), p2: f('two'), p3: f('three'), p4: f('four') };
}
const snapshotAll = async (t, pid) => JSON.stringify({
  me: await Promise.all(ALL.map(async (h) => me(t[h]))),
  rev: (await revisions(t.ada, pid)).json,
  st: await Promise.all(['ada', 'bob', 'cy', 'dee'].map(async (h) => { const s = await stmt(t[h]); return [s.opening_balance, s.entries, s.closing_balance]; })),
});

// ---------------- request validation / permissions ----------------

test('Corrections: 401 without/with bad token; 403 for any authenticated non-sender (receiver, third party, operator); 404 unknown payment', async () => {
  const { t } = await setup(fixtureS());
  const { p1 } = await ids(t);
  expectErr(await http('POST', `/payments/${p1}/corrections`, { key: uniq(), body: corrBody() }), 401, 'unauthenticated');
  expectErr(await http('POST', `/payments/${p1}/corrections`, { token: 'bogus', key: uniq(), body: corrBody() }), 401, 'unauthenticated');
  for (const h of ['bob', 'cy', 'op', 'dee']) expectErr(await correct(t[h], p1, corrBody()), 403, 'forbidden');
  expectErr(await correct(t.ada, 'p_does_not_exist', corrBody()), 404, 'not_found');
  expectErr(await correct(t.bob, 'p_does_not_exist', corrBody()), 404, 'not_found');
  assert.equal((await revisions(t.ada, p1)).json.revisions.length, 1);
});

test('Corrections: Idempotency-Key required (missing/empty 400, 256 chars 422, 255 ok)', async () => {
  const { t } = await setup(fixtureS());
  const { p1 } = await ids(t);
  expectErr(await http('POST', `/payments/${p1}/corrections`, { token: t.ada, body: corrBody() }), 400, 'missing_idempotency_key');
  expectErr(await http('POST', `/payments/${p1}/corrections`, { token: t.ada, body: corrBody(), key: '' }), 400, 'missing_idempotency_key');
  expectErr(await http('POST', `/payments/${p1}/corrections`, { token: t.ada, body: corrBody(), key: 'k'.repeat(256) }), 422, 'validation_failed');
  assert.equal((await http('POST', `/payments/${p1}/corrections`, { token: t.ada, body: corrBody({ amount: 450, effective_at: at(Date.now() - 5 * DAY) }), key: 'k'.repeat(255) })).status, 201);
});

test('Corrections: all fields required — each missing field -> 422 validation_failed', async () => {
  const { t } = await setup(fixtureS());
  const { p1 } = await ids(t);
  for (const f of ['expected_revision', 'amount', 'effective_at', 'reason']) {
    const b = corrBody(); delete b[f];
    expectErr(await correct(t.ada, p1, b), 422, 'validation_failed');
  }
  expectErr(await correct(t.ada, p1, {}), 422, 'validation_failed');
  assert.equal((await revisions(t.ada, p1)).json.revisions.length, 1);
});

test('Corrections: value rules — revision positive integer; amount 0..1e9 integer; reason 1..200 chars; effective_at RFC 3339 not later than now', async () => {
  const { t } = await setup(fixtureS());
  const { p1 } = await ids(t);
  const bad = (over) => correct(t.ada, p1, corrBody({ effective_at: at(Date.now() - 5 * DAY), ...over }));
  for (const v of [0, -1, 1.5, 0.5]) expectErr(await bad({ expected_revision: v }), 422, 'validation_failed');
  for (const v of [-1, 1000000001, 2000000000, 1.5, 0.1]) expectErr(await bad({ amount: v }), 422, 'validation_failed');
  for (const v of ['5', true, false, null]) expectErr(await bad({ amount: v }), 422, 'validation_failed');
  for (const v of [[5], {}]) { const r = await bad({ amount: v }); assert.ok(r.status === 422 || r.status === 400, `amount=${JSON.stringify(v)} -> ${r.status}`); }
  expectErr(await bad({ reason: '' }), 422, 'validation_failed');
  expectErr(await bad({ reason: 'r'.repeat(201) }), 422, 'validation_failed');
  for (const f of ['2026-09-24T13:20:00', '2026-09-24', '', 'garbage', '2026-13-01T00:00:00+00:00', at(Date.now() + HOUR), at(Date.now() + 10 * DAY)]) expectErr(await bad({ effective_at: f }), 422, 'validation_failed');
  // wrong JSON types: spec says invalid input is 422; §5 allows 400 for wrong types — either is a client error, never 2xx/5xx
  for (const [k, v] of [['expected_revision', '1'], ['expected_revision', true], ['expected_revision', null], ['reason', 5], ['reason', null], ['reason', ['x']], ['effective_at', 5], ['effective_at', null]]) {
    const r = await bad({ [k]: v });
    assert.ok(r.status === 422 || r.status === 400, `${k}=${JSON.stringify(v)} -> ${r.status} ${r.text}`);
    assert.ok(r.json && r.json.error);
  }
  expectErr(await http('POST', `/payments/${p1}/corrections`, { token: t.ada, key: uniq(), raw: '{"expected_revision":' }), 400, 'malformed_request');
  expectErr(await http('POST', `/payments/${p1}/corrections`, { token: t.ada, key: uniq(), raw: '[]' }), 400, 'malformed_request');
  assert.equal((await revisions(t.ada, p1)).json.revisions.length, 1, 'nothing recorded by invalid input');
  assert.equal(await balance(t.ada), 10000);
  // accepted edge values
  assert.equal((await bad({ reason: 'r'.repeat(200), amount: 450 })).status, 201);
  assert.equal((await http('POST', `/payments/${p1}/corrections`, { token: t.ada, key: uniq(), raw: `{"expected_revision":2,"amount":4.4e2,"effective_at":"${at(Date.now() - 5 * DAY)}","reason":"exp"}` })).status, 201);
  assert.equal((await http('POST', `/payments/${p1}/corrections`, { token: t.ada, key: uniq(), raw: `{"expected_revision":3,"amount":430.0,"effective_at":"${at(Date.now() - 5 * DAY)}","reason":"dec","extra":{"a":1}}` })).status, 201);
  assert.equal((await bad({ expected_revision: 4, amount: 430, effective_at: at(Date.now() - 1000) })).status, 201, 'effective_at = (almost) now is allowed');
});

// ---------------- effects ----------------

test('Corrections: 201 shape; decrease debits the RECEIVER and credits the sender; balances/history/statement all updated', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { p1 } = await ids(t);
  const eff = at(now - 5 * DAY);
  const r = await correct(t.ada, p1, { expected_revision: 1, amount: 400, effective_at: eff, reason: 'corrected amount' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.payment_id, p1); assert.equal(r.json.revision, 2); assert.equal(r.json.amount, 400);
  assert.equal(ms(r.json.effective_at), ms(eff)); assert.match(r.json.recorded_at, RFC3339); assert.equal(r.json.reason, 'corrected amount');
  assert.ok(ms(r.json.recorded_at) >= now - 5000 && ms(r.json.recorded_at) <= Date.now() + 5000, 'recorded_at is server time (now)');
  assert.equal(await balance(t.ada), 10100); assert.equal(await balance(t.bob), 2400);
  assert.equal(await balance(t.cy), 200);
  // historical views follow the new amount
  assert.equal((await meAt(t.ada, { as_of: at(now - 6 * DAY) })).balance, 9600, 'opening balances never change');
  assert.equal((await meAt(t.bob, { as_of: at(now - 6 * DAY) })).balance, 3200);
  assert.equal((await meAt(t.ada, { as_of: eff })).balance, 9200);
  assert.equal((await meAt(t.bob, { as_of: eff })).balance, 3600);
  const s = await stmt(t.ada);
  const e = s.entries[0];
  assert.equal(e.revision, 2); assert.equal(e.payment.amount, 400); assert.equal(e.delta, -400); assert.equal(e.balance_after, 9200);
  assert.equal(e.recorded_at, r.json.recorded_at); assert.equal(ms(e.effective_at), ms(eff));
  assert.equal(s.entries.length, 3, 'no correction is counted alongside the revision it replaces');
  assert.equal(s.closing_balance, 10100);
  assert.equal(s.opening_balance + s.entries.reduce((a, x) => a + x.delta, 0), s.closing_balance);
  const b = await stmt(t.bob);
  assert.equal(b.entries[0].delta, 400); assert.equal(b.closing_balance, 2400);
});

test('Corrections: increase debits the SENDER; zero reverses the whole payment (entry stays with zero delta)', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { p1, p3 } = await ids(t);
  assert.equal((await correct(t.ada, p1, { expected_revision: 1, amount: 800, effective_at: at(now - 5 * DAY), reason: 'more' })).status, 201);
  assert.equal(await balance(t.ada), 9700); assert.equal(await balance(t.bob), 2800);
  assert.equal((await meAt(t.ada, { as_of: at(now - 5 * DAY) })).balance, 8800);
  const z = await correct(t.ada, p1, { expected_revision: 2, amount: 0, effective_at: at(now - 5 * DAY), reason: 'reverse all' });
  assert.equal(z.status, 201); assert.equal(z.json.amount, 0); assert.equal(z.json.revision, 3);
  assert.equal(await balance(t.ada), 10500); assert.equal(await balance(t.bob), 2000);
  const s = await stmt(t.ada);
  assert.equal(s.entries.length, 3);
  assert.equal(s.entries[0].delta, 0); assert.equal(s.entries[0].payment.amount, 0); assert.equal(s.entries[0].revision, 3);
  assert.equal(s.entries[0].balance_after, 9600);
  assert.equal(s.closing_balance, 10500);
  void p3;
});

test('Corrections: unaffordable current debit -> 409 insufficient_funds; takes precedence over historical_overdraft; nothing changes', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { p1, p3 } = await ids(t);
  const before = await snapshotAll(t, p1);
  const eff = at(now - 5 * DAY);
  // increase debits sender ada (balance 10000): +10001 is unaffordable (and also overdraws history) -> insufficient_funds wins
  expectErr(await correct(t.ada, p1, { expected_revision: 1, amount: 10501, effective_at: eff, reason: 'x' }), 409, 'insufficient_funds');
  // decrease debits receiver cy (current 200): reversing p_3 (300) is unaffordable now (and would overdraw history)
  expectErr(await correct(t.ada, p3, { expected_revision: 1, amount: 0, effective_at: at(now - 3 * DAY), reason: 'x' }), 409, 'insufficient_funds');
  assert.equal(await snapshotAll(t, p1), before, 'failures preserve balances, revisions, statements');
  // exactly affordable current debit is not insufficient_funds (it fails only on history here)
  const edge = await correct(t.ada, p1, { expected_revision: 1, amount: 10500, effective_at: eff, reason: 'x' });
  expectErr(edge, 409, 'historical_overdraft');
  assert.equal(await snapshotAll(t, p1), before);
});

test('Corrections: historical_overdraft when a past effective-time boundary would go negative (moving effective_at later / raising amount)', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { p1, p3 } = await ids(t);
  const before = await snapshotAll(t, p1);
  // cy: +300 at d3 (p_3), -100 at d2 (p_4). Moving p_3 to d1 with the same amount: cy would be -100 at d2. Current delta is 0.
  expectErr(await correct(t.ada, p3, { expected_revision: 1, amount: 300, effective_at: at(now - DAY), reason: 'late' }), 409, 'historical_overdraft');
  // raising p_1 so ada's opening 9600 cannot cover it at d5 (current balance still covers the debit)
  expectErr(await correct(t.ada, p1, { expected_revision: 1, amount: 9701, effective_at: at(now - 5 * DAY), reason: 'big' }), 409, 'historical_overdraft');
  assert.equal(await snapshotAll(t, p1), before);
  // idempotency state preserved: the same key may be reused for a valid correction
  const key = uniq('reuse');
  expectErr(await correct(t.ada, p3, { expected_revision: 1, amount: 300, effective_at: at(now - DAY), reason: 'late' }, key), 409, 'historical_overdraft');
  const ok = await correct(t.ada, p3, { expected_revision: 1, amount: 250, effective_at: at(now - 3 * DAY), reason: 'ok' }, key);
  assert.equal(ok.status, 201, ok.text);
  // a legal late move that keeps every boundary nonnegative works: cy keeps +300 before -100
  const L = ok.json;
  assert.equal(L.revision, 2);
  assert.equal(await balance(t.cy), 150);
});

test('Corrections: boundary balances combine ALL movements at the same instant (no false historical_overdraft inside a tie)', async () => {
  const now = Date.now(); const T = now - 3 * DAY;
  // cy opens at 0; at instant T he receives 300 (p_2) and sends 300 (p_1). In id order p_1 would transiently overdraw him; combined effect is 0.
  const fx = fixture({
    users: [user('u_ada', 'ada', 5000 - 300 - 100), user('u_bob', 'bob', 500 + 100), user('u_cy', 'cy', 0), user('u_dee', 'dee', 300), user('u_op', 'op', 0)],
    payments: [
      seedPay('p_1', 'u_cy', 'u_dee', 300, at(T), { note: 'out' }),
      seedPay('p_2', 'u_ada', 'u_cy', 300, at(T), { note: 'in' }),
      seedPay('p_3', 'u_ada', 'u_bob', 100, at(now - DAY), { note: 'later' }),
    ],
    settlement_operator_ids: [],
  });
  const { t } = await setup(fx, ['ada', 'bob', 'cy', 'dee']);
  const feed = (await get(t.ada, '/activity?limit=200')).json.payments;
  const p3 = feed.find((p) => p.note === 'later').payment_id;
  assert.equal((await meAt(t.cy, { as_of: at(T) })).balance, 0, 'combined effect at T');
  assert.equal((await meAt(t.cy, { as_of: at(T - 1000) })).balance, 0);
  assert.equal((await meAt(t.dee, { as_of: at(T) })).balance, 300);
  const c = await correct(t.ada, p3, { expected_revision: 1, amount: 120, effective_at: at(now - DAY), reason: 'bump' });
  assert.equal(c.status, 201, c.text);
  // correcting the tied payment itself keeps the boundary combined: raise p_2 (300 -> 350) and p_1 stays; cy at T = +350 -300 >= 0
  const p2 = feed.find((p) => p.note === 'in').payment_id;
  const c2 = await correct(t.ada, p2, { expected_revision: 1, amount: 350, effective_at: at(T), reason: 'more in' });
  assert.equal(c2.status, 201, c2.text);
  assert.equal((await meAt(t.cy, { as_of: at(T) })).balance, 50);
  // but moving the inflow to a LATER instant than the outflow overdraws cy at T (current balances unchanged, so this is purely historical)
  expectErr(await correct(t.ada, p2, { expected_revision: 2, amount: 350, effective_at: at(now - DAY), reason: 'later in' }), 409, 'historical_overdraft');
});

test('Corrections: effective_at in the past moves a payment across statement windows (and can be earlier than created_at)', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { p1, p4 } = await ids(t);
  const d = (n) => at(now - n * DAY);
  const win = { from: d(6), to: d(4) };
  assert.equal((await stmt(t.ada, win)).entries.length, 1);
  // p_1 (d5) -> effective d1: out of [d6,d4), into [d2, now)
  const r = await correct(t.ada, p1, { expected_revision: 1, amount: 500, effective_at: d(1), reason: 'recorded late' });
  assert.equal(r.status, 201, r.text);
  const out = await stmt(t.ada, win);
  assert.deepEqual(out.entries, []); assert.equal(out.opening_balance, 9600); assert.equal(out.closing_balance, 9600);
  const into = await stmt(t.ada, { from: d(2), to: at(now + 1000) });
  assert.equal(into.entries.length, 1);
  assert.equal(into.entries[0].revision, 2); assert.equal(ms(into.entries[0].effective_at), ms(d(1)));
  assert.equal(into.opening_balance, 10000 + 500, 'before d2 the payment has not yet taken effect');
  assert.equal(into.closing_balance, 10000);
  const full = await stmt(t.ada);
  assert.deepEqual(full.entries.map((e) => e.payment.note), ['two', 'three', 'one'], 'ordered by selected effective_at');
  assert.equal((await meAt(t.ada, { as_of: d(4) })).balance, 10800);
  assert.equal((await meAt(t.bob, { as_of: d(4) })).balance, 2000);
  assert.equal(await balance(t.ada), 10000);
  // moving p_4 EARLIER than its created_at (but still after cy received the money) is allowed
  const e = await correct(t.cy, p4, { expected_revision: 1, amount: 100, effective_at: at(now - 2.5 * DAY), reason: 'earlier' });
  assert.equal(e.status, 201, e.text);
  const dee = await stmt(t.dee);
  assert.equal(ms(dee.entries[0].effective_at), ms(at(now - 2.5 * DAY)));
});

test('Corrections: stale_revision (older and non-matching expected revision); success after refreshing the expected revision', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { p1 } = await ids(t);
  const eff = at(now - 5 * DAY);
  assert.equal((await correct(t.ada, p1, { expected_revision: 1, amount: 400, effective_at: eff, reason: 'a' })).status, 201);
  expectErr(await correct(t.ada, p1, { expected_revision: 1, amount: 300, effective_at: eff, reason: 'b' }), 409, 'stale_revision');
  expectErr(await correct(t.ada, p1, { expected_revision: 99, amount: 300, effective_at: eff, reason: 'b' }), 409, 'stale_revision');
  assert.equal(await balance(t.ada), 10100);
  const ok = await correct(t.ada, p1, { expected_revision: 2, amount: 300, effective_at: eff, reason: 'b' });
  assert.equal(ok.status, 201); assert.equal(ok.json.revision, 3);
  assert.equal((await revisions(t.ada, p1)).json.revisions.length, 3);
});

// ---------------- idempotency ----------------

test('Corrections idempotency: replay -> 200 with the ORIGINAL revision even after newer revisions; different body 409; key order irrelevant', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { p1 } = await ids(t);
  const eff = at(now - 5 * DAY);
  const key = uniq('c');
  const body = { expected_revision: 1, amount: 400, effective_at: eff, reason: 'first' };
  const first = await correct(t.ada, p1, body, key);
  assert.equal(first.status, 201);
  assert.equal((await correct(t.ada, p1, { expected_revision: 2, amount: 350, effective_at: eff, reason: 'second' })).status, 201);
  assert.equal((await correct(t.ada, p1, { expected_revision: 3, amount: 300, effective_at: eff, reason: 'third' })).status, 201);
  for (let i = 0; i < 3; i++) {
    const rep = await correct(t.ada, p1, body, key);
    assert.equal(rep.status, 200);
    assert.deepEqual(rep.json, first.json);
    assert.equal(rep.json.revision, 2);
  }
  const reordered = await http('POST', `/payments/${p1}/corrections`, { token: t.ada, key, raw: ` {"reason":"first","effective_at":"${eff}","amount":4e2,"expected_revision":1} ` });
  assert.equal(reordered.status, 200); assert.deepEqual(reordered.json, first.json);
  expectErr(await correct(t.ada, p1, { ...body, amount: 401 }, key), 409, 'idempotency_key_reuse');
  expectErr(await correct(t.ada, p1, { ...body, reason: 'other' }, key), 409, 'idempotency_key_reuse');
  assert.equal((await revisions(t.ada, p1)).json.revisions.length, 4, 'replays added no revisions');
  assert.equal(await balance(t.ada), 10200); // 500 -> 300
  expectErr(await correct(t.ada, p1, { expected_revision: 4, amount: 0, effective_at: eff, reason: 'x' }, key), 409, 'idempotency_key_reuse');
});

test('Corrections idempotency: a claimed key beats an invalid body or stale revision (409 idempotency_key_reuse); failed keys are reusable; unparseable body stays 400', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { p1, p3 } = await ids(t);
  const eff = at(now - 5 * DAY);
  const key = uniq('c');
  assert.equal((await correct(t.ada, p1, { expected_revision: 1, amount: 400, effective_at: eff, reason: 'a' }, key)).status, 201);
  for (const bad of [{}, { expected_revision: 1, amount: -5, effective_at: eff, reason: 'a' }, { expected_revision: 1, amount: 400, effective_at: eff, reason: '' }, { expected_revision: 1, amount: 400, effective_at: 'nope', reason: 'a' }, { expected_revision: 7, amount: 400, effective_at: eff, reason: 'a' }]) {
    expectErr(await correct(t.ada, p1, bad, key), 409, 'idempotency_key_reuse');
  }
  expectErr(await http('POST', `/payments/${p1}/corrections`, { token: t.ada, key, raw: '{broken' }), 400, 'malformed_request');
  // failed attempts do not claim keys
  const k2 = uniq('f');
  expectErr(await correct(t.ada, p3, { expected_revision: 5, amount: 250, effective_at: at(now - 3 * DAY), reason: 'stale' }, k2), 409, 'stale_revision');
  expectErr(await correct(t.ada, p3, { expected_revision: 1, amount: -1, effective_at: at(now - 3 * DAY), reason: 'bad' }, k2), 422, 'validation_failed');
  expectErr(await correct(t.bob, p3, { expected_revision: 1, amount: 250, effective_at: at(now - 3 * DAY), reason: 'bob' }, k2), 403, 'forbidden');
  const ok = await correct(t.ada, p3, { expected_revision: 1, amount: 250, effective_at: at(now - 3 * DAY), reason: 'fine' }, k2);
  assert.equal(ok.status, 201);
  // same key and same body on a different payment (different path) is a different request
  const k3 = uniq('p');
  const b = { expected_revision: 2, amount: 250, effective_at: eff, reason: 'same body' };
  assert.equal((await correct(t.ada, p1, b, k3)).status, 201);
  assert.equal((await correct(t.ada, p3, { ...b, expected_revision: 2 }, k3)).status, 201);
  // per-user key scope
  const k4 = 'shared';
  assert.equal((await correct(t.ada, p1, { expected_revision: 3, amount: 240, effective_at: eff, reason: 'u1' }, k4)).status, 201);
  const mine = (await pay(t.bob, { to_handle: 'cy', amount: 10 })).json;
  assert.equal((await correct(t.bob, mine.payment_id, { expected_revision: 1, amount: 9, effective_at: at(Date.now() - 1000), reason: 'u2' }, k4)).status, 201);
});

// ---------------- originals untouched, feed, revisions endpoint ----------------

test('Corrections: the original receipt, its idempotent replay and /activity stay unchanged; corrections are not feed payments', async () => {
  const { t } = await setup();
  const key = uniq('p');
  const body = { to_handle: 'bob', amount: 500, note: 'orig', visibility: 'public' };
  const orig = await http('POST', '/payments', { token: t.ada, key, body });
  assert.equal(orig.status, 201);
  const P = orig.json;
  const feedBefore = (await get(t.cy, '/activity?limit=200')).json;
  await sleep(1100);
  const c = await correct(t.ada, P.payment_id, { expected_revision: 1, amount: 200, effective_at: at(Date.now() - 500), reason: 'less' });
  assert.equal(c.status, 201, c.text);
  const replay = await http('POST', '/payments', { token: t.ada, key, body });
  assert.equal(replay.status, 200); assert.deepEqual(replay.json, P);
  const feed = (await get(t.cy, '/activity?limit=200')).json;
  assert.deepEqual(feed, feedBefore, 'feed shows the original payment only');
  assert.equal(feed.payments.length, 1); assert.equal(feed.payments[0].amount, 500); assert.equal(feed.payments[0].created_at, P.created_at);
  assert.equal(await balance(t.ada), 9700); assert.equal(await balance(t.bob), 2800);
  const st = await stmt(t.ada);
  assert.equal(st.entries[0].payment.amount, 200, 'statement shows the selected amount');
  assert.equal(st.entries[0].payment.payment_id, P.payment_id);
  assert.equal(st.entries[0].payment.created_at, P.created_at);
  // the correction only moves money between the same two wallets and leaves visibility/parties alone
  assert.equal(st.entries[0].payment.visibility, 'public'); assert.equal(st.entries[0].payment.from_handle, 'ada'); assert.equal(st.entries[0].payment.to_handle, 'bob');
});

test('Corrections: request-paid payments are ordinary payments and may be corrected (request link unchanged)', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 300 })).json;
  const p = (await payReq(t.ada, rq.request_id, { visibility: 'private' })).json;
  await sleep(1100);
  const c = await correct(t.ada, p.payment_id, { expected_revision: 1, amount: 100, effective_at: at(Date.now() - 500), reason: 'partial refund' });
  assert.equal(c.status, 201, c.text);
  assert.equal(await balance(t.ada), 9900);
  const e = (await stmt(t.ada)).entries[0].payment;
  assert.equal(e.request_id, rq.request_id); assert.equal(e.visibility, 'private'); assert.equal(e.amount, 100);
  assert.equal((await get(t.ada, '/requests')).json.requests[0].status, 'paid');
});

test('Revisions endpoint: revision order incl. revision 1 (reason ""), both parties may read, third party 404 even for public payments, no token 401', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { p1 } = await ids(t);
  const eff = at(now - 5 * DAY);
  const r0 = await revisions(t.ada, p1);
  assert.equal(r0.status, 200);
  assert.equal(r0.json.revisions.length, 1);
  const v1 = r0.json.revisions[0];
  assert.equal(v1.payment_id, p1); assert.equal(v1.revision, 1); assert.equal(v1.amount, 500); assert.equal(v1.reason, '');
  assert.equal(ms(v1.effective_at), ms(at(now - 5 * DAY))); assert.equal(ms(v1.recorded_at), ms(at(now - 5 * DAY)));
  const c2 = (await correct(t.ada, p1, { expected_revision: 1, amount: 450, effective_at: eff, reason: 'two' })).json;
  const c3 = (await correct(t.ada, p1, { expected_revision: 2, amount: 400, effective_at: at(now - 5 * DAY + 3600e3), reason: 'three' })).json;
  const r = (await revisions(t.ada, p1)).json.revisions;
  assert.deepEqual(r.map((x) => x.revision), [1, 2, 3]);
  assert.deepEqual(r.map((x) => x.amount), [500, 450, 400]);
  assert.deepEqual(r.map((x) => x.reason), ['', 'two', 'three']);
  for (const [rev, resp] of [[r[1], c2], [r[2], c3]]) for (const k of ['payment_id', 'revision', 'amount', 'effective_at', 'recorded_at', 'reason']) assert.deepEqual(rev[k], resp[k], k);
  for (let i = 1; i < r.length; i++) assert.ok(ns(r[i].recorded_at) > ns(r[i - 1].recorded_at), 'recorded_at strictly increases');
  assert.deepEqual((await revisions(t.bob, p1)).json, { revisions: r }, 'the receiver reads the same history');
  assert.equal(p1.length > 0, true);
  for (const h of ['cy', 'dee', 'op', 'zed']) expectErr(await revisions(t[h], p1), 404, 'not_found'); // public payment, still 404
  expectErr(await http('GET', `/payments/${p1}/revisions`), 401, 'unauthenticated');
  expectErr(await http('GET', `/payments/${p1}/revisions`, { token: 'bogus' }), 401, 'unauthenticated');
  expectErr(await revisions(t.ada, 'p_missing'), 404, 'not_found');
});

test('Corrections: recorded times strictly increase for one payment, even for rapid-fire corrections', async () => {
  const { t } = await setup();
  const P = (await pay(t.ada, { to_handle: 'bob', amount: 1000 })).json;
  await sleep(1100);
  let rev = 1; const rec = [];
  for (let i = 0; i < 8; i++) {
    const r = await correct(t.ada, P.payment_id, { expected_revision: rev, amount: 1000 - (i + 1) * 10, effective_at: at(Date.now() - 200), reason: `r${i}` });
    assert.equal(r.status, 201, r.text);
    rev = r.json.revision; rec.push(r.json.recorded_at);
  }
  for (let i = 1; i < rec.length; i++) assert.ok(ns(rec[i]) > ns(rec[i - 1]), `recorded_at #${i}: ${rec[i - 1]} -> ${rec[i]}`);
  assert.ok(ns(rec[0]) >= ns(P.created_at));
  assert.equal(await balance(t.ada), 10000 - 920);
});

// ---------------- known_at ----------------

test('known_at: latest revision recorded at or before known_at is selected; none recorded yet -> contributes nothing; matches the reference ledger over a grid', async () => {
  const { t } = await setup();
  const P = (await pay(t.ada, { to_handle: 'bob', amount: 300 })).json;
  const c = ms(P.created_at);
  await sleep(1200);
  const r2 = (await correct(t.ada, P.payment_id, { expected_revision: 1, amount: 100, effective_at: P.created_at, reason: 'lower' })).json;
  await sleep(1200);
  const r3 = (await correct(t.ada, P.payment_id, { expected_revision: 2, amount: 200, effective_at: at(c - HOUR), reason: 'earlier' })).json;
  await sleep(1200);
  const r4 = (await correct(t.ada, P.payment_id, { expected_revision: 3, amount: 0, effective_at: at(c - HOUR), reason: 'reverse' })).json;
  const L = new Ledger({ u_ada: 10000, u_bob: 2500, u_cy: 0, u_dee: 500, u_op: 100000 });
  L.add({ id: P.payment_id, from: 'u_ada', to: 'u_bob', revs: [
    { revision: 1, amount: 300, effective: c, recorded: c },
    { revision: 2, amount: 100, effective: ms(r2.effective_at), recorded: ms(r2.recorded_at) },
    { revision: 3, amount: 200, effective: ms(r3.effective_at), recorded: ms(r3.recorded_at) },
    { revision: 4, amount: 0, effective: ms(r4.effective_at), recorded: ms(r4.recorded_at) },
  ] });
  const knowns = [c - 5000, c, r2.recorded_at, at(ms(r2.recorded_at) - 1000), r3.recorded_at, at(ms(r3.recorded_at) - 1000), r4.recorded_at, at(ms(r4.recorded_at) - 1000), at(Date.now() + DAY), undefined];
  const asofs = [c - 2 * HOUR, c - HOUR, c - 30 * 60e3, c, c + 1000, Date.now() + DAY, undefined];
  for (const k of knowns) {
    for (const a of asofs) {
      const params = {}; if (k !== undefined) params.known_at = typeof k === 'number' ? at(k) : k; if (a !== undefined) params.as_of = at(a);
      const kms = k === undefined ? Infinity : (typeof k === 'number' ? ms(at(k)) : ms(k)); const ams = a === undefined ? Infinity : ms(at(a));
      for (const [h, u] of [['ada', 'u_ada'], ['bob', 'u_bob']]) {
        const got = await meAt(t[h], params);
        assert.equal(got.balance, L.balanceAt(u, ams, kms), `${h} ${JSON.stringify(params)}`);
        if (params.known_at) assert.equal(got.known_at, params.known_at);
        if (params.as_of) assert.equal(got.as_of, params.as_of);
      }
    }
  }
  // explicit expectations
  assert.equal((await meAt(t.ada, { known_at: at(c - 5000) })).balance, 10000, 'not yet recorded -> contributes nothing');
  assert.equal((await meAt(t.ada, { known_at: P.created_at })).balance, 9700);
  assert.equal((await meAt(t.ada, { known_at: r2.recorded_at })).balance, 9900);
  assert.equal((await meAt(t.ada, { known_at: r3.recorded_at })).balance, 9800);
  assert.equal((await meAt(t.ada, { known_at: r4.recorded_at })).balance, 10000, 'zero reverses');
  assert.equal((await meAt(t.ada)).balance, 10000);
  // the effective time matters: revision 3 is effective one hour before created_at
  assert.equal((await meAt(t.ada, { as_of: at(c - 30 * 60e3), known_at: r3.recorded_at })).balance, 9800);
  assert.equal((await meAt(t.ada, { as_of: at(c - 30 * 60e3), known_at: r2.recorded_at })).balance, 10000);
});

test('known_at statements: entries carry the selected revision, effective_at, recorded_at and amount; zero-amount entries appear; ordering by selected effective_at', async () => {
  const { t } = await setup();
  const A = (await pay(t.ada, { to_handle: 'bob', amount: 100, note: 'A' })).json;
  await sleep(1200);
  const B = (await pay(t.ada, { to_handle: 'bob', amount: 200, note: 'B' })).json;
  await sleep(1200);
  const cB = (await correct(t.ada, B.payment_id, { expected_revision: 1, amount: 250, effective_at: at(ms(A.created_at) - 3600e3), reason: 'B earlier' })).json;
  await sleep(1200);
  const cA = (await correct(t.ada, A.payment_id, { expected_revision: 1, amount: 0, effective_at: A.created_at, reason: 'A reversed' })).json;
  const now = await stmt(t.ada);
  assert.deepEqual(now.entries.map((e) => e.payment.note), ['B', 'A'], 'B now takes effect before A');
  assert.deepEqual(now.entries.map((e) => [e.revision, e.payment.amount, e.delta, e.balance_after]), [[2, 250, -250, 9750], [2, 0, 0, 9750]]);
  assert.equal(now.entries[0].recorded_at, cB.recorded_at); assert.equal(ms(now.entries[0].effective_at), ms(cB.effective_at));
  assert.equal(now.entries[1].recorded_at, cA.recorded_at);
  assert.equal(now.opening_balance, 10000); assert.equal(now.closing_balance, 9750);
  const k1 = await stmt(t.ada, { known_at: cB.recorded_at });
  assert.deepEqual(k1.entries.map((e) => [e.payment.note, e.revision, e.payment.amount]), [['B', 2, 250], ['A', 1, 100]]);
  assert.equal(k1.closing_balance, 9650);
  const k0 = await stmt(t.ada, { known_at: B.created_at });
  assert.deepEqual(k0.entries.map((e) => [e.payment.note, e.revision, e.payment.amount, e.balance_after]), [['A', 1, 100, 9900], ['B', 1, 200, 9700]]);
  const kEarly = await stmt(t.ada, { known_at: at(ms(A.created_at) - 1000) });
  assert.deepEqual(kEarly.entries, []); assert.equal(kEarly.closing_balance, 10000);
  const kA = await stmt(t.ada, { known_at: A.created_at });
  assert.deepEqual(kA.entries.map((e) => e.payment.note), ['A']);
  // windows combine with known_at and as the reference ledger says
  const w = await stmt(t.ada, { from: at(ms(A.created_at) - 1800e3), to: at(ms(A.created_at) + 1000) });
  assert.deepEqual(w.entries.map((e) => e.payment.note), ['A']);
  assert.equal(w.opening_balance, 9750); assert.equal(w.closing_balance, 9750);
  // receiver's view
  const b = await stmt(t.bob);
  assert.deepEqual(b.entries.map((e) => [e.payment.note, e.delta]), [['B', 250], ['A', 0]]);
  // pagination with corrections keeps balance_after stable
  const pages = await stmtAll(t.ada, {}, 1);
  assert.deepEqual(pages.entries, now.entries);
});

test('Corrections keep every historical view conserved: the sum of balances equals the seeded total for any as_of/known_at', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { p1, p2, p3 } = await ids(t);
  await sleep(1100);
  assert.equal((await correct(t.ada, p1, { expected_revision: 1, amount: 700, effective_at: at(now - 5 * DAY), reason: 'up' })).status, 201);
  await sleep(1100);
  assert.equal((await correct(t.bob, p2, { expected_revision: 1, amount: 300, effective_at: at(now - 4.5 * DAY), reason: 'down' })).status, 201);
  assert.equal((await correct(t.ada, p3, { expected_revision: 1, amount: 100, effective_at: at(now - 1 * DAY), reason: 'later+less' })).status, 201);
  const tokens = ALL.map((h) => t[h]);
  const total = S_TOTAL;
  for (const a of [now - 400 * DAY, now - 5 * DAY, now - 4.7 * DAY, now - 4.2 * DAY, now - 3 * DAY, now - 1.5 * DAY, now - DAY, now, now + DAY]) {
    assert.equal(await sumView(tokens, { as_of: at(a) }), total, `as_of ${at(a)}`);
  }
  for (const k of [now - 6 * DAY, now - 4.5 * DAY, now - 1000, now + DAY]) {
    const expected = k < now - 5.5 * DAY ? Object.values(S_OPEN).reduce((x, y) => x + y, 0) : total;
    assert.equal(await sumView(tokens, { as_of: at(now + DAY), known_at: at(k) }), expected, `known_at ${at(k)}`);
  }
  assert.equal(await sumView(tokens, {}), total);
});

// ---------------- settlements & captures ----------------

test('Settlement history: member revision 1 has effective_at = recorded_at = committed_at; correction -> 422 linked_payment_immutable', async () => {
  const { t } = await setup();
  const s = (await settle(t.op, { transfers: [{ from_handle: 'ada', to_handle: 'bob', amount: 100 }, { from_handle: 'bob', to_handle: 'cy', amount: 40 }] })).json;
  for (const m of s.payments) {
    const sender = m.from_handle === 'ada' ? t.ada : t.bob;
    const receiver = m.to_handle === 'bob' ? t.bob : t.cy;
    const r = await revisions(sender, m.payment_id);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.revisions.length, 1);
    const v = r.json.revisions[0];
    assert.equal(v.revision, 1); assert.equal(v.amount, m.amount); assert.equal(v.reason, '');
    assert.equal(ms(v.effective_at), ms(s.committed_at)); assert.equal(ms(v.recorded_at), ms(s.committed_at));
    assert.equal((await revisions(receiver, m.payment_id)).status, 200);
    expectErr(await revisions(t.op, m.payment_id), 404, 'not_found'); // operator is not a party
    expectErr(await revisions(t.dee, m.payment_id), 404, 'not_found');
    expectErr(await correct(sender, m.payment_id, corrBody({ expected_revision: 1, amount: 1, effective_at: at(Date.now() - 500) })), 422, 'linked_payment_immutable');
  }
  assert.equal(await balance(t.ada), 9900); assert.equal(await balance(t.bob), 2560); assert.equal(await balance(t.cy), 40);
  // statement shows all members at the shared instant
  const st = await stmt(t.bob);
  assert.equal(st.entries.length, 2);
  for (const e of st.entries) { assert.equal(ms(e.effective_at), ms(s.committed_at)); assert.equal(e.revision, 1); assert.equal(e.payment.settlement_id, s.settlement_id); }
  // the settlement replay is unchanged
});

test('Captures are immutable linked payments: correction -> 422 linked_payment_immutable; capture revision 1 uses created_at; appear once in statements', async () => {
  const { t } = await setup();
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 1000, note: 'dep' })).json;
  const c1 = (await capture(t.bob, a.authorization_id, { amount: 300, final: false })).json;
  await sleep(1100);
  const c2 = (await capture(t.bob, a.authorization_id, { amount: 200 })).json;
  for (const c of [c1, c2]) {
    expectErr(await correct(t.ada, c.payment_id, corrBody({ expected_revision: 1, amount: 1, effective_at: at(Date.now() - 500) })), 422, 'linked_payment_immutable');
    const rv = (await revisions(t.ada, c.payment_id)).json.revisions;
    assert.equal(rv.length, 1); assert.equal(rv[0].revision, 1); assert.equal(rv[0].reason, '');
    assert.equal(ms(rv[0].effective_at), ms(c.created_at)); assert.equal(ms(rv[0].recorded_at), ms(c.created_at));
    assert.equal((await revisions(t.bob, c.payment_id)).status, 200);
    expectErr(await revisions(t.cy, c.payment_id), 404, 'not_found');
  }
  const s = await stmt(t.ada);
  assert.deepEqual(s.entries.map((e) => e.payment.payment_id), [c1.payment_id, c2.payment_id]);
  assert.deepEqual(s.entries.map((e) => e.delta), [-300, -200]);
  assert.equal(s.closing_balance, 9500);
  assert.equal((await stmt(t.bob)).entries.length, 2);
  assert.equal(await balance(t.ada), 9500);
  // the sender of a capture is the payer of the authorization; a non-sender still gets 403
  expectErr(await correct(t.bob, c1.payment_id, corrBody({ expected_revision: 1, amount: 1, effective_at: at(Date.now() - 500) })), 403, 'forbidden');
});

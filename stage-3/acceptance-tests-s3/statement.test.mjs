import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  http, fixture, user, reset, setup, login, balance, expectErr, pay, mkReq, payReq, settle, get, uniq, RFC3339, sleep, HOUR, DAY,
  seedAuth, mkAuth, capture, voidAuth, me, assertPaymentShape, at, ms, meAt, stmt, stmtQ, stmtAll, correct, corrBody, fixtureS, ledgerS, seedPay, Ledger, S_OPEN,
} from './lib.mjs';

/** build a fixture whose ending balances are consistent with the given openings and seeded payments */
function buildFx(openings, pays, extra = {}) {
  const bal = { ...openings };
  for (const p of pays) { bal[p.from] -= p.amount; bal[p.to] += p.amount; }
  const hs = Object.keys(openings);
  const fx = fixture({
    users: hs.map((h) => user(`u_${h}`, h, bal[h])),
    payments: pays.map((p) => seedPay(p.id, `u_${p.from}`, `u_${p.to}`, p.amount, p.at === undefined ? undefined : at(p.at), { note: p.note || '', visibility: p.visibility || 'public' })),
    settlement_operator_ids: hs.includes('op') ? ['u_op'] : [],
    ...extra,
  });
  const L = new Ledger(Object.fromEntries(hs.map((h) => [`u_${h}`, openings[h]])));
  pays.forEach((p) => L.add({ id: p.id, from: `u_${p.from}`, to: `u_${p.to}`, revs: [{ revision: 1, amount: p.amount, effective: Math.floor(p.at / 1000) * 1000, recorded: Math.floor(p.at / 1000) * 1000 }] }));
  return { fx, L };
}

/** 12 payments, one per hour, alternating directions, with a zero-balance-ish middle */
function manyPayments(now) {
  const pays = [];
  const amts = [100, 250, 75, 600, 1, 999, 40, 500, 300, 20, 800, 5];
  for (let i = 0; i < 12; i++) {
    const ada = i % 3 !== 2; // 8 involve ada
    pays.push({ id: `p_${String(i + 1).padStart(2, '0')}`, from: i % 2 === 0 ? 'ada' : 'bob', to: ada ? (i % 2 === 0 ? 'bob' : 'ada') : 'cy', amount: amts[i], at: now - (13 - i) * HOUR, note: `n${i}` });
  }
  return pays;
}
const OPEN3 = { ada: 5000, bob: 5000, cy: 1000, dee: 0, op: 0 };

const entryShape = (e) => {
  for (const k of ['payment', 'delta', 'balance_after', 'revision', 'effective_at', 'recorded_at']) assert.ok(k in e, `entry.${k}`);
  assertPaymentShape(e.payment, 'entry.payment');
};

test('Statement: entries oldest first, delta signs, balance_after, opening/closing and identity (fixture S, ada)', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const s = await stmt(t.ada);
  assert.equal(s.opening_balance, 9600);
  assert.equal(s.closing_balance, 10000);
  assert.equal(s.has_more, false);
  assert.deepEqual(s.entries.map((e) => [e.delta, e.balance_after]), [[-500, 9100], [1200, 10300], [-300, 10000]]);
  assert.deepEqual(s.entries.map((e) => e.payment.amount), [500, 1200, 300]);
  assert.deepEqual(s.entries.map((e) => e.payment.note), ['one', 'two', 'three']);
  assert.deepEqual(s.entries.map((e) => e.payment.from_handle), ['ada', 'bob', 'ada']);
  assert.deepEqual(s.entries.map((e) => e.payment.to_handle), ['bob', 'ada', 'cy']);
  for (const e of s.entries) {
    entryShape(e);
    assert.equal(e.revision, 1);
    assert.equal(ms(e.effective_at), ms(e.payment.created_at)); assert.equal(ms(e.recorded_at), ms(e.payment.created_at));
  }
  assert.equal(typeof s.snapshot, 'string'); assert.ok(s.snapshot.length > 0);
  assert.equal(s.opening_balance + s.entries.reduce((a, e) => a + e.delta, 0), s.closing_balance);
  // per-user views from the same ledger
  const b = await stmt(t.bob);
  assert.deepEqual(b.entries.map((e) => [e.delta, e.balance_after]), [[500, 3700], [-1200, 2500]]);
  assert.equal(b.opening_balance, 3200); assert.equal(b.closing_balance, 2500);
  const c = await stmt(t.cy);
  assert.deepEqual(c.entries.map((e) => [e.delta, e.balance_after]), [[300, 300], [-100, 200]]);
});

test('Statement: only payments the caller sent or received — even though others\' payments are public; activity-feed rules do not apply', async () => {
  const { t } = await setup(fixtureS());
  const dee = await stmt(t.dee);
  assert.equal(dee.entries.length, 1); assert.equal(dee.entries[0].payment.amount, 100); assert.equal(dee.entries[0].delta, 100);
  assert.equal(dee.opening_balance, 400); assert.equal(dee.closing_balance, 500);
  for (const h of ['op', 'zed']) {
    const s = await stmt(t[h]);
    assert.deepEqual(s.entries, []);
    assert.equal(s.opening_balance, s.closing_balance);
  }
  // a PRIVATE payment (p_2: bob -> ada) is in both parties' statements but not in a third party's
  assert.ok((await stmt(t.bob)).entries.some((e) => e.payment.visibility === 'private'));
  assert.ok((await stmt(t.ada)).entries.some((e) => e.payment.visibility === 'private'));
  assert.ok(!(await stmt(t.cy)).entries.some((e) => e.payment.visibility === 'private'));
  // and public payments of others are on the feed but never in a statement
  assert.ok((await get(t.zed, '/activity?limit=200')).json.payments.length >= 3);
  assert.equal((await stmt(t.zed)).entries.length, 0);
});

test('Statement: half-open window [from, to) with opening = balance before from and closing = balance before to', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const d = (n) => at(now - n * DAY);
  const L = ledgerS(now);
  const win = [
    [d(5), d(3)], [d(4), d(3)], [d(5), d(2)], [d(4), d(4)], [d(3), d(2)], [d(6), d(5)], [d(1), at(now)], [d(5) , d(5)],
    [at(now - 5 * DAY - 1000), at(now - 5 * DAY + 1000)], [at(now - 4 * DAY + 1000), at(now - 3 * DAY - 1000)],
  ];
  for (const [from, to] of win) {
    const s = await stmt(t.ada, { from, to });
    const e = L.statement('u_ada', ms(from), ms(to));
    assert.equal(s.opening_balance, e.opening, `[${from},${to}) opening`);
    assert.equal(s.closing_balance, e.closing, `[${from},${to}) closing`);
    assert.deepEqual(s.entries.map((x) => [x.delta, x.balance_after]), e.entries.map((x) => [x.delta, x.balance_after]), `[${from},${to}) entries`);
    assert.equal(s.opening_balance + s.entries.reduce((a, x) => a + x.delta, 0), s.closing_balance);
  }
  // boundaries explicitly: from inclusive, to exclusive
  const inc = await stmt(t.ada, { from: d(5), to: d(4) });
  assert.equal(inc.entries.length, 1); assert.equal(inc.entries[0].payment.amount, 500);
  assert.equal(inc.opening_balance, 9600); assert.equal(inc.closing_balance, 9100);
  const exc = await stmt(t.ada, { from: d(4), to: d(5) });
  assert.ok(exc.entries.length === 0, 'inverted window yields nothing');
  const only = await stmt(t.ada, { to: d(5) });
  assert.deepEqual(only.entries, []); assert.equal(only.opening_balance, 9600); assert.equal(only.closing_balance, 9600);
  const upto = await stmt(t.ada, { from: d(3) });
  assert.deepEqual(upto.entries.map((x) => x.delta), [-300]); assert.equal(upto.opening_balance, 10300);
});

test('Statement: defaults — from = opening of the wallet, to = now; payments made through the API appear', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  await sleep(1100);
  const p = (await pay(t.ada, { to_handle: 'zed', amount: 50, note: 'live' })).json;
  await sleep(1100);
  const s = await stmt(t.ada);
  assert.equal(s.opening_balance, 9600);
  assert.equal(s.entries.length, 4);
  const last = s.entries[3];
  assert.equal(last.payment.payment_id, p.payment_id); assert.equal(last.delta, -50); assert.equal(last.balance_after, 9950); assert.equal(s.closing_balance, 9950);
  assert.deepEqual(last.payment, p, 'the statement carries the receipt of the payment');
  assert.equal((await stmt(t.zed)).entries[0].delta, 50);
  // from = created_at includes it, to = created_at excludes it
  assert.equal((await stmt(t.ada, { from: p.created_at })).entries.length, 1);
  assert.equal((await stmt(t.ada, { to: p.created_at })).entries.length, 3);
  assert.equal((await stmt(t.ada, { to: p.created_at })).closing_balance, 10000);
});

test('Statement: request-pay payments, settlement members and captures each appear exactly once', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 200 })).json;
  const viaReq = (await payReq(t.ada, rq.request_id)).json;
  const st = (await settle(t.op, { transfers: [{ from_handle: 'ada', to_handle: 'bob', amount: 30 }, { from_handle: 'bob', to_handle: 'cy', amount: 10 }] })).json;
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 500 })).json;
  const cap1 = (await capture(t.bob, a.authorization_id, { amount: 100, final: false })).json;
  const cap2 = (await capture(t.bob, a.authorization_id, { amount: 150 })).json;
  const s = await stmt(t.ada);
  const ids = s.entries.map((e) => e.payment.payment_id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicates');
  for (const id of [viaReq.payment_id, st.payments[0].payment_id, cap1.payment_id, cap2.payment_id]) assert.equal(ids.filter((x) => x === id).length, 1, id);
  assert.ok(!ids.includes(st.payments[1].payment_id), 'settlement member between others is not in ada\'s statement');
  assert.equal(s.entries.length, 4, 'authorization creation / release are not statement entries');
  assert.equal(s.closing_balance, 10000 - 200 - 30 - 100 - 150);
  const cap = s.entries.find((e) => e.payment.payment_id === cap1.payment_id).payment;
  assert.equal(cap.authorization_id, a.authorization_id);
  const sm = s.entries.find((e) => e.payment.payment_id === st.payments[0].payment_id).payment;
  assert.equal(sm.settlement_id, st.settlement_id);
  const bob = await stmt(t.bob);
  assert.equal(bob.entries.filter((e) => e.payment.payment_id === cap2.payment_id).length, 1);
});

test('Statement: equal timestamps are ordered by payment id ascending; balance_after follows that order', async () => {
  const now = Date.now(); const T = now - 2 * DAY;
  const { fx } = buildFx({ ada: 5000, bob: 5000, cy: 0, dee: 0, op: 0 }, [
    { id: 'p_c', from: 'ada', to: 'bob', amount: 30, at: T }, { id: 'p_a', from: 'bob', to: 'ada', amount: 10, at: T },
    { id: 'p_b', from: 'ada', to: 'cy', amount: 20, at: T }, { id: 'p_d', from: 'ada', to: 'bob', amount: 1, at: T + 2000 },
  ]);
  const { t } = await setup(fx);
  const s = await stmt(t.ada);
  const ids = s.entries.map((e) => e.payment.payment_id);
  const tied = ids.slice(0, 3);
  assert.deepEqual(tied, [...tied].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)), 'ties ordered by payment id ascending');
  assert.equal(ids.length, 4);
  let run = 5000;
  for (const e of s.entries) { run += e.delta; assert.equal(e.balance_after, run); }
  assert.equal(s.closing_balance, run);
  // pagination does not disturb the order of ties
  const pages = await stmtAll(t.ada, {}, 1);
  assert.deepEqual(pages.entries.map((e) => e.payment.payment_id), ids);
});

test('Statement: pagination never changes balance_after, opening or closing; has_more / last partial page / offsets beyond the end', async () => {
  const now = Date.now();
  const { fx, L } = buildFx(OPEN3, manyPayments(now));
  const { t } = await setup(fx);
  const full = await stmt(t.ada, { limit: 200 });
  const exp = L.statement('u_ada');
  assert.equal(full.entries.length, exp.entries.length);
  assert.deepEqual(full.entries.map((e) => [e.delta, e.balance_after]), exp.entries.map((e) => [e.delta, e.balance_after]));
  const total = full.entries.length;
  assert.ok(total >= 8);
  for (const limit of [1, 2, 3, 5, total - 1, total, total + 1, 200]) {
    let off = 0; const got = []; let pages = 0;
    for (;;) {
      const p = await stmt(t.ada, { limit, offset: off });
      assert.equal(p.opening_balance, full.opening_balance, `opening @limit ${limit} offset ${off}`);
      assert.equal(p.closing_balance, full.closing_balance, `closing @limit ${limit} offset ${off}`);
      assert.deepEqual(p.entries, full.entries.slice(off, off + limit), `entries @limit ${limit} offset ${off}`);
      assert.equal(p.has_more, off + limit < total, `has_more @limit ${limit} offset ${off}`);
      got.push(...p.entries); pages++;
      if (!p.has_more) break;
      off += limit;
    }
    assert.deepEqual(got, full.entries);
    assert.equal(pages, Math.ceil(total / limit));
  }
  for (const off of [total, total + 1, total + 100]) {
    const p = await stmt(t.ada, { limit: 5, offset: off });
    assert.deepEqual(p.entries, []); assert.equal(p.has_more, false);
    assert.equal(p.opening_balance, full.opening_balance); assert.equal(p.closing_balance, full.closing_balance);
  }
  // windowed pagination identical
  const from = at(now - 9 * HOUR), to = at(now - 3 * HOUR);
  const w = await stmt(t.ada, { from, to, limit: 200 });
  const wp = await stmtAll(t.ada, { from, to }, 2);
  assert.deepEqual(wp.entries, w.entries);
  assert.equal(wp.first.opening_balance, w.opening_balance); assert.equal(wp.first.closing_balance, w.closing_balance);
});

test('Statement: limit/offset ranges are validated like GET /requests (strict integers)', async () => {
  const { t } = await setup(fixtureS());
  for (const qs of ['limit=0', 'limit=201', 'limit=-1', 'offset=-1', 'limit=abc', 'limit=1e2', 'limit=4.0', 'limit=+4', 'offset=1.0', 'offset=+1', 'offset=1e0', 'offset=x']) {
    expectErr(await http('GET', `/statement?${qs}`, { token: t.ada }), 422, 'validation_failed');
  }
  for (const qs of ['limit=1', 'limit=200', 'offset=0', 'limit=50&offset=0&foo=bar', 'unknown=1']) assert.equal((await http('GET', `/statement?${qs}`, { token: t.ada })).status, 200, qs);
  assert.equal((await stmt(t.ada, { limit: 1 })).entries.length, 1);
});

test('Statement: invalid from / to / known_at -> 422; unauthenticated -> 401', async () => {
  const { t } = await setup(fixtureS());
  for (const param of ['from', 'to', 'known_at']) {
    for (const v of ['2026-09-24T13:20:00', '2026-09-24', '', 'garbage', '2026-13-45T00:00:00+00:00', '1700000000']) {
      expectErr(await http('GET', `/statement?${param}=${encodeURIComponent(v)}`, { token: t.ada }), 422, 'validation_failed');
    }
  }
  expectErr(await http('GET', '/statement'), 401, 'unauthenticated');
  expectErr(await http('GET', '/statement', { token: 'bogus' }), 401, 'unauthenticated');
});

test('Statement: a user with no payments / a new account: opening == closing == balance, no entries, still returns a snapshot token', async () => {
  const { t } = await setup(fixtureS());
  const s = await http('POST', '/auth/signup', { body: { email: 'nobody@example.com', password: 'longenough1', display_name: 'N' } });
  const r = await stmt(s.json.token);
  assert.deepEqual(r.entries, []); assert.equal(r.opening_balance, 0); assert.equal(r.closing_balance, 0); assert.equal(r.has_more, false);
  assert.equal(typeof r.snapshot, 'string');
});

test('Statement: future from/to are allowed (to in the future = everything up to then)', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const s = await stmt(t.ada, { to: at(now + 400 * DAY) });
  assert.equal(s.entries.length, 3); assert.equal(s.closing_balance, 10000);
  const f = await stmt(t.ada, { from: at(now + DAY) });
  assert.deepEqual(f.entries, []); assert.equal(f.opening_balance, 10000); assert.equal(f.closing_balance, 10000);
});

// ---------------- snapshots ----------------

test('Snapshots: first response returns an opaque token; paging it returns slices of the exact frozen result', async () => {
  const now = Date.now();
  const { fx } = buildFx(OPEN3, manyPayments(now));
  const { t } = await setup(fx);
  const first = await stmt(t.ada, { limit: 3 });
  assert.equal(typeof first.snapshot, 'string');
  const full = await stmt(t.ada, { limit: 200 });
  assert.notEqual(full.snapshot, first.snapshot, 'every read gets its own token');
  const total = full.entries.length;
  let off = 0; const got = [];
  for (;;) {
    const p = await stmt(t.ada, { snapshot: first.snapshot, limit: 3, offset: off });
    assert.equal(p.opening_balance, full.opening_balance); assert.equal(p.closing_balance, full.closing_balance);
    assert.deepEqual(p.entries, full.entries.slice(off, off + 3));
    assert.equal(p.has_more, off + 3 < total);
    got.push(...p.entries);
    if (!p.has_more) break; off += 3;
  }
  assert.deepEqual(got, full.entries);
  for (const o of [total, total + 7]) { const p = await stmt(t.ada, { snapshot: first.snapshot, limit: 5, offset: o }); assert.deepEqual(p.entries, []); assert.equal(p.has_more, false); assert.equal(p.closing_balance, full.closing_balance); }
  // the same token can be paged repeatedly and in any order
  const again = await stmt(t.ada, { snapshot: first.snapshot, limit: 2, offset: 4 });
  assert.deepEqual(again.entries, full.entries.slice(4, 6));
  // default limit applies when omitted
  assert.equal((await stmt(t.ada, { snapshot: first.snapshot })).entries.length, Math.min(50, total));
});

test('Snapshots: stay frozen after new payments, corrections and lifecycle actions; new reads see the changes', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const snap = await stmt(t.ada, { limit: 2 });
  const before = await stmt(t.ada, { snapshot: snap.snapshot, limit: 200 });
  assert.equal(before.entries.length, 3);
  await sleep(1100);
  assert.equal((await pay(t.ada, { to_handle: 'bob', amount: 11 })).status, 201);
  assert.equal((await pay(t.bob, { to_handle: 'ada', amount: 5 })).status, 201);
  const p1 = (await get(t.ada, '/activity?limit=200')).json.payments.find((p) => p.note === 'one');
  const c = await correct(t.ada, p1.payment_id, { expected_revision: 1, amount: 450, effective_at: at(now - 5 * DAY), reason: 'typo' });
  assert.equal(c.status, 201, c.text);
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 100 })).json;
  await capture(t.bob, a.authorization_id, { amount: 40 });
  const a2 = (await mkAuth(t.ada, { to_handle: 'bob', amount: 100 })).json;
  await voidAuth(t.ada, a2.authorization_id);
  const after = await stmt(t.ada, { snapshot: snap.snapshot, limit: 200 });
  assert.deepEqual(after.entries, before.entries, 'entries frozen');
  assert.equal(after.opening_balance, before.opening_balance); assert.equal(after.closing_balance, before.closing_balance);
  const paged = await stmt(t.ada, { snapshot: snap.snapshot, limit: 2, offset: 2 });
  assert.deepEqual(paged.entries, before.entries.slice(2)); assert.equal(paged.has_more, false);
  // a fresh read reflects everything
  const fresh = await stmt(t.ada, { limit: 200 });
  assert.ok(fresh.entries.length > 3);
  assert.notEqual(fresh.closing_balance, before.closing_balance);
  assert.equal(fresh.entries.find((e) => e.payment.note === 'one').payment.amount, 450);
  assert.equal(before.entries.find((e) => e.payment.note === 'one').payment.amount, 500, 'frozen result keeps the old selected revision');
});

test('Snapshots: default `to` (now) is frozen — payments after the first read never appear while paging', async () => {
  const { t } = await setup(fixtureS());
  const snap = await stmt(t.ada, { limit: 1 });
  await sleep(1100);
  await pay(t.ada, { to_handle: 'bob', amount: 1 });
  await sleep(1100);
  const all = await stmtAll(t.ada, { snapshot: snap.snapshot }, 1);
  assert.equal(all.entries.length, 3);
  assert.equal(all.first.closing_balance, 10000);
});

test('Snapshots: only limit and offset may accompany a token — from, to or known_at -> 422 validation_failed', async () => {
  const { t } = await setup(fixtureS());
  const { snapshot } = await stmt(t.ada);
  for (const [k, v] of [['from', at(Date.now() - DAY)], ['to', at(Date.now())], ['known_at', at(Date.now())], ['from', 'garbage']]) {
    expectErr(await stmtQ(t.ada, { snapshot, [k]: v }), 422, 'validation_failed');
  }
  expectErr(await stmtQ(t.ada, { snapshot, from: at(Date.now() - DAY), to: at(Date.now()) }), 422, 'validation_failed');
  expectErr(await stmtQ(t.ada, { snapshot, limit: 0 }), 422, 'validation_failed');
  expectErr(await stmtQ(t.ada, { snapshot, limit: 201 }), 422, 'validation_failed');
  expectErr(await stmtQ(t.ada, { snapshot, offset: -1 }), 422, 'validation_failed');
  expectErr(await stmtQ(t.ada, { snapshot, limit: '4.0' }), 422, 'validation_failed');
  assert.equal((await http('GET', `/statement?snapshot=${encodeURIComponent(snapshot)}&limit=2&offset=1&unrecognised=1`, { token: t.ada })).status, 200);
});

test('Snapshots: unknown token, another user\'s token, a token from before reset -> 404 not_found; no bearer -> 401', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { snapshot } = await stmt(t.ada);
  expectErr(await stmtQ(t.ada, { snapshot: 'not-a-real-token' }), 404, 'not_found');
  expectErr(await stmtQ(t.ada, { snapshot: '' }), 404, 'not_found');
  expectErr(await stmtQ(t.bob, { snapshot }), 404, 'not_found');
  expectErr(await stmtQ(t.op, { snapshot }), 404, 'not_found');
  expectErr(await http('GET', `/statement?snapshot=${encodeURIComponent(snapshot)}`), 401, 'unauthenticated');
  assert.equal((await stmtQ(t.ada, { snapshot })).status, 200, 'owner still can use it');
  // reset (same fixture -> same ids): old token is gone
  const { t: t2 } = await setup(fixtureS(now));
  expectErr(await stmtQ(t2.ada, { snapshot }), 404, 'not_found');
});

test('Snapshots last until reset: still valid after many operations, and per-user tokens do not collide', async () => {
  const { t } = await setup(fixtureS());
  const sa = await stmt(t.ada), sb = await stmt(t.bob);
  for (let i = 0; i < 5; i++) { await pay(t.ada, { to_handle: 'bob', amount: 1 }); }
  assert.equal((await stmt(t.ada, { snapshot: sa.snapshot })).entries.length, 3);
  assert.equal((await stmt(t.bob, { snapshot: sb.snapshot })).entries.length, 2);
  expectErr(await stmtQ(t.ada, { snapshot: sb.snapshot }), 404, 'not_found');
});

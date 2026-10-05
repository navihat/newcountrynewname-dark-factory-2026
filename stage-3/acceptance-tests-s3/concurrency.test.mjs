import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  http, fixture, user, setup, balance, expectErr, pay, get, uniq, sleep, HOUR, DAY,
  mkAuth, capture, voidAuth, me, auths, at, ms, meAt, stmt, correct, revisions, fixtureS, sumView, assertMeInvariants,
} from './lib.mjs';

const no5xx = (rs) => assert.ok(rs.every((r) => r.status < 500), `5xx: ${rs.filter((r) => r.status >= 500).map((r) => r.text).join(' | ')}`);
const TOTAL = 10000 + 2500 + 500 + 100000;
const ALL = ['ada', 'bob', 'cy', 'dee', 'op'];

function sampler(tokens) {
  let stop = false; const violations = []; let n = 0;
  const loop = (async () => {
    while (!stop) {
      const rs = await Promise.all(tokens.map((tk) => http('GET', '/me', { token: tk })));
      n++;
      for (const r of rs) {
        if (r.status !== 200) { violations.push(`status ${r.status}`); continue; }
        const m = r.json;
        if (m.balance !== m.total || m.available !== m.total - m.held || m.available < 0 || m.held < 0 || m.total < 0) violations.push(JSON.stringify(m));
      }
    }
  })();
  return { async finish() { stop = true; await loop; return { violations, n }; } };
}
function checkStatement(s, label = 'statement') {
  assert.equal(s.opening_balance + s.entries.reduce((a, e) => a + e.delta, 0), s.closing_balance, `${label}: identity`);
  let run = s.opening_balance;
  for (const e of s.entries) { run += e.delta; assert.equal(e.balance_after, run, `${label}: balance_after chain`); assert.ok(e.balance_after >= 0, `${label}: nonnegative`); }
}

test('Concurrency: 25 parallel corrections with the SAME expected_revision (distinct keys) — exactly one succeeds, the rest are stale_revision', async () => {
  const { t } = await setup();
  const P = (await pay(t.ada, { to_handle: 'bob', amount: 1000 })).json;
  await sleep(1100);
  const eff = P.created_at;
  const sm = sampler([t.ada, t.bob]);
  const rs = await Promise.all(Array.from({ length: 25 }, (_, i) => correct(t.ada, P.payment_id, { expected_revision: 1, amount: 100 + i * 10, effective_at: eff, reason: `r${i}` })));
  const { violations } = await sm.finish();
  assert.deepEqual(violations, []);
  no5xx(rs);
  assert.equal(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.status).join(','));
  for (const r of rs.filter((x) => x.status !== 201)) expectErr(r, 409, 'stale_revision');
  const win = rs.find((r) => r.status === 201).json;
  assert.equal(win.revision, 2);
  const revs = (await revisions(t.ada, P.payment_id)).json.revisions;
  assert.equal(revs.length, 2);
  assert.equal(revs[1].amount, win.amount);
  assert.equal(await balance(t.ada), 10000 - win.amount); assert.equal(await balance(t.bob), 2500 + win.amount);
});

test('Concurrency: 25 identical corrections with ONE key — exactly one 201, others 200 with the same body, one revision', async () => {
  const { t } = await setup();
  const P = (await pay(t.ada, { to_handle: 'bob', amount: 1000 })).json;
  await sleep(1100);
  const key = uniq('c');
  const body = { expected_revision: 1, amount: 600, effective_at: P.created_at, reason: 'same' };
  const rs = await Promise.all(Array.from({ length: 25 }, () => correct(t.ada, P.payment_id, body, key)));
  no5xx(rs);
  const created = rs.filter((r) => r.status === 201);
  assert.equal(created.length, 1);
  for (const r of rs) { assert.ok(r.status === 200 || r.status === 201, r.text); assert.deepEqual(r.json, created[0].json); }
  assert.equal((await revisions(t.ada, P.payment_id)).json.revisions.length, 2);
  assert.equal(await balance(t.ada), 9600);
});

test('Concurrency: a chain of competing correction rounds — each round exactly one winner, revisions strictly sequential, recorded_at strictly increasing', async () => {
  const { t } = await setup();
  const P = (await pay(t.ada, { to_handle: 'bob', amount: 500 })).json;
  await sleep(1100);
  let rev = 1;
  for (let round = 0; round < 5; round++) {
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => correct(t.ada, P.payment_id, { expected_revision: rev, amount: 100 + round * 50 + i, effective_at: P.created_at, reason: `round${round}` })));
    no5xx(rs);
    assert.equal(rs.filter((r) => r.status === 201).length, 1);
    rev += 1;
  }
  const revs = (await revisions(t.ada, P.payment_id)).json.revisions;
  assert.deepEqual(revs.map((r) => r.revision), [1, 2, 3, 4, 5, 6]);
  for (let i = 1; i < revs.length; i++) assert.ok(Date.parse(revs[i].recorded_at) >= Date.parse(revs[i - 1].recorded_at));
  const last = revs[5];
  assert.equal(await balance(t.ada), 10000 - last.amount);
  assert.equal(await balance(t.ada) + await balance(t.bob), 12500);
});

test('Concurrency: corrections racing payments from the same wallet — never negative, money conserved, outcome equals some serial order', async () => {
  for (let round = 0; round < 3; round++) {
    const { t } = await setup(); // dee has 500
    const P = (await pay(t.dee, { to_handle: 'bob', amount: 100 })).json; // dee 400
    await sleep(1100);
    const calls = [correct(t.dee, P.payment_id, { expected_revision: 1, amount: 400, effective_at: P.created_at, reason: 'raise' })];
    for (let i = 0; i < 20; i++) calls.push(pay(t.dee, { to_handle: 'cy', amount: 30 }));
    const sm = sampler([t.dee, t.bob, t.cy]);
    const rs = await Promise.all(calls);
    const { violations } = await sm.finish();
    assert.deepEqual(violations, []);
    no5xx(rs);
    const corrOk = rs[0].status === 201;
    if (!corrOk) assert.ok(rs[0].status === 409 && ['insufficient_funds', 'historical_overdraft'].includes(rs[0].json.error.code), rs[0].text);
    const okPays = rs.slice(1).filter((r) => r.status === 201).length;
    for (const r of rs.slice(1).filter((x) => x.status !== 201)) expectErr(r, 409, 'insufficient_funds');
    const spent = 100 + (corrOk ? 300 : 0) + okPays * 30;
    assert.ok(spent <= 500);
    assert.equal(await balance(t.dee), 500 - spent);
    assert.equal(okPays, Math.floor((500 - 100 - (corrOk ? 300 : 0)) / 30), 'maximal serial outcome');
    const tokens = ALL.map((h) => t[h]);
    assert.equal(await sumView(tokens, {}), TOTAL);
    assert.equal(await sumView(tokens, { as_of: at(Date.now() + DAY) }), TOTAL);
  }
});

test('Concurrency: corrections racing authorizations — available never negative; holds + corrections respect each other', async () => {
  const { t } = await setup();
  const P = (await pay(t.ada, { to_handle: 'bob', amount: 1000 })).json; // ada 9000
  await sleep(1100);
  const calls = [];
  for (let i = 0; i < 12; i++) calls.push(mkAuth(t.ada, { to_handle: 'cy', amount: 700 }));
  for (let i = 0; i < 6; i++) calls.push(correct(t.ada, P.payment_id, { expected_revision: 1, amount: 1000 + (i + 1) * 100, effective_at: P.created_at, reason: `up${i}` }));
  const sm = sampler([t.ada, t.bob, t.cy]);
  const rs = await Promise.all(calls);
  const { violations } = await sm.finish();
  assert.deepEqual(violations, []);
  no5xx(rs);
  const holds = rs.slice(0, 12).filter((r) => r.status === 201).length;
  const corr = rs.slice(12).filter((r) => r.status === 201);
  assert.ok(corr.length <= 1, 'at most one correction wins revision 1');
  for (const r of rs.slice(0, 12).filter((x) => x.status !== 201)) expectErr(r, 409, 'insufficient_funds');
  for (const r of rs.slice(12).filter((x) => x.status !== 201)) assert.ok(r.status === 409 && ['stale_revision', 'insufficient_funds', 'historical_overdraft'].includes(r.json.error.code), r.text);
  const m = await me(t.ada); assertMeInvariants(m);
  const amount = corr.length ? corr[0].json.amount : 1000;
  assert.equal(m.total, 10000 - amount);
  assert.equal(m.held, holds * 700);
  assert.ok(m.available >= 0);
  assert.equal(await sumView(ALL.map((h) => t[h]), {}), TOTAL);
});

test('Concurrency: a statement snapshot stays byte-for-byte stable while payments, corrections, captures and voids happen in parallel', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const feed = (await get(t.ada, '/activity?limit=200')).json.payments;
  const p1 = feed.find((p) => p.note === 'one').payment_id, p3 = feed.find((p) => p.note === 'three').payment_id;
  const snap = await stmt(t.ada, { limit: 1 });
  const frozen = await stmt(t.ada, { snapshot: snap.snapshot, limit: 200 });
  assert.equal(frozen.entries.length, 3);
  await sleep(1100);
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 1000 })).json;
  const a2 = (await mkAuth(t.ada, { to_handle: 'bob', amount: 500 })).json;
  let stop = false; const diffs = [];
  const pager = (async () => {
    while (!stop) {
      const all = await stmt(t.ada, { snapshot: snap.snapshot, limit: 200 });
      if (JSON.stringify(all.entries) !== JSON.stringify(frozen.entries) || all.opening_balance !== frozen.opening_balance || all.closing_balance !== frozen.closing_balance) diffs.push(all);
      const p = await stmt(t.ada, { snapshot: snap.snapshot, limit: 2, offset: 1 });
      if (JSON.stringify(p.entries) !== JSON.stringify(frozen.entries.slice(1, 3)) || p.has_more !== false) diffs.push(p);
    }
  })();
  const calls = [];
  for (let i = 0; i < 20; i++) calls.push(pay(t.ada, { to_handle: 'zed', amount: 1 }), pay(t.bob, { to_handle: 'ada', amount: 1 }));
  calls.push(correct(t.ada, p1, { expected_revision: 1, amount: 450, effective_at: at(now - 5 * DAY), reason: 'a' }));
  calls.push(correct(t.ada, p3, { expected_revision: 1, amount: 290, effective_at: at(now - 3 * DAY), reason: 'b' }));
  calls.push(capture(t.bob, a.authorization_id, { amount: 300 }), voidAuth(t.ada, a2.authorization_id));
  const rs = await Promise.all(calls);
  stop = true; await pager;
  no5xx(rs);
  assert.deepEqual(diffs, [], 'snapshot paging changed during concurrent writes');
  const fresh = await stmt(t.ada, { limit: 200 });
  checkStatement(fresh, 'fresh');
  assert.ok(fresh.entries.length > frozen.entries.length);
});

test('Concurrency: statements read during a write storm are internally consistent (identity, balance_after chain, nonnegative) and snapshots resolve', async () => {
  const { t } = await setup(fixtureS());
  const calls = []; const reads = [];
  for (let i = 0; i < 25; i++) calls.push(pay(t.ada, { to_handle: 'bob', amount: 5 }), pay(t.bob, { to_handle: 'ada', amount: 3 }));
  for (let i = 0; i < 25; i++) reads.push(stmt(t.ada, { limit: 10, offset: (i % 3) * 5 }), stmt(t.bob, { limit: 200 }));
  const [rs, rd] = await Promise.all([Promise.all(calls), Promise.all(reads)]);
  no5xx(rs);
  for (const s of rd) {
    assert.ok(s.opening_balance >= 0 && s.closing_balance >= 0);
    let run = null;
    for (const e of s.entries) { assert.ok(e.balance_after >= 0); if (run !== null) assert.equal(e.balance_after, run + e.delta); run = e.balance_after; }
    assert.equal(typeof s.snapshot, 'string');
  }
  // full pages from a snapshot taken mid-storm are self-consistent
  const full = await stmt(t.bob, { limit: 200 });
  checkStatement(full, 'bob');
  const all = await stmt(t.ada, { limit: 200 });
  checkStatement(all, 'ada');
  assert.equal(all.closing_balance, await balance(t.ada));
  assert.equal(full.closing_balance, await balance(t.bob));
});

test('Concurrency: parallel corrections on different payments by different senders — all independent ones succeed; history stays conserved', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const feed = (await get(t.ada, '/activity?limit=200')).json.payments;
  const id = (n) => feed.find((p) => p.note === n).payment_id;
  await sleep(1100);
  const rs = await Promise.all([
    correct(t.ada, id('one'), { expected_revision: 1, amount: 450, effective_at: at(now - 5 * DAY), reason: 'a' }),
    correct(t.bob, id('two'), { expected_revision: 1, amount: 1100, effective_at: at(now - 4 * DAY), reason: 'b' }),
    correct(t.ada, id('three'), { expected_revision: 1, amount: 250, effective_at: at(now - 3 * DAY), reason: 'c' }),
    correct(t.cy, id('four'), { expected_revision: 1, amount: 80, effective_at: at(now - 2 * DAY), reason: 'd' }),
  ]);
  no5xx(rs);
  for (const r of rs) assert.equal(r.status, 201, r.text);
  const tokens = ['ada', 'bob', 'cy', 'dee', 'op', 'zed'].map((h) => t[h]);
  const sums = await Promise.all([now - 10 * DAY, now - 4 * DAY, now].map((a) => sumView(tokens, { as_of: at(a) })));
  for (const s of sums) assert.equal(s, 10000 + 2500 + 200 + 500 + 100000);
  for (const h of ['ada', 'bob', 'cy', 'dee']) checkStatement(await stmt(t[h]), h);
});

test('Concurrency: expected-revision race between two senders views — receiver cannot correct; only the sender\'s one winner is recorded', async () => {
  const { t } = await setup();
  const P = (await pay(t.ada, { to_handle: 'bob', amount: 300 })).json;
  await sleep(1100);
  const calls = [];
  for (let i = 0; i < 10; i++) { calls.push(correct(t.ada, P.payment_id, { expected_revision: 1, amount: 200 + i, effective_at: P.created_at, reason: 'x' })); calls.push(correct(t.bob, P.payment_id, { expected_revision: 1, amount: 100, effective_at: P.created_at, reason: 'y' })); }
  const rs = await Promise.all(calls);
  no5xx(rs);
  assert.equal(rs.filter((_, i) => i % 2 === 0).filter((r) => r.status === 201).length, 1);
  for (const r of rs.filter((_, i) => i % 2 === 1)) expectErr(r, 403, 'forbidden');
  assert.equal((await revisions(t.bob, P.payment_id)).json.revisions.length, 2);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  http, fixture, setup, balance, expectErr, pay, get, uniq, sleep, DAY,
  mkAuth, capture, me, at, ms, meAt, stmt, correct, revisions, refund, batch, bItem, sumView, assertMeInvariants,
} from './lib.mjs';

const TOTAL = 10000 + 2500 + 500 + 100000;
const ALL = ['ada', 'bob', 'cy', 'dee', 'op'];
const no5xx = (rs) => assert.ok(rs.every((r) => r.status < 500), `5xx: ${rs.filter((r) => r.status >= 500).map((r) => r.text).join(' | ')}`);
const mkP = async (t, from, to, amount) => (await pay(t[from], { to_handle: to, amount })).json;

function sampler(tokens) {
  let stop = false; const violations = [];
  const loop = (async () => {
    while (!stop) {
      const rs = await Promise.all(tokens.map((tk) => http('GET', '/me', { token: tk })));
      for (const r of rs) {
        if (r.status !== 200) { violations.push(`status ${r.status}`); continue; }
        const m = r.json;
        if (m.balance !== m.total || m.available !== m.total - m.held || m.available < 0 || m.held < 0 || m.total < 0) violations.push(JSON.stringify(m));
      }
    }
  })();
  return { async finish() { stop = true; await loop; return violations; } };
}

test('Concurrency: 30 parallel refunds with distinct keys never exceed the cumulative limit (exactly 10 x 100 of 1000)', async () => {
  const { t } = await setup();
  const P = await mkP(t, 'ada', 'bob', 1000);
  const sm = sampler([t.ada, t.bob]);
  const rs = await Promise.all(Array.from({ length: 30 }, () => refund(t.bob, P.payment_id, { amount: 100 })));
  assert.deepEqual(await sm.finish(), []);
  no5xx(rs);
  assert.equal(rs.filter((r) => r.status === 201).length, 10, rs.map((r) => r.status).join(','));
  for (const r of rs.filter((x) => x.status !== 201)) expectErr(r, 422, 'refund_exceeds_payment');
  assert.equal(await balance(t.ada), 10000); assert.equal(await balance(t.bob), 2500);
  assert.equal((await get(t.ada, '/activity?limit=200')).json.payments.filter((p) => p.refund_of === P.payment_id).length, 10);
});

test('Concurrency: refunds of mixed sizes — the sum of successful refunds never exceeds the payment; balances match', async () => {
  const { t } = await setup();
  const P = await mkP(t, 'ada', 'bob', 1000);
  const sizes = Array.from({ length: 30 }, (_, i) => 20 + (i % 9) * 35);
  const rs = await Promise.all(sizes.map((a) => refund(t.bob, P.payment_id, { amount: a })));
  no5xx(rs);
  const sum = rs.reduce((s, r, i) => s + (r.status === 201 ? sizes[i] : 0), 0);
  assert.ok(sum <= 1000, `refunded ${sum}`);
  for (const r of rs.filter((x) => x.status !== 201)) expectErr(r, 422, 'refund_exceeds_payment');
  assert.equal(await balance(t.ada), 9000 + sum); assert.equal(await balance(t.bob), 3500 - sum);
  assert.equal(await sumView(ALL.map((h) => t[h]), {}), TOTAL);
});

test('Concurrency: refunds racing a correction of the same payment — refunded never exceeds the corrected amount; outcome equals a serial order', async () => {
  for (let round = 0; round < 4; round++) {
    const { t } = await setup();
    const P = await mkP(t, 'ada', 'bob', 1000);
    await sleep(1100);
    const calls = [correct(t.ada, P.payment_id, { expected_revision: 1, amount: 300, effective_at: P.created_at, reason: 'down' })];
    for (let i = 0; i < 10; i++) calls.push(refund(t.bob, P.payment_id, { amount: 100 }));
    const sm = sampler([t.ada, t.bob]);
    const rs = await Promise.all(calls);
    assert.deepEqual(await sm.finish(), []);
    no5xx(rs);
    const corrOk = rs[0].status === 201;
    if (!corrOk) assert.ok(rs[0].status === 422 && rs[0].json.error.code === 'refund_exceeds_payment', rs[0].text);
    const okR = rs.slice(1).filter((r) => r.status === 201).length;
    const finalAmount = corrOk ? 300 : 1000;
    assert.ok(okR * 100 <= finalAmount, `refunded ${okR * 100} > amount ${finalAmount}`);
    for (const r of rs.slice(1).filter((x) => x.status !== 201)) expectErr(r, 422, 'refund_exceeds_payment');
    assert.equal(okR, finalAmount / 100 > 10 ? 10 : Math.min(10, finalAmount / 100), 'maximal serial outcome');
    assert.equal(await balance(t.ada), 10000 - finalAmount + okR * 100);
    assert.equal(await balance(t.bob), 2500 + finalAmount - okR * 100);
    assert.equal(await sumView(ALL.map((h) => t[h]), {}), TOTAL);
  }
});

test('Concurrency: 20 batches sharing one expected revision (each with its own extra payment) — exactly one succeeds', async () => {
  const { t } = await setup();
  const shared = await mkP(t, 'ada', 'bob', 500);
  const own = []; for (let i = 0; i < 20; i++) own.push(await mkP(t, 'ada', 'cy', 10));
  await sleep(1100);
  const sm = sampler([t.ada, t.bob, t.cy]);
  const rs = await Promise.all(own.map((o, i) => batch(t.op, { corrections: [bItem(shared.payment_id, { amount: 100 + i, effective_at: shared.created_at }), bItem(o.payment_id, { amount: 5, effective_at: o.created_at })] })));
  assert.deepEqual(await sm.finish(), []);
  no5xx(rs);
  assert.equal(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.status).join(','));
  for (const r of rs.filter((x) => x.status !== 201)) expectErr(r, 409, 'stale_revision');
  const winner = rs.findIndex((r) => r.status === 201);
  const revs = (await revisions(t.ada, shared.payment_id)).json.revisions;
  assert.equal(revs.length, 2); assert.equal(revs[1].amount, 100 + winner);
  // only the winner's own payment was corrected
  for (let i = 0; i < own.length; i++) assert.equal((await revisions(t.ada, own[i].payment_id)).json.revisions.length, i === winner ? 2 : 1, `own ${i}`);
  assert.equal(await sumView(ALL.map((h) => t[h]), {}), TOTAL);
});

test('Concurrency: overlapping batches ([A,B] vs [B,C]) share B — exactly one succeeds', async () => {
  const { t } = await setup();
  const A = await mkP(t, 'ada', 'bob', 100), B = await mkP(t, 'ada', 'cy', 100), C = await mkP(t, 'ada', 'dee', 100);
  await sleep(1100);
  const e = (p, amount) => bItem(p.payment_id, { amount, effective_at: p.created_at });
  const rs = await Promise.all([batch(t.op, { corrections: [e(A, 50), e(B, 50)] }), batch(t.op, { corrections: [e(B, 60), e(C, 60)] }), batch(t.op, { corrections: [e(C, 70)] })]);
  no5xx(rs);
  const ok = rs.map((r, i) => (r.status === 201 ? i : -1)).filter((i) => i >= 0);
  assert.ok(ok.length >= 1 && ok.length <= 2, rs.map((r) => r.status).join(','));
  assert.ok(!(ok.includes(0) && ok.includes(1)), 'batches sharing B cannot both succeed');
  assert.ok(!(ok.includes(1) && ok.includes(2)), 'batches sharing C cannot both succeed');
  for (const r of rs.filter((x) => x.status !== 201)) expectErr(r, 409, 'stale_revision');
  for (const p of [A, B, C]) assert.ok((await revisions(t.ada, p.payment_id)).json.revisions.length <= 2);
  assert.equal(await sumView(ALL.map((h) => t[h]), {}), TOTAL);
});

test('Concurrency: batch vs single correction on the same payment (10 each, same expected revision) — exactly one winner overall', async () => {
  const { t } = await setup();
  const P = await mkP(t, 'ada', 'bob', 800);
  await sleep(1100);
  const calls = [];
  for (let i = 0; i < 10; i++) {
    calls.push(correct(t.ada, P.payment_id, { expected_revision: 1, amount: 100 + i, effective_at: P.created_at, reason: 's' }));
    calls.push(batch(t.op, { corrections: [bItem(P.payment_id, { amount: 200 + i, effective_at: P.created_at })] }));
  }
  const rs = await Promise.all(calls);
  no5xx(rs);
  assert.equal(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.status).join(','));
  for (const r of rs.filter((x) => x.status !== 201)) expectErr(r, 409, 'stale_revision');
  const revs = (await revisions(t.ada, P.payment_id)).json.revisions;
  assert.equal(revs.length, 2);
  assert.equal(await balance(t.ada), 10000 - revs[1].amount);
  const winner = rs.findIndex((r) => r.status === 201);
  assert.equal(winner % 2 === 1 ? revs[1].correction_batch_id !== undefined && revs[1].correction_batch_id !== null : !revs[1].correction_batch_id, true, 'batch id present iff the batch won');
});

test('Concurrency: 20 identical batches with ONE key — exactly one 201, others 200 with the same body; effect once', async () => {
  const { t } = await setup();
  const P = await mkP(t, 'ada', 'bob', 500); await sleep(1100);
  const key = uniq('b');
  const body = { corrections: [bItem(P.payment_id, { amount: 200, effective_at: P.created_at })] };
  const rs = await Promise.all(Array.from({ length: 20 }, () => batch(t.op, body, key)));
  no5xx(rs);
  const created = rs.filter((r) => r.status === 201);
  assert.equal(created.length, 1);
  for (const r of rs) { assert.ok(r.status === 200 || r.status === 201); assert.deepEqual(r.json, created[0].json); }
  assert.equal((await revisions(t.ada, P.payment_id)).json.revisions.length, 2);
  assert.equal(await balance(t.ada), 9800);
});

test('Concurrency: 20 identical refunds / 20 identical batch+refund mixes with one key each stay single-effect', async () => {
  const { t } = await setup();
  const P = await mkP(t, 'ada', 'bob', 1000); await sleep(1100);
  const rk = uniq('r'), bk = uniq('b');
  const calls = [];
  for (let i = 0; i < 20; i++) { calls.push(refund(t.bob, P.payment_id, { amount: 100 }, rk)); calls.push(batch(t.op, { corrections: [bItem(P.payment_id, { amount: 900, effective_at: P.created_at })] }, bk)); }
  const rs = await Promise.all(calls);
  no5xx(rs);
  // each key has exactly one creator unless the batch was refused because of the refund race (refund_exceeds_payment is impossible here: 100 <= 900)
  assert.equal(rs.filter((r, i) => i % 2 === 0 && r.status === 201).length, 1);
  assert.equal(rs.filter((r, i) => i % 2 === 1 && r.status === 201).length, 1);
  const feed = (await get(t.ada, '/activity?limit=200')).json.payments;
  assert.equal(feed.filter((p) => p.refund_of === P.payment_id).length, 1);
  assert.equal(await balance(t.ada), 10000 - 900 + 100); assert.equal(await balance(t.bob), 2500 + 900 - 100);
});

test('Concurrency storm: payments, refunds, single and batch corrections, authorizations and captures in parallel — invariants hold at every read, no 5xx', async () => {
  const { t } = await setup();
  const base = []; for (let i = 0; i < 6; i++) base.push(await mkP(t, 'ada', 'bob', 200));
  const extra = []; for (let i = 0; i < 6; i++) extra.push(await mkP(t, 'bob', 'cy', 50));
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 1000 })).json;
  await sleep(1100);
  const sm = sampler([t.ada, t.bob, t.cy, t.dee, t.op]);
  const calls = [];
  base.forEach((p, i) => {
    calls.push(refund(t.bob, p.payment_id, { amount: 50 + i * 10 }));
    calls.push(refund(t.bob, p.payment_id, { amount: 90 }));
    if (i % 2) calls.push(batch(t.op, { corrections: [bItem(p.payment_id, { amount: 120, effective_at: p.created_at }), bItem(extra[i].payment_id, { amount: 20, effective_at: extra[i].created_at })] }));
    else calls.push(correct(t.ada, p.payment_id, { expected_revision: 1, amount: 150, effective_at: p.created_at, reason: 's' }));
    calls.push(pay(t.ada, { to_handle: 'dee', amount: 30 }));
    calls.push(mkAuth(t.bob, { to_handle: 'cy', amount: 100 }));
  });
  calls.push(capture(t.bob, a.authorization_id, { amount: 400 }));
  const rs = await Promise.all(calls);
  assert.deepEqual(await sm.finish(), []);
  no5xx(rs);
  const tokens = ALL.map((h) => t[h]);
  assert.equal(await sumView(tokens, {}), TOTAL);
  for (const off of [-400 * DAY, 0, DAY]) assert.equal(await sumView(tokens, { as_of: at(Date.now() + off) }), TOTAL);
  // refunds never exceed the (corrected) amount of their payment
  const feed = (await get(t.bob, '/activity?limit=200')).json.payments;
  for (const p of base) {
    const refunded = feed.filter((x) => x.refund_of === p.payment_id).reduce((s, x) => s + x.amount, 0);
    const revs = (await revisions(t.ada, p.payment_id)).json.revisions;
    assert.ok(refunded <= revs[revs.length - 1].amount, `payment ${p.payment_id}: refunded ${refunded} > ${revs[revs.length - 1].amount}`);
  }
  for (const h of ['ada', 'bob']) { const s = await stmt(t[h], { limit: 200 }); assert.equal(s.opening_balance + s.entries.reduce((x, e) => x + e.delta, 0), s.closing_balance); let run = s.opening_balance; for (const e of s.entries) { run += e.delta; assert.equal(e.balance_after, run); assert.ok(e.balance_after >= 0); } }
});

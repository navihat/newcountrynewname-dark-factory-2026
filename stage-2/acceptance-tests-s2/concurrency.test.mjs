import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  http, fixture, user, setup, balance, totalBalance, expectErr, pay, get, uniq,
  sleep, mkAuth, capture, voidAuth, me, auths, authById, assertMeInvariants, expectMe,
} from './lib.mjs';

const TOTAL = 10000 + 2500 + 500 + 100000;
const no5xx = (rs) => assert.ok(rs.every((r) => r.status < 500), `5xx: ${rs.filter((r) => r.status >= 500).map((r) => r.text).join(' | ')}`);

/** background sampler: keeps reading /me for the given tokens and records invariant violations */
function sampler(tokens) {
  let stop = false; const violations = []; let n = 0;
  const loop = (async () => {
    while (!stop) {
      const ms = await Promise.all(tokens.map((tk) => http('GET', '/me', { token: tk })));
      n++;
      let sum = 0;
      for (const r of ms) {
        if (r.status !== 200) { violations.push(`status ${r.status}`); continue; }
        const m = r.json; sum += m.total;
        if (m.balance !== m.total) violations.push(`balance!=total ${JSON.stringify(m)}`);
        if (m.available !== m.total - m.held) violations.push(`available!=total-held ${JSON.stringify(m)}`);
        if (m.available < 0 || m.held < 0 || m.total < 0) violations.push(`negative ${JSON.stringify(m)}`);
      }
    }
  })();
  return { async finish() { stop = true; await loop; return { violations, n }; } };
}

test('Concurrency: 30 parallel DEFAULT captures (distinct keys) of one hold -> exactly one 201, rest authorization_not_open, money moves once', async () => {
  const { t } = await setup();
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 2000 })).json;
  const rs = await Promise.all(Array.from({ length: 30 }, () => capture(t.bob, a.authorization_id, { amount: 1500 })));
  no5xx(rs);
  assert.equal(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.status).join(','));
  for (const r of rs.filter((x) => x.status !== 201)) expectErr(r, 409, 'authorization_not_open');
  expectMe(await me(t.ada), { total: 8500, available: 8500, held: 0 });
  assert.equal(await balance(t.bob), 4000);
  assert.equal((await get(t.bob, '/activity?limit=200')).json.payments.length, 1);
});

test('Concurrency: 40 parallel extended captures of 100 against a 2000 hold -> exactly 20 succeed, cumulative never exceeds, then closed', async () => {
  const { t } = await setup();
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 2000 })).json;
  const sm = sampler([t.ada, t.bob, t.cy]);
  const rs = await Promise.all(Array.from({ length: 40 }, () => capture(t.bob, a.authorization_id, { amount: 100, final: false })));
  const { violations } = await sm.finish();
  assert.deepEqual(violations, []);
  no5xx(rs);
  assert.equal(rs.filter((r) => r.status === 201).length, 20, rs.map((r) => r.status).join(','));
  for (const r of rs.filter((x) => x.status !== 201)) {
    assert.ok((r.status === 422 && r.json.error.code === 'capture_exceeds_authorization') || (r.status === 409 && r.json.error.code === 'authorization_not_open'), r.text);
  }
  const rec = await authById(t.bob, a.authorization_id);
  assert.equal(rec.captured_amount, 2000); assert.equal(rec.remaining_amount, 0); assert.equal(rec.status, 'captured');
  assert.equal(rec.payment_ids.length, 20); assert.equal(new Set(rec.payment_ids).size, 20);
  expectMe(await me(t.ada), { total: 8000, available: 8000, held: 0 });
  assert.equal(await balance(t.bob), 4500);
});

test('Concurrency: racing captures of different sizes never over-capture the hold (sum of successful captures <= amount)', async () => {
  const { t } = await setup();
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 1000 })).json;
  const sizes = Array.from({ length: 30 }, (_, i) => 50 + (i % 7) * 30);
  const rs = await Promise.all(sizes.map((s) => capture(t.bob, a.authorization_id, { amount: s, final: false })));
  no5xx(rs);
  const ok = rs.map((r, i) => (r.status === 201 ? sizes[i] : 0)).reduce((x, y) => x + y, 0);
  assert.ok(ok <= 1000, `captured ${ok}`);
  const rec = await authById(t.bob, a.authorization_id);
  assert.equal(rec.captured_amount, ok);
  assert.equal(rec.remaining_amount, rec.status === 'open' ? 1000 - ok : 0);
  const m = await me(t.ada);
  assertMeInvariants(m);
  assert.equal(m.total, 10000 - ok);
  assert.equal(m.held, rec.remaining_amount);
  assert.equal(await totalBalance(t), TOTAL);
});

test('Concurrency: 20 identical captures with ONE key -> exactly one 201, others 200 with the same body, money once', async () => {
  const { t } = await setup();
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 2000 })).json;
  const key = uniq('cap');
  const rs = await Promise.all(Array.from({ length: 20 }, () => capture(t.bob, a.authorization_id, { amount: 700, final: false }, key)));
  no5xx(rs);
  const created = rs.filter((r) => r.status === 201);
  assert.equal(created.length, 1);
  for (const r of rs) { assert.ok([200, 201].includes(r.status), r.text); assert.deepEqual(r.json, created[0].json); }
  expectMe(await me(t.ada), { total: 9300, available: 8000, held: 1300 });
  assert.equal((await authById(t.bob, a.authorization_id)).payment_ids.length, 1);
});

test('Concurrency: 20 identical POST /authorizations with one key -> one hold, one 201', async () => {
  const { t } = await setup();
  const key = uniq('au');
  const rs = await Promise.all(Array.from({ length: 20 }, () => http('POST', '/authorizations', { token: t.ada, key, body: { to_handle: 'bob', amount: 500 } })));
  no5xx(rs);
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
  for (const r of rs) assert.deepEqual(r.json, rs.find((x) => x.status === 201).json);
  expectMe(await me(t.ada), { total: 10000, available: 9500, held: 500 });
});

test('Concurrency: capture vs void race (10 each, several rounds): one outcome wins; money and holds are consistent with it', async () => {
  for (let round = 0; round < 6; round++) {
    const { t } = await setup();
    const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 2000 })).json;
    const calls = [];
    for (let i = 0; i < 10; i++) { calls.push(capture(t.bob, a.authorization_id, { amount: 1500 })); calls.push(voidAuth(t.ada, a.authorization_id)); }
    const rs = await Promise.all(calls);
    no5xx(rs);
    const rec = await authById(t.ada, a.authorization_id);
    const caps = rs.filter((_, i) => i % 2 === 0), voids = rs.filter((_, i) => i % 2 === 1);
    if (rec.status === 'captured') {
      assert.equal(caps.filter((r) => r.status === 201).length, 1);
      assert.ok(voids.every((r) => r.status === 409));
      expectMe(await me(t.ada), { total: 8500, available: 8500, held: 0 });
      assert.equal(await balance(t.bob), 4000);
    } else {
      assert.equal(rec.status, 'voided');
      assert.ok(caps.every((r) => r.status === 409), 'captures after void are not_open');
      assert.ok(voids.every((r) => r.status === 200));
      expectMe(await me(t.ada), { total: 10000, available: 10000, held: 0 });
      assert.equal(await balance(t.bob), 2500);
    }
    assert.equal(await totalBalance(t), TOTAL);
  }
});

test('Concurrency: captures racing the expiry deadline: result is either captured once before the deadline or expired; never both, never 5xx', async () => {
  for (let round = 0; round < 3; round++) {
    const { t } = await setup(fixture({ authorization_ttl_seconds: 2 }));
    const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 2000 })).json;
    const deadline = Date.parse(a.expires_at);
    const calls = [];
    for (let i = 0; i < 40; i++) {
      const at = deadline - 600 + i * 30; // straddle the deadline
      calls.push((async () => { await sleep(Math.max(0, at - Date.now())); const r = await capture(t.bob, a.authorization_id, { amount: 500, final: false }); return r; })());
    }
    const rs = await Promise.all(calls);
    no5xx(rs);
    for (const r of rs.filter((x) => x.status !== 201)) {
      assert.ok(r.status === 409 && ['authorization_expired', 'authorization_not_open'].includes(r.json.error.code) || (r.status === 422 && r.json.error.code === 'capture_exceeds_authorization'), r.text);
    }
    await sleep(Math.max(0, deadline - Date.now()) + 600);
    const ok = rs.filter((r) => r.status === 201).length;
    const rec = await authById(t.ada, a.authorization_id);
    assert.ok(ok <= 4, 'at most 2000/500 captures');
    assert.equal(rec.captured_amount, ok * 500);
    assert.ok(['expired', 'captured'].includes(rec.status), rec.status);
    assert.equal(rec.remaining_amount, 0);
    expectMe(await me(t.ada), { total: 10000 - ok * 500, available: 10000 - ok * 500, held: 0 });
    assert.equal(await balance(t.bob), 2500 + ok * 500);
    assert.equal(await totalBalance(t), TOTAL);
    // successes must have been issued before the deadline
    for (const r of rs.filter((x) => x.status === 201)) assert.ok(Date.parse(r.json.created_at) <= deadline + 1000, 'capture created after deadline');
  }
});

test('Concurrency: 30 holds + 30 payments of 500 racing for a 10000 wallet: available never negative, totals conserved, no 5xx', async () => {
  const { t } = await setup();
  const sm = sampler([t.ada, t.bob, t.cy]);
  const calls = [];
  for (let i = 0; i < 30; i++) {
    calls.push(mkAuth(t.ada, { to_handle: 'bob', amount: 500 }));
    calls.push(pay(t.ada, { to_handle: 'cy', amount: 500 }));
  }
  const rs = await Promise.all(calls);
  const { violations, n } = await sm.finish();
  assert.deepEqual(violations, []);
  assert.ok(n >= 1);
  no5xx(rs);
  const holds = rs.filter((_, i) => i % 2 === 0), pays = rs.filter((_, i) => i % 2 === 1);
  const okH = holds.filter((r) => r.status === 201).length, okP = pays.filter((r) => r.status === 201).length;
  for (const r of rs.filter((x) => x.status !== 201)) expectErr(r, 409, 'insufficient_funds');
  assert.equal(okH + okP, 20, 'exactly 20 x 500 fit into 10000');
  expectMe(await me(t.ada), { total: 10000 - okP * 500, available: 10000 - okP * 500 - okH * 500, held: okH * 500 });
  assert.equal(await balance(t.cy), okP * 500);
  assert.equal(await totalBalance(t), TOTAL);
  assert.equal((await auths(t.ada, '?limit=200')).authorizations.length, okH);
});

test('Concurrency: payer spends available while receiver captures held funds — both can never exceed the wallet', async () => {
  const { t } = await setup(); // dee: 500
  const a = (await mkAuth(t.dee, { to_handle: 'bob', amount: 300 })).json; // available 200
  const calls = [];
  for (let i = 0; i < 20; i++) calls.push(pay(t.dee, { to_handle: 'cy', amount: 20 }));
  calls.push(capture(t.bob, a.authorization_id, {}));
  const sm = sampler([t.dee]);
  const rs = await Promise.all(calls);
  const { violations } = await sm.finish();
  assert.deepEqual(violations, []);
  no5xx(rs);
  assert.equal(rs[20].status, 201);
  assert.equal(rs.slice(0, 20).filter((r) => r.status === 201).length, 10, 'only the 200 available can be spent');
  expectMe(await me(t.dee), { total: 0, available: 0, held: 0 });
  assert.equal(await totalBalance(t), TOTAL);
});

test('Concurrency: request-pay and settlement racing a hold respect available; sum conserved', async () => {
  const { t } = await setup();
  const rq = [];
  for (let i = 0; i < 10; i++) rq.push((await http('POST', '/requests', { token: t.bob, key: uniq(), body: { payer_handle: 'dee', amount: 100 } })).json);
  const calls = [mkAuth(t.dee, { to_handle: 'cy', amount: 200 })];
  for (const r of rq) calls.push(http('POST', `/requests/${r.request_id}/pay`, { token: t.dee, key: uniq(), body: {} }));
  for (let i = 0; i < 5; i++) calls.push(http('POST', '/settlements', { token: t.op, key: uniq(), body: { transfers: [{ from_handle: 'dee', to_handle: 'cy', amount: 100 }] } }));
  const sm = sampler([t.dee, t.bob, t.cy]);
  const rs = await Promise.all(calls);
  const { violations } = await sm.finish();
  assert.deepEqual(violations, []);
  no5xx(rs);
  const m = await me(t.dee);
  assertMeInvariants(m);
  assert.equal(m.held, rs[0].status === 201 ? 200 : 0);
  assert.equal(await totalBalance(t), TOTAL);
});

test('Concurrency: continuous /me sampling during a mixed storm of holds, captures, voids and payments never sees a broken invariant', async () => {
  const { t } = await setup();
  const base = [];
  for (let i = 0; i < 8; i++) base.push((await mkAuth(t.ada, { to_handle: 'bob', amount: 300 })).json);
  const sm = sampler([t.ada, t.bob, t.cy, t.dee, t.op]);
  const calls = [];
  base.forEach((a, i) => {
    calls.push(capture(t.bob, a.authorization_id, { amount: 100 + i * 10, final: i % 2 === 0 }));
    calls.push(voidAuth(t.ada, a.authorization_id));
    calls.push(mkAuth(t.ada, { to_handle: 'cy', amount: 400 }));
    calls.push(pay(t.ada, { to_handle: 'dee', amount: 350 }));
    calls.push(pay(t.bob, { to_handle: 'ada', amount: 100 }));
  });
  const rs = await Promise.all(calls);
  const { violations } = await sm.finish();
  assert.deepEqual(violations, []);
  no5xx(rs);
  for (const r of rs) assert.ok(r.status < 500);
  const total = await totalBalance(t);
  assert.equal(total, TOTAL);
  // holds equal the sum of remaining amounts of open authorizations
  const open = (await auths(t.ada, '?status=open&direction=outgoing&limit=200')).authorizations;
  assert.equal((await me(t.ada)).held, open.reduce((s, a) => s + a.remaining_amount, 0));
});

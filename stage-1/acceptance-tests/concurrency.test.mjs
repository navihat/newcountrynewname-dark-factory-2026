import { test } from 'node:test';
import assert from 'node:assert/strict';
import { http, fixture, user, setup, balance, totalBalance, expectErr, pay, mkReq, payReq, split, get, uniq } from './lib.mjs';

const no5xx = (rs) => assert.ok(rs.every((r) => r.status < 500), `5xx seen: ${rs.filter((r) => r.status >= 500).map((r) => r.text).join(' | ')}`);

test('§1.1-2 50 parallel payments from one wallet that can afford only some: never negative, sum conserved, no 5xx', async () => {
  const { t } = await setup(); // dee has 500
  const rs = await Promise.all(Array.from({ length: 50 }, () => pay(t.dee, { to_handle: 'cy', amount: 30 })));
  no5xx(rs);
  const ok = rs.filter((r) => r.status === 201).length;
  const fail = rs.filter((r) => r.status === 409);
  assert.equal(ok, 16); // floor(500/30)
  assert.equal(ok + fail.length, 50);
  for (const f of fail) assert.equal(f.json.error.code, 'insufficient_funds');
  assert.equal(await balance(t.dee), 500 - 16 * 30);
  assert.equal(await balance(t.cy), 16 * 30);
  assert.equal(await totalBalance(t), 10000 + 2500 + 500 + 100000);
  assert.equal((await get(t.cy, '/activity?limit=200')).json.payments.length, 16);
});

test('§1.1-2 50 parallel payments exactly draining a wallet: exactly balance/amount succeed, wallet ends at 0', async () => {
  const { t } = await setup();
  const rs = await Promise.all(Array.from({ length: 50 }, () => pay(t.dee, { to_handle: 'bob', amount: 10 })));
  no5xx(rs);
  assert.equal(rs.filter((r) => r.status === 201).length, 50);
  assert.equal(await balance(t.dee), 0);
  const more = await Promise.all(Array.from({ length: 10 }, () => pay(t.dee, { to_handle: 'bob', amount: 1 })));
  assert.ok(more.every((r) => r.status === 409));
  assert.equal(await balance(t.dee), 0);
});

test('§1.3 50 parallel pay attempts on ONE request with distinct keys: exactly one 201, others request_not_pending, money moves once', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 1000 })).json;
  const rs = await Promise.all(Array.from({ length: 50 }, () => payReq(t.ada, rq.request_id, {})));
  no5xx(rs);
  assert.equal(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.status).join(','));
  for (const r of rs.filter((x) => x.status !== 201)) expectErr(r, 409, 'request_not_pending');
  assert.equal(await balance(t.ada), 9000);
  assert.equal(await balance(t.bob), 3500);
  assert.equal((await get(t.ada, '/activity')).json.payments.length, 1);
  assert.equal((await get(t.ada, '/requests')).json.requests[0].status, 'paid');
});

test('§1.3 parallel pay + decline + cancel on one request: exactly one terminal outcome; money moves at most once and consistent with status', async () => {
  for (let round = 0; round < 5; round++) {
    const { t } = await setup();
    const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 1000 })).json;
    const calls = [];
    for (let i = 0; i < 10; i++) calls.push(payReq(t.ada, rq.request_id, {}));
    for (let i = 0; i < 10; i++) calls.push(http('POST', `/requests/${rq.request_id}/decline`, { token: t.ada }));
    for (let i = 0; i < 10; i++) calls.push(http('POST', `/requests/${rq.request_id}/cancel`, { token: t.bob }));
    const rs = await Promise.all(calls);
    no5xx(rs);
    for (const r of rs) assert.ok([200, 201, 409].includes(r.status), `${r.status} ${r.text}`);
    const final = (await get(t.ada, '/requests')).json.requests[0];
    assert.ok(['paid', 'declined', 'cancelled'].includes(final.status));
    const adaBal = await balance(t.ada);
    if (final.status === 'paid') {
      assert.equal(adaBal, 9000);
      assert.equal(rs.slice(0, 10).filter((r) => r.status === 201).length, 1);
      assert.ok(rs.slice(10).every((r) => r.status === 409), 'decline/cancel after paid are 409');
    } else {
      assert.equal(adaBal, 10000);
      assert.ok(rs.slice(0, 10).every((r) => r.status === 409), 'pay after decline/cancel is 409');
      assert.deepEqual((await get(t.ada, '/activity')).json.payments, []);
    }
    assert.equal(await totalBalance(t), 10000 + 2500 + 500 + 100000);
  }
});

test('§1.1-3 50 parallel pay-request races from many requests against a short payer: no negative balance, each request pays at most once', async () => {
  const { t } = await setup();
  // dee holds 500; 25 requests of 100 each (only 5 payable), each raced twice with distinct keys
  const rqs = [];
  for (let i = 0; i < 25; i++) rqs.push((await mkReq(t.bob, { payer_handle: 'dee', amount: 100 })).json);
  const calls = [];
  for (const r of rqs) { calls.push(payReq(t.dee, r.request_id, {})); calls.push(payReq(t.dee, r.request_id, {})); }
  const rs = await Promise.all(calls);
  no5xx(rs);
  const ok = rs.filter((r) => r.status === 201);
  assert.equal(ok.length, 5);
  assert.equal(new Set(ok.map((r) => r.json.request_id)).size, 5, 'no request paid twice');
  for (const r of rs.filter((x) => x.status !== 201)) assert.ok([409].includes(r.status) && ['insufficient_funds', 'request_not_pending'].includes(r.json.error.code), r.text);
  assert.equal(await balance(t.dee), 0);
  assert.equal(await balance(t.bob), 3000);
  assert.equal(await totalBalance(t), 10000 + 2500 + 500 + 100000);
  const paid = (await get(t.bob, '/requests?status=paid&limit=200')).json.requests;
  assert.equal(paid.length, 5);
});

test('§1 mixed storm: 50 parallel payments between all users in random directions keep balances non-negative and conserved', async () => {
  const { t } = await setup();
  const names = ['ada', 'bob', 'cy', 'dee'];
  const calls = [];
  for (let i = 0; i < 50; i++) {
    const from = names[i % 4], to = names[(i * 7 + 1) % 4 === i % 4 ? (i + 1) % 4 : (i * 7 + 1) % 4];
    calls.push(pay(t[from], { to_handle: to, amount: 1 + ((i * 37) % 400), visibility: i % 2 ? 'private' : 'public' }));
  }
  const rs = await Promise.all(calls);
  no5xx(rs);
  for (const r of rs) assert.ok([201, 409].includes(r.status), r.text);
  for (const n of names) assert.ok((await balance(t[n])) >= 0);
  assert.equal(await totalBalance(t), 10000 + 2500 + 500 + 100000);
  // every successful payment is visible to both parties exactly once
  const okIds = rs.filter((r) => r.status === 201).map((r) => r.json.payment_id);
  const seen = new Map();
  for (const n of names) for (const p of (await get(t[n], '/activity?limit=200')).json.payments) seen.set(p.payment_id, true);
  assert.deepEqual([...seen.keys()].sort(), okIds.slice().sort());
});

test('§1 concurrent opposing payments (A->B and B->A) never produce negative balances or 5xx', async () => {
  const { t } = await setup(fixture({ users: [user('u_a', 'a', 1000), user('u_b', 'b', 1000)] }), ['a', 'b']);
  const calls = [];
  for (let i = 0; i < 25; i++) { calls.push(pay(t.a, { to_handle: 'b', amount: 300 })); calls.push(pay(t.b, { to_handle: 'a', amount: 300 })); }
  const rs = await Promise.all(calls);
  no5xx(rs);
  assert.ok((await balance(t.a)) >= 0 && (await balance(t.b)) >= 0);
  assert.equal(await totalBalance(t), 2000);
});

test('§1 concurrent settlements competing for the same funds: net sum conserved, none negative, no 5xx, failures leave no payments', async () => {
  const { t } = await setup();
  const calls = [];
  for (let i = 0; i < 20; i++) calls.push(http('POST', '/settlements', { token: t.op, key: uniq(), body: { transfers: [{ from_handle: 'dee', to_handle: 'cy', amount: 100 }, { from_handle: 'dee', to_handle: 'bob', amount: 50 }] } }));
  for (let i = 0; i < 20; i++) calls.push(pay(t.dee, { to_handle: 'ada', amount: 75 }));
  const rs = await Promise.all(calls);
  no5xx(rs);
  assert.ok((await balance(t.dee)) >= 0);
  assert.equal(await totalBalance(t), 10000 + 2500 + 500 + 100000);
  const okSettle = rs.slice(0, 20).filter((r) => r.status === 201).length;
  const okPay = rs.slice(20).filter((r) => r.status === 201).length;
  assert.equal(await balance(t.dee), 500 - okSettle * 150 - okPay * 75);
  assert.equal(await balance(t.cy), okSettle * 100);
  const feed = (await get(t.cy, '/activity?limit=200')).json.payments;
  assert.equal(feed.filter((p) => p.to_handle === 'cy').length, okSettle);
  assert.equal(feed.filter((p) => p.settlement_id).length, okSettle * 2, 'whole settlements only (atomic)');
});

test('§7 concurrent identical split / request creation with unused key creates exactly one set of requests', async () => {
  const { t } = await setup();
  const key = uniq();
  const body = { amount: 1000, participant_handles: ['ada', 'bob', 'cy'] };
  const rs = await Promise.all(Array.from({ length: 30 }, () => http('POST', '/splits', { token: t.ada, key, body })));
  no5xx(rs);
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
  assert.equal(rs.filter((r) => r.status === 200).length, 29);
  assert.equal((await get(t.ada, '/requests?limit=200')).json.requests.length, 2);
});

test('§5 service stays healthy and 5xx-free under 50 mixed parallel reads and invalid writes', async () => {
  const { t } = await setup();
  const calls = [];
  for (let i = 0; i < 50; i++) {
    if (i % 5 === 0) calls.push(get(t.ada, '/me'));
    else if (i % 5 === 1) calls.push(get(t.ada, '/activity?limit=5'));
    else if (i % 5 === 2) calls.push(get(t.ada, '/requests?status=pending'));
    else if (i % 5 === 3) calls.push(pay(t.ada, { to_handle: 'nobody', amount: 5 }));
    else calls.push(http('POST', '/payments', { token: t.ada, key: uniq(), raw: '{broken' }));
  }
  no5xx(await Promise.all(calls));
  assert.equal((await http('GET', '/health')).status, 200);
});

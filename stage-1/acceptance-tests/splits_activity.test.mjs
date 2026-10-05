import { test } from 'node:test';
import assert from 'node:assert/strict';
import { http, fixture, user, setup, balance, totalBalance, expectErr, pay, mkReq, payReq, split, get, uniq, RFC3339 } from './lib.mjs';

const shares = (r) => r.json.shares.map((s) => s.amount);

test('§9 rounding table: (1000,3)->334,333,333; (1,3)->1,0,0; (10,3)->4,3,3; (999,3)->333x3; (5,5)->1x5', async () => {
  const { t } = await setup();
  const cases = [
    [1000, ['ada', 'bob', 'cy'], [334, 333, 333]],
    [1, ['ada', 'bob', 'cy'], [1, 0, 0]],
    [10, ['ada', 'bob', 'cy'], [4, 3, 3]],
    [999, ['ada', 'bob', 'cy'], [333, 333, 333]],
    [5, ['ada', 'bob', 'cy', 'dee', 'op'], [1, 1, 1, 1, 1]],
  ];
  for (const [amount, handles, expected] of cases) {
    const r = await split(t.ada, { amount, participant_handles: handles });
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(shares(r), expected, `${amount}/${handles.length}`);
    assert.deepEqual(r.json.shares.map((s) => s.handle), handles);
    assert.equal(shares(r).reduce((a, b) => a + b, 0), amount);
  }
});

test('§9 more rounding: 2/3 amounts spread to FIRST participants, spread <= 1, sum exact', async () => {
  const { t } = await setup();
  for (const [amount, n] of [[11, 4], [100, 7], [7, 3], [2, 5], [1000000000, 7], [13, 13], [14, 13], [3, 2]]) {
    const handles = ['ada', 'bob', 'cy', 'dee', 'op'];
    // reuse handles up to 5; for n > 5 sign up extra users
    const hs = handles.slice(0, Math.min(n, 5));
    if (n > 5) {
      for (let i = 0; i < n - 5; i++) {
        const s = await http('POST', '/auth/signup', { body: { email: `extra${n}_${amount}_${i}@x.org`, password: 'longenough1', display_name: 'E' } });
        assert.equal(s.status, 201, s.text);
        hs.push(`extra${n}_${amount}_${i}`);
      }
    }
    const r = await split(t.ada, { amount, participant_handles: hs });
    assert.equal(r.status, 201, `${amount}/${n}: ${r.text}`);
    const sh = shares(r);
    const base = Math.floor(amount / n), rem = amount % n;
    assert.deepEqual(sh, hs.map((_, i) => base + (i < rem ? 1 : 0)), `${amount}/${n}`);
  }
});

test('§9 same amount, reordered participants -> extra unit goes to a different person', async () => {
  const { t } = await setup();
  const a = await split(t.ada, { amount: 1000, participant_handles: ['ada', 'bob', 'cy'] });
  const b = await split(t.ada, { amount: 1000, participant_handles: ['cy', 'bob', 'ada'] });
  const c = await split(t.ada, { amount: 1000, participant_handles: ['bob', 'cy', 'ada'] });
  const by = (r) => Object.fromEntries(r.json.shares.map((s) => [s.handle, s.amount]));
  assert.deepEqual(by(a), { ada: 334, bob: 333, cy: 333 });
  assert.deepEqual(by(b), { cy: 334, bob: 333, ada: 333 });
  assert.deepEqual(by(c), { bob: 334, cy: 333, ada: 333 });
  assert.deepEqual(b.json.shares.map((s) => s.handle), ['cy', 'bob', 'ada']);
  // requests follow the given order, excluding the caller
  assert.deepEqual(b.json.requests.map((q) => q.payer_handle), ['cy', 'bob']);
  assert.deepEqual(b.json.requests.map((q) => q.amount), [334, 333]);
});

test('§8 split response shape; requests are pending requests with caller as requester; caller excluded from requests', async () => {
  const { t } = await setup();
  const r = await split(t.ada, { amount: 3000, participant_handles: ['ada', 'bob', 'cy'], note: 'dinner' });
  assert.equal(r.status, 201);
  const s = r.json;
  assert.equal(typeof s.split_id, 'string'); assert.ok(s.split_id.length <= 64);
  assert.equal(s.amount, 3000); assert.equal(s.currency, 'EUR'); assert.equal(s.note, 'dinner');
  assert.match(s.created_at, RFC3339);
  assert.deepEqual(s.shares, [{ handle: 'ada', amount: 1000 }, { handle: 'bob', amount: 1000 }, { handle: 'cy', amount: 1000 }]);
  assert.equal(s.requests.length, 2);
  assert.deepEqual(s.requests.map((q) => q.payer_handle), ['bob', 'cy']);
  for (const q of s.requests) {
    assert.equal(q.requester_id, 'u_ada'); assert.equal(q.requester_handle, 'ada');
    assert.equal(q.status, 'pending'); assert.equal(q.payment_id, null); assert.equal(q.amount, 1000);
    assert.equal(q.note, 'dinner'); assert.equal(q.currency, 'EUR');
  }
  // the requests exist in /requests for both parties
  const bobReqs = (await get(t.bob, '/requests?direction=incoming')).json.requests;
  assert.equal(bobReqs.length, 1);
  assert.equal(bobReqs[0].request_id, s.requests[0].request_id);
  const adaReqs = (await get(t.ada, '/requests?direction=outgoing')).json.requests;
  assert.equal(adaReqs.length, 2);
  // a third party sees none
  assert.deepEqual((await get(t.dee, '/requests')).json.requests, []);
  // not a feed item and no money moved
  assert.deepEqual((await get(t.ada, '/activity')).json.payments, []);
  assert.equal(await balance(t.ada), 10000);
});

test('§8 split without caller in the participants: request for every participant, shares exclude caller', async () => {
  const { t } = await setup();
  const r = await split(t.ada, { amount: 10, participant_handles: ['bob', 'cy', 'dee'] });
  assert.equal(r.status, 201);
  assert.deepEqual(shares(r), [4, 3, 3]);
  assert.equal(r.json.shares.length, 3);
  assert.equal(r.json.requests.length, 3);
  assert.deepEqual(r.json.requests.map((q) => q.amount), [4, 3, 3]);
  assert.deepEqual(r.json.requests.map((q) => q.payer_handle), ['bob', 'cy', 'dee']);
});

test('§8 split where caller is the only participant: valid, one share, requests []', async () => {
  const { t } = await setup();
  const r = await split(t.ada, { amount: 777, participant_handles: ['ada'] });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.shares, [{ handle: 'ada', amount: 777 }]);
  assert.deepEqual(r.json.requests, []);
  assert.deepEqual((await get(t.ada, '/requests')).json.requests, []);
});

test('§9 share of 0 is legal and still creates a request (amount 0)', async () => {
  const { t } = await setup();
  const r = await split(t.ada, { amount: 1, participant_handles: ['ada', 'bob', 'cy'] });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.requests.map((q) => q.amount), [0, 0]);
  assert.equal(r.json.requests.length, 2);
  const rq = (await get(t.cy, '/requests')).json.requests;
  assert.equal(rq.length, 1);
  assert.equal(rq[0].amount, 0);
});

test('§8 split: nothing checks balances (cy with 0 can be a participant of a huge split)', async () => {
  const { t } = await setup();
  const r = await split(t.cy, { amount: 1000000000, participant_handles: ['cy', 'ada', 'bob'] });
  assert.equal(r.status, 201);
  assert.equal(await balance(t.cy), 0);
  assert.equal(await balance(t.ada), 10000);
});

test('§8 split errors: amount, empty/duplicate participants, note length, unknown handle, types', async () => {
  const { t } = await setup();
  const base = { participant_handles: ['bob', 'cy'] };
  for (const amount of [0, -1, 1000000001, 1.5]) expectErr(await split(t.ada, { ...base, amount }), 422, 'validation_failed');
  for (const amount of ['100', true, null]) expectErr(await split(t.ada, { ...base, amount }), 422, 'validation_failed');
  expectErr(await split(t.ada, { amount: 10, participant_handles: [] }), 422, 'validation_failed');
  expectErr(await split(t.ada, { amount: 10, participant_handles: ['bob', 'bob'] }), 422, 'validation_failed');
  expectErr(await split(t.ada, { amount: 10, participant_handles: ['ada', 'bob', 'ada'] }), 422, 'validation_failed');
  expectErr(await split(t.ada, { amount: 10, participant_handles: ['bob'], note: 'n'.repeat(201) }), 422, 'validation_failed');
  expectErr(await split(t.ada, { amount: 10, participant_handles: ['bob'], note: null }), 422, 'validation_failed');
  expectErr(await split(t.ada, { amount: 10, participant_handles: ['bob', 'ghost'] }), 404, 'not_found');
  expectErr(await split(t.ada, { amount: 10, participant_handles: ['ghost'] }), 404, 'not_found');
  expectErr(await split(t.ada, { amount: 10 }), 422, 'validation_failed');
  expectErr(await split(t.ada, { participant_handles: ['bob'] }), 422, 'validation_failed');
  expectErr(await split(t.ada, { amount: 10, participant_handles: 'bob' }), 400, 'malformed_request');
  expectErr(await split(t.ada, { amount: 10, participant_handles: [5] }), 400, 'malformed_request');
  expectErr(await http('POST', '/splits', { token: t.ada, key: uniq(), raw: '{"amount":' }), 400, 'malformed_request');
  // failed splits created no requests
  assert.deepEqual((await get(t.bob, '/requests')).json.requests, []);
  assert.deepEqual((await get(t.ada, '/requests')).json.requests, []);
  // amount forms
  assert.equal((await http('POST', '/splits', { token: t.ada, key: uniq(), raw: '{"amount":1e3,"participant_handles":["bob"]}' })).json.amount, 1000);
  assert.equal((await http('POST', '/splits', { token: t.ada, key: uniq(), raw: '{"amount":3000.0,"participant_handles":["bob"]}' })).json.amount, 3000);
  assert.equal((await split(t.ada, { amount: 10, participant_handles: ['bob'], note: 'n'.repeat(200) })).status, 201);
  assert.equal((await split(t.ada, { amount: 10, participant_handles: ['bob'], note: '🍕 é ' })).json.note, '🍕 é ');
  assert.equal((await split(t.ada, { amount: 10, participant_handles: ['bob'] })).json.note, '');
});

test('§8 split: a failed (404) split creates no partial requests', async () => {
  const { t } = await setup();
  expectErr(await split(t.ada, { amount: 100, participant_handles: ['bob', 'cy', 'ghost'] }), 404, 'not_found');
  assert.deepEqual((await get(t.bob, '/requests')).json.requests, []);
  assert.deepEqual((await get(t.cy, '/requests')).json.requests, []);
});

test('§9 split requests paid in full: balances still sum to seeded total; each split independent', async () => {
  const { t } = await setup();
  const total = await totalBalance(t);
  for (const [amount, hs] of [[1000, ['ada', 'bob', 'cy']], [1, ['ada', 'bob', 'cy']], [10, ['bob', 'ada', 'dee']], [999, ['cy', 'bob', 'ada']]]) {
    const s = await split(t.ada, { amount, participant_handles: hs });
    for (const q of s.json.requests) {
      const payer = t[q.payer_handle];
      if (q.amount > (await balance(payer))) {
        // fund payer so the request is payable
        assert.equal((await pay(t.op, { to_handle: q.payer_handle, amount: q.amount })).status, 201);
      }
      assert.equal((await payReq(payer, q.request_id)).status, 201);
    }
  }
  assert.equal(await totalBalance(t), total);
});

test('§8 paying a 0-amount split request: (documented) amount 0 request — pay does not break conservation or 5xx', async () => {
  const { t } = await setup();
  const s = await split(t.ada, { amount: 1, participant_handles: ['ada', 'bob', 'cy'] });
  const total = await totalBalance(t);
  const r = await payReq(t.bob, s.json.requests[0].request_id);
  assert.ok(r.status < 500, r.text); // spec is silent on 0-amount payments; only require no crash
  assert.equal(await totalBalance(t), total);
});

test('§8 split by non-existent token -> 401', async () => {
  await setup();
  expectErr(await http('POST', '/splits', { token: 'zzz', key: uniq(), body: { amount: 5, participant_handles: ['bob'] } }), 401, 'unauthenticated');
});

test('§8 split requests by a split are individually payable/declinable by their payers only', async () => {
  const { t } = await setup();
  const s = (await split(t.ada, { amount: 600, participant_handles: ['bob', 'dee'] })).json;
  const [rb, rd] = s.requests;
  expectErr(await payReq(t.dee, rb.request_id), 403, 'forbidden');
  expectErr(await payReq(t.bob, rd.request_id), 403, 'forbidden');
  assert.equal((await payReq(t.bob, rb.request_id, { visibility: 'private' })).status, 201);
  const decl = await http('POST', `/requests/${rd.request_id}/decline`, { token: t.dee });
  assert.equal(decl.json.status, 'declined');
  assert.equal((await http('POST', `/requests/${rb.request_id}/cancel`, { token: t.ada })).status, 409);
});

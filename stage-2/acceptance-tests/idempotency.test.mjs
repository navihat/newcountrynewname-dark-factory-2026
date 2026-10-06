import { test } from 'node:test';
import assert from 'node:assert/strict';
import { http, setup, balance, expectErr, mkReq, get, uniq } from './lib.mjs';

// Each of the five idempotent paths, with a valid body and a different (valid) body.
async function paths(t) {
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  const rq2 = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  return [
    { name: 'payments', tok: t.ada, path: '/payments', body: { to_handle: 'bob', amount: 100 }, other: { to_handle: 'bob', amount: 101 } },
    { name: 'requests', tok: t.ada, path: '/requests', body: { payer_handle: 'bob', amount: 100 }, other: { payer_handle: 'bob', amount: 101 } },
    { name: 'pay', tok: t.ada, path: `/requests/${rq.request_id}/pay`, body: {}, other: { visibility: 'public' } },
    { name: 'splits', tok: t.ada, path: '/splits', body: { amount: 100, participant_handles: ['bob', 'cy'] }, other: { amount: 101, participant_handles: ['bob', 'cy'] } },
    { name: 'settlements', tok: t.op, path: '/settlements', body: { transfers: [{ from_handle: 'op', to_handle: 'cy', amount: 10 }] }, other: { transfers: [{ from_handle: 'op', to_handle: 'cy', amount: 11 }] } },
    { name: 'pay2', tok: t.ada, path: `/requests/${rq2.request_id}/pay`, body: { visibility: 'private' }, other: { visibility: 'public' } },
  ];
}

test('§7 first use 201; replay 200 with identical JSON body; different body 409 idempotency_key_reuse — all five paths', async () => {
  const { t } = await setup();
  for (const p of await paths(t)) {
    const key = uniq(p.name);
    const first = await http('POST', p.path, { token: p.tok, key, body: p.body });
    assert.equal(first.status, 201, `${p.name}: ${first.text}`);
    const replay = await http('POST', p.path, { token: p.tok, key, body: p.body });
    assert.equal(replay.status, 200, `${p.name}: ${replay.text}`);
    assert.deepEqual(replay.json, first.json, p.name);
    const third = await http('POST', p.path, { token: p.tok, key, body: p.body });
    assert.equal(third.status, 200);
    assert.deepEqual(third.json, first.json);
    expectErr(await http('POST', p.path, { token: p.tok, key, body: p.other }), 409, 'idempotency_key_reuse');
  }
});

test('§7 replays and key conflicts have no side effects (money moves once)', async () => {
  const { t } = await setup();
  const key = uniq();
  for (let i = 0; i < 4; i++) await http('POST', '/payments', { token: t.ada, key, body: { to_handle: 'bob', amount: 1000 } });
  await http('POST', '/payments', { token: t.ada, key, body: { to_handle: 'bob', amount: 2000 } });
  assert.equal(await balance(t.ada), 9000);
  assert.equal(await balance(t.bob), 3500);
  assert.equal((await get(t.ada, '/activity')).json.payments.length, 1);
  // same for requests/splits: only one created
  const k2 = uniq(), k3 = uniq();
  for (let i = 0; i < 3; i++) await http('POST', '/requests', { token: t.ada, key: k2, body: { payer_handle: 'bob', amount: 5 } });
  for (let i = 0; i < 3; i++) await http('POST', '/splits', { token: t.ada, key: k3, body: { amount: 9, participant_handles: ['bob', 'cy'] } });
  assert.equal((await get(t.ada, '/requests?direction=outgoing')).json.requests.length, 3); // 1 request + 2 split requests
});

test('§7 body equality is JSON-value equality: key order, whitespace and amount form (1000 vs 1000.0 vs 1e3) do not matter', async () => {
  const { t } = await setup();
  const key = uniq();
  const first = await http('POST', '/payments', { token: t.ada, key, raw: '{"to_handle":"bob","amount":1000,"note":"x"}' });
  assert.equal(first.status, 201);
  const reorder = await http('POST', '/payments', { token: t.ada, key, raw: '  {\n "note" : "x",\n "amount":1000 ,\t"to_handle":"bob" }  ' });
  assert.equal(reorder.status, 200);
  assert.deepEqual(reorder.json, first.json);
  const expo = await http('POST', '/payments', { token: t.ada, key, raw: '{"to_handle":"bob","amount":1e3,"note":"x"}' });
  assert.equal(expo.status, 200);
  assert.deepEqual(expo.json, first.json);
  assert.equal(await balance(t.ada), 9000);
  // an extra (ignored) field makes it a different JSON value
  expectErr(await http('POST', '/payments', { token: t.ada, key, raw: '{"to_handle":"bob","amount":1000,"note":"x","extra":1}' }), 409, 'idempotency_key_reuse');
  // omitted default vs explicit default is a different value
  expectErr(await http('POST', '/payments', { token: t.ada, key, raw: '{"to_handle":"bob","amount":1000,"note":"x","visibility":"public"}' }), 409, 'idempotency_key_reuse');
});

test('§8/§7 pay: {} and {"visibility":"public"} are different values; same body replay works even after request is paid', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  const key = uniq();
  const first = await http('POST', `/requests/${rq.request_id}/pay`, { token: t.ada, key, body: {} });
  assert.equal(first.status, 201);
  expectErr(await http('POST', `/requests/${rq.request_id}/pay`, { token: t.ada, key, body: { visibility: 'public' } }), 409, 'idempotency_key_reuse');
  const rep = await http('POST', `/requests/${rq.request_id}/pay`, { token: t.ada, key, body: {} });
  assert.equal(rep.status, 200);
  assert.deepEqual(rep.json, first.json);
  // the other way round
  const rq2 = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  const k2 = uniq();
  assert.equal((await http('POST', `/requests/${rq2.request_id}/pay`, { token: t.ada, key: k2, body: { visibility: 'public' } })).status, 201);
  expectErr(await http('POST', `/requests/${rq2.request_id}/pay`, { token: t.ada, key: k2, body: {} }), 409, 'idempotency_key_reuse');
  assert.equal(await balance(t.ada), 9800);
});

test('§7 replay returns original response even after the resource changed (request pay replay after cancel impossible; request create replay after cancel)', async () => {
  const { t } = await setup();
  const key = uniq();
  const body = { payer_handle: 'bob', amount: 50 };
  const first = await http('POST', '/requests', { token: t.ada, key, body });
  assert.equal(first.status, 201);
  assert.equal((await http('POST', `/requests/${first.json.request_id}/cancel`, { token: t.ada })).status, 200);
  const rep = await http('POST', '/requests', { token: t.ada, key, body });
  assert.equal(rep.status, 200);
  assert.deepEqual(rep.json, first.json, 'original body, status still pending');
  assert.equal(rep.json.status, 'pending');
  assert.equal((await get(t.ada, '/requests')).json.requests.length, 1);
});

test('§7 payment replay after balance dropped to zero still returns the original 200 (no insufficient_funds)', async () => {
  const { t } = await setup();
  const key = uniq();
  const body = { to_handle: 'bob', amount: 500 };
  const first = await http('POST', '/payments', { token: t.dee, key, body }); // dee has exactly 500
  assert.equal(first.status, 201);
  const rep = await http('POST', '/payments', { token: t.dee, key, body });
  assert.equal(rep.status, 200);
  assert.deepEqual(rep.json, first.json);
  assert.equal(await balance(t.dee), 0);
});

test('§7 same key + same body on a DIFFERENT path is a different request and succeeds normally', async () => {
  const { t } = await setup();
  const key = uniq();
  const pay = await http('POST', '/payments', { token: t.ada, key, body: { to_handle: 'bob', amount: 10 } });
  assert.equal(pay.status, 201);
  const req = await http('POST', '/requests', { token: t.ada, key, body: { payer_handle: 'bob', amount: 10 } });
  assert.equal(req.status, 201);
  const sp = await http('POST', '/splits', { token: t.ada, key, body: { amount: 10, participant_handles: ['bob'] } });
  assert.equal(sp.status, 201);
  // identical body JSON on two paths: payments vs settlements are different shapes, use two pay paths on 2 requests
  const r1 = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  const r2 = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  const kk = uniq();
  const p1 = await http('POST', `/requests/${r1.request_id}/pay`, { token: t.ada, key: kk, body: {} });
  const p2 = await http('POST', `/requests/${r2.request_id}/pay`, { token: t.ada, key: kk, body: {} });
  assert.equal(p1.status, 201);
  assert.equal(p2.status, 201, 'same key, same body, different path (request id) -> new request');
  assert.notEqual(p1.json.payment_id, p2.json.payment_id);
  assert.equal(await balance(t.ada), 10000 - 10 - 200);
  // replays still resolve to their own originals
  assert.deepEqual((await http('POST', '/payments', { token: t.ada, key, body: { to_handle: 'bob', amount: 10 } })).json, pay.json);
  assert.deepEqual((await http('POST', '/requests', { token: t.ada, key, body: { payer_handle: 'bob', amount: 10 } })).json, req.json);
});

test('§7 key scope is per user: two users can use the same key string independently', async () => {
  const { t } = await setup();
  const key = 'shared-key-string';
  const a = await http('POST', '/payments', { token: t.ada, key, body: { to_handle: 'cy', amount: 10 } });
  const b = await http('POST', '/payments', { token: t.bob, key, body: { to_handle: 'cy', amount: 10 } });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.notEqual(a.json.payment_id, b.json.payment_id);
  assert.equal(a.json.from_handle, 'ada'); assert.equal(b.json.from_handle, 'bob');
  // different bodies under the same key string for different users: no conflict
  const c = await http('POST', '/payments', { token: t.dee, key, body: { to_handle: 'cy', amount: 99 } });
  assert.equal(c.status, 201);
  // each replays its own
  assert.deepEqual((await http('POST', '/payments', { token: t.bob, key, body: { to_handle: 'cy', amount: 10 } })).json, b.json);
  assert.equal(await balance(t.cy), 119);
});

test('§7 key reused after the original failed with 4xx is treated as a first use', async () => {
  const { t } = await setup();
  const key = uniq();
  expectErr(await http('POST', '/payments', { token: t.dee, key, body: { to_handle: 'bob', amount: 501 } }), 409, 'insufficient_funds');
  const ok = await http('POST', '/payments', { token: t.dee, key, body: { to_handle: 'bob', amount: 500 } }); // different body, was a failure
  assert.equal(ok.status, 201);
  const k2 = uniq();
  expectErr(await http('POST', '/payments', { token: t.ada, key: k2, body: { to_handle: 'ghost', amount: 5 } }), 404, 'not_found');
  expectErr(await http('POST', '/payments', { token: t.ada, key: k2, body: { to_handle: 'bob', amount: 0 } }), 422, 'validation_failed');
  expectErr(await http('POST', '/payments', { token: t.ada, key: k2, body: { to_handle: 'ada', amount: 5 } }), 422, 'self_payment');
  assert.equal((await http('POST', '/payments', { token: t.ada, key: k2, body: { to_handle: 'bob', amount: 5 } })).status, 201);
  // same failed body repeated is still an error each time (not a replay)
  const k3 = uniq();
  for (let i = 0; i < 2; i++) expectErr(await http('POST', '/requests', { token: t.ada, key: k3, body: { payer_handle: 'ada', amount: 5 } }), 422, 'self_request');
});

test('§7 claimed key precedence: a successful key sent with an INVALID body -> 409 idempotency_key_reuse (not 422/404/409 other)', async () => {
  const { t } = await setup();
  const key = uniq();
  assert.equal((await http('POST', '/payments', { token: t.ada, key, body: { to_handle: 'bob', amount: 10 } })).status, 201);
  for (const bad of [{ to_handle: 'bob', amount: 0 }, { to_handle: 'bob', amount: 'x' }, { to_handle: 'ghost', amount: 5 }, { to_handle: 'ada', amount: 5 }, { to_handle: 'bob', amount: 999999999 }, { amount: 5 }, {}, { to_handle: 'bob', amount: 10, note: null }, { to_handle: 'bob', amount: 10, visibility: 'x' }]) {
    expectErr(await http('POST', '/payments', { token: t.ada, key, body: bad }), 409, 'idempotency_key_reuse');
  }
  // request pay: key claimed, request now paid, invalid visibility with same key -> 409 reuse
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  const k2 = uniq();
  assert.equal((await http('POST', `/requests/${rq.request_id}/pay`, { token: t.ada, key: k2, body: {} })).status, 201);
  expectErr(await http('POST', `/requests/${rq.request_id}/pay`, { token: t.ada, key: k2, body: { visibility: 'nope' } }), 409, 'idempotency_key_reuse');
  // splits
  const k3 = uniq();
  assert.equal((await http('POST', '/splits', { token: t.ada, key: k3, body: { amount: 10, participant_handles: ['bob'] } })).status, 201);
  expectErr(await http('POST', '/splits', { token: t.ada, key: k3, body: { amount: 10, participant_handles: [] } }), 409, 'idempotency_key_reuse');
  // requests
  const k4 = uniq();
  assert.equal((await http('POST', '/requests', { token: t.ada, key: k4, body: { payer_handle: 'bob', amount: 10 } })).status, 201);
  expectErr(await http('POST', '/requests', { token: t.ada, key: k4, body: { payer_handle: 'bob', amount: -10 } }), 409, 'idempotency_key_reuse');
  // settlements
  const k5 = uniq();
  assert.equal((await http('POST', '/settlements', { token: t.op, key: k5, body: { transfers: [{ from_handle: 'op', to_handle: 'cy', amount: 10 }] } })).status, 201);
  expectErr(await http('POST', '/settlements', { token: t.op, key: k5, body: { transfers: [] } }), 409, 'idempotency_key_reuse');
});

test('§7 claimed key + non-parseable body is still 400 malformed_request (key resolution only after a JSON object parsed)', async () => {
  const { t } = await setup();
  const key = uniq();
  assert.equal((await http('POST', '/payments', { token: t.ada, key, body: { to_handle: 'bob', amount: 10 } })).status, 201);
  expectErr(await http('POST', '/payments', { token: t.ada, key, raw: '{broken' }), 400, 'malformed_request');
});

test('§5/§7 Idempotency-Key header: absent or empty -> 400 missing_idempotency_key on all five paths', async () => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  const targets = [
    [t.ada, '/payments', { to_handle: 'bob', amount: 10 }],
    [t.ada, '/requests', { payer_handle: 'bob', amount: 10 }],
    [t.ada, `/requests/${rq.request_id}/pay`, {}],
    [t.ada, '/splits', { amount: 10, participant_handles: ['bob'] }],
    [t.op, '/settlements', { transfers: [{ from_handle: 'op', to_handle: 'cy', amount: 10 }] }],
  ];
  for (const [tok, path, body] of targets) {
    expectErr(await http('POST', path, { token: tok, body }), 400, 'missing_idempotency_key');
    expectErr(await http('POST', path, { token: tok, body, key: '' }), 400, 'missing_idempotency_key');
  }
  assert.equal(await balance(t.ada), 10000);
  assert.equal((await get(t.ada, '/requests?direction=outgoing')).json.requests.length, 0);
  // a failed (missing key) attempt did not claim anything: request still pending and payable
  assert.equal((await http('POST', `/requests/${rq.request_id}/pay`, { token: t.ada, key: uniq(), body: {} })).status, 201);
});

test('§5 Idempotency-Key length: 255 ok, 256 -> 422 validation_failed, on all five paths', async () => {
  const { t } = await setup();
  const long = 'k'.repeat(256), max = 'm'.repeat(255);
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 100 })).json;
  const targets = [
    [t.ada, '/payments', { to_handle: 'bob', amount: 10 }],
    [t.ada, '/requests', { payer_handle: 'bob', amount: 10 }],
    [t.ada, `/requests/${rq.request_id}/pay`, {}],
    [t.ada, '/splits', { amount: 10, participant_handles: ['bob'] }],
    [t.op, '/settlements', { transfers: [{ from_handle: 'op', to_handle: 'cy', amount: 10 }] }],
  ];
  for (const [tok, path, body] of targets) {
    expectErr(await http('POST', path, { token: tok, body, key: long }), 422, 'validation_failed');
  }
  for (const [tok, path, body] of targets) {
    const r = await http('POST', path, { token: tok, body, key: max });
    assert.equal(r.status, 201, `${path}: ${r.text}`);
  }
  assert.equal((await http('POST', '/payments', { token: t.ada, body: { to_handle: 'bob', amount: 1 }, key: 'x' })).status, 201); // 1 char ok
});

test('§7 concurrent identical requests with an unused key: exactly one 201, rest 200 with the same body, effect once', async () => {
  const { t } = await setup();
  const mk = (path, tok, body) => async () => {
    const key = uniq('conc');
    const rs = await Promise.all(Array.from({ length: 20 }, () => http('POST', path, { token: tok, key, body })));
    const created = rs.filter((r) => r.status === 201);
    assert.equal(created.length, 1, `${path}: statuses ${rs.map((r) => r.status)}`);
    for (const r of rs) {
      assert.ok(r.status === 201 || r.status === 200, `${path}: ${r.status} ${r.text}`);
      assert.deepEqual(r.json, created[0].json);
    }
    return created[0].json;
  };
  await mk('/payments', t.ada, { to_handle: 'bob', amount: 1000 })();
  assert.equal(await balance(t.ada), 9000);
  assert.equal(await balance(t.bob), 3500);
  await mk('/requests', t.bob, { payer_handle: 'cy', amount: 5 })();
  await mk('/splits', t.ada, { amount: 30, participant_handles: ['ada', 'bob', 'cy'] })();
  assert.equal((await get(t.cy, '/requests')).json.requests.length, 2);
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 700 })).json;
  await mk(`/requests/${rq.request_id}/pay`, t.ada, { visibility: 'private' })();
  assert.equal(await balance(t.ada), 9000 - 700);
  await mk('/settlements', t.op, { transfers: [{ from_handle: 'op', to_handle: 'cy', amount: 100 }] })();
  assert.equal(await balance(t.op), 100000 - 100);
});

test('§7 concurrent same key with DIFFERENT bodies: one wins (201), the others 409 reuse or 200 only if same body; money moves once', async () => {
  const { t } = await setup();
  const key = uniq();
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => http('POST', '/payments', { token: t.ada, key, body: { to_handle: 'bob', amount: 100 + (i % 2) } })));
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
  for (const r of rs) assert.ok([200, 201, 409].includes(r.status), r.text);
  assert.ok(rs.filter((r) => r.status === 409).every((r) => r.json.error.code === 'idempotency_key_reuse'));
  const moved = 10000 - (await balance(t.ada));
  assert.ok(moved === 100 || moved === 101);
});

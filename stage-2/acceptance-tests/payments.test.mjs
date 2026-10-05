import { test } from 'node:test';
import assert from 'node:assert/strict';
import { http, fixture, user, reset, setup, login, balance, totalBalance, expectErr, pay, get, uniq, RFC3339 } from './lib.mjs';

const rawPay = (token, raw, key = uniq('raw')) => http('POST', '/payments', { token, key, raw });

test('§8 POST /payments 201 full receipt shape with defaults (note "", visibility public, request_id null)', async () => {
  const { t } = await setup();
  const r = await pay(t.ada, { to_handle: 'bob', amount: 1500 });
  assert.equal(r.status, 201);
  const p = r.json;
  assert.equal(typeof p.payment_id, 'string');
  assert.ok(p.payment_id.length >= 1 && p.payment_id.length <= 64);
  assert.equal(p.from_user_id, 'u_ada'); assert.equal(p.from_handle, 'ada');
  assert.equal(p.to_user_id, 'u_bob'); assert.equal(p.to_handle, 'bob');
  assert.equal(p.amount, 1500); assert.equal(p.currency, 'EUR');
  assert.equal(p.note, ''); assert.equal(p.visibility, 'public'); assert.equal(p.request_id, null);
  assert.match(p.created_at, RFC3339);
  assert.equal(await balance(t.ada), 8500);
  assert.equal(await balance(t.bob), 4000);
});

test('§8 payment: sender debited, receiver credited, total conserved', async () => {
  const { t } = await setup();
  const before = await totalBalance(t);
  for (let i = 0; i < 5; i++) assert.equal((await pay(t.ada, { to_handle: 'cy', amount: 333 })).status, 201);
  assert.equal(await balance(t.cy), 1665);
  assert.equal(await totalBalance(t), before);
});

test('§8 insufficient_funds: amount = balance+1 -> 409, nothing changes; amount = balance succeeds leaving 0', async () => {
  const { t } = await setup();
  expectErr(await pay(t.dee, { to_handle: 'bob', amount: 501 }), 409, 'insufficient_funds');
  assert.equal(await balance(t.dee), 500);
  assert.equal(await balance(t.bob), 2500);
  assert.deepEqual((await get(t.dee, '/activity')).json.payments, []);
  const ok = await pay(t.dee, { to_handle: 'bob', amount: 500 });
  assert.equal(ok.status, 201);
  assert.equal(await balance(t.dee), 0);
  expectErr(await pay(t.dee, { to_handle: 'bob', amount: 1 }), 409, 'insufficient_funds');
  expectErr(await pay(t.cy, { to_handle: 'bob', amount: 1 }), 409, 'insufficient_funds'); // cy has 0
});

test('§8 amount boundaries: 0, -1, 1000000001, 1.5, 1000.5 -> 422; 1 ok', async () => {
  const { t } = await setup(fixture({ users: [user('u_rich', 'rich', 5000000000), user('u_poor', 'poor', 0)] }), ['rich', 'poor']);
  for (const amount of [0, -1, -1000, 1000000001, 2000000000, 1.5, 1000.5, 0.999]) {
    expectErr(await pay(t.rich, { to_handle: 'poor', amount }), 422, 'validation_failed');
  }
  assert.equal((await pay(t.rich, { to_handle: 'poor', amount: 1 })).status, 201);
  assert.equal((await pay(t.rich, { to_handle: 'poor', amount: 1000000000 })).status, 201);
  assert.equal(await balance(t.poor), 1000000001);
  assert.equal(await balance(t.rich), 5000000000 - 1000000001);
});

test('§4 amount forms: 1000.0 and 1e3 are valid integral amounts equal to 1000; strings and booleans are 422', async () => {
  const { t } = await setup();
  for (const lit of ['1000.0', '1e3', '1E3', '10e2', '1000.00']) {
    const r = await rawPay(t.ada, `{"to_handle":"bob","amount":${lit}}`);
    assert.equal(r.status, 201, `${lit}: ${r.text}`);
    assert.equal(r.json.amount, 1000, lit);
  }
  assert.equal(await balance(t.ada), 5000);
  for (const lit of ['"1000"', 'true', 'false', 'null', '[1000]', '{"a":1}', '"1e3"', '1e-1', '1.0000001']) {
    const r = await rawPay(t.ada, `{"to_handle":"bob","amount":${lit}}`);
    expectErr(r, 422, 'validation_failed');
  }
  assert.equal(await balance(t.ada), 5000);
});

test('§4 amount 1e9 literal accepted (max), 1.000000001e9 rejected', async () => {
  const { t } = await setup(fixture({ users: [user('u_rich', 'rich', 5000000000), user('u_poor', 'poor', 0)] }), ['rich', 'poor']);
  const ok = await rawPay(t.rich, '{"to_handle":"poor","amount":1e9}');
  assert.equal(ok.status, 201);
  assert.equal(ok.json.amount, 1000000000);
  expectErr(await rawPay(t.rich, '{"to_handle":"poor","amount":1000000000.5}'), 422, 'validation_failed');
});

test('§5 missing required fields -> 422; wrong JSON types for to_handle -> 400; unparseable / non-object body -> 400', async () => {
  const { t } = await setup();
  expectErr(await pay(t.ada, { amount: 5 }), 422, 'validation_failed');
  expectErr(await pay(t.ada, { to_handle: 'bob' }), 422, 'validation_failed');
  expectErr(await pay(t.ada, {}), 422, 'validation_failed');
  expectErr(await pay(t.ada, { to_handle: 123, amount: 5 }), 400, 'malformed_request');
  expectErr(await pay(t.ada, { to_handle: ['bob'], amount: 5 }), 400, 'malformed_request');
  expectErr(await rawPay(t.ada, '{"to_handle": "bob", "amount": '), 400, 'malformed_request');
  expectErr(await rawPay(t.ada, 'not json at all'), 400, 'malformed_request');
  expectErr(await rawPay(t.ada, '[1,2,3]'), 400, 'malformed_request');
  expectErr(await rawPay(t.ada, '"a string"'), 400, 'malformed_request');
  assert.equal(await balance(t.ada), 10000);
});

test('§8 self_payment -> 422 self_payment; unknown handle -> 404 not_found', async () => {
  const { t } = await setup();
  expectErr(await pay(t.ada, { to_handle: 'ada', amount: 5 }), 422, 'self_payment');
  expectErr(await pay(t.ada, { to_handle: 'ghost', amount: 5 }), 404, 'not_found');
  expectErr(await pay(t.ada, { to_handle: '', amount: 5 }), 404, 'not_found');
  assert.equal(await balance(t.ada), 10000);
});

test('§5 note rules: null / non-string -> 422; 201 chars -> 422; 200 chars OK; default ""', async () => {
  const { t } = await setup();
  for (const note of [null, 5, true, ['x'], { a: 1 }]) {
    expectErr(await pay(t.ada, { to_handle: 'bob', amount: 5, note }), 422, 'validation_failed');
  }
  expectErr(await pay(t.ada, { to_handle: 'bob', amount: 5, note: 'a'.repeat(201) }), 422, 'validation_failed');
  expectErr(await pay(t.ada, { to_handle: 'bob', amount: 5, note: 'a'.repeat(5000) }), 422, 'validation_failed');
  const ok = await pay(t.ada, { to_handle: 'bob', amount: 5, note: 'a'.repeat(200) });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.note.length, 200);
  assert.equal((await pay(t.ada, { to_handle: 'bob', amount: 5, note: '' })).json.note, '');
  assert.equal(await balance(t.ada), 10000 - 10);
});

test('§8 note stored verbatim: whitespace, markup, unicode, emoji, newlines — in receipt AND in activity feed', async () => {
  const { t } = await setup();
  const notes = ['  padded  ', '<b>x</b> & "q" \'s\' \\ /', 'héllo wörld Ünï', '日本語のメモ', '🍕🎉👨‍👩‍👧‍👦', 'line1\nline2\ttab', 'é vs é', '​zero​width'];
  const ids = [];
  for (const note of notes) {
    const r = await pay(t.ada, { to_handle: 'bob', amount: 1, note });
    assert.equal(r.status, 201);
    assert.equal(r.json.note, note);
    ids.push(r.json.payment_id);
  }
  const feed = (await get(t.bob, '/activity?limit=200')).json.payments;
  for (let i = 0; i < notes.length; i++) {
    const p = feed.find((x) => x.payment_id === ids[i]);
    assert.ok(p, 'payment in feed');
    assert.equal(p.note, notes[i]);
  }
});

test('§5 visibility: other than public/private -> 422 (incl. null, number, case variants); defaults to public', async () => {
  const { t } = await setup();
  for (const visibility of ['friends', 'PUBLIC', 'Private', '', null, 1, true, ['public']]) {
    expectErr(await pay(t.ada, { to_handle: 'bob', amount: 5, visibility }), 422, 'validation_failed');
  }
  assert.equal((await pay(t.ada, { to_handle: 'bob', amount: 5 })).json.visibility, 'public');
  assert.equal((await pay(t.ada, { to_handle: 'bob', amount: 5, visibility: 'private' })).json.visibility, 'private');
  assert.equal((await pay(t.ada, { to_handle: 'bob', amount: 5, visibility: 'public' })).json.visibility, 'public');
  assert.equal(await balance(t.ada), 10000 - 15);
});

test('§8 failed payments leave no trace in activity or balances', async () => {
  const { t } = await setup();
  const total = await totalBalance(t);
  await pay(t.ada, { to_handle: 'bob', amount: 0 });
  await pay(t.ada, { to_handle: 'ghost', amount: 5 });
  await pay(t.ada, { to_handle: 'ada', amount: 5 });
  await pay(t.ada, { to_handle: 'bob', amount: 99999999 });
  await pay(t.ada, { to_handle: 'bob', amount: 5, note: 'x'.repeat(201) });
  for (const k of ['ada', 'bob', 'cy', 'dee', 'op']) assert.deepEqual((await get(t[k], '/activity')).json.payments, []);
  assert.equal(await totalBalance(t), total);
});

test('§1/§4 arithmetic: large balances stay exact (no float rounding), sum conserved', async () => {
  const big = 9007199254740000; // < 2^53
  const { t } = await setup(fixture({ users: [user('u_big', 'big', big), user('u_s', 's', 1)] }), ['big', 's']);
  for (let i = 0; i < 3; i++) assert.equal((await pay(t.big, { to_handle: 's', amount: 1000000000 })).status, 201);
  assert.equal(await balance(t.big), big - 3000000000);
  assert.equal(await balance(t.s), 3000000001);
  assert.equal((await pay(t.big, { to_handle: 's', amount: 1 })).status, 201);
  assert.equal(await balance(t.big), big - 3000000001);
  assert.equal(await balance(t.s), 3000000002);
});

test('§4 JPY (minor_units 0) and BHD (3): amounts are plain minor-unit integers', async () => {
  for (const [cur, mu] of [['JPY', 0], ['BHD', 3]]) {
    const { t } = await setup(fixture({ currency: cur, minor_units: mu }));
    const r = await pay(t.ada, { to_handle: 'bob', amount: 1234 });
    assert.equal(r.status, 201);
    assert.equal(r.json.amount, 1234);
    assert.equal(r.json.currency, cur);
    assert.equal(await balance(t.ada), 10000 - 1234);
    expectErr(await pay(t.ada, { to_handle: 'bob', amount: 1.0001 }), 422, 'validation_failed');
  }
});

// ---------- feed visibility ----------

test('§4 feed: public visible to everyone, private only to sender and receiver, identical value for both parties', async () => {
  const { t } = await setup();
  const pub = (await pay(t.ada, { to_handle: 'bob', amount: 10, visibility: 'public', note: 'pub' })).json;
  const priv = (await pay(t.ada, { to_handle: 'bob', amount: 20, visibility: 'private', note: 'priv' })).json;
  const ids = async (tok) => (await get(tok, '/activity')).json.payments.map((p) => p.payment_id);
  assert.deepEqual((await ids(t.ada)).sort(), [pub.payment_id, priv.payment_id].sort());
  assert.deepEqual((await ids(t.bob)).sort(), [pub.payment_id, priv.payment_id].sort());
  assert.deepEqual(await ids(t.cy), [pub.payment_id]);
  assert.deepEqual(await ids(t.dee), [pub.payment_id]);
  assert.deepEqual(await ids(t.op), [pub.payment_id], 'operator gets no access to private items');
  const a = (await get(t.ada, '/activity')).json.payments.find((p) => p.payment_id === priv.payment_id);
  const b = (await get(t.bob, '/activity')).json.payments.find((p) => p.payment_id === priv.payment_id);
  assert.deepEqual(a, b);
  assert.equal(a.visibility, 'private');
  // third party's public view carries the same payment object
  const c = (await get(t.cy, '/activity')).json.payments.find((p) => p.payment_id === pub.payment_id);
  assert.deepEqual(c, pub);
});

test('§4 feed: private payment between two users is not visible to a third even when third sent/received other payments', async () => {
  const { t } = await setup();
  await pay(t.bob, { to_handle: 'cy', amount: 10, visibility: 'private', note: 'bc' });
  await pay(t.ada, { to_handle: 'cy', amount: 10, visibility: 'private', note: 'ac' });
  const ada = (await get(t.ada, '/activity')).json.payments.map((p) => p.note);
  const bob = (await get(t.bob, '/activity')).json.payments.map((p) => p.note);
  const cy = (await get(t.cy, '/activity')).json.payments.map((p) => p.note).sort();
  assert.deepEqual(ada, ['ac']);
  assert.deepEqual(bob, ['bc']);
  assert.deepEqual(cy, ['ac', 'bc']);
});

test('§4/§8 requests never appear in the activity feed (only payments)', async () => {
  const { t } = await setup();
  const rq = await http('POST', '/requests', { token: t.bob, key: uniq(), body: { payer_handle: 'ada', amount: 100 } });
  assert.equal(rq.status, 201);
  assert.deepEqual((await get(t.bob, '/activity')).json.payments, []);
  assert.deepEqual((await get(t.ada, '/activity')).json.payments, []);
});

test('§8 activity newest first, items are full payment objects', async () => {
  const { t } = await setup();
  const made = [];
  for (let i = 1; i <= 4; i++) {
    made.push((await pay(t.ada, { to_handle: 'bob', amount: i })).json);
    await new Promise((r) => setTimeout(r, 1100)); // ordering within the same second is unspecified
  }
  const feed = (await get(t.ada, '/activity')).json;
  assert.equal(feed.has_more, false);
  assert.deepEqual(feed.payments.map((p) => p.amount), [4, 3, 2, 1]);
  for (const p of feed.payments) {
    for (const k of ['payment_id', 'from_user_id', 'from_handle', 'to_user_id', 'to_handle', 'amount', 'currency', 'note', 'visibility', 'request_id', 'created_at']) assert.ok(k in p, k);
  }
});

test('§8 activity pagination: limit/offset/has_more; ranges and strict integer parsing', async () => {
  const { t } = await setup();
  const ids = [];
  for (let i = 1; i <= 7; i++) ids.push((await pay(t.ada, { to_handle: 'bob', amount: i })).json.payment_id);
  const all = (await get(t.ada, '/activity?limit=200')).json;
  assert.equal(all.payments.length, 7);
  assert.equal(all.has_more, false);
  const p1 = (await get(t.ada, '/activity?limit=3&offset=0')).json;
  assert.equal(p1.payments.length, 3); assert.equal(p1.has_more, true);
  const p2 = (await get(t.ada, '/activity?limit=3&offset=3')).json;
  assert.equal(p2.payments.length, 3); assert.equal(p2.has_more, true);
  const p3 = (await get(t.ada, '/activity?limit=3&offset=6')).json;
  assert.equal(p3.payments.length, 1); assert.equal(p3.has_more, false);
  const exact = (await get(t.ada, '/activity?limit=7')).json;
  assert.equal(exact.payments.length, 7); assert.equal(exact.has_more, false);
  const six = (await get(t.ada, '/activity?limit=6')).json;
  assert.equal(six.has_more, true);
  const beyond = (await get(t.ada, '/activity?offset=100')).json;
  assert.deepEqual(beyond.payments, []); assert.equal(beyond.has_more, false);
  const seen = new Set([...p1.payments, ...p2.payments, ...p3.payments].map((p) => p.payment_id));
  assert.equal(seen.size, 7, 'pages are disjoint and complete');
  assert.equal((await get(t.ada, '/activity?limit=200')).status, 200);
  assert.equal((await get(t.ada, '/activity?limit=1')).status, 200);
  assert.equal((await get(t.ada, '/activity?offset=0')).status, 200);
  for (const q of ['limit=0', 'limit=201', 'limit=-1', 'offset=-1', 'limit=abc', 'offset=abc', 'limit=1e2', 'limit=4.0', 'limit=+4', 'offset=1e1', 'offset=2.0', 'offset=+1', 'limit=0x10', 'limit=10000000000000000000']) {
    expectErr(await get(t.ada, `/activity?${q}`), 422, 'validation_failed');
  }
});

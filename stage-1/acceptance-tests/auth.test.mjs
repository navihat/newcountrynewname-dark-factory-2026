import { test } from 'node:test';
import assert from 'node:assert/strict';
import { http, fixture, user, reset, setup, balance, expectErr, pay, get, PW } from './lib.mjs';

const signup = (email, password = 'longenough1', display_name = 'Name') =>
  http('POST', '/auth/signup', { body: { email, password, display_name } });

test('§6 signup -> 201 {user_id, display_name, token}; new user has balance 0 and derived handle', async () => {
  await setup();
  const r = await signup('Mary.Jane+x@Example.com', 'longenough1', 'Mary');
  assert.equal(r.status, 201);
  assert.equal(typeof r.json.user_id, 'string');
  assert.equal(r.json.display_name, 'Mary');
  assert.equal(typeof r.json.token, 'string');
  const me = await get(r.json.token, '/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.balance, 0);
  assert.equal(me.json.user_id, r.json.user_id);
  assert.equal(me.json.currency, 'EUR');
  assert.equal(me.json.minor_units, 2);
  // §4: lowercase local part, non [a-z0-9_] -> '_'
  assert.equal(me.json.handle, 'mary_jane_x');
});

test('§4 derived handle: uppercase lowered, dots/dashes/plus -> underscore, underscore+digits kept', async () => {
  await setup();
  const cases = [
    ['UPPER@example.com', 'upper'],
    ['a.b-c+d@example.com', 'a_b_c_d'],
    ['x_1.9@example.com', 'x_1_9'],
  ];
  for (const [email, handle] of cases) {
    const r = await signup(email);
    assert.equal(r.status, 201, email);
    assert.equal((await get(r.json.token, '/me')).json.handle, handle, email);
  }
});

test('§4 derived handle truncated to 20 characters', async () => {
  await setup();
  const local = 'abcdefghij.klmnopqrst.uvwxyz'; // 28 chars
  const r = await signup(`${local}@example.com`);
  assert.equal(r.status, 201);
  const h = (await get(r.json.token, '/me')).json.handle;
  assert.equal(h, 'abcdefghij_klmnopqrs');
  assert.equal(h.length, 20);
  assert.match(h, /^[a-z0-9_]{1,20}$/);
});

test('§4/§6 new user can receive money by derived handle immediately and be asked for money', async () => {
  const { t } = await setup();
  const r = await signup('Newbie.One@example.com');
  const p = await pay(t.ada, { to_handle: 'newbie_one', amount: 250 });
  assert.equal(p.status, 201);
  assert.equal(await balance(r.json.token), 250);
});

test('§6 handle_taken: derived handle collides with seeded handle -> 409 handle_taken and NO account created', async () => {
  await setup();
  // 'ada' is a seeded handle; Ada.@... lowercases to 'ada_' (no collision) but ADA@ -> 'ada' collides
  const r = await signup('ADA@other.org');
  expectErr(r, 409, 'handle_taken');
  // no account created: login fails and the email is still unregistered
  expectErr(await http('POST', '/auth/login', { body: { email: 'ADA@other.org', password: 'longenough1' } }), 401, 'unauthenticated');
  // second collision via two different emails
  const a = await signup('dup@one.com');
  assert.equal(a.status, 201);
  expectErr(await signup('dup@two.com'), 409, 'handle_taken');
  expectErr(await signup('DUP@three.com'), 409, 'handle_taken');
  // truncation collision: two 25-char locals sharing first 20 chars
  const l1 = 'abcdefghijklmnopqrstAAAAA@x.com';
  const l2 = 'abcdefghijklmnopqrstBBBBB@x.com';
  assert.equal((await signup(l1)).status, 201);
  expectErr(await signup(l2), 409, 'handle_taken');
});

test('§6 email_taken: duplicate email -> 409 email_taken (seeded and signed up)', async () => {
  await setup();
  expectErr(await signup('ada@example.com'), 409, 'email_taken');
  assert.equal((await signup('fresh@example.com')).status, 201);
  expectErr(await signup('fresh@example.com'), 409, 'email_taken');
});

test('§6 password shorter than 8 -> 422; exactly 8 accepted', async () => {
  await setup();
  expectErr(await signup('short1@example.com', '1234567'), 422, 'validation_failed');
  expectErr(await signup('short2@example.com', ''), 422, 'validation_failed');
  // failed signup creates no account
  assert.equal((await signup('short1@example.com', '12345678')).status, 201);
  assert.equal((await signup('short3@example.com', '12345678')).status, 201);
});

test('§6 email not local@domain -> 422', async () => {
  await setup();
  for (const email of ['plain', '@example.com', 'a@', 'a b@example.com', 'a@@b.com', '']) {
    expectErr(await signup(email), 422, 'validation_failed');
  }
});

test('§5 signup missing required field -> 422; wrong JSON type -> 400; unparseable -> 400', async () => {
  await setup();
  expectErr(await http('POST', '/auth/signup', { body: { password: 'longenough1', display_name: 'x' } }), 422, 'validation_failed');
  expectErr(await http('POST', '/auth/signup', { body: { email: 'q@example.com', display_name: 'x' } }), 422, 'validation_failed');
  expectErr(await http('POST', '/auth/signup', { body: { email: 12, password: 'longenough1', display_name: 'x' } }), 400, 'malformed_request');
  expectErr(await http('POST', '/auth/signup', { raw: '{"email": ' }), 400, 'malformed_request');
});

test('§6 login: 200 with same user_id/display_name; wrong password and unknown email -> 401', async () => {
  await setup();
  const r = await http('POST', '/auth/login', { body: { email: 'bob@example.com', password: PW } });
  assert.equal(r.status, 200);
  assert.equal(r.json.user_id, 'u_bob');
  assert.equal(r.json.display_name, 'BOB');
  expectErr(await http('POST', '/auth/login', { body: { email: 'bob@example.com', password: 'nope-nope' } }), 401, 'unauthenticated');
  expectErr(await http('POST', '/auth/login', { body: { email: 'ghost@example.com', password: PW } }), 401, 'unauthenticated');
  expectErr(await http('POST', '/auth/login', { body: { email: 'bob@example.com', password: PW.toUpperCase() } }), 401, 'unauthenticated');
});

test('§6 signup user can log in with the chosen password', async () => {
  await setup();
  const s = await signup('login.me@example.com', 'sup3r-secret');
  const l = await http('POST', '/auth/login', { body: { email: 'login.me@example.com', password: 'sup3r-secret' } });
  assert.equal(l.status, 200);
  assert.equal(l.json.user_id, s.json.user_id);
});

test('§6 401 on missing / malformed / unknown bearer token for every authenticated endpoint', async () => {
  await setup();
  const endpoints = [
    ['GET', '/me'], ['GET', '/activity'], ['GET', '/requests'],
    ['POST', '/payments'], ['POST', '/requests'], ['POST', '/splits'], ['POST', '/settlements'],
    ['POST', '/requests/rq_x/pay'], ['POST', '/requests/rq_x/decline'], ['POST', '/requests/rq_x/cancel'],
  ];
  const headerSets = [
    {},
    { Authorization: 'Bearer ' },
    { Authorization: 'Bearer not-a-real-token' },
    { Authorization: 'Basic abc' },
    { Authorization: 'garbage' },
  ];
  for (const [m, p] of endpoints) {
    for (const headers of headerSets) {
      const r = await http(m, p, { headers: { ...headers, 'Idempotency-Key': 'k1' }, body: m === 'POST' ? {} : undefined });
      expectErr(r, 401, 'unauthenticated');
    }
  }
});

test('§6 multiple valid tokens per account; logins do not invalidate earlier tokens', async () => {
  await setup();
  const toks = new Set();
  for (let i = 0; i < 3; i++) {
    const l = await http('POST', '/auth/login', { body: { email: 'ada@example.com', password: PW } });
    toks.add(l.json.token);
  }
  assert.ok(toks.size >= 1);
  const l1 = await http('POST', '/auth/login', { body: { email: 'ada@example.com', password: PW } });
  const l2 = await http('POST', '/auth/login', { body: { email: 'ada@example.com', password: PW } });
  assert.equal((await get(l1.json.token, '/me')).json.user_id, 'u_ada');
  assert.equal((await get(l2.json.token, '/me')).json.user_id, 'u_ada');
  for (const t of toks) assert.equal((await get(t, '/me')).status, 200);
  // signup token and later login token both work
  const s = await signup('multi@example.com');
  const l = await http('POST', '/auth/login', { body: { email: 'multi@example.com', password: 'longenough1' } });
  assert.equal((await get(s.json.token, '/me')).status, 200);
  assert.equal((await get(l.json.token, '/me')).status, 200);
  // a payment through one token is visible through the other (same account)
  assert.equal((await pay(l1.json.token, { to_handle: 'bob', amount: 10 })).status, 201);
  assert.equal(await balance(l2.json.token), 9990);
});

test('§6 /health, /_test/reset and auth endpoints need no token', async () => {
  assert.equal((await http('GET', '/health')).status, 200);
  assert.equal((await http('POST', '/_test/reset', { body: fixture() })).status, 204);
  assert.equal((await http('POST', '/auth/login', { body: { email: 'ada@example.com', password: PW } })).status, 200);
});

test('§6 concurrent identical signups: exactly one account, others email_taken', async () => {
  await setup();
  const rs = await Promise.all(Array.from({ length: 10 }, () => signup('race@example.com')));
  const ok = rs.filter((r) => r.status === 201).length;
  assert.equal(ok, 1);
  for (const r of rs) assert.ok(r.status === 201 || r.status === 409, r.text);
  assert.ok(rs.every((r) => r.status < 500));
});

test('§4 handle uniqueness: seeded handle with 20 chars and underscore/digits is usable', async () => {
  await reset(fixture({ users: [user('u_a', 'a_b_c_d_e_f_g_h_i_j1', 100), user('u_b', 'b', 0)] }));
  const t = (await http('POST', '/auth/login', { body: { email: 'b@example.com', password: PW } })).json.token;
  assert.equal((await get(t, '/me')).json.handle, 'b');
  const r = await http('POST', '/payments', { token: t, key: 'k', body: { to_handle: 'a_b_c_d_e_f_g_h_i_j1', amount: 1 } });
  expectErr(r, 409, 'insufficient_funds');
});

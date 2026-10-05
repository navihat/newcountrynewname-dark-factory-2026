import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  http, fixture, user, reset, setup, login, balance, expectErr, pay, mkReq, payReq, settle, get, uniq, RFC3339, sleep, HOUR, DAY,
  seedAuth, mkAuth, capture, me, assertPaymentShape, at, atMs, ms, meQ, meAt, stmt, stmtAll, fixtureS, ledgerS, seedPay, S_OPEN, S_TOTAL, sumView, expectMe,
} from './lib.mjs';

const ALL = ['ada', 'bob', 'cy', 'dee', 'op', 'zed'];

// ---------------- payment timestamps / seeding ----------------

test('Payment timestamps: seeded created_at is the payment instant; fixture balances are NOT changed by seeded payments', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  assert.equal((await me(t.ada)).balance, 10000); assert.equal((await me(t.bob)).balance, 2500);
  assert.equal((await me(t.cy)).balance, 200); assert.equal((await me(t.dee)).balance, 500);
  const feed = (await get(t.ada, '/activity?limit=200')).json.payments;
  assert.ok(feed.length >= 3);
  for (const p of feed) assertPaymentShape(p, 'activity item');
  const p1 = feed.find((p) => p.amount === 500 && p.note === 'one');
  assert.equal(ms(p1.created_at), ms(at(now - 5 * DAY)));
  // newest first by created_at
  const times = feed.map((p) => ms(p.created_at));
  assert.deepEqual(times, [...times].sort((x, y) => y - x));
});

test('Payment timestamps: created_at supplied with a +02:00 offset denotes the same instant', async () => {
  const base = Date.now() - 3 * DAY;
  const utc = new Date(base);
  const pad = (n) => String(n).padStart(2, '0');
  const local = new Date(base + 2 * HOUR); // wall clock of UTC+2
  const s = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}+02:00`;
  const fx = fixture({
    users: [user('u_a', 'a', 900), user('u_b', 'b', 100)],
    payments: [seedPay('p_1', 'u_a', 'u_b', 100, s)], settlement_operator_ids: [],
  });
  const { t } = await setup(fx, ['a', 'b']);
  const p = (await get(t.a, '/activity')).json.payments[0];
  assert.match(p.created_at, RFC3339);
  assert.equal(ms(p.created_at), Math.floor(utc.getTime() / 1000) * 1000);
  assert.equal(await balance(t.a), 900);
  const opening = await meAt(t.a, { as_of: at(base - 2000) });
  assert.equal(opening.balance, 1000);
});

test('Payment timestamps: omitted created_at uses reset time, strictly before payments created later through the API', async () => {
  const before = Date.now();
  const fx = fixture({ payments: [seedPay('p_1', 'u_ada', 'u_bob', 100, undefined)] });
  fx.users[0].balance = 10000;
  const { t } = await setup(fx);
  const after = Date.now();
  await sleep(1100);
  const api = (await pay(t.ada, { to_handle: 'bob', amount: 5 })).json;
  const seeded = (await get(t.ada, '/activity?limit=200')).json.payments.find((p) => p.amount === 100);
  assert.match(seeded.created_at, RFC3339);
  assert.ok(ms(seeded.created_at) >= before - 1000 && ms(seeded.created_at) <= after + 1000, `reset-time created_at expected, got ${seeded.created_at}`);
  assert.ok(ms(seeded.created_at) < ms(api.created_at), 'seeded payment precedes later API payments');
  // activity ordering by created_at, newest first
  const feed = (await get(t.ada, '/activity?limit=200')).json.payments;
  assert.deepEqual(feed.map((p) => p.amount), [5, 100]);
  // opening balance subtracts the seeded payment's effect: before reset time ada held 10100
  const op = await meAt(t.ada, { as_of: at(before - 3600e3) });
  assert.equal(op.balance, 10100);
  assert.equal(await balance(t.ada), 9995);
});

test('Payment timestamps: seeded created_at in the FUTURE -> 422 validation_failed from reset, state unchanged', async () => {
  const { t } = await setup();
  assert.equal((await pay(t.ada, { to_handle: 'bob', amount: 100 })).status, 201);
  const fut = fixture({ payments: [seedPay('p_1', 'u_ada', 'u_bob', 100, at(Date.now() + 2 * DAY))] });
  expectErr(await http('POST', '/_test/reset', { body: fut }), 422, 'validation_failed');
  assert.equal(await balance(t.ada), 9900);
  assert.equal((await get(t.ada, '/activity')).json.payments.length, 1);
  // even one hour ahead is rejected, while a time safely in the past is fine
  expectErr(await http('POST', '/_test/reset', { body: fixture({ payments: [seedPay('p_1', 'u_ada', 'u_bob', 100, at(Date.now() + HOUR))] }) }), 422, 'validation_failed');
  assert.equal(await balance(t.ada), 9900);
});

test('Payment timestamps: every endpoint that returns a payment includes created_at (RFC 3339 with offset)', async () => {
  const { t } = await setup();
  const direct = (await pay(t.ada, { to_handle: 'bob', amount: 10 })).json;
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 20 })).json;
  const viaReq = (await payReq(t.ada, rq.request_id)).json;
  const st = (await settle(t.op, { transfers: [{ from_handle: 'op', to_handle: 'cy', amount: 5 }] })).json;
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 50 })).json;
  const cap = (await capture(t.bob, a.authorization_id, {})).json;
  for (const [label, p] of [['payments', direct], ['request pay', viaReq], ['settlement member', st.payments[0]], ['capture', cap]]) assertPaymentShape(p, label);
  for (const p of (await get(t.ada, '/activity?limit=200')).json.payments) assertPaymentShape(p, 'activity');
  const s = await stmt(t.ada);
  for (const e of s.entries) assertPaymentShape(e.payment, 'statement payment');
  const revs = (await http('GET', `/payments/${direct.payment_id}/revisions`, { token: t.ada })).json.revisions;
  assert.equal(revs.length, 1);
});

// ---------------- GET /me as_of ----------------

test('as_of: inclusive boundary — payment at exactly as_of counts; just before it does not; per-user balances', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const d = (n) => now - n * DAY;
  const L = ledgerS(now);
  const cases = [
    [d(5) - 1000, 'ada', 9600], [d(5), 'ada', 9100], [d(5) + 1000, 'ada', 9100], [d(4), 'ada', 10300], [d(3) - 1000, 'ada', 10300],
    [d(3), 'ada', 10000], [d(2), 'ada', 10000],
    [d(5), 'bob', 3700], [d(4), 'bob', 2500], [d(4) - 1000, 'bob', 3700],
    [d(3), 'cy', 300], [d(2), 'cy', 200], [d(2) - 1000, 'cy', 300],
    [d(2), 'dee', 500], [d(2) - 1000, 'dee', 400], [d(10), 'dee', 400],
    [d(1), 'op', 100000], [d(10), 'op', 100000],
  ];
  for (const [when, who, expected] of cases) {
    const m = await meAt(t[who], { as_of: at(when) });
    assert.equal(m.balance, expected, `${who} as_of ${at(when)}`);
    assert.equal(m.total, expected); assert.equal(m.held, 0); assert.equal(m.available, expected);
    assert.equal(m.balance, L.balanceAt(`u_${who}`, when));
    assert.equal(m.as_of, at(when), 'as_of echoed exactly as given');
  }
});

test('as_of: before the earliest payment = opening balance; at/after the latest = current balance; far future = current', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  assert.equal((await meAt(t.ada, { as_of: at(now - 400 * DAY) })).balance, 9600);
  assert.equal((await meAt(t.ada, { as_of: '1970-01-01T00:00:00+00:00' })).balance, 9600);
  assert.equal((await meAt(t.ada, { as_of: at(now - 3 * DAY) })).balance, 10000);
  assert.equal((await meAt(t.ada, { as_of: at(now) })).balance, 10000);
  assert.equal((await meAt(t.ada, { as_of: at(now + 400 * DAY) })).balance, 10000);
  assert.equal((await meAt(t.ada, { as_of: '2999-12-31T23:59:59+00:00' })).balance, 10000);
  assert.equal((await meAt(t.zed, { as_of: at(now - 100 * DAY) })).balance, 0, 'seeded user without payments');
  assert.equal((await meAt(t.zed, { as_of: at(now + 100 * DAY) })).balance, 0);
  // a payment made after the seed moves "current" but not older views
  await sleep(1100);
  const np = (await pay(t.ada, { to_handle: 'zed', amount: 77 })).json;
  assert.equal((await meAt(t.ada, { as_of: at(now + 400 * DAY) })).balance, 9923);
  assert.equal((await meAt(t.ada, { as_of: np.created_at })).balance, 9923, 'created_at echoed back as as_of includes the payment');
  assert.equal((await meAt(t.zed, { as_of: np.created_at })).balance, 77);
  assert.equal((await meAt(t.zed, { as_of: at(ms(np.created_at) - 1000) })).balance, 0);
  assert.equal((await meAt(t.ada, { as_of: at(now - 3 * DAY) })).balance, 10000);
});

test('as_of: new accounts open at zero and see only their own payments; opening balances are per user', async () => {
  const { t } = await setup();
  const s = await http('POST', '/auth/signup', { body: { email: 'fresh.user@example.com', password: 'longenough1', display_name: 'F' } });
  const tok = s.json.token;
  await sleep(1100);
  const p = (await pay(t.ada, { to_handle: 'fresh_user', amount: 1234 })).json;
  assert.equal((await meAt(tok, { as_of: at(ms(p.created_at) - 2000) })).balance, 0);
  assert.equal((await meAt(tok, { as_of: p.created_at })).balance, 1234);
  assert.equal((await meAt(tok, { as_of: '2000-01-01T00:00:00+00:00' })).balance, 0);
  assert.equal((await meAt(t.ada, { as_of: '2000-01-01T00:00:00+00:00' })).balance, 10000);
  assert.equal((await meAt(t.bob, { as_of: '2000-01-01T00:00:00+00:00' })).balance, 2500);
  const st = await stmt(tok);
  assert.equal(st.opening_balance, 0); assert.equal(st.closing_balance, 1234);
});

test('as_of: echo is exact for different offset spellings (Z, +02:00, fractional seconds, -05:30)', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const base = new Date(now - 3 * DAY - 500);
  const forms = [
    base.toISOString(), // ...Z with ms
    base.toISOString().replace(/\.\d+Z$/, 'Z'),
    `${new Date(base.getTime() + 2 * HOUR).toISOString().replace(/\.\d+Z$/, '')}+02:00`,
    `${new Date(base.getTime() - (5 * HOUR + 30 * 60e3)).toISOString().replace(/\.\d+Z$/, '')}-05:30`,
    `${base.toISOString().replace('Z', '123Z')}`,
  ];
  for (const f of forms) {
    const r = await meQ(t.ada, { as_of: f });
    assert.equal(r.status, 200, `${f}: ${r.text}`);
    assert.equal(r.json.as_of, f, 'as_of echoed exactly as given');
  }
  // the encoded "+" form of the specification's example
  const raw = await http('GET', '/me?as_of=2026-09-24T13:20:00%2B00:00', { token: t.ada });
  assert.equal(raw.status, 200);
  assert.equal(raw.json.as_of, '2026-09-24T13:20:00+00:00');
});

test('as_of / known_at invalid values -> 422 validation_failed (naive, bare date, empty, garbage, bad calendar values)', async () => {
  const { t } = await setup(fixtureS());
  const bad = ['2026-09-24T13:20:00', '2026-09-24', '', 'garbage', '1700000000', '2026-13-01T00:00:00+00:00', '2026-02-30T00:00:00+00:00', '2026-09-24T25:00:00+00:00', '13:20:00+00:00', 'now', 'null'];
  for (const param of ['as_of', 'known_at']) {
    for (const v of bad) {
      const r = await http('GET', `/me?${param}=${encodeURIComponent(v)}`, { token: t.ada });
      expectErr(r, 422, 'validation_failed');
    }
    expectErr(await http('GET', `/me?${param}`, { token: t.ada }), 422, 'validation_failed'); // present but empty
    expectErr(await http('GET', `/me?${param}=`, { token: t.ada }), 422, 'validation_failed');
    expectErr(await http('GET', `/statement?${param === 'as_of' ? 'from' : 'known_at'}=2026-09-24`, { token: t.ada }), 422, 'validation_failed');
  }
  // valid one next to an invalid other
  expectErr(await meQ(t.ada, { as_of: '2026-09-24T13:20:00+00:00', known_at: 'nope' }), 422, 'validation_failed');
});

test('/me without temporal parameters is unchanged (current corrected values); unknown params ignored; 401 without token', async () => {
  const { t } = await setup(fixtureS());
  const m = await me(t.ada);
  expectMe(m, { total: 10000, available: 10000, held: 0 });
  assert.ok(!('as_of' in m) || m.as_of === null || m.as_of === undefined, 'no as_of echo when not supplied');
  assert.equal((await http('GET', '/me?foo=bar', { token: t.ada })).status, 200);
  expectErr(await http('GET', `/me?as_of=${encodeURIComponent(at(Date.now()))}`), 401, 'unauthenticated');
  for (const f of ['user_id', 'display_name', 'handle', 'currency', 'minor_units']) assert.ok(f in (await meAt(t.ada, { as_of: at(Date.now()) })), f);
});

test('known_at: same validation, exact echo, may be in the future; without corrections it changes nothing except payments not yet recorded', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const k = at(now + 3 * DAY);
  const r = await meAt(t.ada, { known_at: k });
  assert.equal(r.known_at, k);
  assert.equal(r.balance, 10000);
  const both = await meAt(t.ada, { as_of: at(now - 4 * DAY), known_at: at(now + DAY) });
  assert.equal(both.balance, 10300); assert.equal(both.as_of, at(now - 4 * DAY)); assert.equal(both.known_at, at(now + DAY));
  // known_at before any recording: payment contributes nothing -> only opening balance
  const early = await meAt(t.ada, { known_at: at(now - 6 * DAY) });
  assert.equal(early.balance, 9600);
  // known_at between recordings: payments recorded at or before count
  assert.equal((await meAt(t.ada, { known_at: at(now - 5 * DAY) })).balance, 9100, 'recorded exactly at known_at counts');
  assert.equal((await meAt(t.ada, { known_at: at(now - 5 * DAY + 1000) })).balance, 9100);
  assert.equal((await meAt(t.ada, { known_at: at(now - 4 * DAY - 1000) })).balance, 9100);
  assert.equal((await meAt(t.bob, { known_at: at(now - 3 * DAY) })).balance, 2500);
});

test('Historical views conserve money: sum of all wallets equals the seeded total for every as_of / known_at', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const tokens = ALL.map((h) => t[h]);
  const instants = [now - 400 * DAY, now - 5 * DAY, now - 4.5 * DAY, now - 4 * DAY, now - 3 * DAY, now - 2 * DAY, now - DAY, now, now + 5 * DAY];
  for (const a of instants) {
    assert.equal(await sumView(tokens, { as_of: at(a) }), S_TOTAL, `as_of ${at(a)}`);
  }
  // with known_at the sum also stays constant only while every payment is known or none; opening totals are covered separately
  assert.equal(await sumView(tokens, { as_of: at(now), known_at: at(now + DAY) }), S_TOTAL);
  assert.equal(await sumView(tokens, { as_of: at(now), known_at: at(now - 400 * DAY) }), Object.values(S_OPEN).reduce((x, y) => x + y, 0));
});

test('Seeded history reconstructs opening balances: opening = ending balance minus net effect of seeded payments; statement identity holds', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const exp = { ada: [9600, 10000], bob: [3200, 2500], cy: [0, 200], dee: [400, 500], op: [100000, 100000], zed: [0, 0] };
  for (const [h, [o, c]] of Object.entries(exp)) {
    const s = await stmt(t[h]);
    assert.equal(s.opening_balance, o, `${h} opening`);
    assert.equal(s.closing_balance, c, `${h} closing`);
    assert.equal(s.opening_balance + s.entries.reduce((a, e) => a + e.delta, 0), s.closing_balance, `${h} identity`);
    assert.equal((await me(t[h])).balance, c);
  }
});

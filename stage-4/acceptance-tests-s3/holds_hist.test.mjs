import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  http, fixture, user, setup, balance, expectErr, pay, get, uniq, RFC3339, sleep, HOUR, DAY,
  seedAuth, mkAuth, capture, voidAuth, me, auths, authById, atMs as at, ms, meAt, stmt, correct, fixtureS, sumView,
} from './lib.mjs';

/** all four money fields must describe one view */
function view(m, { total, held }, label = '') {
  assert.equal(m.balance, m.total, 'balance = total');
  assert.equal(m.available, m.total - m.held, 'available = total - held');
  assert.equal(m.total, total, `total ${label} ${JSON.stringify(m)}`);
  assert.equal(m.held, held, `held ${label} ${JSON.stringify(m)}`);
  assert.ok(m.available >= 0);
}
const H = async (t, who, params, exp) => view(await meAt(t[who], params), exp, JSON.stringify(params));
const P = (x) => (typeof x === 'string' ? x : at(x)); // exact instants are passed as the original strings, offsets as numbers

test('Historical holds: lifecycle authorize -> nonfinal capture -> final capture releases remainder -> second hold -> void (as_of grid)', async () => {
  const { t } = await setup();
  await sleep(1100);
  const A = (await mkAuth(t.ada, { to_handle: 'bob', amount: 2000 })).json;
  const cA = ms(A.created_at);
  await sleep(1200);
  const c1 = (await capture(t.bob, A.authorization_id, { amount: 700, final: false })).json;
  const e1 = ms(c1.created_at);
  await sleep(1200);
  const c2 = (await capture(t.bob, A.authorization_id, { amount: 500 })).json; // final: 800 released
  const e2 = ms(c2.created_at);
  await sleep(1200);
  const B = (await mkAuth(t.ada, { to_handle: 'cy', amount: 1000 })).json;
  const cB = ms(B.created_at);
  await sleep(1200);
  assert.equal((await voidAuth(t.ada, B.authorization_id)).status, 200);
  const recA = await authById(t.ada, A.authorization_id), recB = await authById(t.ada, B.authorization_id);
  assert.equal(recA.status, 'captured'); assert.equal(recB.status, 'voided');
  assert.match(recA.closed_at, RFC3339); assert.match(recB.closed_at, RFC3339);
  assert.equal(ms(recA.closed_at), e2, 'final capture closes the hold at the capture time');
  const vB = ms(recB.closed_at);
  assert.ok(vB > cB);
  const grid = [
    [cA - 1000, 10000, 0], [A.created_at, 10000, 2000], [e1 - 1000, 10000, 2000], [c1.created_at, 9300, 1300], [e2 - 1000, 9300, 1300], [c2.created_at, 8800, 0],
    [cB - 1000, 8800, 0], [B.created_at, 8800, 1000], [vB - 1000, 8800, 1000], [recB.closed_at, 8800, 0], [vB + DAY, 8800, 0],
  ];
  for (const [when, total, held] of grid) await H(t, 'ada', { as_of: P(when) }, { total, held });
  // receiver: holds are not hers
  for (const [when, total] of [[A.created_at, 2500], [c1.created_at, 3200], [c2.created_at, 3700]]) await H(t, 'bob', { as_of: when }, { total, held: 0 });
  // current (no as_of) equals the latest view
  await H(t, 'ada', {}, { total: 8800, held: 0 });
  // with a fractional-second exact instant: as_of equal to the event time counts as happened
  await H(t, 'ada', { as_of: A.created_at }, { total: 10000, held: 2000 });
  await H(t, 'ada', { as_of: c1.created_at }, { total: 9300, held: 1300 });
  await H(t, 'ada', { as_of: recA.closed_at }, { total: 8800, held: 0 });
  // known_at: events are known at their own event time
  const k = (ts) => ({ as_of: at(Date.now() + 30e3), known_at: P(ts) });
  await H(t, 'ada', k(cA - 1000), { total: 10000, held: 0 });          // creation not yet known
  await H(t, 'ada', k(A.created_at), { total: 10000, held: 2000 });
  await H(t, 'ada', k(c1.created_at), { total: 9300, held: 1300 });                // capture known, final release not yet
  await H(t, 'ada', k(e2 - 1000), { total: 9300, held: 1300 });
  await H(t, 'ada', k(c2.created_at), { total: 8800, held: 0 });
  await H(t, 'ada', k(B.created_at), { total: 8800, held: 1000 });                // B created, its void (later) not yet known
  await H(t, 'ada', k(vB - 1000), { total: 8800, held: 1000 });
  await H(t, 'ada', k(recB.closed_at), { total: 8800, held: 0 });
  // an as_of in the past with a known_at in the past that has not yet learned the void
  await H(t, 'ada', { as_of: at(vB + 500), known_at: at(vB - 500) }, { total: 8800, held: 1000 });
  // money conservation in the same views
  const tokens = ['ada', 'bob', 'cy', 'dee', 'op'].map((h) => t[h]);
  for (const when of [A.created_at, c1.created_at, c2.created_at, recB.closed_at]) assert.equal(await sumView(tokens, { as_of: when }), 10000 + 2500 + 0 + 500 + 100000);
  // statements stay money-only
  const s = await stmt(t.ada);
  assert.deepEqual(s.entries.map((e) => e.payment.payment_id), [c1.payment_id, c2.payment_id]);
});

test('Historical holds: authorizations expose closed_at (null while open; event time when closed) for capture, void and expiry', async () => {
  const { t } = await setup(fixtureShort());
  const open = (await mkAuth(t.ada, { to_handle: 'bob', amount: 100 })).json;
  assert.ok(open.closed_at === null, `closed_at null while open: ${JSON.stringify(open)}`);
  assert.equal((await authById(t.bob, open.authorization_id)).closed_at, null);
  const voided = (await mkAuth(t.ada, { to_handle: 'bob', amount: 100 })).json;
  const v = await voidAuth(t.ada, voided.authorization_id);
  assert.match(v.json.closed_at, RFC3339);
  assert.ok(ms(v.json.closed_at) >= ms(voided.created_at));
  const capd = (await mkAuth(t.ada, { to_handle: 'bob', amount: 100 })).json;
  const cp = (await capture(t.bob, capd.authorization_id, { amount: 40 })).json;
  assert.equal(ms((await authById(t.ada, capd.authorization_id)).closed_at), ms(cp.created_at));
  const partial = (await mkAuth(t.ada, { to_handle: 'bob', amount: 100 })).json;
  await capture(t.bob, partial.authorization_id, { amount: 40, final: false });
  assert.equal((await authById(t.ada, partial.authorization_id)).closed_at, null, 'still open after a nonfinal capture');
  await sleep(3500); // short ttl: everything open expires
  const exp = await authById(t.ada, open.authorization_id);
  assert.equal(exp.status, 'expired');
  assert.equal(ms(exp.closed_at), ms(open.expires_at), 'expiry closes at expires_at');
  const pexp = await authById(t.ada, partial.authorization_id);
  assert.equal(pexp.status, 'expired'); assert.equal(ms(pexp.closed_at), ms(partial.expires_at));
  assert.equal(pexp.captured_amount, 40);
  // closed_at is part of every listing
  for (const a of (await auths(t.ada, '?limit=200')).authorizations) assert.ok('closed_at' in a, 'closed_at key present');
});

function fixtureShort() { return fixture({ authorization_ttl_seconds: 3 }); }

test('Historical holds: clock expiry takes effect AT expires_at; known creation implies known deadline; GET /authorizations shows expired', async () => {
  const { t } = await setup(fixtureShort());
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 3000 })).json;
  const c = ms(a.created_at), E = ms(a.expires_at);
  assert.equal(E - c, 3000);
  await H(t, 'ada', { as_of: a.created_at }, { total: 10000, held: 3000 });
  await H(t, 'ada', { as_of: at(E - 1000) }, { total: 10000, held: 3000 });
  await H(t, 'ada', { as_of: a.expires_at }, { total: 10000, held: 0 });          // takes effect at expires_at
  await H(t, 'ada', { as_of: at(E + 1000) }, { total: 10000, held: 0 });
  await sleep(Math.max(0, E - Date.now()) + 800);
  view(await me(t.ada), { total: 10000, held: 0 });
  assert.equal((await authById(t.ada, a.authorization_id)).status, 'expired');
  // creation known -> deadline known: a known_at between creation and expiry still releases at the deadline
  await H(t, 'ada', { as_of: at(E + 1000), known_at: a.created_at }, { total: 10000, held: 0 });
  await H(t, 'ada', { as_of: at(E - 1000), known_at: a.created_at }, { total: 10000, held: 3000 });
  // creation not yet known
  await H(t, 'ada', { as_of: at(E - 1000), known_at: at(c - 1000) }, { total: 10000, held: 0 });
  await H(t, 'ada', { as_of: at(E - 1000), known_at: at(E - 1000) }, { total: 10000, held: 3000 });
});

test('Historical holds: partially captured then expired — capture reduces the hold at capture time, expiry releases only the remainder at the deadline', async () => {
  const { t } = await setup(fixtureShort());
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 2000 })).json;
  await sleep(1100);
  const c = (await capture(t.bob, a.authorization_id, { amount: 600, final: false })).json;
  const cap = ms(c.created_at), E = ms(a.expires_at);
  await sleep(Math.max(0, E - Date.now()) + 800);
  await H(t, 'ada', { as_of: at(cap - 1000) }, { total: 10000, held: 2000 });
  await H(t, 'ada', { as_of: c.created_at }, { total: 9400, held: 1400 });
  await H(t, 'ada', { as_of: at(E - 500) }, { total: 9400, held: 1400 });
  await H(t, 'ada', { as_of: a.expires_at }, { total: 9400, held: 0 });
  view(await me(t.ada), { total: 9400, held: 0 });
  const rec = await authById(t.ada, a.authorization_id);
  assert.equal(rec.status, 'expired'); assert.equal(rec.remaining_amount, 0); assert.equal(rec.captured_amount, 600);
  assert.equal(await balance(t.bob), 2500 + 600);
});

test('Historical holds: queries beyond now — an open hold expires at its deadline (default ttl 600)', async () => {
  const { t } = await setup();
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 2000 })).json;
  const E = ms(a.expires_at);
  await H(t, 'ada', { as_of: at(Date.now() + 60e3) }, { total: 10000, held: 2000 });
  await H(t, 'ada', { as_of: at(E - 1000) }, { total: 10000, held: 2000 });
  await H(t, 'ada', { as_of: a.expires_at }, { total: 10000, held: 0 });
  await H(t, 'ada', { as_of: at(Date.now() + HOUR) }, { total: 10000, held: 0 });
  await H(t, 'ada', { as_of: at(Date.now() + 400 * DAY) }, { total: 10000, held: 0 });
  await H(t, 'ada', { as_of: at(Date.now() + HOUR), known_at: at(Date.now() + 2 * HOUR) }, { total: 10000, held: 0 });
  // without as_of the instant the request began is used: the hold is still held now
  view(await me(t.ada), { total: 10000, held: 2000 });
  // after a void the hold stays released in the future too
  const b = (await mkAuth(t.ada, { to_handle: 'bob', amount: 500 })).json;
  await voidAuth(t.ada, b.authorization_id);
  await H(t, 'ada', { as_of: at(Date.now() + 60e3) }, { total: 10000, held: 2000 });
});

test('Historical holds: seeded open holds are created at reset time unless created_at is supplied; closed seeded holds hold nothing', async () => {
  const before = Date.now();
  const fx = fixture({
    authorizations: [
      seedAuth('a_1', 'u_ada', 'u_bob', 2000, { note: 'seed', expires_at: at(before + 2 * HOUR) }),
      seedAuth('a_2', 'u_ada', 'u_cy', 500, { created_at: at(before - 2 * HOUR), expires_at: at(before + 3 * HOUR) }),
      seedAuth('a_3', 'u_ada', 'u_cy', 700, { status: 'captured' }),
      seedAuth('a_4', 'u_ada', 'u_cy', 700, { status: 'voided' }),
      seedAuth('a_5', 'u_ada', 'u_cy', 700, { status: 'expired', expires_at: at(before - 2 * HOUR) }),
    ],
  });
  const { t } = await setup(fx);
  await sleep(300);
  // a_1 (no created_at): created at reset; a_2: created two hours ago
  await H(t, 'ada', { as_of: at(before - 3 * HOUR) }, { total: 10000, held: 0 });
  await H(t, 'ada', { as_of: at(before - 90 * 60e3) }, { total: 10000, held: 500 });
  await H(t, 'ada', { as_of: at(before - 600e3) }, { total: 10000, held: 500 }, 'before reset: only the dated hold exists');
  await H(t, 'ada', { as_of: at(Date.now() + 1000) }, { total: 10000, held: 2500 });
  await H(t, 'ada', { as_of: at(before + 2.5 * HOUR) }, { total: 10000, held: 500 }, 'a_1 expired at +2h, a_2 still held');
  await H(t, 'ada', { as_of: at(before + 4 * HOUR) }, { total: 10000, held: 0 });
  view(await me(t.ada), { total: 10000, held: 2500 });
  // known_at: a seeded hold is known from its creation
  await H(t, 'ada', { as_of: at(Date.now() + 1000), known_at: at(before - 3 * HOUR) }, { total: 10000, held: 0 });
  const list = (await auths(t.ada, '?limit=200')).authorizations;
  assert.equal(list.length, 5);
  for (const a of list) assert.ok('closed_at' in a);
  for (const a of list.filter((x) => x.status === 'open')) assert.equal(a.closed_at, null);
  assert.equal(list.filter((x) => x.status === 'open').length, 2);
});

test('Historical overdraft with holds: a correction that would make AVAILABLE negative at a past event boundary -> 409 historical_overdraft', async () => {
  const { t } = await setup();
  await sleep(1100);
  const P = (await pay(t.ada, { to_handle: 'bob', amount: 3000, note: 'P' })).json; // bob: 2500 -> 5500
  await sleep(1200);
  const B = (await mkAuth(t.bob, { to_handle: 'cy', amount: 5500 })).json;          // bob available 0 at cB
  await sleep(1200);
  const cB = ms(B.created_at);
  // moving P to AFTER the hold: at cB bob would hold 5500 against a total of only 2500 -> available -3000; total itself stays >= 0
  const bad = await correct(t.ada, P.payment_id, { expected_revision: 1, amount: 3000, effective_at: at(cB + 1000), reason: 'moved later' });
  expectErr(bad, 409, 'historical_overdraft');
  view(await me(t.bob), { total: 5500, held: 5500 });
  assert.equal((await http('GET', `/payments/${P.payment_id}/revisions`, { token: t.ada })).json.revisions.length, 1);
  // a decrease would debit bob's CURRENT available (0) -> insufficient_funds takes precedence
  expectErr(await correct(t.ada, P.payment_id, { expected_revision: 1, amount: 2000, effective_at: P.created_at, reason: 'less' }), 409, 'insufficient_funds');
  // voiding the hold does not rewrite history: bob still held 5500 from cB, so lowering P stays a historical overdraft...
  await voidAuth(t.bob, B.authorization_id);
  expectErr(await correct(t.ada, P.payment_id, { expected_revision: 1, amount: 2000, effective_at: P.created_at, reason: 'less' }), 409, 'historical_overdraft');
  // ...while raising P (more money for bob at every boundary) is fine
  const ok = await correct(t.ada, P.payment_id, { expected_revision: 1, amount: 3500, effective_at: P.created_at, reason: 'more' });
  assert.equal(ok.status, 201, ok.text);
});

test('Historical overdraft with holds: a correction that keeps every past boundary valid (including holds) succeeds', async () => {
  const { t } = await setup();
  await sleep(1100);
  const P = (await pay(t.ada, { to_handle: 'bob', amount: 3000 })).json;
  await sleep(1200);
  const B = (await mkAuth(t.bob, { to_handle: 'cy', amount: 2500 })).json;       // fits in bob's opening 2500 even without P
  await sleep(1200);
  const ok = await correct(t.ada, P.payment_id, { expected_revision: 1, amount: 3000, effective_at: at(ms(B.created_at) + 1000), reason: 'later' });
  assert.equal(ok.status, 201, ok.text);
  await H(t, 'bob', { as_of: B.created_at }, { total: 2500, held: 2500 });
  await H(t, 'bob', { as_of: at(ms(B.created_at) + 1500) }, { total: 5500, held: 2500 });
  // lowering P below what bob's hold history needs is a current-available problem, not historical
  view(await me(t.bob), { total: 5500, held: 2500 });
});

test('Historical overdraft with holds: capture-driven history — corrections see total AND available at capture boundaries', async () => {
  const { t } = await setup();
  await sleep(1100);
  const P = (await pay(t.ada, { to_handle: 'dee', amount: 1000, note: 'P' })).json; // dee 500 -> 1500
  await sleep(1200);
  const A = (await mkAuth(t.dee, { to_handle: 'cy', amount: 1500 })).json;          // dee: total 1500, held 1500
  await sleep(1200);
  const cap = (await capture(t.cy, A.authorization_id, { amount: 1500 })).json;      // dee total 0 at capture time
  await sleep(1200);
  // delaying P until after the capture would leave dee at 500 total against a 1500 capture -> negative total at the capture boundary
  expectErr(await correct(t.ada, P.payment_id, { expected_revision: 1, amount: 1000, effective_at: at(ms(cap.created_at) + 1000), reason: 'late' }), 409, 'historical_overdraft');
  view(await me(t.dee), { total: 0, held: 0 });
  const rv = (await http('GET', `/payments/${P.payment_id}/revisions`, { token: t.ada })).json.revisions;
  assert.equal(rv.length, 1);
});

test('Historical views never mix: as_of/known_at on /me for the receiver of holds stays total-only; sums stay conserved with holds in play', async () => {
  const { t } = await setup();
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 1000 })).json;
  await sleep(1100);
  await capture(t.bob, a.authorization_id, { amount: 400, final: false });
  const tokens = ['ada', 'bob', 'cy', 'dee', 'op'].map((h) => t[h]);
  for (const off of [-HOUR, 0, 500, 5000, HOUR]) assert.equal(await sumView(tokens, { as_of: at(Date.now() + off) }), 10000 + 2500 + 500 + 100000);
  const m = await meAt(t.bob, { as_of: at(Date.now() + HOUR) });
  assert.equal(m.held, 0); assert.equal(m.available, m.total);
});

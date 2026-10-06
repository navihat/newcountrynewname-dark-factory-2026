import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  http, fixture, user, reset, setup, balance, expectErr, pay, mkReq, payReq, settle, get, uniq, PW, RFC3339, sleep, DAY,
  mkAuth, capture, me, auths, at, ms, meAt, stmt, stmtQ, correct, revisions, refund, batch, bItem, fixtureS, sIds, sumView,
} from './lib.mjs';

const load = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const BUNDLES = [['stage-1', load('stage1-export.json'), load('stage1-scenario.json')], ['stage-2', load('stage2-export.json'), load('stage2-scenario.json')], ['stage-3', load('stage3-export.json'), load('stage3-scenario.json')]];
const exportState = async () => { const r = await http('GET', '/_test/export'); assert.equal(r.status, 200, r.text); return r.json; };
const importState = (o) => http('POST', '/_test/import', { body: o });
const superset = (got, orig, label) => { for (const [k, v] of Object.entries(orig)) assert.deepEqual(got[k], v, `${label}: ${k}`); };
const curRev = async (tok, id) => { const l = (await revisions(tok, id)).json.revisions; return l[l.length - 1].revision; };
const HANDLES = ['ada', 'bob', 'cy', 'dee', 'op'];
// stage-4 adds fields (refund_of, correction_batch_id) to bodies saved by earlier versions: compare what the OLD body carried
const normEntries = (es) => es.map((x) => { const p = { ...x.payment }; delete p.refund_of; return { ...x, payment: p }; });
const supRevs = (got, saved, label) => { assert.equal(got.length, saved.length, label); saved.forEach((r, i) => superset(got[i], r, `${label}[${i}]`)); };

for (const [label, EXP, SC] of BUNDLES) {
  test(`Upgrade from a real ${label} export: accepted unchanged; tokens, logins, balances survive; pending requests payable; retry keys replay originals`, async () => {
    await reset(fixture({ users: [user('u_zzz', 'zzz', 1)], settlement_operator_ids: [] }));
    const imp = await importState(EXP);
    assert.equal(imp.status, 204, imp.text);
    for (const h of HANDLES) {
      const m = await me(SC.tokens[h]);
      assert.equal(m.balance, SC.balances[h], `${h} balance`); assert.equal(m.balance, m.total); assert.equal(m.available, m.total - m.held);
      assert.equal((await http('POST', '/auth/login', { body: { email: `${h}@example.com`, password: PW } })).status, 200);
    }
    expectErr(await http('POST', '/auth/login', { body: { email: 'zzz@example.com', password: PW } }), 401, 'unauthenticated');
    for (const [name, path] of Object.entries(SC.paths || { lost_payment: '/payments', private_payment: '/payments', request_pending: '/requests', settlement: '/settlements' })) {
      const actor = { lost_payment: 'ada', private_payment: 'ada', request_pending: 'bob', settlement: 'op', auth_open: 'ada', auth_captured: 'ada', auth_voided: 'ada', capture_nonfinal: 'bob', capture_final: 'cy', capture: 'bob', correction_one: 'ada', correction_lost: 'ada' }[name];
      const rep = await http('POST', path, { token: SC.tokens[actor], key: SC.keys[name], body: SC.bodies[name] });
      assert.equal(rep.status, 200, `${name}: ${rep.text}`);
      superset(rep.json, SC.responses[name], name);
    }
    for (const h of HANDLES) assert.equal(await balance(SC.tokens[h]), SC.balances[h], `${h}: replays moved nothing`);
    const r = await payReq(SC.tokens.ada, SC.pending_request_id, {});
    assert.equal(r.status, 201, r.text); assert.equal(r.json.refund_of, null);
  });

  test(`Upgrade from ${label}: refunds and batch corrections work on imported payments; settlement membership is retained`, async () => {
    await reset(fixture());
    assert.equal((await importState(EXP)).status, 204);
    const lost = SC.responses.lost_payment, priv = SC.responses.private_payment;
    // refund on an imported payment (receiver bob)
    const r = await refund(SC.tokens.bob, lost.payment_id, { amount: 200 });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.refund_of, lost.payment_id); assert.equal(r.json.from_handle, 'bob'); assert.equal(r.json.to_handle, 'ada'); assert.equal(r.json.request_id, null); assert.equal(r.json.note, lost.note);
    const cur = (await revisions(SC.tokens.ada, lost.payment_id)).json.revisions;
    const curAmount = cur[cur.length - 1].amount;
    expectErr(await refund(SC.tokens.bob, lost.payment_id, { amount: curAmount - 199 }), 422, 'refund_exceeds_payment');
    expectErr(await refund(SC.tokens.ada, lost.payment_id, { amount: 1 }), 403, 'forbidden');
    expectErr(await refund(SC.tokens.ada, r.json.payment_id, { amount: 1 }), 422, 'invalid_refund_target');
    // the imported refunds replay and statement
    assert.equal((await refund(SC.tokens.bob, lost.payment_id, { amount: 200 }, uniq('x'))).status, 201);
    // batch correction of imported payments by the (imported) operator
    await sleep(1100);
    const rv = await curRev(SC.tokens.ada, priv.payment_id);
    const b = await batch(SC.tokens.op, { corrections: [bItem(priv.payment_id, { expected_revision: rv, amount: 40, effective_at: priv.created_at, reason: 'after upgrade' })] });
    assert.equal(b.status, 201, b.text);
    assert.equal(b.json.revisions[0].revision, rv + 1);
    assert.equal(b.json.revisions[0].correction_batch_id, b.json.correction_batch_id);
    expectErr(await batch(SC.tokens.ada, { corrections: [bItem(priv.payment_id, { expected_revision: rv + 1 })] }), 403, 'forbidden');
    // settlement membership
    const members = SC.responses.settlement.payments;
    const C = SC.responses.settlement.committed_at;
    if (members.length > 1) {
      expectErr(await batch(SC.tokens.op, { corrections: [bItem(members[0].payment_id, { effective_at: C, amount: 0 })] }), 422, 'incomplete_settlement');
      expectErr(await batch(SC.tokens.op, { corrections: members.slice(0, 2).map((p) => bItem(p.payment_id, { effective_at: C, amount: 0 })) }), 422, 'incomplete_settlement');
    }
    const whole = await batch(SC.tokens.op, { corrections: members.map((p) => bItem(p.payment_id, { effective_at: C, amount: 1 })) });
    assert.equal(whole.status, 201, whole.text);
    assert.equal(whole.json.revisions.length, members.length);
    const rep = await http('POST', '/settlements', { token: SC.tokens.op, key: SC.keys.settlement, body: SC.bodies.settlement });
    assert.equal(rep.status, 200); superset(rep.json, SC.responses.settlement, 'settlement replay');
    // single corrections of members stay rejected
    expectErr(await correct(SC.tokens[members[0].from_handle], members[0].payment_id, { expected_revision: await curRev(SC.tokens.op === undefined ? SC.tokens.ada : SC.tokens[members[0].from_handle], members[0].payment_id), amount: 1, effective_at: C, reason: 'x' }), 422, 'linked_payment_immutable');
    const total = Object.values(SC.balances).reduce((a, b2) => a + b2, 0);
    const tokens = HANDLES.map((h) => SC.tokens[h]);
    assert.equal(await sumView(tokens, {}), total - (SC.balances.zed || 0) + (SC.balances.zed || 0));
    assert.equal(await sumView(tokens, { as_of: at(Date.now() + DAY) }), await sumView(tokens, {}));
  });
}

test('Upgrade from stage 2/3: imported captures can be refunded (not corrected), holds are not restored', async () => {
  for (const [label, EXP, SC, capId, capBy, capTo] of [['stage-2', BUNDLES[1][1], BUNDLES[1][2], BUNDLES[1][2].capture_payment_id, 'bob', 'ada'], ['stage-3', BUNDLES[2][1], BUNDLES[2][2], BUNDLES[2][2].capture_payment_id, 'bob', 'ada']]) {
    await reset(fixture());
    assert.equal((await importState(EXP)).status, 204, label);
    const before = (await auths(SC.tokens.ada, '?limit=200')).authorizations.find((a) => a.authorization_id === SC.open_auth_id);
    const meBefore = await me(SC.tokens[capTo]);
    const r = await refund(SC.tokens[capBy], capId, { amount: 100 });
    assert.equal(r.status, 201, `${label}: ${r.text}`);
    assert.equal(r.json.refund_of, capId); assert.equal(r.json.authorization_id, null);
    const meAfter = await me(SC.tokens[capTo]);
    assert.equal(meAfter.total, meBefore.total + 100);
    assert.equal(meAfter.held, meBefore.held, 'refunds restore no hold');
    const after = (await auths(SC.tokens.ada, '?limit=200')).authorizations.find((a) => a.authorization_id === SC.open_auth_id);
    assert.equal(after.captured_amount, before.captured_amount);
    assert.equal(after.status, before.status);
    expectErr(await correct(SC.tokens.ada, capId, { expected_revision: 1, amount: 1, effective_at: at(Date.now() - 500), reason: 'x' }), 422, 'linked_payment_immutable');
    expectErr(await batch(SC.tokens.op, { corrections: [bItem(capId, { effective_at: at(Date.now() - 500) })] }), 422, 'linked_payment_immutable');
    const capAmt = (SC.responses.capture_nonfinal || SC.responses.capture).amount;
    expectErr(await refund(SC.tokens[capBy], capId, { amount: capAmt - 100 + 1 }), 422, 'refund_exceeds_payment');
    assert.equal((await refund(SC.tokens[capBy], capId, { amount: capAmt - 100 })).status, 201);
  }
});

test('Upgrade from stage 3: corrections, statements and revisions are retained; snapshots are either gone (404) or exactly the frozen result', async () => {
  const [, EXP, SC] = BUNDLES[2];
  await reset(fixture());
  assert.equal((await importState(EXP)).status, 204);
  for (const [id, revs] of Object.entries(SC.revisions)) supRevs((await revisions(SC.tokens.ada, id)).json.revisions, revs, `revisions of ${id}`);
  const s = await stmt(SC.tokens.ada, { limit: 200 });
  assert.deepEqual(normEntries(s.entries), normEntries(SC.statement_ada.entries));
  assert.equal(s.opening_balance, SC.statement_ada.opening_balance); assert.equal(s.closing_balance, SC.statement_ada.closing_balance);
  const corr = SC.responses.correction_lost;
  const rep = await correct(SC.tokens.ada, corr.payment_id, SC.bodies.correction_lost, SC.keys.correction_lost);
  assert.equal(rep.status, 200); assert.deepEqual(rep.json, corr);
  const sn = await stmtQ(SC.tokens.ada, { snapshot: SC.snapshot, limit: 200 });
  assert.ok(sn.status === 404 || sn.status === 200, `snapshot -> ${sn.status}`);
  if (sn.status === 200) { assert.deepEqual(normEntries(sn.json.entries), normEntries(SC.snapshot_full.entries)); assert.equal(sn.json.closing_balance, SC.snapshot_full.closing_balance); }
  // imported activity keeps the original amounts; refund_of is null on imported payments
  const feed = (await get(SC.tokens.ada, '/activity?limit=200')).json.payments;
  for (const p of feed) assert.ok(p.refund_of === null || p.refund_of === undefined);
  assert.equal(feed.find((p) => p.payment_id === SC.responses.lost_payment.payment_id).amount, 1000);
  // a single correction continues the imported revision numbering
  const c = await correct(SC.tokens.ada, SC.responses.lost_payment.payment_id, { expected_revision: 2, amount: 850, effective_at: SC.responses.lost_payment.created_at, reason: 'again' });
  assert.equal(c.status, 201, c.text); assert.equal(c.json.revision, 3);
});

// ---------------- stage-4 round trip ----------------

test('Round trip: refunds, batches, revisions, settlement membership, replays and receipts all restored; refund room and batch state continue correctly', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const { p1, p3 } = await sIds(t);
  const P = (await pay(t.ada, { to_handle: 'bob', amount: 1000, note: 'dinner', visibility: 'private' })).json;
  const stk = uniq('st'); const stBody = { transfers: [{ from_handle: 'ada', to_handle: 'bob', amount: 100 }, { from_handle: 'bob', to_handle: 'cy', amount: 40 }] };
  const S = await http('POST', '/settlements', { token: t.op, key: stk, body: stBody });
  assert.equal(S.status, 201);
  await sleep(1100);
  const rk = uniq('rf'); const R = await refund(t.bob, P.payment_id, { amount: 300 }, rk);
  assert.equal(R.status, 201, R.text);
  const R2 = await refund(t.bob, S.json.payments[0].payment_id, { amount: 25 });
  assert.equal(R2.status, 201, R2.text);
  const bk = uniq('b');
  const bb = { corrections: [bItem(p1, { amount: 450, effective_at: at(now - 5 * DAY), reason: 'b1' }), ...S.json.payments.map((p) => bItem(p.payment_id, { amount: 30, effective_at: S.json.committed_at }))] };
  const B = await batch(t.op, bb, bk);
  assert.equal(B.status, 201, B.text);
  const failKey = uniq('fail');
  expectErr(await refund(t.bob, P.payment_id, { amount: 701 }, failKey), 422, 'refund_exceeds_payment');
  const snapTok = (await stmt(t.ada, { limit: 2 })).snapshot;
  const snapFrozen = (await stmt(t.ada, { snapshot: snapTok, limit: 200 })).entries;
  const ids = [P.payment_id, p1, p3, R.json.payment_id, R2.json.payment_id, ...S.json.payments.map((p) => p.payment_id)];
  const snapAll = async () => JSON.stringify({
    me: await Promise.all(['ada', 'bob', 'cy', 'dee', 'op', 'zed'].map((h) => me(t[h]))),
    st: await Promise.all(['ada', 'bob', 'cy'].map(async (h) => { const x = await stmt(t[h], { limit: 200 }); return [x.opening_balance, x.entries, x.closing_balance]; })),
    old: await Promise.all([{}, { as_of: at(now - 4 * DAY) }, { as_of: S.json.committed_at }, { known_at: B.json.recorded_at }].map((q) => Promise.all(['ada', 'bob', 'cy'].map((h) => meAt(t[h], q))))),
    rev: await Promise.all(ids.map(async (id) => (await http('GET', `/payments/${id}/revisions`, { token: t.ada })).text)),
    act: (await get(t.cy, '/activity?limit=200')).json,
  });
  const before = await snapAll();
  const exp = await exportState();
  const frozenExport = JSON.stringify(exp);
  // diverge then wipe
  await refund(t.bob, P.payment_id, { amount: 100 });
  await reset(fixture({ users: [user('u_q', 'q', 1)] }));
  assert.equal(JSON.stringify(exp), frozenExport);
  assert.equal((await importState(exp)).status, 204);
  assert.equal(await snapAll(), before, 'all views identical after import');
  // retries
  const rr = await refund(t.bob, P.payment_id, { amount: 300 }, rk); assert.equal(rr.status, 200); assert.deepEqual(rr.json, R.json);
  const br = await batch(t.op, bb, bk); assert.equal(br.status, 200); assert.deepEqual(br.json, B.json);
  const sr = await http('POST', '/settlements', { token: t.op, key: stk, body: stBody }); assert.equal(sr.status, 200); assert.deepEqual(sr.json, S.json);
  expectErr(await refund(t.bob, P.payment_id, { amount: 301 }, rk), 409, 'idempotency_key_reuse');
  expectErr(await batch(t.op, { corrections: [bItem(p1, { amount: 1 })] }, bk), 409, 'idempotency_key_reuse');
  // refund room retained: 300 refunded of 1000 -> 700 left; failed key reusable
  const ok = await refund(t.bob, P.payment_id, { amount: 700 }, failKey);
  assert.equal(ok.status, 201, ok.text);
  expectErr(await refund(t.bob, P.payment_id, { amount: 1 }), 422, 'refund_exceeds_payment');
  expectErr(await refund(t.ada, R.json.payment_id, { amount: 1 }), 422, 'invalid_refund_target');
  // membership retained, refund payments immutable, batch numbering continues
  expectErr(await batch(t.op, { corrections: [bItem(S.json.payments[0].payment_id, { expected_revision: 2, amount: 25, effective_at: S.json.committed_at })] }), 422, 'incomplete_settlement');
  expectErr(await batch(t.op, { corrections: [bItem(R.json.payment_id)] }), 422, 'linked_payment_immutable');
  const B2 = await batch(t.op, { corrections: S.json.payments.map((p) => bItem(p.payment_id, { expected_revision: 2, amount: 25, effective_at: S.json.committed_at })) });
  assert.equal(B2.status, 201, B2.text); assert.deepEqual(B2.json.revisions.map((r) => r.revision), [3, 3]);
  assert.notEqual(B2.json.correction_batch_id, B.json.correction_batch_id);
  const sn = await stmtQ(t.ada, { snapshot: snapTok, limit: 200 });
  assert.ok(sn.status === 404 || sn.status === 200, `old snapshot -> ${sn.status}`);
  if (sn.status === 200) assert.deepEqual(sn.json.entries, snapFrozen);
  assert.equal(await sumView(['ada', 'bob', 'cy', 'dee', 'op', 'zed'].map((h) => t[h]), { as_of: at(Date.now() + DAY) }), 113200);
});

test('Round trip: import is repeatable and replacing; reset clears refunds/batches; invalid imports leave state unchanged', async () => {
  const { t } = await setup();
  const P = (await pay(t.ada, { to_handle: 'bob', amount: 1000 })).json;
  await refund(t.bob, P.payment_id, { amount: 200 });
  const exp = await exportState();
  await refund(t.bob, P.payment_id, { amount: 300 });
  for (let i = 0; i < 3; i++) {
    assert.equal((await importState(exp)).status, 204);
    assert.equal(await balance(t.ada), 9200);
    assert.equal((await get(t.ada, '/activity?limit=200')).json.payments.length, 2);
  }
  expectErr(await importState({ ...exp, format_version: 2 }), 422, 'validation_failed');
  assert.equal(await balance(t.ada), 9200);
  await reset(fixture());
  const ta = (await http('POST', '/auth/login', { body: { email: 'ada@example.com', password: PW } })).json.token;
  assert.equal(await balance(ta), 10000);
  assert.deepEqual((await get(ta, '/activity')).json.payments, []);
});

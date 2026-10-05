import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  http, fixture, user, reset, setup, login, balance, expectErr, pay, mkReq, payReq, settle, get, uniq, PW, RFC3339, sleep, HOUR, DAY,
  seedAuth, mkAuth, capture, voidAuth, me, auths, at, ms, meAt, stmt, stmtQ, stmtAll, correct, revisions, fixtureS, sumView, seedPay,
} from './lib.mjs';

const load = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const S1_EXPORT = load('stage1-export.json'), S1 = load('stage1-scenario.json');
const S2_EXPORT = load('stage2-export.json'), S2 = load('stage2-scenario.json');

const exportState = async () => { const r = await http('GET', '/_test/export'); assert.equal(r.status, 200, r.text); return r.json; };
const importState = (o) => http('POST', '/_test/import', { body: o });
const superset = (got, orig, label) => { for (const [k, v] of Object.entries(orig)) assert.deepEqual(got[k], v, `${label}: ${k}`); };
const HANDLES = ['ada', 'bob', 'cy', 'dee', 'op'];

/** payments contained in a scenario's recorded responses (stage-1 / stage-2 receipts) */
function scenarioPayments(S) {
  const out = [];
  for (const r of Object.values(S.responses)) {
    if (r && r.payments) out.push(...r.payments);
    else if (r && r.payment_id && r.from_handle && r.amount !== undefined && r.created_at) out.push(r);
  }
  return out;
}
function openings(S, payments) {
  const o = { ...S.balances };
  for (const p of payments) { o[p.from_handle] += p.amount; o[p.to_handle] -= p.amount; }
  return o;
}

for (const [label, EXP, SC] of [['stage-1', S1_EXPORT, S1], ['stage-2', S2_EXPORT, S2]]) {
  test(`Upgrade from a real ${label} export: accepted unchanged; tokens, logins and balances survive; ledger reconstructed (opening balances, revision 1)`, async () => {
    await reset(fixture({ users: [user('u_zzz', 'zzz', 1)], settlement_operator_ids: [] }));
    const imp = await importState(EXP);
    assert.equal(imp.status, 204, imp.text);
    for (const h of HANDLES) {
      const m = await me(SC.tokens[h]);
      assert.equal(m.balance, SC.balances[h], `${h} balance`);
      assert.equal(m.balance, m.total); assert.equal(m.available, m.total - m.held);
      assert.equal((await http('POST', '/auth/login', { body: { email: `${h}@example.com`, password: PW } })).status, 200);
    }
    assert.equal((await me(SC.zed.token)).balance, 0);
    assert.equal((await http('POST', '/auth/login', { body: { email: 'zed@example.com', password: 'longenough1' } })).json.user_id, SC.zed.user_id);
    expectErr(await http('POST', '/auth/login', { body: { email: 'zzz@example.com', password: PW } }), 401, 'unauthenticated');
    const pays = scenarioPayments(SC);
    assert.ok(pays.length >= 3);
    const open = openings(SC, pays);
    for (const h of HANDLES) {
      const s = await stmt(SC.tokens[h]);
      assert.equal(s.opening_balance, open[h], `${h} opening balance = ending balance minus net effect of imported payments`);
      assert.equal(s.closing_balance, SC.balances[h], `${h} closing`);
      assert.equal(s.opening_balance + s.entries.reduce((a, e) => a + e.delta, 0), s.closing_balance, `${h} identity`);
      let run = s.opening_balance; for (const e of s.entries) { run += e.delta; assert.equal(e.balance_after, run); }
      for (const e of s.entries) { assert.equal(e.revision, 1); assert.equal(ms(e.effective_at), ms(e.payment.created_at)); assert.equal(ms(e.recorded_at), ms(e.payment.created_at)); assert.match(e.payment.created_at, RFC3339); }
      const earliest = Math.min(...pays.map((p) => ms(p.created_at)));
      assert.equal((await meAt(SC.tokens[h], { as_of: at(earliest - 2 * DAY) })).balance, open[h], `${h} as_of before everything = opening`);
      assert.equal((await meAt(SC.tokens[h], { as_of: at(Date.now() + DAY) })).balance, SC.balances[h]);
    }
    const tokens = [...HANDLES.map((h) => SC.tokens[h]), SC.zed.token];
    const total = Object.values(SC.balances).reduce((a, b) => a + b, 0);
    assert.equal(await sumView(tokens, {}), total);
    assert.equal(await sumView(tokens, { as_of: at(Date.now() - 400 * DAY) }), Object.values(open).reduce((a, b) => a + b, 0));
    assert.equal(Object.values(open).reduce((a, b) => a + b, 0), total, 'imported history is money-conserving');
  });

  test(`Upgrade from ${label}: every imported payment has a revision history (revision 1, effective = recorded = created_at) readable by its parties only`, async () => {
    await reset(fixture());
    assert.equal((await importState(EXP)).status, 204);
    const pays = scenarioPayments(SC);
    for (const p of pays) {
      const sender = SC.tokens[p.from_handle], receiver = SC.tokens[p.to_handle];
      const r = await revisions(sender, p.payment_id);
      assert.equal(r.status, 200, `${p.payment_id}: ${r.text}`);
      assert.equal(r.json.revisions.length, 1);
      const v = r.json.revisions[0];
      assert.equal(v.revision, 1); assert.equal(v.amount, p.amount); assert.equal(v.reason, '');
      assert.equal(ms(v.effective_at), ms(p.created_at)); assert.equal(ms(v.recorded_at), ms(p.created_at));
      assert.equal((await revisions(receiver, p.payment_id)).status, 200);
      expectErr(await revisions(SC.tokens.dee === sender || SC.tokens.dee === receiver ? SC.zed.token : SC.tokens.dee, p.payment_id), 404, 'not_found');
    }
  });

  test(`Upgrade from ${label}: pending requests payable, retry keys replay the ORIGINAL receipts, imported payments can be corrected`, async () => {
    await reset(fixture());
    assert.equal((await importState(EXP)).status, 204);
    for (const [name, path] of Object.entries(SC.paths || { lost_payment: '/payments', private_payment: '/payments', request_pending: '/requests', settlement: '/settlements' })) {
      const actor = { lost_payment: 'ada', private_payment: 'ada', request_pending: 'bob', settlement: 'op', auth_open: 'ada', auth_captured: 'ada', auth_voided: 'ada', capture_nonfinal: 'bob', capture_final: 'cy' }[name];
      const rep = await http('POST', path, { token: SC.tokens[actor], key: SC.keys[name], body: SC.bodies[name] });
      assert.equal(rep.status, 200, `${name}: ${rep.text}`);
      superset(rep.json, SC.responses[name], name);
    }
    for (const h of HANDLES) assert.equal(await balance(SC.tokens[h]), SC.balances[h], `${h}: replays moved nothing`);
    // pending request is payable
    const r = await payReq(SC.tokens.ada, SC.pending_request_id, {});
    assert.equal(r.status, 201, r.text);
    assert.match(r.json.created_at, RFC3339);
    assert.equal(await balance(SC.tokens.ada), SC.balances.ada - 700);
    // an imported ordinary payment can be corrected; the original receipt (replay) and activity stay original
    const lost = SC.responses.lost_payment;
    await sleep(1100);
    const c = await correct(SC.tokens.ada, lost.payment_id, { expected_revision: 1, amount: 900, effective_at: lost.created_at, reason: 'after upgrade' });
    assert.equal(c.status, 201, c.text);
    assert.equal(c.json.revision, 2);
    assert.equal(await balance(SC.tokens.ada), SC.balances.ada - 700 + 100);
    assert.equal(await balance(SC.tokens.bob), SC.balances.bob + 700 - 100);
    const rep = await http('POST', '/payments', { token: SC.tokens.ada, key: SC.keys.lost_payment, body: SC.bodies.lost_payment });
    assert.equal(rep.status, 200); assert.equal(rep.json.amount, 1000, 'original receipt unchanged');
    assert.equal((await get(SC.tokens.ada, '/activity?limit=200')).json.payments.find((p) => p.payment_id === lost.payment_id).amount, 1000);
    // imported settlement members are linked payments
    const member = SC.responses.settlement.payments[0];
    expectErr(await correct(SC.tokens[member.from_handle], member.payment_id, { expected_revision: 1, amount: 1, effective_at: member.created_at, reason: 'x' }), 422, 'linked_payment_immutable');
    // tokens of imported sessions still authorize new payments with fresh ids
    const np = (await pay(SC.tokens.cy, { to_handle: 'dee', amount: 1 })).json;
    assert.ok(!scenarioPayments(SC).some((p) => p.payment_id === np.payment_id), 'new ids do not collide with imported ones');
  });
}

test('Upgrade from stage 2: authorizations and captures are imported and accounted for (captures immutable, in statements exactly once, holds consistent)', async () => {
  await reset(fixture());
  assert.equal((await importState(S2_EXPORT)).status, 204);
  const ada = SC2();
  const list = (await auths(ada.ada, '?limit=200')).authorizations;
  assert.ok(list.length >= 4, `authorizations imported (${list.length})`);
  for (const a of list) { assert.ok('closed_at' in a); assert.ok('remaining_amount' in a); }
  const byId = Object.fromEntries(list.map((a) => [a.authorization_id, a]));
  const open = byId[S2.open_auth_id];
  assert.equal(open.captured_amount, 700);
  assert.deepEqual(open.payment_ids, [S2.capture_payment_id]);
  assert.ok(['open', 'expired'].includes(open.status), 'open hold stays open until its deadline');
  const voided = byId[S2.voided_auth_id]; assert.equal(voided.status, 'voided');
  // holds recomputed consistently
  const m = await me(ada.ada);
  const held = list.filter((a) => a.status === 'open' && a.from_handle === 'ada').reduce((s, a) => s + a.remaining_amount, 0);
  assert.equal(m.held, held); assert.equal(m.available, m.total - held); assert.equal(m.balance, S2.balances.ada);
  // capture payments: immutable, revision 1, appear exactly once per party statement
  const capPays = [S2.responses.capture_nonfinal, S2.responses.capture_final];
  for (const c of capPays) {
    const sender = ada[c.from_handle], receiver = ada[c.to_handle];
    expectErr(await correct(sender, c.payment_id, { expected_revision: 1, amount: 1, effective_at: c.created_at, reason: 'x' }), 422, 'linked_payment_immutable');
    const v = (await revisions(sender, c.payment_id)).json.revisions[0];
    assert.equal(v.revision, 1); assert.equal(ms(v.effective_at), ms(c.created_at)); assert.equal(ms(v.recorded_at), ms(c.created_at));
    for (const tok of [sender, receiver]) {
      const s = await stmt(tok);
      assert.equal(s.entries.filter((e) => e.payment.payment_id === c.payment_id).length, 1);
      const e = s.entries.find((x) => x.payment.payment_id === c.payment_id);
      assert.equal(e.payment.authorization_id, c.authorization_id);
    }
  }
  // authorize/void/release events are not statement entries
  const sAda = await stmt(ada.ada);
  const allPays = scenarioPayments(S2).filter((p) => p.from_handle === 'ada' || p.to_handle === 'ada');
  assert.equal(sAda.entries.length, allPays.length);
  assert.equal(sAda.closing_balance, S2.balances.ada);
  // a historical view before the seeded hold / everything
  const early = await meAt(ada.ada, { as_of: at(Date.now() - 400 * DAY) });
  assert.equal(early.balance, 10000); assert.equal(early.held, 0); assert.equal(early.available, 10000);
  // lifecycle still works on imported holds
  const nb = (await mkAuth(ada.ada, { to_handle: 'bob', amount: 100 })).json;
  assert.equal((await capture(ada.bob, nb.authorization_id, { amount: 60 })).status, 201);
  if (open.status === 'open') {
    const c = await capture(ada.bob, S2.open_auth_id, { amount: 1300 });
    assert.equal(c.status, 201, c.text);
    assert.equal((await auths(ada.ada, '?limit=200')).authorizations.find((a) => a.authorization_id === S2.open_auth_id).status, 'captured');
  }
});
function SC2() { return { ...S2.tokens }; }

test('Upgrade from stage 2: retry keys of authorizations and captures replay 200 with the original bodies', async () => {
  await reset(fixture());
  assert.equal((await importState(S2_EXPORT)).status, 204);
  const actor = { auth_open: 'ada', auth_captured: 'ada', auth_voided: 'ada', capture_nonfinal: 'bob', capture_final: 'cy' };
  for (const [name, who] of Object.entries(actor)) {
    const rep = await http('POST', S2.paths[name], { token: S2.tokens[who], key: S2.keys[name], body: S2.bodies[name] });
    assert.equal(rep.status, 200, `${name}: ${rep.text}`);
    superset(rep.json, S2.responses[name], name);
    expectErr(await http('POST', S2.paths[name], { token: S2.tokens[who], key: S2.keys[name], body: { ...S2.bodies[name], amount: S2.bodies[name].amount + 1 } }), 409, 'idempotency_key_reuse');
  }
  assert.equal(await balance(S2.tokens.ada), S2.balances.ada);
  assert.equal(await balance(S2.tokens.bob), S2.balances.bob);
});

// ---------------- stage-3 round trip ----------------

test('Round trip with revisions: balances, statements, revisions, historical and known_at views, receipts and retries all restored exactly', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const feed = (await get(t.ada, '/activity?limit=200')).json.payments;
  const id = (n) => feed.find((p) => p.note === n).payment_id;
  const key1 = uniq('c1'), key2 = uniq('c2');
  const b1 = { expected_revision: 1, amount: 400, effective_at: at(now - 5 * DAY), reason: 'one' };
  const c1 = await correct(t.ada, id('one'), b1, key1);
  assert.equal(c1.status, 201, c1.text);
  await sleep(1100);
  const b2 = { expected_revision: 1, amount: 280, effective_at: at(now - 3 * DAY), reason: 'three' };
  const c2 = await correct(t.ada, id('three'), b2, key2);
  assert.equal(c2.status, 201, c2.text);
  const failKey = uniq('fail');
  expectErr(await correct(t.ada, id('three'), { expected_revision: 1, amount: 280, effective_at: at(now - 3 * DAY), reason: 'stale' }, failKey), 409, 'stale_revision');
  const pkey = uniq('p'), pbody = { to_handle: 'zed', amount: 33, note: 'late' };
  const late = await http('POST', '/payments', { token: t.ada, key: pkey, body: pbody });
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 900 })).json;
  await capture(t.bob, a.authorization_id, { amount: 200, final: false });
  const grid = [{}, { as_of: at(now - 5 * DAY) }, { as_of: at(now - 4 * DAY) }, { as_of: at(now - 3 * DAY) }, { as_of: at(now + DAY) }, { known_at: c1.json.recorded_at }, { known_at: at(ms(c1.json.recorded_at) - 1000) }, { as_of: at(now - 3 * DAY), known_at: c1.json.recorded_at }, { known_at: at(now - 6 * DAY) }];
  const snapAll = async () => JSON.stringify({
    me: await Promise.all(grid.flatMap((g) => ['ada', 'bob', 'cy', 'dee', 'zed'].map((h) => meAt(t[h], g)))),
    st: await Promise.all(grid.flatMap((g) => ['ada', 'bob', 'cy'].map(async (h) => { const s = await stmt(t[h], g.as_of ? { known_at: g.known_at } : g); return [s.opening_balance, s.entries, s.closing_balance, s.has_more]; }))),
    rev: await Promise.all([id('one'), id('three'), id('two')].map(async (p) => (await revisions(t.ada, p)).json)),
    auth: (await auths(t.ada, '?limit=200')).authorizations,
  });
  const before = await snapAll();
  const exp = await exportState();
  const oldSnap = (await stmt(t.ada, { limit: 2 }));
  const oldPage = await stmt(t.ada, { snapshot: oldSnap.snapshot, limit: 200 });
  // diverge: more corrections, a payment, then wipe
  await sleep(1100);
  await correct(t.ada, id('one'), { expected_revision: 2, amount: 300, effective_at: at(now - 5 * DAY), reason: 'again' });
  await pay(t.ada, { to_handle: 'bob', amount: 1 });
  await reset(fixture({ users: [user('u_q', 'q', 1)] }));
  assert.equal((await importState(exp)).status, 204);
  assert.equal(await snapAll(), before, 'every view identical after the import');
  // idempotent receipts / retries
  const r1 = await correct(t.ada, id('one'), b1, key1); assert.equal(r1.status, 200); assert.deepEqual(r1.json, c1.json);
  const r2 = await correct(t.ada, id('three'), b2, key2); assert.equal(r2.status, 200); assert.deepEqual(r2.json, c2.json);
  const rp = await http('POST', '/payments', { token: t.ada, key: pkey, body: pbody }); assert.equal(rp.status, 200); assert.deepEqual(rp.json, late.json);
  expectErr(await correct(t.ada, id('one'), { ...b1, amount: 401 }, key1), 409, 'idempotency_key_reuse');
  // failed key remains reusable; revision numbering continues; recorded_at keeps increasing
  const ok = await correct(t.ada, id('three'), { expected_revision: 2, amount: 270, effective_at: at(now - 3 * DAY), reason: 'cont' }, failKey);
  assert.equal(ok.status, 201, ok.text); assert.equal(ok.json.revision, 3);
  assert.ok(ms(ok.json.recorded_at) >= ms(c2.json.recorded_at));
  const revs = (await revisions(t.ada, id('three'))).json.revisions;
  assert.deepEqual(revs.map((r) => r.revision), [1, 2, 3]);
  // opening balances unchanged by the whole exercise
  assert.equal((await meAt(t.ada, { as_of: at(now - 30 * DAY) })).balance, 9600);
  // snapshots from before the export: either gone (404) or — if kept — exactly the frozen result
  const sn = await stmtQ(t.ada, { snapshot: oldSnap.snapshot, limit: 200 });
  assert.ok(sn.status === 404 || sn.status === 200, `snapshot after import: ${sn.status}`);
  if (sn.status === 200) assert.deepEqual(sn.json.entries, oldPage.entries);
  // new work after the import is sequenced after imported history
  const np = (await pay(t.ada, { to_handle: 'bob', amount: 2 })).json;
  assert.ok(ms(np.created_at) >= ms(late.json.created_at));
  assert.ok(![id('one'), id('two'), id('three'), id('four'), late.json.payment_id].includes(np.payment_id));
});

test('Round trip: import is replacement and repeatable; reset clears imported revision history; invalid imports leave state unchanged', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const p1 = (await get(t.ada, '/activity?limit=200')).json.payments.find((p) => p.note === 'one').payment_id;
  await correct(t.ada, p1, { expected_revision: 1, amount: 450, effective_at: at(now - 5 * DAY), reason: 'x' });
  const exp = await exportState();
  const bal = await balance(t.ada);
  await sleep(1100);
  await correct(t.ada, p1, { expected_revision: 2, amount: 400, effective_at: at(now - 5 * DAY), reason: 'y' });
  for (let i = 0; i < 3; i++) {
    assert.equal((await importState(exp)).status, 204);
    assert.equal(await balance(t.ada), bal);
    assert.equal((await revisions(t.ada, p1)).json.revisions.length, 2, 'import replaces; nothing duplicated');
  }
  for (const bad of [{ ...exp, format_version: 2 }, { ...exp, track: 'x' }, { track: 'pocketful', format_version: 1 }]) {
    expectErr(await importState(bad), 422, 'validation_failed');
    assert.equal(await balance(t.ada), bal);
    assert.equal((await revisions(t.ada, p1)).json.revisions.length, 2);
  }
  await reset(fixtureS(now));
  const ta = await login('ada');
  assert.equal(await balance(ta), 10000);
  const p1n = (await get(ta, '/activity?limit=200')).json.payments.find((p) => p.note === 'one').payment_id;
  assert.equal((await revisions(ta, p1n)).json.revisions.length, 1, 'reset clears imported corrections');
});

test('Round trip: export is a read-only isolated snapshot even with revisions (later corrections do not alter it)', async () => {
  const now = Date.now();
  const { t } = await setup(fixtureS(now));
  const p1 = (await get(t.ada, '/activity?limit=200')).json.payments.find((p) => p.note === 'one').payment_id;
  const exp = await exportState();
  const frozen = JSON.stringify(exp);
  await correct(t.ada, p1, { expected_revision: 1, amount: 450, effective_at: at(now - 5 * DAY), reason: 'x' });
  assert.equal(JSON.stringify(exp), frozen);
  assert.equal((await importState(exp)).status, 204);
  assert.equal((await revisions(t.ada, p1)).json.revisions.length, 1);
  assert.equal(await balance(t.ada), 10000);
});

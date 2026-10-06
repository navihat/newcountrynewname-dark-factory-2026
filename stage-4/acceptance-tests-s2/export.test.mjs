import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  http, fixture, user, reset, setup, login, balance, totalBalance, expectErr, pay, mkReq, payReq, settle, get, uniq, PW,
  sleep, seedAuth, mkAuth, capture, voidAuth, me, auths, authById, expectMe,
} from './lib.mjs';

const S1_EXPORT = JSON.parse(fs.readFileSync(new URL('./fixtures/stage1-export.json', import.meta.url), 'utf8'));
const S1 = JSON.parse(fs.readFileSync(new URL('./fixtures/stage1-scenario.json', import.meta.url), 'utf8'));

const exportState = async () => { const r = await http('GET', '/_test/export'); assert.equal(r.status, 200, r.text); return r.json; };
const importState = (o) => http('POST', '/_test/import', { body: o });
/** replayed body must equal the original for every field the ORIGINAL had (stage-2 may add new fields such as authorization_id) */
const assertSupersetOf = (replayed, original, msg) => { for (const [k, v] of Object.entries(original)) assert.deepEqual(replayed[k], v, `${msg}: field ${k}`); };

// ---------------- stage-1 export imported into stage 2 ----------------

test('Upgrade: a REAL stage-1 export is accepted unchanged (204); existing tokens, logins, balances survive; holds are zero', async () => {
  await reset(fixture({ users: [user('u_zzz', 'zzz', 1)], authorizations: [] }));
  const imp = await importState(S1_EXPORT);
  assert.equal(imp.status, 204, imp.text);
  for (const h of ['ada', 'bob', 'cy', 'dee', 'op']) {
    const m = await me(S1.tokens[h]); // old token still valid
    expectMe(m, { total: S1.balances[h], available: S1.balances[h], held: 0 });
    assert.equal(m.handle, h);
    const l = await http('POST', '/auth/login', { body: { email: `${h}@example.com`, password: PW } });
    assert.equal(l.status, 200);
  }
  expectMe(await me(S1.zed.token), { total: 0, available: 0, held: 0 });
  const zl = await http('POST', '/auth/login', { body: { email: 'zed@example.com', password: 'longenough1' } });
  assert.equal(zl.json.user_id, S1.zed.user_id);
  expectErr(await get('nope', '/me'), 401, 'unauthenticated');
  // pre-existing 'zzz' fixture user is gone (replacement)
  expectErr(await http('POST', '/auth/login', { body: { email: 'zzz@example.com', password: PW } }), 401, 'unauthenticated');
  assert.deepEqual((await auths(S1.tokens.ada)), { authorizations: [], has_more: false });
  assert.deepEqual((await auths(S1.tokens.bob)).authorizations, []);
  // history survives
  const feed = (await get(S1.tokens.ada, '/activity?limit=200')).json.payments;
  assert.deepEqual(feed.map((p) => p.payment_id).sort(), S1.activity_ada.map((p) => p.payment_id).sort());
  for (const p of feed) assert.ok(p.authorization_id === null || p.authorization_id === undefined);
});

test('Upgrade: pending stage-1 request stays pending and payable through the API after import', async () => {
  await reset(fixture());
  assert.equal((await importState(S1_EXPORT)).status, 204);
  const reqs = (await get(S1.tokens.ada, '/requests?status=pending&direction=incoming')).json.requests;
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].request_id, S1.pending_request_id);
  assert.equal(reqs[0].amount, 700); assert.equal(reqs[0].note, 'taxi');
  const r = await payReq(S1.tokens.ada, S1.pending_request_id, {});
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.request_id, S1.pending_request_id);
  assert.equal(r.json.authorization_id, null);
  expectMe(await me(S1.tokens.ada), { total: S1.balances.ada - 700, available: S1.balances.ada - 700, held: 0 });
  assert.equal(await balance(S1.tokens.bob), S1.balances.bob + 700);
  expectErr(await payReq(S1.tokens.ada, S1.pending_request_id, {}), 409, 'request_not_pending');
});

test('Upgrade: retry keys from stage 1 stay valid — same key+body replays 200 with the original receipt; no extra money; other body 409', async () => {
  await reset(fixture());
  assert.equal((await importState(S1_EXPORT)).status, 204);
  const cases = [
    ['lost_payment', S1.tokens.ada, '/payments'],
    ['private_payment', S1.tokens.ada, '/payments'],
    ['request_pending', S1.tokens.bob, '/requests'],
    ['request_cy_dee', S1.tokens.cy, '/requests'],
    ['settlement', S1.tokens.op, '/settlements'],
  ];
  for (const [name, tok, path] of cases) {
    const rep = await http('POST', path, { token: tok, key: S1.keys[name], body: S1.bodies[name] });
    assert.equal(rep.status, 200, `${name}: ${rep.text}`);
    assertSupersetOf(rep.json, S1.responses[name], name);
    const other = JSON.parse(JSON.stringify(S1.bodies[name]));
    if (other.amount !== undefined) other.amount += 1; else other.transfers[0].amount += 1;
    expectErr(await http('POST', path, { token: tok, key: S1.keys[name], body: other }), 409, 'idempotency_key_reuse');
  }
  for (const h of ['ada', 'bob', 'cy', 'dee', 'op']) assert.equal(await balance(S1.tokens[h]), S1.balances[h], `${h} balance after replays`);
  // same key on a new path+body is still a first use
  assert.equal((await pay(S1.tokens.ada, { to_handle: 'bob', amount: 1 }, S1.keys.lost_payment + '-new')).status, 201);
});

test('Upgrade: operator permission and ids survive; new authorizations/captures work on the imported state; ids do not collide', async () => {
  await reset(fixture());
  assert.equal((await importState(S1_EXPORT)).status, 204);
  assert.equal((await settle(S1.tokens.op, { transfers: [{ from_handle: 'op', to_handle: 'dee', amount: 5 }] })).status, 201);
  expectErr(await settle(S1.tokens.ada, { transfers: [{ from_handle: 'op', to_handle: 'dee', amount: 5 }] }), 403, 'forbidden');
  const a = await mkAuth(S1.tokens.ada, { to_handle: 'bob', amount: 2000 });
  assert.equal(a.status, 201, a.text);
  expectMe(await me(S1.tokens.ada), { total: S1.balances.ada, available: S1.balances.ada - 2000, held: 2000 });
  const c = await capture(S1.tokens.bob, a.json.authorization_id, { amount: 1500 });
  assert.equal(c.status, 201);
  const oldIds = new Set(Object.values(S1.responses).flatMap((r) => [r.payment_id, r.request_id, r.settlement_id].filter(Boolean)));
  assert.ok(!oldIds.has(c.json.payment_id), 'new payment id must not reuse an imported id');
  const np = (await pay(S1.tokens.cy, { to_handle: 'dee', amount: 1 })).json;
  assert.ok(!oldIds.has(np.payment_id));
  assert.equal(np.authorization_id, null);
  // ttl default after importing a state that has no ttl setting is the default 600
  assert.equal((Date.parse(a.json.expires_at) - Date.parse(a.json.created_at)) / 1000, 600);
});

test('Upgrade: validation of imports still applies after an upgrade import (422, state intact)', async () => {
  await reset(fixture());
  assert.equal((await importState(S1_EXPORT)).status, 204);
  const before = await balance(S1.tokens.ada);
  for (const bad of [{ ...S1_EXPORT, track: 'x' }, { ...S1_EXPORT, format_version: 99 }, { track: 'pocketful', format_version: 1 }]) {
    expectErr(await importState(bad), 422, 'validation_failed');
  }
  assert.equal(await balance(S1.tokens.ada), before);
});

// ---------------- stage-2 export / import with holds and captures ----------------

test('Export/import round trip with open holds, partial captures, voided and captured authorizations: everything restored exactly', async () => {
  const { t } = await setup();
  const open1 = (await mkAuth(t.ada, { to_handle: 'bob', amount: 2000, note: 'o1', visibility: 'private' })).json;
  const ext = (await mkAuth(t.ada, { to_handle: 'cy', amount: 1000, note: 'ext' })).json;
  const c1 = await capture(t.cy, ext.authorization_id, { amount: 300, final: false });
  const closed = (await mkAuth(t.ada, { to_handle: 'bob', amount: 500 })).json;
  const k = uniq('cap');
  const cc = await capture(t.bob, closed.authorization_id, { amount: 400 }, k);
  const voided = (await mkAuth(t.ada, { to_handle: 'bob', amount: 100 })).json;
  await voidAuth(t.ada, voided.authorization_id);
  const kAuth = uniq('au'); const authBody = { to_handle: 'dee', amount: 77 };
  const au = await http('POST', '/authorizations', { token: t.ada, key: kAuth, body: authBody });
  const failKey = uniq('fail');
  expectErr(await capture(t.bob, open1.authorization_id, { amount: 99999 }, failKey), 422, 'capture_exceeds_authorization');

  const snap = {
    me: { ada: await me(t.ada), bob: await me(t.bob), cy: await me(t.cy), dee: await me(t.dee) },
    auths: { ada: await auths(t.ada, '?limit=200'), bob: await auths(t.bob, '?limit=200') },
    feed: (await get(t.cy, '/activity?limit=200')).json,
  };
  const exp = await exportState();
  const frozen = JSON.stringify(exp);

  // mutate the source afterwards, then replace with an unrelated fixture
  assert.equal((await capture(t.bob, open1.authorization_id, { amount: 1 })).status, 201);
  await reset(fixture({ users: [user('u_q', 'q', 1)] }));
  expectErr(await get(t.ada, '/me'), 401, 'unauthenticated');
  assert.equal(JSON.stringify(exp), frozen, 'export object is an isolated snapshot');

  assert.equal((await importState(exp)).status, 204);
  for (const k of ['ada', 'bob', 'cy', 'dee']) assert.deepEqual(await me(t[k]), snap.me[k], `me ${k}`);
  assert.deepEqual(await auths(t.ada, '?limit=200'), snap.auths.ada);
  assert.deepEqual(await auths(t.bob, '?limit=200'), snap.auths.bob);
  assert.deepEqual((await get(t.cy, '/activity?limit=200')).json, snap.feed);
  // retries still valid
  const rc = await capture(t.bob, closed.authorization_id, { amount: 400 }, k);
  assert.equal(rc.status, 200); assert.deepEqual(rc.json, cc.json);
  const ra = await http('POST', '/authorizations', { token: t.ada, key: kAuth, body: authBody });
  assert.equal(ra.status, 200); assert.deepEqual(ra.json, au.json);
  expectErr(await capture(t.bob, closed.authorization_id, { amount: 401 }, k), 409, 'idempotency_key_reuse');
  // failed key still reusable
  assert.equal((await capture(t.bob, open1.authorization_id, { amount: 100, final: false }, failKey)).status, 201);
  // holds keep working: capture continues from the remainder, extended capture list preserved
  const c2 = await capture(t.cy, ext.authorization_id, { amount: 200 }); // final: releases 500
  assert.equal(c2.status, 201);
  const rec = await authById(t.cy, ext.authorization_id);
  assert.deepEqual(rec.payment_ids, [c1.json.payment_id, c2.json.payment_id]);
  assert.equal(rec.captured_amount, 500); assert.equal(rec.status, 'captured');
  assert.equal((await voidAuth(t.ada, open1.authorization_id)).status, 200);
  assert.equal(await totalBalance(t), 10000 + 2500 + 500 + 100000);
});

test('Export/import: repeated import does not duplicate holds or payments; import is replacement (post-export holds vanish)', async () => {
  const { t } = await setup();
  assert.equal((await mkAuth(t.ada, { to_handle: 'bob', amount: 1000 })).status, 201);
  const exp = await exportState();
  assert.equal((await mkAuth(t.ada, { to_handle: 'bob', amount: 2000 })).status, 201);
  for (let i = 0; i < 3; i++) {
    assert.equal((await importState(exp)).status, 204);
    expectMe(await me(t.ada), { total: 10000, available: 9000, held: 1000 });
    assert.equal((await auths(t.ada, '?limit=200')).authorizations.length, 1);
  }
});

test('Export/import: expiry is absolute — the deadline is NOT regenerated or extended by an import', async () => {
  const { t } = await setup(fixture({ authorization_ttl_seconds: 3 }));
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 4000 })).json;
  const exp = await exportState();
  await sleep(1500);
  assert.equal((await importState(exp)).status, 204);
  const rec = await authById(t.ada, a.authorization_id);
  assert.equal(rec.expires_at, a.expires_at);
  assert.equal(rec.created_at, a.created_at);
  await sleep(2500); // now past the original deadline
  expectMe(await me(t.ada), { total: 10000, available: 10000, held: 0 });
  assert.equal((await authById(t.ada, a.authorization_id)).status, 'expired');
  expectErr(await capture(t.bob, a.authorization_id, {}), 409, 'authorization_expired');
});

test('Export/import: importing an export taken while an hold was already expired keeps it expired and funds free', async () => {
  const { t } = await setup(fixture({ authorization_ttl_seconds: 2 }));
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 4000 })).json;
  await sleep(3000);
  const exp = await exportState();
  await reset(fixture());
  assert.equal((await importState(exp)).status, 204);
  expectMe(await me(t.ada), { total: 10000, available: 10000, held: 0 });
  assert.equal((await authById(t.bob, a.authorization_id)).status, 'expired');
});

test('Export/import: seeded authorizations survive the round trip; reset afterwards clears imported holds', async () => {
  const { t } = await setup(fixture({ authorizations: [seedAuth('a_1', 'u_ada', 'u_bob', 2500, { note: 'seed' })] }));
  const exp = await exportState();
  await reset(fixture());
  assert.equal((await importState(exp)).status, 204);
  expectMe(await me(t.ada), { total: 10000, available: 7500, held: 2500 });
  const a = (await auths(t.bob)).authorizations[0];
  assert.equal((await capture(t.bob, a.authorization_id, { amount: 2500 })).status, 201);
  await reset(fixture());
  const ta = await login('ada');
  expectMe(await me(ta), { total: 10000, available: 10000, held: 0 });
  assert.deepEqual((await auths(ta)).authorizations, []);
});

test('Export/import: signed-in tokens keep working across import for holds/captures, including a token created by signup', async () => {
  const { t } = await setup();
  const s = await http('POST', '/auth/signup', { body: { email: 'new.user@example.com', password: 'longenough1', display_name: 'New' } });
  assert.equal(s.status, 201);
  assert.equal((await pay(t.ada, { to_handle: 'new_user', amount: 3000 })).status, 201);
  const a = (await mkAuth(s.json.token, { to_handle: 'ada', amount: 1000 })).json;
  const exp = await exportState();
  await reset(fixture());
  assert.equal((await importState(exp)).status, 204);
  expectMe(await me(s.json.token), { total: 3000, available: 2000, held: 1000 });
  assert.equal((await capture(t.ada, a.authorization_id, {})).status, 201);
  expectMe(await me(s.json.token), { total: 2000, available: 2000, held: 0 });
});

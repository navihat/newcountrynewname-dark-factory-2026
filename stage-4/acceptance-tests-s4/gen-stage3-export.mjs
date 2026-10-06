// Generates fixtures/stage3-export.json + fixtures/stage3-scenario.json from a running STAGE-3 service
// (built from the stage-3/ folder of this repository, commit 6634cbd). Usage:
//   BASE_URL=http://127.0.0.1:18095 node gen-stage3-export.mjs
// Earlier bundles: stage1-export.json (stage-1 build), stage2-export.json (stage-2 build, see ../acceptance-tests-s3/gen-stage2-export.mjs).
import fs from 'node:fs';
import { http, reset, login, uniq, fixtureS, seedAuth, at, sleep, DAY, stmt, correct, mkAuth, capture, settle, PW } from './lib.mjs';

const now = Date.now();
await reset(fixtureS(now));
const t = {}; for (const h of ['ada', 'bob', 'cy', 'dee', 'op', 'zed']) t[h] = await login(h);
const S = { now, tokens: t, keys: {}, bodies: {}, paths: {}, responses: {} };
const rec = async (name, tok, path, body, status = 201) => {
  const key = `s3-${name}`;
  const r = await http('POST', path, { token: tok, key, body });
  if (r.status !== status) throw new Error(`${name}: ${r.status} ${r.text}`);
  S.keys[name] = key; S.bodies[name] = body; S.paths[name] = path; S.responses[name] = r.json; return r.json;
};
const feed = (await http('GET', '/activity?limit=200', { token: t.ada })).json.payments;
S.ids = Object.fromEntries(['one', 'two', 'three', 'four'].map((n) => [n, feed.find((p) => p.note === n).payment_id]));
const rq = await rec('request_pending', t.bob, '/requests', { payer_handle: 'ada', amount: 700, note: 'taxi' });
S.pending_request_id = rq.request_id;
await sleep(1100);
await rec('lost_payment', t.ada, '/payments', { to_handle: 'bob', amount: 1000, note: 'lost response', visibility: 'public' });
await rec('private_payment', t.ada, '/payments', { to_handle: 'cy', amount: 50, note: 'secret', visibility: 'private' });
await rec('settlement', t.op, '/settlements', { transfers: [{ from_handle: 'ada', to_handle: 'bob', amount: 100, note: 'm1' }, { from_handle: 'bob', to_handle: 'cy', amount: 40, note: 'm2' }, { from_handle: 'cy', to_handle: 'dee', amount: 10, note: 'm3' }] });
const a = await rec('auth_open', t.ada, '/authorizations', { to_handle: 'bob', amount: 900, note: 'hold' });
S.open_auth_id = a.authorization_id;
const cap = await rec('capture', t.bob, `/authorizations/${a.authorization_id}/capture`, { amount: 300, final: false });
S.capture_payment_id = cap.payment_id;
await sleep(1100);
await rec('correction_one', t.ada, `/payments/${S.ids.one}/corrections`, { expected_revision: 1, amount: 450, effective_at: at(now - 5 * DAY), reason: 'typo' });
await rec('correction_lost', t.ada, `/payments/${S.responses.lost_payment.payment_id}/corrections`, { expected_revision: 1, amount: 900, effective_at: S.responses.lost_payment.created_at, reason: 'refund-ish' });
S.balances = {}; for (const h of Object.keys(t)) S.balances[h] = (await http('GET', '/me', { token: t[h] })).json.balance;
const first = (await http('GET', '/statement?limit=2', { token: t.ada })).json;
S.snapshot = first.snapshot; S.snapshot_first_page = first;
S.snapshot_full = (await http('GET', `/statement?snapshot=${first.snapshot}&limit=200`, { token: t.ada })).json;
S.statement_ada = (await http('GET', '/statement?limit=200', { token: t.ada })).json;
S.revisions = {};
for (const id of [S.ids.one, S.responses.lost_payment.payment_id]) S.revisions[id] = (await http('GET', `/payments/${id}/revisions`, { token: t.ada })).json.revisions;
S.activity_ada = (await http('GET', '/activity?limit=200', { token: t.ada })).json.payments;
const exp = await http('GET', '/_test/export');
if (exp.status !== 200) throw new Error('export failed');
fs.writeFileSync(new URL('./fixtures/stage3-export.json', import.meta.url), JSON.stringify(exp.json));
fs.writeFileSync(new URL('./fixtures/stage3-scenario.json', import.meta.url), JSON.stringify(S, null, 1));
console.log('wrote fixtures', S.balances);

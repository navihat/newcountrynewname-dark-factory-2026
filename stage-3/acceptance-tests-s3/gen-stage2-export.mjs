// Generates fixtures/stage2-export.json + fixtures/stage2-scenario.json from a running STAGE-2 service
// (built from the stage-2/ folder of this repository, commit aa528cd carry-forward == stage-2 final).
// Usage: BASE_URL=http://127.0.0.1:18092 node gen-stage2-export.mjs
// (stage-1 counterpart: fixtures/stage1-export.json was produced the same way by ../acceptance-tests-s2/gen-stage1-export.mjs)
import fs from 'node:fs';
import { http, fixture, reset, login, seedAuth, PW } from './lib.mjs';

await reset(fixture({ authorizations: [seedAuth('a_seed', 'u_ada', 'u_bob', 1500, { note: 'seeded hold' })] }));
const t = {}; for (const h of ['ada', 'bob', 'cy', 'dee', 'op']) t[h] = await login(h);
const sig = await http('POST', '/auth/signup', { body: { email: 'zed@example.com', password: 'longenough1', display_name: 'Zed' } });
const S = { tokens: t, zed: sig.json, keys: {}, bodies: {}, paths: {}, responses: {} };
const rec = async (name, tok, path, body, status = 201) => {
  const key = `s2-${name}`;
  const r = await http('POST', path, { token: tok, key, body });
  if (r.status !== status) throw new Error(`${name}: ${r.status} ${r.text}`);
  S.keys[name] = key; S.bodies[name] = body; S.paths[name] = path; S.responses[name] = r.json; return r.json;
};
const rq = await rec('request_pending', t.bob, '/requests', { payer_handle: 'ada', amount: 700, note: 'taxi' });
S.pending_request_id = rq.request_id;
await rec('lost_payment', t.ada, '/payments', { to_handle: 'bob', amount: 1000, note: 'lost response', visibility: 'public' });
await rec('private_payment', t.ada, '/payments', { to_handle: 'cy', amount: 50, note: 'secret', visibility: 'private' });
await rec('settlement', t.op, '/settlements', { transfers: [{ from_handle: 'op', to_handle: 'cy', amount: 25 }] });
const open = await rec('auth_open', t.ada, '/authorizations', { to_handle: 'bob', amount: 2000, note: 'open hold' });
S.open_auth_id = open.authorization_id;
const cap1 = await rec('capture_nonfinal', t.bob, `/authorizations/${open.authorization_id}/capture`, { amount: 700, final: false });
S.capture_payment_id = cap1.payment_id;
const auth2 = await rec('auth_captured', t.ada, '/authorizations', { to_handle: 'cy', amount: 300, note: 'to capture' });
await rec('capture_final', t.cy, `/authorizations/${auth2.authorization_id}/capture`, { amount: 100 });
const auth3 = await rec('auth_voided', t.ada, '/authorizations', { to_handle: 'dee', amount: 200 });
const v = await http('POST', `/authorizations/${auth3.authorization_id}/void`, { token: t.ada });
if (v.status !== 200) throw new Error('void failed');
S.voided_auth_id = auth3.authorization_id;
S.balances = {}; S.me = {};
for (const h of Object.keys(t)) { const m = (await http('GET', '/me', { token: t[h] })).json; S.balances[h] = m.balance; S.me[h] = m; }
S.balances.zed = 0;
S.activity_ada = (await http('GET', '/activity?limit=200', { token: t.ada })).json.payments;
S.authorizations_ada = (await http('GET', '/authorizations?limit=200', { token: t.ada })).json.authorizations;
const exp = await http('GET', '/_test/export');
if (exp.status !== 200) throw new Error('export failed');
fs.writeFileSync(new URL('./fixtures/stage2-export.json', import.meta.url), JSON.stringify(exp.json));
fs.writeFileSync(new URL('./fixtures/stage2-scenario.json', import.meta.url), JSON.stringify(S, null, 1));
console.log('wrote fixtures; balances', S.balances);

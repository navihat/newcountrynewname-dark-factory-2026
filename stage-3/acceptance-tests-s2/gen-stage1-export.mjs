// Generates fixtures/stage1-export.json + fixtures/stage1-scenario.json from a running STAGE-1 service
// (the same team's stage-1 build). Usage: BASE_URL=http://127.0.0.1:18081 node gen-stage1-export.mjs
// The resulting files are committed so the stage-2 suite can import a REAL stage-1 export (§ "Existing clients after an upgrade").
import fs from 'node:fs';
import { http, fixture, reset, login, uniq, PW } from './lib.mjs';

await reset(fixture());
const t = {}; for (const h of ['ada', 'bob', 'cy', 'dee', 'op']) t[h] = await login(h);
const sig = await http('POST', '/auth/signup', { body: { email: 'zed@example.com', password: 'longenough1', display_name: 'Zed' } });
const S = { tokens: t, zed: sig.json, keys: {}, bodies: {}, responses: {} };
const rec = async (name, tok, path, body) => {
  const key = `s1-${name}`;
  const r = await http('POST', path, { token: tok, key, body });
  if (r.status !== 201) throw new Error(`${name}: ${r.status} ${r.text}`);
  S.keys[name] = key; S.bodies[name] = body; S.responses[name] = r.json; return r.json;
};
const rq = await rec('request_pending', t.bob, '/requests', { payer_handle: 'ada', amount: 700, note: 'taxi' });
S.pending_request_id = rq.request_id;
await rec('lost_payment', t.ada, '/payments', { to_handle: 'bob', amount: 1000, note: 'lost response', visibility: 'public' });
await rec('private_payment', t.ada, '/payments', { to_handle: 'cy', amount: 50, note: 'secret', visibility: 'private' });
await rec('request_cy_dee', t.cy, '/requests', { payer_handle: 'dee', amount: 100 });
await rec('settlement', t.op, '/settlements', { transfers: [{ from_handle: 'op', to_handle: 'cy', amount: 25 }] });
S.balances = {};
for (const h of Object.keys(t)) S.balances[h] = (await http('GET', '/me', { token: t[h] })).json.balance;
S.balances.zed = (await http('GET', '/me', { token: sig.json.token })).json.balance;
S.activity_ada = (await http('GET', '/activity?limit=200', { token: t.ada })).json.payments;
const exp = await http('GET', '/_test/export');
if (exp.status !== 200) throw new Error('export failed');
fs.mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./fixtures/stage1-export.json', import.meta.url), JSON.stringify(exp.json));
fs.writeFileSync(new URL('./fixtures/stage1-scenario.json', import.meta.url), JSON.stringify(S, null, 1));
console.log('wrote fixtures; balances', S.balances);

// UI acceptance tests (stage 2). Uses Playwright when available (set PLAYWRIGHT_CORE to the playwright-core
// package directory if it is not resolvable from this folder); otherwise the browser tests are skipped and only the
// HTML-level checks (static data-testid presence, Accept negotiation) run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  BASE_URL, http, fixture, user, reset, setup, login, balance, expectErr, pay, mkReq, get, uniq, PW,
  sleep, iso, HOUR, seedAuth, mkAuth, capture, voidAuth, me, auths, expectMe,
} from './lib.mjs';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const m of [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'playwright'].filter(Boolean)) {
    try { const pw = require(m); if (pw && pw.chromium) return pw; } catch { /* next */ }
  }
  return null;
}
const PW_LIB = loadPlaywright();
const NO_BROWSER = !PW_LIB;
let browser;
before(async () => {
  if (PW_LIB) browser = await PW_LIB.chromium.launch({ headless: true });
});
after(async () => { if (browser) await browser.close(); });

const ui = (name, fn) => test(`UI: ${name}`, { skip: NO_BROWSER ? 'playwright not available (set PLAYWRIGHT_CORE)' : false, timeout: 90000 }, async () => {
  const ctx = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 }, acceptDownloads: false });
  ctx.setDefaultTimeout(8000);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  try { await fn(page, ctx); } finally { await ctx.close(); }
});

const T = (page, id) => page.getByTestId(id);
const has = async (page, id) => (await T(page, id).count()) > 0;
const text = async (page, id) => (await T(page, id).first().textContent()).trim();
async function until(fn, ms = 8000, msg = 'condition') {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; last = v; } catch (e) { last = e; } await sleep(100); }
  throw new Error(`timeout waiting for ${msg} (last: ${last && last.message ? last.message : last})`);
}
const waitText = (page, id, expected, ms) => until(async () => (await has(page, id)) && (await text(page, id)) === expected, ms, `${id} == ${expected}`);
const waitGone = (page, id, ms) => until(async () => !(await has(page, id)), ms, `${id} gone`);
const waitHas = (page, id, ms) => until(async () => has(page, id), ms, `${id} present`);

async function uiLogin(page, handle = 'ada', password = PW) {
  await page.goto('/login');
  await T(page, 'login-email').fill(`${handle}@example.com`);
  await T(page, 'login-password').fill(password);
  await T(page, 'login-submit').click();
  await waitHas(page, 'current-user');
  await page.goto('/');
  await waitHas(page, 'wallet-balance');
}
const fillPay = async (page, { handle, amount, note, visibility }) => {
  if (handle !== undefined) await T(page, 'pay-handle').fill(handle);
  if (amount !== undefined) await T(page, 'pay-amount').fill(amount);
  if (note !== undefined) await T(page, 'pay-note').fill(note);
  if (visibility !== undefined) await T(page, 'pay-visibility').selectOption(visibility);
};
function trackPosts(page, path) {
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === path) posts.push({ key: r.headers()['idempotency-key'], body: r.postDataJSON() }); });
  return posts;
}
const feedIds = async (page) => (await page.locator('[data-testid^="activity-item-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').slice('activity-item-'.length))));

// ============ HTML-level checks (always run) ============

const ALL_TESTIDS = [
  'signup-email', 'signup-password', 'signup-display-name', 'signup-submit', 'login-email', 'login-password', 'login-submit', 'auth-error',
  'current-user', 'current-handle', 'logout-button', 'wallet-balance', 'wallet-available', 'wallet-held', 'pay-handle', 'pay-amount', 'pay-note',
  'pay-visibility', 'pay-submit', 'pay-error', 'pay-uncertain', 'request-handle', 'request-amount', 'request-note', 'request-submit', 'request-error',
  'wallet-refresh', 'activity-list', 'activity-item-', 'activity-parties-', 'activity-amount-', 'activity-note-', 'empty-activity',
  'incoming-list', 'outgoing-list', 'request-item-', 'request-amount-', 'request-pay-', 'request-decline-', 'request-cancel-', 'empty-requests',
  'split-amount', 'split-handles', 'split-note', 'split-submit', 'split-preview', 'split-share-', 'split-error',
  'authorize-handle', 'authorize-amount', 'authorize-note', 'authorize-visibility', 'authorize-submit', 'authorize-error',
  'authorization-list', 'authorization-item-', 'authorization-amount-', 'authorization-captured-', 'authorization-expires-',
  'authorization-capture-amount-', 'authorization-capture-', 'authorization-void-', 'authorization-error', 'empty-authorizations',
];

test('UI/HTML: every required route returns an HTML page for Accept: text/html', async () => {
  for (const route of ['/', '/requests', '/split', '/signup', '/login', '/authorizations']) {
    const r = await fetch(BASE_URL + route, { headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
    assert.equal(r.status, 200, route);
    assert.match(r.headers.get('content-type') || '', /text\/html/, route);
    const body = await r.text();
    assert.match(body, /<html|<!doctype html/i, route);
  }
});

test('UI/HTML: every data-testid from the specification is present in the served HTML / bundled scripts', async () => {
  let blob = '';
  const seen = new Set();
  const grab = async (url) => {
    if (seen.has(url)) return; seen.add(url);
    const r = await fetch(url, { headers: { Accept: url.endsWith('.js') || url.includes('.js') ? '*/*' : 'text/html' }, redirect: 'follow' });
    const body = await r.text(); blob += '\n' + body;
    for (const m of body.matchAll(/(?:src|href)=["']([^"']+\.(?:js|mjs)(?:\?[^"']*)?)["']/g)) {
      const u = new URL(m[1], url); if (u.origin === new URL(BASE_URL).origin) await grab(u.toString());
    }
    for (const m of body.matchAll(/import\s*(?:[^'"]*from\s*)?["'](\.{0,2}\/[^"']+\.m?js)["']/g)) {
      const u = new URL(m[1], url); if (u.origin === new URL(BASE_URL).origin) await grab(u.toString());
    }
  };
  for (const route of ['/', '/requests', '/split', '/signup', '/login', '/authorizations']) await grab(BASE_URL + route);
  const missing = ALL_TESTIDS.filter((id) => !blob.includes(id));
  assert.deepEqual(missing, [], `data-testid values not found anywhere in served HTML/JS: ${missing.join(', ')}`);
});

test('UI/HTML: /requests and /authorizations negotiate — HTML for Accept: text/html, JSON otherwise (token required for JSON)', async () => {
  const { t } = await setup();
  for (const [route, key] of [['/requests', 'requests'], ['/authorizations', 'authorizations']]) {
    const html = await fetch(BASE_URL + route, { headers: { Accept: 'text/html' } });
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type') || '', /text\/html/);
    const htmlAuth = await fetch(BASE_URL + route, { headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', Authorization: `Bearer ${t.ada}` } });
    assert.match(htmlAuth.headers.get('content-type') || '', /text\/html/, 'browser Accept wins even with a bearer token');
    const noAccept = await http('GET', route, { token: t.ada });
    assert.equal(noAccept.status, 200);
    assert.ok(Array.isArray(noAccept.json[key]), 'JSON for default Accept');
    const jsonAccept = await http('GET', route, { token: t.ada, headers: { Accept: 'application/json' } });
    assert.equal(jsonAccept.status, 200);
    assert.ok(Array.isArray(jsonAccept.json[key]));
    expectErr(await http('GET', route, { headers: { Accept: 'application/json' } }), 401, 'unauthenticated');
    expectErr(await http('GET', route), 401, 'unauthenticated');
  }
});

// ============ browser tests ============

ui('signup form creates an account; current-user / current-handle on every screen; logout works; auth-error only when there is one', async (page) => {
  await reset(fixture());
  await page.goto('/signup');
  assert.equal(await has(page, 'auth-error'), false);
  await T(page, 'signup-email').fill('New.Person@example.com');
  await T(page, 'signup-password').fill('longenough1');
  await T(page, 'signup-display-name').fill('Newbie');
  await T(page, 'signup-submit').click();
  await waitHas(page, 'current-user');
  assert.match(await text(page, 'current-user'), /Newbie/);
  assert.equal(await text(page, 'current-handle'), 'new_person');
  assert.equal(await has(page, 'auth-error'), false);
  for (const route of ['/', '/requests', '/split', '/authorizations']) {
    await page.goto(route);
    await waitHas(page, 'current-user');
    assert.match(await text(page, 'current-user'), /Newbie/, route);
    assert.equal(await text(page, 'current-handle'), 'new_person', route);
  }
  await page.goto('/');
  await waitText(page, 'wallet-balance', '0.00 EUR');
  await T(page, 'logout-button').click();
  await waitGone(page, 'current-user');
  await page.goto('/');
  assert.equal(await has(page, 'wallet-balance') && await has(page, 'current-user'), false, 'signed out: no wallet for anonymous');
});

ui('signup/login errors show auth-error: email taken, handle taken, short password, bad email, wrong password', async (page) => {
  await reset(fixture());
  const trySignup = async (email, pw, name = 'X') => {
    await page.goto('/signup');
    await T(page, 'signup-email').fill(email); await T(page, 'signup-password').fill(pw); await T(page, 'signup-display-name').fill(name);
    await T(page, 'signup-submit').click();
  };
  await trySignup('ada@example.com', 'longenough1'); await waitHas(page, 'auth-error');
  assert.ok((await text(page, 'auth-error')).length > 0);
  assert.equal(await has(page, 'current-user'), false);
  await trySignup('ADA@other.org', 'longenough1'); await waitHas(page, 'auth-error'); // derived handle 'ada' taken
  await trySignup('fine@example.com', 'short'); await waitHas(page, 'auth-error');
  await trySignup('not-an-email', 'longenough1'); await waitHas(page, 'auth-error');
  await page.goto('/login');
  await T(page, 'login-email').fill('ada@example.com'); await T(page, 'login-password').fill('wrong-password'); await T(page, 'login-submit').click();
  await waitHas(page, 'auth-error');
  assert.equal(await has(page, 'current-user'), false);
  await T(page, 'login-password').fill(PW); await T(page, 'login-submit').click();
  await waitHas(page, 'current-user');
  await waitGone(page, 'auth-error');
  assert.equal(await text(page, 'current-handle'), 'ada');
});

ui('wallet: formatted total/available/held with data-amount; available is the headline; wallet-held absent when held is zero', async (page) => {
  await setup(fixture({ authorizations: [seedAuth('a_1', 'u_ada', 'u_bob', 2000)] }));
  await uiLogin(page, 'ada');
  assert.equal(await text(page, 'wallet-balance'), '100.00 EUR');
  assert.equal(await T(page, 'wallet-balance').getAttribute('data-amount'), '10000');
  assert.equal(await text(page, 'wallet-available'), '80.00 EUR');
  assert.equal(await T(page, 'wallet-available').getAttribute('data-amount'), '8000');
  assert.equal(await text(page, 'wallet-held'), '20.00 EUR');
  assert.equal(await T(page, 'wallet-held').getAttribute('data-amount'), '2000');
  const fs = async (id) => parseFloat(await T(page, id).first().evaluate((e) => getComputedStyle(e).fontSize));
  const [fa, fb, fh] = [await fs('wallet-available'), await fs('wallet-balance'), await fs('wallet-held')];
  assert.ok(fa > fb && fa > fh, `available (${fa}px) must be the most prominent vs total (${fb}px) and held (${fh}px)`);
  await page.goto('/authorizations'); // holds also visible after a fresh navigation
  await page.goto('/');
  await waitText(page, 'wallet-available', '80.00 EUR');
  // bob has no hold
  const p2 = await page.context().newPage();
  await uiLogin(p2, 'bob');
  assert.equal(await text(p2, 'wallet-balance'), '25.00 EUR');
  assert.equal(await text(p2, 'wallet-available'), '25.00 EUR');
  assert.equal(await has(p2, 'wallet-held'), false);
});

ui('formatting for minor_units 0 (JPY: "10000 JPY", no decimal point) and 3 (BHD: "10.000 BHD")', async (page) => {
  for (const [cur, mu, expected] of [['JPY', 0, '10000 JPY'], ['BHD', 3, '10.000 BHD']]) {
    await setup(fixture({ currency: cur, minor_units: mu }));
    await page.context().clearCookies();
    await page.goto('/'); await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
    await uiLogin(page, 'ada');
    assert.equal(await text(page, 'wallet-balance'), expected);
    assert.equal(await text(page, 'wallet-available'), expected);
    if (mu === 0) {
      const posts = trackPosts(page, '/payments');
      await fillPay(page, { handle: 'bob', amount: '15.5', note: '', visibility: 'public' });
      await T(page, 'pay-submit').click();
      await waitHas(page, 'pay-error');
      assert.equal(posts.length, 0, 'fractional JPY amount must be rejected client-side');
      await T(page, 'pay-amount').fill('1200');
      await T(page, 'pay-submit').click();
      await waitText(page, 'wallet-balance', '8800 JPY');
      assert.equal(posts[0].body.amount, 1200);
    } else {
      const posts = trackPosts(page, '/payments');
      await fillPay(page, { handle: 'bob', amount: '1.2345' });
      await T(page, 'pay-submit').click(); await waitHas(page, 'pay-error');
      assert.equal(posts.length, 0);
      await T(page, 'pay-amount').fill('1.234');
      await T(page, 'pay-submit').click();
      await waitText(page, 'wallet-balance', '8.766 BHD');
      assert.equal(posts[0].body.amount, 1234);
    }
  }
});

ui('pay form: decimal amounts submit minor units (15 and 15.00 -> 1500, 15.5 -> 1550); success updates balance and feed; form values are kept', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'ada');
  const posts = trackPosts(page, '/payments');
  assert.equal(await has(page, 'empty-activity'), true);
  await fillPay(page, { handle: 'bob', amount: '15', note: 'dinner 🍕', visibility: 'private' });
  await T(page, 'pay-submit').click();
  await waitText(page, 'wallet-balance', '85.00 EUR');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.amount, 1500); assert.equal(posts[0].body.to_handle, 'bob');
  assert.equal(posts[0].body.note, 'dinner 🍕'); assert.equal(posts[0].body.visibility, 'private');
  const ids = await until(async () => { const x = await feedIds(page); return x.length === 1 ? x : null; }, 6000, 'one feed item');
  const id = ids[0];
  assert.equal(await T(page, `activity-item-${id}`).getAttribute('data-visibility'), 'private');
  assert.equal(await text(page, `activity-amount-${id}`), '15.00 EUR');
  assert.equal(await text(page, `activity-note-${id}`), 'dinner 🍕');
  const parties = await text(page, `activity-parties-${id}`);
  assert.ok(parties.includes('ada') && parties.includes('bob'), parties);
  assert.equal(await has(page, 'empty-activity'), false);
  assert.equal(await has(page, 'pay-error'), false);
  // values kept
  assert.equal(await T(page, 'pay-handle').inputValue(), 'bob');
  assert.equal(await T(page, 'pay-amount').inputValue(), '15');
  assert.equal(await T(page, 'pay-note').inputValue(), 'dinner 🍕');
  assert.equal(await T(page, 'pay-visibility').inputValue(), 'private');
  // server state agrees
  assert.equal(await balance(t.ada), 8500);
  // 15.00 -> 1500 ; 15.5 -> 1550 (changed fields = new payments)
  await T(page, 'pay-amount').fill('15.00'); await T(page, 'pay-submit').click();
  await waitText(page, 'wallet-balance', '70.00 EUR');
  assert.equal(posts[1].body.amount, 1500);
  await T(page, 'pay-amount').fill('15.5'); await T(page, 'pay-submit').click();
  await waitText(page, 'wallet-balance', '54.50 EUR');
  assert.equal(posts[2].body.amount, 1550);
  assert.equal(posts.length, 3);
  assert.equal((await feedIds(page)).length, 3);
});

ui('pay form: resubmitting an UNCHANGED form sends no second payment; changing a field makes the next submit a new payment', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'ada');
  const posts = trackPosts(page, '/payments');
  await fillPay(page, { handle: 'bob', amount: '10.00', note: 'once', visibility: 'public' });
  await T(page, 'pay-submit').click();
  await waitText(page, 'wallet-balance', '90.00 EUR');
  await T(page, 'pay-submit').click();
  await T(page, 'pay-submit').click();
  await sleep(1200);
  assert.equal(await text(page, 'wallet-balance'), '90.00 EUR');
  assert.equal((await feedIds(page)).length, 1, 'feed contains one payment');
  assert.equal(await has(page, 'pay-error'), false);
  assert.equal(await balance(t.ada), 9000);
  assert.ok(posts.length <= 1 || posts.every((p) => p.key === posts[0].key), 'any resend must reuse the same idempotency key (replay)');
  const sent = posts.length;
  await T(page, 'pay-note').fill('twice');
  await T(page, 'pay-submit').click();
  await waitText(page, 'wallet-balance', '80.00 EUR');
  assert.equal(await balance(t.ada), 8000);
  assert.ok(posts.length > sent);
  const last = posts[posts.length - 1];
  assert.notEqual(last.key, posts[0].key, 'a changed form is a new request with a new key');
  assert.equal((await feedIds(page)).length, 2);
});

ui('pay form: nonnumeric or too many decimals -> pay-error and NO request (15.005 is rejected, not rounded)', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'ada');
  const posts = trackPosts(page, '/payments');
  for (const bad of ['15.005', 'abc', '1.2.3', '']) {
    await fillPay(page, { handle: 'bob', amount: bad, note: '', visibility: 'public' });
    await T(page, 'pay-submit').click();
    await waitHas(page, 'pay-error');
    await sleep(200);
    assert.equal(posts.length, 0, `"${bad}" must not reach the server`);
  }
  assert.equal(await balance(t.ada), 10000);
  await T(page, 'pay-amount').fill('15.5'); // valid again -> sends and error clears
  await T(page, 'pay-submit').click();
  await waitText(page, 'wallet-balance', '84.50 EUR');
  await waitGone(page, 'pay-error');
  assert.equal(posts[0].body.amount, 1550);
});

ui('pay refused (insufficient funds): pay-error, balance/feed refreshed, ALL inputs preserved, no pay-uncertain', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'dee'); // 5.00 EUR
  await waitText(page, 'wallet-balance', '5.00 EUR');
  await fillPay(page, { handle: 'bob', amount: '5.01', note: 'too much', visibility: 'private' });
  await T(page, 'pay-submit').click();
  await waitHas(page, 'pay-error');
  assert.ok((await text(page, 'pay-error')).length > 0);
  assert.equal(await has(page, 'pay-uncertain'), false);
  assert.equal(await text(page, 'wallet-balance'), '5.00 EUR');
  assert.equal(await T(page, 'pay-handle').inputValue(), 'bob');
  assert.equal(await T(page, 'pay-amount').inputValue(), '5.01');
  assert.equal(await T(page, 'pay-note').inputValue(), 'too much');
  assert.equal(await T(page, 'pay-visibility').inputValue(), 'private');
  assert.equal(await balance(t.dee), 500);
  // unknown handle is a refusal as well
  await T(page, 'pay-handle').fill('nobody'); await T(page, 'pay-amount').fill('1.00');
  await T(page, 'pay-submit').click();
  await waitHas(page, 'pay-error');
  // after a fix, success clears the error
  await T(page, 'pay-handle').fill('bob');
  await T(page, 'pay-submit').click();
  await waitGone(page, 'pay-error');
  await waitText(page, 'wallet-balance', '4.00 EUR');
});

ui('competing client spends the balance after the browser read it: refused payment shows pay-error, balance refreshes, inputs preserved', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'ada');
  assert.equal(await text(page, 'wallet-balance'), '100.00 EUR');
  assert.equal((await pay(t.ada, { to_handle: 'cy', amount: 9990 })).status, 201); // another client
  await fillPay(page, { handle: 'bob', amount: '50.00', note: 'late', visibility: 'public' });
  await T(page, 'pay-submit').click();
  await waitHas(page, 'pay-error');
  await waitText(page, 'wallet-balance', '0.10 EUR');
  await waitText(page, 'wallet-available', '0.10 EUR');
  assert.equal(await T(page, 'pay-amount').inputValue(), '50.00');
  assert.equal(await T(page, 'pay-note').inputValue(), 'late');
  assert.equal(await T(page, 'pay-handle').inputValue(), 'bob');
  assert.equal(await has(page, 'pay-uncertain'), false);
  const ids = await feedIds(page);
  assert.equal(ids.length, 1, 'feed refreshed to include the other client\'s payment');
});

ui('pay with held funds: available (not total) funds the payment; refusal shows pay-error', async (page) => {
  await setup(fixture({ authorizations: [seedAuth('a_1', 'u_ada', 'u_bob', 9000)] }));
  await uiLogin(page, 'ada');
  await waitText(page, 'wallet-available', '10.00 EUR');
  await fillPay(page, { handle: 'cy', amount: '10.01', note: '', visibility: 'public' });
  await T(page, 'pay-submit').click();
  await waitHas(page, 'pay-error');
  await waitText(page, 'wallet-balance', '100.00 EUR');
  await T(page, 'pay-amount').fill('10.00');
  await T(page, 'pay-submit').click();
  await waitText(page, 'wallet-balance', '90.00 EUR');
  await waitText(page, 'wallet-available', '0.00 EUR');
  await waitText(page, 'wallet-held', '90.00 EUR');
});

ui('wallet-refresh: refreshes balance and feed without clearing the pay form; latest refresh wins when responses arrive out of order', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'ada');
  await waitText(page, 'wallet-balance', '100.00 EUR');
  await fillPay(page, { handle: 'bob', amount: '3.00', note: 'draft', visibility: 'private' });
  // plain refresh picks up another client's payment and keeps the form
  assert.equal((await pay(t.ada, { to_handle: 'cy', amount: 1000 })).status, 201);
  await T(page, 'wallet-refresh').click();
  await waitText(page, 'wallet-balance', '90.00 EUR');
  assert.equal((await feedIds(page)).length, 1);
  assert.equal(await T(page, 'pay-note').inputValue(), 'draft');
  assert.equal(await T(page, 'pay-amount').inputValue(), '3.00');
  assert.equal(await T(page, 'pay-visibility').inputValue(), 'private');
  // now delay the FIRST read after arming; a second refresh (newer state) must win
  const state = { armed: false, meDelayed: false, actDelayed: false };
  await page.route(/\/me(\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET' && state.armed && !state.meDelayed) {
      state.meDelayed = true; const resp = await route.fetch(); await sleep(2500); await route.fulfill({ response: resp });
    } else await route.continue();
  });
  await page.route(/\/activity(\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET' && state.armed && !state.actDelayed) {
      state.actDelayed = true; const resp = await route.fetch(); await sleep(2500); await route.fulfill({ response: resp });
    } else await route.continue();
  });
  state.armed = true;
  await T(page, 'wallet-refresh').click(); // refresh #1 -> stale (90.00) answers arrive late
  await sleep(300);
  assert.equal((await pay(t.ada, { to_handle: 'cy', amount: 2000 })).status, 201); // state moves on: 70.00
  await T(page, 'wallet-refresh').click({ timeout: 10000 }); // refresh #2 -> fast, newest
  await waitText(page, 'wallet-balance', '70.00 EUR', 6000);
  await until(async () => (await feedIds(page)).length === 2, 6000, 'two feed items');
  await sleep(4000); // let the delayed stale responses arrive
  assert.equal(await text(page, 'wallet-balance'), '70.00 EUR', 'stale read must not overwrite the later refresh');
  assert.equal(await text(page, 'wallet-available'), '70.00 EUR');
  assert.equal((await feedIds(page)).length, 2, 'stale feed must not overwrite the later refresh');
  assert.equal(await T(page, 'pay-note').inputValue(), 'draft');
  assert.ok(state.meDelayed, 'test arming: a /me read was actually delayed');
});

ui('lost response AFTER the payment committed: pay-uncertain (not pay-error); unchanged retry uses the same key+body; money moves exactly once', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'ada');
  const seen = [];
  let drop = true;
  await page.route(/\/payments$/, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    seen.push({ key: req.headers()['idempotency-key'], body: req.postData() });
    if (drop) { drop = false; await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  await fillPay(page, { handle: 'bob', amount: '15.00', note: 'lost', visibility: 'public' });
  await T(page, 'pay-submit').click();
  await waitHas(page, 'pay-uncertain');
  assert.ok((await text(page, 'pay-uncertain')).length > 0);
  assert.equal(await has(page, 'pay-error'), false, 'unknown outcome is not a confirmed rejection');
  assert.equal(await balance(t.ada), 8500, 'the payment did commit server-side');
  assert.equal(await T(page, 'pay-amount').inputValue(), '15.00');
  await T(page, 'pay-submit').click(); // retry unchanged
  await waitGone(page, 'pay-uncertain');
  assert.equal(await has(page, 'pay-error'), false);
  await waitText(page, 'wallet-balance', '85.00 EUR');
  assert.equal(seen.length, 2);
  assert.equal(seen[1].key, seen[0].key, 'retry must reuse the idempotency key');
  assert.deepEqual(JSON.parse(seen[1].body), JSON.parse(seen[0].body), 'retry must send the identical body');
  assert.equal(await balance(t.ada), 8500, 'money moved exactly once');
  assert.equal((await feedIds(page)).length, 1);
  assert.equal((await get(t.ada, '/activity')).json.payments.length, 1);
});

ui('lost response BEFORE the payment reached the service: pay-uncertain; retry with same key succeeds and moves money exactly once', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'ada');
  const seen = []; let drop = true;
  await page.route(/\/payments$/, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    seen.push({ key: req.headers()['idempotency-key'], body: req.postData() });
    if (drop) { drop = false; await route.abort('connectionreset'); } else await route.continue();
  });
  await fillPay(page, { handle: 'bob', amount: '20', note: '', visibility: 'private' });
  await T(page, 'pay-submit').click();
  await waitHas(page, 'pay-uncertain');
  assert.equal(await has(page, 'pay-error'), false);
  assert.equal(await balance(t.ada), 10000);
  await T(page, 'pay-submit').click();
  await waitGone(page, 'pay-uncertain');
  await waitText(page, 'wallet-balance', '80.00 EUR');
  assert.equal(seen[1].key, seen[0].key);
  assert.equal(await balance(t.ada), 8000);
});

ui('lost response, then the retry is REFUSED for real (funds gone): pay-error replaces pay-uncertain', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'dee'); // 5.00
  let drop = true;
  await page.route(/\/payments$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    if (drop) { drop = false; await route.abort('failed'); } else await route.continue(); // never reached the service
  });
  await fillPay(page, { handle: 'bob', amount: '4.00', note: '', visibility: 'public' });
  await T(page, 'pay-submit').click();
  await waitHas(page, 'pay-uncertain');
  assert.equal((await pay(t.dee, { to_handle: 'cy', amount: 500 })).status, 201); // other client drains the wallet
  await T(page, 'pay-submit').click();
  await waitHas(page, 'pay-error');
  await waitGone(page, 'pay-uncertain');
  await waitText(page, 'wallet-balance', '0.00 EUR');
  assert.equal(await balance(t.bob), 2500);
});

ui('lost response survives an export/import upgrade between browser requests: retry recovers the ORIGINAL payment, balance refreshed, session still signed in', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'ada');
  const seen = []; let drop = true;
  await page.route(/\/payments$/, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    seen.push({ key: req.headers()['idempotency-key'], body: req.postData() });
    if (drop) { drop = false; await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  await fillPay(page, { handle: 'bob', amount: '15.00', note: 'upgrade', visibility: 'public' });
  await T(page, 'pay-submit').click();
  await waitHas(page, 'pay-uncertain');
  const exp = (await http('GET', '/_test/export')).json;
  await reset(fixture({ users: [user('u_q', 'q', 1)] })); // wipe
  assert.equal((await http('POST', '/_test/import', { body: exp })).status, 204);
  assert.equal(await has(page, 'current-user'), true, 'still signed in after import');
  await T(page, 'pay-submit').click(); // retry with the same key+body against the imported state
  await waitGone(page, 'pay-uncertain');
  assert.equal(await has(page, 'pay-error'), false);
  await waitText(page, 'wallet-balance', '85.00 EUR');
  assert.equal(seen[1].key, seen[0].key);
  assert.equal(await balance(t.ada), 8500, 'exactly one payment after the upgrade');
  assert.equal((await feedIds(page)).length, 1);
  assert.equal(await T(page, 'pay-note').inputValue(), 'upgrade');
});

ui('signed-in session and half-filled form survive an import between browser requests; refresh shows the imported balance', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'ada');
  assert.equal((await pay(t.ada, { to_handle: 'bob', amount: 1000 })).status, 201);
  await T(page, 'wallet-refresh').click();
  await waitText(page, 'wallet-balance', '90.00 EUR');
  const exp = (await http('GET', '/_test/export')).json;
  assert.equal((await pay(t.ada, { to_handle: 'bob', amount: 4000 })).status, 201); // state moves on after the export
  await fillPay(page, { handle: 'cy', amount: '2.00', note: 'pending draft', visibility: 'private' });
  assert.equal((await http('POST', '/_test/import', { body: exp })).status, 204);
  await T(page, 'wallet-refresh').click();
  await waitText(page, 'wallet-balance', '90.00 EUR');
  assert.equal(await has(page, 'current-user'), true);
  assert.equal(await T(page, 'pay-note').inputValue(), 'pending draft');
  assert.equal(await T(page, 'pay-handle').inputValue(), 'cy');
  await T(page, 'pay-submit').click(); // and the session is genuinely authenticated
  await waitText(page, 'wallet-balance', '88.00 EUR');
});

ui('request form: creates a request (decimal -> minor units), request-error on refusal, pay form unaffected', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'bob');
  const posts = trackPosts(page, '/requests');
  await T(page, 'request-handle').fill('ada'); await T(page, 'request-amount').fill('12'); await T(page, 'request-note').fill('taxi');
  await T(page, 'request-submit').click();
  await until(async () => (await get(t.bob, '/requests')).json.requests.length === 1, 6000, 'request created');
  assert.equal(posts[0].body.amount, 1200); assert.equal(posts[0].body.payer_handle, 'ada');
  assert.equal(await has(page, 'request-error'), false);
  const n = posts.length;
  await T(page, 'request-amount').fill('12.001'); await T(page, 'request-submit').click();
  await waitHas(page, 'request-error'); await sleep(200);
  assert.equal(posts.length, n, 'invalid decimal must not be sent');
  await T(page, 'request-amount').fill('5'); await T(page, 'request-handle').fill('bob'); // self request
  await T(page, 'request-submit').click();
  await waitHas(page, 'request-error');
  await T(page, 'request-handle').fill('ghost'); await T(page, 'request-submit').click();
  await waitHas(page, 'request-error');
  assert.equal((await get(t.bob, '/requests')).json.requests.length, 1);
});

ui('requests screen: incoming/outgoing lists, statuses, formatted amounts, buttons only on PENDING requests of the right direction; pay/decline/cancel work', async (page) => {
  const { t } = await setup();
  const inc = (await mkReq(t.bob, { payer_handle: 'ada', amount: 1250, note: 'taxi' })).json;
  const inc2 = (await mkReq(t.cy, { payer_handle: 'ada', amount: 300 })).json;
  const out = (await mkReq(t.ada, { payer_handle: 'bob', amount: 777 })).json;
  const decl = (await mkReq(t.dee, { payer_handle: 'ada', amount: 50 })).json;
  await http('POST', `/requests/${decl.request_id}/decline`, { token: t.ada });
  await uiLogin(page, 'ada');
  await page.goto('/requests');
  await waitHas(page, 'incoming-list'); await waitHas(page, 'outgoing-list');
  assert.equal(await has(page, 'empty-requests'), false);
  const item = (id) => T(page, `request-item-${id}`);
  assert.equal(await item(inc.request_id).getAttribute('data-status'), 'pending');
  assert.equal(await text(page, `request-amount-${inc.request_id}`), '12.50 EUR');
  assert.equal(await text(page, `request-amount-${out.request_id}`), '7.77 EUR');
  assert.equal(await item(decl.request_id).getAttribute('data-status'), 'declined');
  assert.ok(await T(page, 'incoming-list').locator(`[data-testid="request-item-${inc.request_id}"]`).count() === 1, 'incoming request inside incoming-list');
  assert.ok(await T(page, 'outgoing-list').locator(`[data-testid="request-item-${out.request_id}"]`).count() === 1, 'outgoing request inside outgoing-list');
  assert.equal(await has(page, `request-pay-${inc.request_id}`), true);
  assert.equal(await has(page, `request-decline-${inc.request_id}`), true);
  assert.equal(await has(page, `request-cancel-${inc.request_id}`), false);
  assert.equal(await has(page, `request-cancel-${out.request_id}`), true);
  assert.equal(await has(page, `request-pay-${out.request_id}`), false);
  assert.equal(await has(page, `request-decline-${out.request_id}`), false);
  assert.equal(await has(page, `request-pay-${decl.request_id}`), false);
  assert.equal(await has(page, `request-decline-${decl.request_id}`), false);
  // pay
  await T(page, `request-pay-${inc.request_id}`).click();
  await until(async () => (await item(inc.request_id).getAttribute('data-status')) === 'paid', 6000, 'paid status');
  await waitGone(page, `request-pay-${inc.request_id}`);
  assert.equal(await balance(t.ada), 10000 - 1250);
  // decline
  await T(page, `request-decline-${inc2.request_id}`).click();
  await until(async () => (await item(inc2.request_id).getAttribute('data-status')) === 'declined', 6000, 'declined status');
  await waitGone(page, `request-decline-${inc2.request_id}`);
  // cancel
  await T(page, `request-cancel-${out.request_id}`).click();
  await until(async () => (await item(out.request_id).getAttribute('data-status')) === 'cancelled', 6000, 'cancelled status');
  await waitGone(page, `request-cancel-${out.request_id}`);
  assert.equal(await has(page, 'request-error'), false);
  assert.equal(await balance(t.ada), 8750);
});

ui('requests screen: empty-requests when there are none', async (page) => {
  await setup();
  await uiLogin(page, 'dee');
  await page.goto('/requests');
  await waitHas(page, 'empty-requests');
});

ui('request cancelled elsewhere while its pay button is visible: refused pay shows request-error and the stale pay button disappears', async (page) => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'ada', amount: 500 })).json;
  await uiLogin(page, 'ada');
  await page.goto('/requests');
  await waitHas(page, `request-pay-${rq.request_id}`);
  assert.equal((await http('POST', `/requests/${rq.request_id}/cancel`, { token: t.bob })).status, 200); // elsewhere
  await T(page, `request-pay-${rq.request_id}`).click();
  await waitHas(page, 'request-error');
  assert.ok((await text(page, 'request-error')).length > 0);
  await waitGone(page, `request-pay-${rq.request_id}`);
  await waitGone(page, `request-decline-${rq.request_id}`);
  assert.equal(await T(page, `request-item-${rq.request_id}`).getAttribute('data-status'), 'cancelled');
  assert.equal(await balance(t.ada), 10000);
});

ui('request pay refused for insufficient funds shows request-error and keeps the request pending', async (page) => {
  const { t } = await setup();
  const rq = (await mkReq(t.bob, { payer_handle: 'dee', amount: 5000 })).json;
  await uiLogin(page, 'dee');
  await page.goto('/requests');
  await T(page, `request-pay-${rq.request_id}`).click();
  await waitHas(page, 'request-error');
  assert.equal(await T(page, `request-item-${rq.request_id}`).getAttribute('data-status'), 'pending');
  assert.equal(await has(page, `request-pay-${rq.request_id}`), true);
  // after money arrives the same request can be paid from the UI
  assert.equal((await pay(t.ada, { to_handle: 'dee', amount: 5000 })).status, 201);
  await T(page, `request-pay-${rq.request_id}`).click();
  await until(async () => (await T(page, `request-item-${rq.request_id}`).getAttribute('data-status')) === 'paid', 6000, 'paid');
  await waitGone(page, 'request-error');
  assert.equal(await balance(t.dee), 500);
});

ui('existing pending request (seeded) is payable through the request screen after an import round trip', async (page) => {
  const fx = fixture({ requests: [{ id: 'rq_seed', requester_id: 'u_bob', payer_id: 'u_ada', amount: 1200, note: 'taxi', status: 'pending' }] });
  const { t } = await setup(fx);
  await uiLogin(page, 'ada');
  await page.goto('/requests');
  await waitHas(page, 'incoming-list');
  const id = (await get(t.ada, '/requests')).json.requests[0].request_id;
  await waitHas(page, `request-pay-${id}`);
  const exp = (await http('GET', '/_test/export')).json;
  assert.equal((await http('POST', '/_test/import', { body: exp })).status, 204);
  await T(page, `request-pay-${id}`).click();
  await until(async () => (await T(page, `request-item-${id}`).getAttribute('data-status')) === 'paid', 6000, 'paid after import');
  assert.equal(await balance(t.ada), 8800);
});

ui('split: preview equals the server shares by §9 BEFORE posting (334/333/333, reordering moves the extra unit); submit creates matching requests', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'ada');
  await page.goto('/split');
  const posts = trackPosts(page, '/splits');
  await T(page, 'split-amount').fill('10.00');
  await T(page, 'split-handles').fill('ada, bob, cy');
  await waitHas(page, 'split-preview');
  await waitText(page, 'split-share-ada', '3.34 EUR');
  assert.equal(await text(page, 'split-share-bob'), '3.33 EUR');
  assert.equal(await text(page, 'split-share-cy'), '3.33 EUR');
  assert.equal(await T(page, 'split-preview').locator('[data-testid^="split-share-"]').count(), 3);
  assert.equal(posts.length, 0, 'preview must not post anything');
  // reorder -> extra unit goes to the first handle
  await T(page, 'split-handles').fill('cy,bob,ada');
  await waitText(page, 'split-share-cy', '3.34 EUR');
  assert.equal(await text(page, 'split-share-ada'), '3.33 EUR');
  await T(page, 'split-handles').fill('bob,cy,ada');
  await T(page, 'split-note').fill('dinner');
  await waitText(page, 'split-share-bob', '3.34 EUR');
  const [resp] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === '/splits' && r.request().method() === 'POST'),
    T(page, 'split-submit').click(),
  ]);
  assert.equal(resp.status(), 201);
  const body = await resp.json();
  assert.equal(posts[0].body.amount, 1000);
  assert.deepEqual(posts[0].body.participant_handles, ['bob', 'cy', 'ada']);
  const fmt = (n) => `${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')} EUR`;
  for (const s of body.shares) assert.equal(await text(page, `split-share-${s.handle}`), fmt(s.amount), `share ${s.handle} equals server`);
  assert.deepEqual(body.shares.map((s) => s.amount), [334, 333, 333]);
  assert.equal(await has(page, 'split-error'), false);
  assert.equal((await get(t.bob, '/requests?direction=incoming')).json.requests[0].amount, 334);
  assert.equal((await get(t.ada, '/requests?direction=outgoing')).json.requests.length, 2);
});

ui('split preview: amount smaller than participants gives 0.01 / 0.00 / 0.00 and matches the server; JPY uses whole units', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'ada');
  await page.goto('/split');
  await T(page, 'split-amount').fill('0.01'); await T(page, 'split-handles').fill('ada,bob,cy');
  await waitText(page, 'split-share-ada', '0.01 EUR');
  assert.equal(await text(page, 'split-share-bob'), '0.00 EUR');
  assert.equal(await text(page, 'split-share-cy'), '0.00 EUR');
  await T(page, 'split-submit').click();
  await until(async () => (await get(t.ada, '/requests?direction=outgoing')).json.requests.length === 2, 6000, 'split requests');
  assert.deepEqual((await get(t.ada, '/requests?direction=outgoing')).json.requests.map((r) => r.amount).sort(), [0, 0]);
  // five equal shares
  await T(page, 'split-amount').fill('0.05'); await T(page, 'split-handles').fill('ada,bob,cy,dee,op');
  await waitText(page, 'split-share-op', '0.01 EUR');
});

ui('split errors: invalid decimal -> split-error with no request; unknown handle -> split-error after server refusal; single self participant works', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'ada');
  await page.goto('/split');
  const posts = trackPosts(page, '/splits');
  await T(page, 'split-amount').fill('15.005'); await T(page, 'split-handles').fill('ada,bob');
  await T(page, 'split-submit').click();
  await waitHas(page, 'split-error'); await sleep(200);
  assert.equal(posts.length, 0);
  await T(page, 'split-amount').fill('9.00'); await T(page, 'split-handles').fill('ada,ghost');
  await T(page, 'split-submit').click();
  await waitHas(page, 'split-error');
  assert.equal((await get(t.ada, '/requests')).json.requests.length, 0);
  await T(page, 'split-handles').fill('ada');
  await waitText(page, 'split-share-ada', '9.00 EUR');
  await T(page, 'split-submit').click();
  await waitGone(page, 'split-error');
  assert.equal((await get(t.ada, '/requests')).json.requests.length, 0, 'self-only split creates no requests');
});

ui('authorizations screen: seeded holds listed newest first with data-status, formatted amounts, RFC 3339 expiry; buttons per direction and status', async (page) => {
  const exp = iso(5 * HOUR);
  const fx = fixture({
    authorizations: [
      seedAuth('a_out', 'u_ada', 'u_bob', 2000, { expires_at: exp, note: 'deposit' }),
      seedAuth('a_in', 'u_bob', 'u_ada', 1000, { expires_at: iso(6 * HOUR) }),
      seedAuth('a_cap', 'u_ada', 'u_bob', 300, { status: 'captured' }),
      seedAuth('a_exp', 'u_ada', 'u_bob', 400, { status: 'expired', expires_at: iso(-2 * HOUR) }),
      seedAuth('a_void', 'u_ada', 'u_bob', 500, { status: 'voided' }),
    ],
  });
  const { t } = await setup(fx);
  const list = (await auths(t.ada, '?limit=200')).authorizations;
  const by = (amt) => list.find((a) => a.amount === amt);
  await uiLogin(page, 'ada');
  await page.goto('/authorizations');
  await waitHas(page, 'authorization-list');
  assert.equal(await has(page, 'empty-authorizations'), false);
  const item = (id) => T(page, `authorization-item-${id}`);
  const out = by(2000), inn = by(1000), cap = by(300), exd = by(400), vd = by(500);
  assert.equal(await item(out.authorization_id).getAttribute('data-status'), 'open');
  assert.equal(await item(inn.authorization_id).getAttribute('data-status'), 'open');
  assert.equal(await item(cap.authorization_id).getAttribute('data-status'), 'captured');
  assert.equal(await item(exd.authorization_id).getAttribute('data-status'), 'expired');
  assert.equal(await item(vd.authorization_id).getAttribute('data-status'), 'voided');
  assert.equal(await text(page, `authorization-amount-${out.authorization_id}`), '20.00 EUR');
  assert.equal(await text(page, `authorization-amount-${inn.authorization_id}`), '10.00 EUR');
  assert.equal(Date.parse(await text(page, `authorization-expires-${out.authorization_id}`)), Date.parse(out.expires_at));
  assert.match(await text(page, `authorization-expires-${out.authorization_id}`), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
  // outgoing open: void only
  assert.equal(await has(page, `authorization-void-${out.authorization_id}`), true);
  assert.equal(await has(page, `authorization-capture-${out.authorization_id}`), false);
  assert.equal(await has(page, `authorization-capture-amount-${out.authorization_id}`), false);
  // incoming open: capture only, prefilled with the remaining amount
  assert.equal(await has(page, `authorization-capture-${inn.authorization_id}`), true);
  assert.equal(await has(page, `authorization-void-${inn.authorization_id}`), false);
  assert.equal(Number(await T(page, `authorization-capture-amount-${inn.authorization_id}`).inputValue()), 10);
  // closed ones: no buttons; captured shows captured amount, others do not
  for (const a of [cap, exd, vd]) {
    for (const k of ['authorization-void-', 'authorization-capture-', 'authorization-capture-amount-']) assert.equal(await has(page, `${k}${a.authorization_id}`), false, `${k}${a.authorization_id}`);
  }
  assert.equal(await has(page, `authorization-captured-${cap.authorization_id}`), true);
  for (const a of [out, inn, exd, vd]) assert.equal(await has(page, `authorization-captured-${a.authorization_id}`), false);
  // wallet numbers visible on the page that shows holds
  await page.goto('/');
  await waitText(page, 'wallet-available', '80.00 EUR');
  await waitText(page, 'wallet-held', '20.00 EUR');
});

ui('authorizations screen: empty state; newest first in the DOM', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'cy');
  await page.goto('/authorizations');
  await waitHas(page, 'empty-authorizations');
  const p = await page.context().newPage();
  await uiLogin(p, 'ada');
  const a1 = (await mkAuth(t.ada, { to_handle: 'bob', amount: 100 })).json;
  await sleep(1200);
  const a2 = (await mkAuth(t.ada, { to_handle: 'cy', amount: 200 })).json;
  await p.goto('/authorizations');
  await waitHas(p, 'authorization-list');
  const order = await p.locator('[data-testid^="authorization-item-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').slice('authorization-item-'.length)));
  assert.deepEqual(order, [a2.authorization_id, a1.authorization_id]);
});

async function openAuthorizeForm(page) {
  for (const route of ['/authorizations', '/']) {
    await page.goto(route);
    try { await T(page, 'authorize-handle').waitFor({ timeout: 2500 }); return route; } catch { /* try next */ }
  }
  throw new Error('authorize-handle not found on /authorizations or /');
}

ui('authorize form: creates a hold (decimal -> minor units), available falls and held appears, total unchanged; list shows it with a void button', async (page) => {
  const { t } = await setup();
  await uiLogin(page, 'ada');
  const route = await openAuthorizeForm(page);
  const posts = trackPosts(page, '/authorizations');
  await T(page, 'authorize-handle').fill('bob'); await T(page, 'authorize-amount').fill('20');
  await T(page, 'authorize-note').fill('deposit'); await T(page, 'authorize-visibility').selectOption('private');
  await T(page, 'authorize-submit').click();
  await until(async () => (await me(t.ada)).held === 2000, 6000, 'hold created');
  assert.equal(posts[0].body.amount, 2000); assert.equal(posts[0].body.to_handle, 'bob'); assert.equal(posts[0].body.visibility, 'private');
  assert.equal(await has(page, 'authorize-error'), false);
  expectMe(await me(t.ada), { total: 10000, available: 8000, held: 2000 });
  // wallet numbers wherever the wallet is shown refresh without a manual reload (same page if it shows the wallet)
  if (await has(page, 'wallet-available')) await waitText(page, 'wallet-available', '80.00 EUR');
  await page.goto('/');
  await waitText(page, 'wallet-balance', '100.00 EUR');
  await waitText(page, 'wallet-available', '80.00 EUR');
  await waitText(page, 'wallet-held', '20.00 EUR');
  await page.goto('/authorizations');
  const id = (await auths(t.ada)).authorizations[0].authorization_id;
  assert.equal(await T(page, `authorization-item-${id}`).getAttribute('data-status'), 'open');
  assert.equal(await text(page, `authorization-amount-${id}`), '20.00 EUR');
  assert.equal(await has(page, `authorization-void-${id}`), true);
  assert.equal(await has(page, `authorization-capture-${id}`), false);
  assert.deepEqual((await get(t.ada, '/activity')).json.payments, [], 'hold is not a feed item');
  assert.equal(await has(page, 'activity-list') && (await page.locator('[data-testid^="activity-item-"]').count()) > 0, false, 'no activity item for a hold');
  // void from the UI releases it
  await T(page, `authorization-void-${id}`).click();
  await until(async () => (await T(page, `authorization-item-${id}`).getAttribute('data-status')) === 'voided', 6000, 'voided');
  await waitGone(page, `authorization-void-${id}`);
  expectMe(await me(t.ada), { total: 10000, available: 10000, held: 0 });
  await page.goto('/');
  await waitText(page, 'wallet-available', '100.00 EUR');
  await waitGone(page, 'wallet-held');
  void route;
});

ui('authorize form errors: insufficient AVAILABLE funds -> authorize-error; invalid decimal -> authorize-error with no request; inputs kept', async (page) => {
  const { t } = await setup(fixture({ authorizations: [seedAuth('a_1', 'u_ada', 'u_cy', 9000)] }));
  await uiLogin(page, 'ada');
  await openAuthorizeForm(page);
  const posts = trackPosts(page, '/authorizations');
  await T(page, 'authorize-handle').fill('bob'); await T(page, 'authorize-amount').fill('10.01');
  await T(page, 'authorize-submit').click();
  await waitHas(page, 'authorize-error');
  assert.ok((await text(page, 'authorize-error')).length > 0);
  assert.equal(await T(page, 'authorize-amount').inputValue(), '10.01');
  assert.equal((await me(t.ada)).held, 9000);
  const n = posts.length;
  await T(page, 'authorize-amount').fill('1.005'); await T(page, 'authorize-submit').click();
  await waitHas(page, 'authorize-error'); await sleep(200);
  assert.equal(posts.length, n);
  await T(page, 'authorize-amount').fill('abc'); await T(page, 'authorize-submit').click(); await sleep(200);
  assert.equal(posts.length, n);
  await T(page, 'authorize-amount').fill('10.00'); await T(page, 'authorize-submit').click();
  await until(async () => (await me(t.ada)).held === 10000, 6000, 'hold of the whole available balance');
  await waitGone(page, 'authorize-error');
});

ui('capture from the UI (receiver): prefilled remaining amount, partial capture marks it captured with captured amount; money and holds update', async (page) => {
  const { t } = await setup(fixture({ authorizations: [seedAuth('a_1', 'u_ada', 'u_bob', 2000, { note: 'deposit' })] }));
  const id = (await auths(t.bob)).authorizations[0].authorization_id;
  await uiLogin(page, 'bob');
  await page.goto('/authorizations');
  await waitHas(page, `authorization-capture-${id}`);
  assert.equal(Number(await T(page, `authorization-capture-amount-${id}`).inputValue()), 20);
  assert.equal(await has(page, `authorization-void-${id}`), false);
  await T(page, `authorization-capture-amount-${id}`).fill('15.00');
  await T(page, `authorization-capture-${id}`).click();
  await until(async () => (await T(page, `authorization-item-${id}`).getAttribute('data-status')) === 'captured', 6000, 'captured');
  assert.equal(await text(page, `authorization-captured-${id}`), '15.00 EUR');
  await waitGone(page, `authorization-capture-${id}`);
  await waitGone(page, `authorization-capture-amount-${id}`);
  assert.equal(await has(page, 'authorization-error'), false);
  expectMe(await me(t.ada), { total: 8500, available: 8500, held: 0 });
  assert.equal(await balance(t.bob), 4000);
  await page.goto('/');
  await waitText(page, 'wallet-balance', '40.00 EUR');
  assert.equal((await feedIds(page)).length, 1, 'captured payment is a feed item');
  // invalid decimal capture input -> authorization-error, no request
});

ui('capture refused (hold voided elsewhere): authorization-error, list refreshes and the stale capture button disappears; invalid capture amount shows an error without a request', async (page) => {
  const { t } = await setup();
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 2000 })).json;
  await uiLogin(page, 'bob');
  await page.goto('/authorizations');
  const id = a.authorization_id;
  await waitHas(page, `authorization-capture-${id}`);
  const posts = trackPosts(page, `/authorizations/${id}/capture`);
  await T(page, `authorization-capture-amount-${id}`).fill('1.234');
  await T(page, `authorization-capture-${id}`).click();
  await waitHas(page, 'authorization-error'); await sleep(200);
  assert.equal(posts.length, 0, 'more decimals than minor units must not be sent');
  await T(page, `authorization-capture-amount-${id}`).fill('50.00'); // exceeds remaining -> refused by the server
  await T(page, `authorization-capture-${id}`).click();
  await until(async () => posts.length === 1, 4000, 'capture request sent');
  await waitHas(page, 'authorization-error');
  assert.equal(await T(page, `authorization-item-${id}`).getAttribute('data-status'), 'open');
  assert.equal((await voidAuth(t.ada, id)).status, 200); // elsewhere
  await T(page, `authorization-capture-amount-${id}`).fill('10.00');
  await T(page, `authorization-capture-${id}`).click();
  await waitHas(page, 'authorization-error');
  await waitGone(page, `authorization-capture-${id}`);
  assert.equal(await T(page, `authorization-item-${id}`).getAttribute('data-status'), 'voided');
  assert.equal(await balance(t.bob), 2500);
});

ui('void refused (already captured elsewhere): authorization-error and the list refreshes', async (page) => {
  const { t } = await setup();
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 2000 })).json;
  await uiLogin(page, 'ada');
  await page.goto('/authorizations');
  const id = a.authorization_id;
  await waitHas(page, `authorization-void-${id}`);
  assert.equal((await capture(t.bob, id, { amount: 500 })).status, 201);
  await T(page, `authorization-void-${id}`).click();
  await waitHas(page, 'authorization-error');
  await waitGone(page, `authorization-void-${id}`);
  assert.equal(await T(page, `authorization-item-${id}`).getAttribute('data-status'), 'captured');
  assert.equal(await text(page, `authorization-captured-${id}`), '5.00 EUR');
});

ui('wallet reflects expiry by the clock after a refresh (short ttl); expired item has no buttons', async (page) => {
  const { t } = await setup(fixture({ authorization_ttl_seconds: 3 }));
  const a = (await mkAuth(t.ada, { to_handle: 'bob', amount: 3000 })).json;
  await uiLogin(page, 'ada');
  await waitText(page, 'wallet-available', '70.00 EUR');
  await waitText(page, 'wallet-held', '30.00 EUR');
  await sleep(4000);
  await T(page, 'wallet-refresh').click();
  await waitText(page, 'wallet-available', '100.00 EUR');
  await waitGone(page, 'wallet-held');
  await page.goto('/authorizations');
  await waitHas(page, `authorization-item-${a.authorization_id}`);
  assert.equal(await T(page, `authorization-item-${a.authorization_id}`).getAttribute('data-status'), 'expired');
  assert.equal(await has(page, `authorization-void-${a.authorization_id}`), false);
});

ui('feed: activity items newest first with visibility; private payments of others hidden; empty-activity for a user with none', async (page) => {
  const { t } = await setup();
  const p1 = (await pay(t.bob, { to_handle: 'cy', amount: 100, note: 'first', visibility: 'public' })).json;
  await sleep(1200);
  const p2 = (await pay(t.bob, { to_handle: 'cy', amount: 200, note: 'secret', visibility: 'private' })).json;
  await sleep(1200);
  const p3 = (await pay(t.bob, { to_handle: 'dee', amount: 300, note: '', visibility: 'public' })).json;
  await uiLogin(page, 'ada'); // third party
  await waitHas(page, 'activity-list');
  assert.deepEqual(await feedIds(page), [p3.payment_id, p1.payment_id]);
  assert.equal(await T(page, `activity-item-${p1.payment_id}`).getAttribute('data-visibility'), 'public');
  assert.equal(await text(page, `activity-note-${p3.payment_id}`), '', 'empty note element present with empty text');
  assert.equal(await has(page, `activity-item-${p2.payment_id}`), false);
  const p = await page.context().newPage();
  await uiLogin(p, 'cy');
  await until(async () => (await feedIds(p)).length === 3, 6000, 'cy sees own private payment');
  assert.equal(await T(p, `activity-item-${p2.payment_id}`).getAttribute('data-visibility'), 'private');
  assert.equal(await text(p, `activity-amount-${p2.payment_id}`), '2.00 EUR');
});

ui('navigation: every required screen is reachable by URL and through links in the UI; layout shared', async (page) => {
  await setup();
  await uiLogin(page, 'ada');
  for (const [route, id] of [['/', 'pay-submit'], ['/requests', 'incoming-list'], ['/split', 'split-amount'], ['/authorizations', 'authorization-list']]) {
    await page.goto(route);
    await until(async () => (await has(page, id)) || (await has(page, 'empty-requests')) || (await has(page, 'empty-authorizations')), 6000, `${route} content`);
    await waitHas(page, 'current-user');
  }
  await page.goto('/signup'); await waitHas(page, 'signup-email');
  await page.goto('/login'); await waitHas(page, 'login-email');
  await page.goto('/');
  for (const target of ['/requests', '/split', '/authorizations']) {
    const link = page.locator(`a[href="${target}"]`).first();
    assert.ok((await link.count()) > 0, `link to ${target} reachable from the wallet screen`);
    await link.click();
    await page.waitForURL(`**${target}`);
    await waitHas(page, 'current-user');
    const home = page.locator('a[href="/"]').first();
    assert.ok((await home.count()) > 0, `link back to / on ${target}`);
    await home.click();
    await page.waitForURL((u) => u.pathname === '/');
  }
});

for (const [w, h] of [[375, 812], [1280, 900]]) {
  ui(`layout at ${w}px: no horizontal page scrolling on any screen; inputs have labels`, async (page) => {
    const { t } = await setup(fixture({ authorizations: [seedAuth('a_1', 'u_ada', 'u_bob', 2000, { note: 'a fairly long note to stress the layout of narrow screens ' + 'x'.repeat(60) })] }));
    await mkReq(t.bob, { payer_handle: 'ada', amount: 1234, note: 'request note that is also fairly long '.repeat(3).slice(0, 200) });
    await pay(t.ada, { to_handle: 'bob', amount: 100, note: 'n'.repeat(190) });
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/login');
    await T(page, 'login-email').fill('ada@example.com'); await T(page, 'login-password').fill(PW);
    await T(page, 'login-submit').click();
    await waitHas(page, 'current-user');
    for (const route of ['/', '/requests', '/split', '/authorizations', '/signup', '/login']) {
      await page.goto(route);
      await sleep(600);
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth, iw: window.innerWidth }));
      assert.ok(m.sw <= m.iw && m.bw <= m.iw, `${route} at ${w}px scrolls horizontally: ${JSON.stringify(m)}`);
      const unlabeled = await page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter((e) => {
        const lab = (e.labels && e.labels.length > 0) || e.getAttribute('aria-label') || e.getAttribute('aria-labelledby');
        return !lab;
      }).map((e) => e.getAttribute('data-testid') || e.name || e.type));
      assert.deepEqual(unlabeled, [], `${route}: inputs without a label`);
    }
    await page.goto('/requests'); await sleep(300);
    const m2 = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.ok(m2);
  });
}

ui('keyboard focus is visible on controls (outline or box-shadow differs from unfocused)', async (page) => {
  await setup();
  await page.goto('/login');
  const el = T(page, 'login-email');
  const style = () => el.evaluate((e) => { const s = getComputedStyle(e); return `${s.outlineStyle}|${s.outlineWidth}|${s.boxShadow}|${s.borderColor}`; });
  const before = await style();
  await el.focus();
  const afterFocus = await style();
  assert.notEqual(afterFocus, before, 'focused input must look different');
  const btn = T(page, 'login-submit');
  const bs = () => btn.evaluate((e) => { const s = getComputedStyle(e); return `${s.outlineStyle}|${s.outlineWidth}|${s.boxShadow}`; });
  const b0 = await bs();
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); // password then button
  await btn.focus();
  assert.notEqual(await bs(), b0, 'focused button must look different');
});

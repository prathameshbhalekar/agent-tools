import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/server.js';

const accepts = [{ scheme: 'exact', network: 'base-sepolia', maxAmountRequired: '10000', payTo: '0xabc', asset: '0xusdc' }];
const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');
const goodPayment = encode({ x402Version: 1, scheme: 'exact', network: 'base-sepolia', payload: { signature: 'good' } });
const badPayment = encode({ x402Version: 1, scheme: 'exact', network: 'base-sepolia', payload: { signature: 'bad' } });

// Mock x402 facilitator: accepts signature "good", rejects anything else.
const facilitator = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const { paymentPayload, paymentRequirements } = JSON.parse(body);
  assert.deepEqual(paymentRequirements, accepts[0]);
  const ok = paymentPayload.payload.signature === 'good';
  const out = req.url === '/verify'
    ? { isValid: ok, invalidReason: ok ? undefined : 'invalid_signature', payer: '0xpayer' }
    : { success: true, transaction: '0xtx', network: 'base-sepolia', payer: '0xpayer' };
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
});

let app, base, cookie, apiKey;
// Dashboard calls use the session cookie; worker calls use { key }.
const call = async (method, path, { key, body, withCookie = true } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  else if (withCookie && cookie) headers.cookie = cookie;
  const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, setCookie, body: await res.json() };
};

before(async () => {
  await new Promise((r) => facilitator.listen(0, r));
  app = createApp({ dbPath: ':memory:', facilitatorUrl: `http://127.0.0.1:${facilitator.address().port}` });
  await new Promise((r) => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => {
  app.server.close();
  facilitator.close();
});

test('dashboard HTML is served at /', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /<title>Agent Helper<\/title>/);
});

test('signup validates input and starts a session', async () => {
  assert.equal((await call('POST', '/v1/signup', { body: { email: 'nope', password: 'longenough' } })).status, 400);
  assert.equal((await call('POST', '/v1/signup', { body: { email: 'a@b.co', password: 'short' } })).status, 400);
  const r = await call('POST', '/v1/signup', { body: { email: 'Owner@Acme.io', password: 'correct horse' } });
  assert.equal(r.status, 200);
  assert.match(r.setCookie, /^sid=[0-9a-f]{64}; HttpOnly; SameSite=Lax/);
  cookie = r.setCookie.split(';')[0];
  assert.equal((await call('POST', '/v1/signup', { body: { email: 'owner@acme.io', password: 'correct horse' } })).status, 409);
});

test('me returns the API key; unauthenticated requests are rejected', async () => {
  const { body } = await call('GET', '/v1/me');
  assert.equal(body.email, 'owner@acme.io');
  assert.match(body.apiKey, /^ah_/);
  apiKey = body.apiKey;
  assert.equal((await call('GET', '/v1/me', { withCookie: false })).status, 401);
  assert.equal((await call('GET', '/v1/worker/config', { key: 'ah_bogus' })).status, 401);
});

test('logout ends the session; login starts a new one', async () => {
  await call('POST', '/v1/logout');
  assert.equal((await call('GET', '/v1/me')).status, 401);
  assert.equal((await call('POST', '/v1/login', { body: { email: 'owner@acme.io', password: 'wrong pass' } })).status, 401);
  const r = await call('POST', '/v1/login', { body: { email: 'OWNER@acme.io', password: 'correct horse' } });
  assert.equal(r.status, 200);
  cookie = r.setCookie.split(';')[0];
  assert.equal((await call('GET', '/v1/me')).status, 200);
});

test('routes saved from the dashboard are served to the worker', async () => {
  const routes = [
    { method: 'get', path: '/paid/*', paywall: { accepts }, log: true },
    { path: '/logged', log: true },
  ];
  assert.equal((await call('PUT', '/v1/routes', { body: { routes } })).status, 200);
  const { body } = await call('GET', '/v1/worker/config', { key: apiKey });
  assert.deepEqual(body.routes, [
    { method: 'GET', path: '/paid/*', paywall: { accepts }, log: true },
    { method: '*', path: '/logged', log: true },
  ]);
  assert.equal((await call('PUT', '/v1/routes', { body: { routes: [{ path: 'no-slash' }] } })).status, 400);
});

test('verify: valid payment is settled, recorded, and returns X-PAYMENT-RESPONSE', async () => {
  const { body } = await call('POST', '/v1/worker/verify', {
    key: apiKey, body: { payment: goodPayment, accepts, method: 'GET', url: 'https://w.dev/paid/1' },
  });
  assert.equal(body.valid, true);
  assert.equal(body.payer, '0xpayer');
  assert.equal(JSON.parse(Buffer.from(body.paymentResponse, 'base64')).transaction, '0xtx');
  const { payments } = (await call('GET', '/v1/payments')).body;
  assert.equal(payments.length, 1);
  assert.deepEqual(
    { amount: payments[0].amount, tx: payments[0].tx, payer: payments[0].payer, payTo: payments[0].payTo },
    { amount: '10000', tx: '0xtx', payer: '0xpayer', payTo: '0xabc' },
  );
});

test('verify: bad signature, garbage, and mismatched network are rejected and not recorded', async () => {
  const verify = (payment) => call('POST', '/v1/worker/verify', { key: apiKey, body: { payment, accepts } });
  assert.deepEqual((await verify(badPayment)).body, { valid: false, error: 'invalid_signature' });
  assert.equal((await verify('%%%')).body.valid, false);
  assert.equal((await verify(encode({ scheme: 'exact', network: 'base', payload: {} }))).body.error, 'no matching payment requirements');
  assert.equal((await call('GET', '/v1/payments')).body.payments.length, 1);
});

test('logs are listed newest first with paging, and stats aggregate them', async () => {
  for (const [status, ms] of [[200, 10], [502, 30]]) {
    await call('POST', '/v1/worker/logs', {
      key: apiKey,
      body: { ts: new Date().toISOString(), method: 'GET', url: 'https://x/paid/1', route: '/paid/*', status,
        durationMs: ms, paid: status === 200, payer: null, request: { headers: {}, body: null }, response: { headers: {}, body: 'ok' } },
    });
  }
  const { body } = await call('GET', '/v1/logs?limit=1');
  assert.equal(body.logs[0].status, 502);
  assert.equal(body.logs[0].durationMs, 30);
  assert.equal(body.logs[0].response.body, 'ok');
  const page2 = await call('GET', `/v1/logs?limit=1&before=${body.next}`);
  assert.equal(page2.body.logs[0].status, 200);
  assert.equal(page2.body.logs[0].paid, true);

  const stats = (await call('GET', '/v1/stats?days=7')).body;
  assert.equal(stats.daily.length, 7);
  assert.deepEqual(stats.totals, { requests: 2, errors: 1, payments: 1, amount: 10000, avgMs: 20 });
  const today = stats.daily.at(-1);
  assert.deepEqual([today.requests, today.payments, today.amount], [2, 1, 10000]);
  assert.deepEqual(stats.topRoutes, [{ route: '/paid/*', requests: 2, paid: 1, errors: 1, avgMs: 20 }]);
});

test('rotating the key invalidates the old one', async () => {
  const { apiKey: fresh } = (await call('POST', '/v1/key/rotate')).body;
  assert.notEqual(fresh, apiKey);
  assert.equal((await call('GET', '/v1/worker/config', { key: apiKey })).status, 401);
  assert.equal((await call('GET', '/v1/worker/config', { key: fresh })).status, 200);
});

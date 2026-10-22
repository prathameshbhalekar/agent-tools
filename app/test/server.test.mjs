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

let app, base, apiKey;
const call = async (method, path, { key = apiKey, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  await new Promise((r) => facilitator.listen(0, r));
  app = createApp({ dbPath: ':memory:', adminToken: 'admin', facilitatorUrl: `http://127.0.0.1:${facilitator.address().port}` });
  await new Promise((r) => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => {
  app.server.close();
  facilitator.close();
});

test('admin creates an account; non-admin cannot', async () => {
  assert.equal((await call('POST', '/v1/accounts', { key: 'nope', body: { name: 'x' } })).status, 401);
  const { status, body } = await call('POST', '/v1/accounts', { key: 'admin', body: { name: 'acme' } });
  assert.equal(status, 200);
  assert.match(body.apiKey, /^ah_/);
  apiKey = body.apiKey;
});

test('unknown API key is rejected', async () => {
  assert.equal((await call('GET', '/v1/worker/config', { key: 'ah_bogus' })).status, 401);
});

test('routes saved via dashboard API are served to the worker', async () => {
  const routes = [
    { method: 'get', path: '/paid/*', paywall: { accepts }, log: true },
    { path: '/logged', log: true },
  ];
  assert.equal((await call('PUT', '/v1/routes', { body: { routes } })).status, 200);
  const { body } = await call('GET', '/v1/worker/config');
  assert.deepEqual(body.routes, [
    { method: 'GET', path: '/paid/*', paywall: { accepts }, log: true },
    { method: '*', path: '/logged', log: true },
  ]);
  assert.equal((await call('PUT', '/v1/routes', { body: { routes: [{ path: 'no-slash' }] } })).status, 400);
});

test('verify: valid payment is verified, settled, and returns X-PAYMENT-RESPONSE', async () => {
  const { body } = await call('POST', '/v1/worker/verify', { body: { payment: goodPayment, accepts } });
  assert.equal(body.valid, true);
  assert.equal(body.payer, '0xpayer');
  assert.equal(JSON.parse(Buffer.from(body.paymentResponse, 'base64')).transaction, '0xtx');
});

test('verify: bad signature, garbage, and mismatched network are rejected', async () => {
  assert.deepEqual((await call('POST', '/v1/worker/verify', { body: { payment: badPayment, accepts } })).body,
    { valid: false, error: 'invalid_signature' });
  assert.equal((await call('POST', '/v1/worker/verify', { body: { payment: '%%%', accepts } })).body.valid, false);
  const otherNet = encode({ scheme: 'exact', network: 'base', payload: {} });
  assert.equal((await call('POST', '/v1/worker/verify', { body: { payment: otherNet, accepts } })).body.error,
    'no matching payment requirements');
});

test('logs ingested from the worker are listed newest first', async () => {
  for (const status of [200, 402]) {
    await call('POST', '/v1/worker/logs', {
      body: { ts: new Date().toISOString(), method: 'GET', url: 'https://x/paid/1', route: '/paid/*', status,
        durationMs: 5, paid: status === 200, payer: null, request: { headers: {}, body: null }, response: { headers: {}, body: 'ok' } },
    });
  }
  const { body } = await call('GET', '/v1/logs?limit=1');
  assert.equal(body.logs.length, 1);
  assert.equal(body.logs[0].status, 402);
  assert.equal(body.logs[0].response.body, 'ok');
  const page2 = await call('GET', `/v1/logs?limit=1&before=${body.next}`);
  assert.equal(page2.body.logs[0].status, 200);
  assert.equal(page2.body.logs[0].paid, true);
});

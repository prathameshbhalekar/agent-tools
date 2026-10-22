import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { unstable_dev } from 'wrangler';

const accepts = [{ scheme: 'exact', network: 'base-sepolia', maxAmountRequired: '10000', payTo: '0xabc' }];
const logs = [];
let lastOriginHeaders;

// One mock server plays both the customer's origin and our app API.
const mock = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const json = (obj) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(obj));

  if (req.url === '/v1/worker/config') {
    assert.equal(req.headers.authorization, 'Bearer test-key');
    return json({
      routes: [
        { method: 'GET', path: '/paid/*', paywall: { accepts }, log: true },
        { method: '*', path: '/logged', log: true },
      ],
    });
  }
  if (req.url === '/v1/worker/verify') {
    const { payment } = JSON.parse(body);
    return json(payment === 'good' ? { valid: true, payer: '0xpayer', paymentResponse: 'settled' } : { valid: false, error: 'bad sig' });
  }
  if (req.url === '/v1/worker/logs') {
    logs.push(JSON.parse(body));
    return json({});
  }
  lastOriginHeaders = req.headers;
  json({ origin: true, path: req.url, body });
});

let worker;
before(async () => {
  await new Promise((r) => mock.listen(0, r));
  const base = `http://127.0.0.1:${mock.address().port}`;
  worker = await unstable_dev('src/index.js', {
    vars: { ORIGIN_URL: base, APP_API_URL: base, API_KEY: 'test-key', ORIGIN_SECRET: 's3cret' },
    experimental: { disableExperimentalWarning: true },
  });
});
after(async () => {
  await worker?.stop();
  mock.close();
});

const waitForLogs = async (n) => {
  for (let i = 0; i < 50 && logs.length < n; i++) await new Promise((r) => setTimeout(r, 50));
};

test('unmatched path proxies straight through', async () => {
  const res = await worker.fetch('/free?x=1');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).path, '/free?x=1');
  assert.equal(lastOriginHeaders['x-payment-verified'], undefined);
});

test('paid route without payment returns 402 with accepts', async () => {
  const res = await worker.fetch('/paid/item');
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.x402Version, 1);
  assert.deepEqual(body.accepts, accepts);
});

test('paid route with invalid payment returns 402', async () => {
  const res = await worker.fetch('/paid/item', { headers: { 'X-PAYMENT': 'bad' } });
  assert.equal(res.status, 402);
  assert.equal((await res.json()).error, 'bad sig');
});

test('paid route with valid payment reaches origin with injected proof', async () => {
  logs.length = 0;
  const res = await worker.fetch('/paid/item', { headers: { 'X-PAYMENT': 'good' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-payment-response'), 'settled');
  assert.equal(lastOriginHeaders['x-payment'], 'good');
  assert.equal(lastOriginHeaders['x-payment-verified'], 'true');
  assert.equal(lastOriginHeaders['x-payment-payer'], '0xpayer');
  assert.equal(lastOriginHeaders['x-agent-helper-secret'], 's3cret');
  await waitForLogs(1);
  assert.equal(logs[0].paid, true);
  assert.equal(logs[0].request.headers['x-payment'], '[redacted]');
});

test('logged route ships redacted request/response to analytics', async () => {
  logs.length = 0;
  const res = await worker.fetch('/logged', {
    method: 'POST',
    headers: { authorization: 'Bearer user-token' },
    body: 'hello',
  });
  assert.equal(res.status, 200);
  await waitForLogs(1);
  const [log] = logs;
  assert.equal(log.route, '/logged');
  assert.equal(log.status, 200);
  assert.equal(log.request.body, 'hello');
  assert.equal(log.request.headers.authorization, '[redacted]');
  assert.match(log.response.body, /"origin":true/);
});

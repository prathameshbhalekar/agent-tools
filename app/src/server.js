import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.DB_PATH ?? 'agent-helper.db';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const FACILITATOR_URL = (process.env.FACILITATOR_URL ?? 'https://x402.org/facilitator').replace(/\/$/, '');

export function createApp({ dbPath = DB_PATH, adminToken = ADMIN_TOKEN, facilitatorUrl = FACILITATOR_URL } = {}) {
  // ponytail: SQLite single-node store; move to Postgres when you run more than one instance
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (api_key TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS routes (api_key TEXT NOT NULL, position INTEGER NOT NULL, method TEXT NOT NULL,
      path TEXT NOT NULL, paywall TEXT, log INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (api_key, position));
    CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, api_key TEXT NOT NULL, ts TEXT NOT NULL,
      method TEXT, url TEXT, route TEXT, status INTEGER, duration_ms INTEGER, paid INTEGER, payer TEXT, data TEXT);
    CREATE INDEX IF NOT EXISTS logs_by_account ON logs (api_key, id);
  `);

  const q = {
    account: db.prepare('SELECT * FROM accounts WHERE api_key = ?'),
    createAccount: db.prepare('INSERT INTO accounts (api_key, name, created_at) VALUES (?, ?, ?)'),
    routes: db.prepare('SELECT method, path, paywall, log FROM routes WHERE api_key = ? ORDER BY position'),
    clearRoutes: db.prepare('DELETE FROM routes WHERE api_key = ?'),
    addRoute: db.prepare('INSERT INTO routes (api_key, position, method, path, paywall, log) VALUES (?, ?, ?, ?, ?, ?)'),
    addLog: db.prepare(`INSERT INTO logs (api_key, ts, method, url, route, status, duration_ms, paid, payer, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    logs: db.prepare('SELECT * FROM logs WHERE api_key = ? AND id < ? ORDER BY id DESC LIMIT ?'),
  };

  const listRoutes = (apiKey) =>
    q.routes.all(apiKey).map((r) => ({
      method: r.method,
      path: r.path,
      ...(r.paywall && { paywall: JSON.parse(r.paywall) }),
      ...(r.log && { log: true }),
    }));

  function replaceRoutes(apiKey, routes) {
    if (!Array.isArray(routes)) throw new HttpError(400, 'routes must be an array');
    for (const r of routes) {
      if (typeof r.path !== 'string' || !r.path.startsWith('/')) throw new HttpError(400, `bad path: ${r.path}`);
      if (r.paywall && !Array.isArray(r.paywall.accepts)) throw new HttpError(400, `paywall.accepts must be an array (${r.path})`);
    }
    db.exec('BEGIN');
    try {
      q.clearRoutes.run(apiKey);
      routes.forEach((r, i) =>
        q.addRoute.run(apiKey, i, (r.method ?? '*').toUpperCase(), r.path, r.paywall ? JSON.stringify(r.paywall) : null, r.log ? 1 : 0),
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  async function facilitator(path, body) {
    const res = await fetch(facilitatorUrl + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new HttpError(502, `facilitator ${path} ${res.status}`);
    return res.json();
  }

  // X-PAYMENT is base64(JSON PaymentPayload); verify + settle through the x402 facilitator.
  // ponytail: settles before the origin responds; split into verify-then-settle if refunds on origin errors matter
  async function verifyPayment({ payment, accepts }) {
    let payload;
    try {
      payload = JSON.parse(Buffer.from(payment, 'base64').toString('utf8'));
    } catch {
      return { valid: false, error: 'X-PAYMENT is not base64 JSON' };
    }
    const requirements = (accepts ?? []).find((a) => a.scheme === payload.scheme && a.network === payload.network);
    if (!requirements) return { valid: false, error: 'no matching payment requirements' };

    const body = { x402Version: payload.x402Version ?? 1, paymentPayload: payload, paymentRequirements: requirements };
    const verified = await facilitator('/verify', body);
    if (!verified.isValid) return { valid: false, error: verified.invalidReason ?? 'invalid payment' };

    const settled = await facilitator('/settle', body);
    if (!settled.success) return { valid: false, error: settled.errorReason ?? 'settlement failed' };

    return {
      valid: true,
      payer: settled.payer ?? verified.payer,
      paymentResponse: Buffer.from(JSON.stringify(settled)).toString('base64'),
    };
  }

  function authAccount(req) {
    const key = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!key || !q.account.get(key)) throw new HttpError(401, 'invalid API key');
    return key;
  }

  function authAdmin(req) {
    if (!adminToken || req.headers.authorization !== `Bearer ${adminToken}`) throw new HttpError(401, 'admin only');
  }

  async function handle(req, url) {
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /health') return { ok: true };

    if (route === 'POST /v1/accounts') {
      authAdmin(req);
      const { name } = await readJson(req);
      if (!name) throw new HttpError(400, 'name is required');
      const apiKey = `ah_${randomBytes(24).toString('hex')}`;
      q.createAccount.run(apiKey, name, new Date().toISOString());
      return { apiKey, name };
    }

    const apiKey = authAccount(req);

    switch (route) {
      // used by the worker
      case 'GET /v1/worker/config':
      case 'GET /v1/routes':
        return { routes: listRoutes(apiKey) };
      case 'POST /v1/worker/verify':
        return verifyPayment(await readJson(req));
      case 'POST /v1/worker/logs': {
        const e = await readJson(req);
        q.addLog.run(apiKey, e.ts ?? new Date().toISOString(), e.method ?? null, e.url ?? null, e.route ?? null,
          e.status ?? null, e.durationMs ?? null, e.paid ? 1 : 0, e.payer ?? null,
          JSON.stringify({ request: e.request, response: e.response }));
        return { ok: true };
      }
      // used by the dashboard
      case 'PUT /v1/routes':
        replaceRoutes(apiKey, (await readJson(req)).routes);
        return { routes: listRoutes(apiKey) };
      case 'GET /v1/logs': {
        const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 500);
        const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
        const logs = q.logs.all(apiKey, before, limit).map(({ api_key, data, paid, ...l }) => ({ ...l, paid: !!paid, ...JSON.parse(data) }));
        return { logs, next: logs.length === limit ? logs.at(-1).id : null };
      }
    }
    throw new HttpError(404, 'not found');
  }

  const server = http.createServer(async (req, res) => {
    let status = 200;
    let body;
    try {
      body = await handle(req, new URL(req.url, 'http://localhost'));
    } catch (err) {
      status = err.status ?? 500;
      body = { error: err.status ? err.message : 'internal error' };
      if (!err.status) console.error(err);
    }
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });

  return { server, db };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_BODY = 1024 * 1024;

async function readJson(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > MAX_BODY) throw new HttpError(413, 'body too large');
  }
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!ADMIN_TOKEN) console.warn('ADMIN_TOKEN not set: account creation disabled');
  createApp().server.listen(PORT, () => console.log(`agent-helper app on :${PORT}`));
}

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.DB_PATH ?? 'agent-helper.db';
const FACILITATOR_URL = (process.env.FACILITATOR_URL ?? 'https://x402.org/facilitator').replace(/\/$/, '');
const SESSION_DAYS = 30;
const DASHBOARD = readFileSync(new URL('../public/index.html', import.meta.url));

export function createApp({ dbPath = DB_PATH, facilitatorUrl = FACILITATOR_URL } = {}) {
  // ponytail: SQLite single-node store; move to Postgres when you run more than one instance
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, api_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, account_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS routes (account_id INTEGER NOT NULL, position INTEGER NOT NULL, method TEXT NOT NULL,
      path TEXT NOT NULL, paywall TEXT, log INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account_id, position));
    CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, ts TEXT NOT NULL,
      method TEXT, url TEXT, route TEXT, status INTEGER, duration_ms INTEGER, paid INTEGER, payer TEXT, data TEXT);
    CREATE INDEX IF NOT EXISTS logs_by_account ON logs (account_id, id);
    CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, ts TEXT NOT NULL,
      method TEXT, url TEXT, payer TEXT, amount TEXT, asset TEXT, network TEXT, pay_to TEXT, tx TEXT);
    CREATE INDEX IF NOT EXISTS payments_by_account ON payments (account_id, id);
  `);

  const q = {
    accountByKey: db.prepare('SELECT * FROM accounts WHERE api_key = ?'),
    accountByEmail: db.prepare('SELECT * FROM accounts WHERE email = ?'),
    accountBySession: db.prepare(`SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token = ? AND s.expires_at > ?`),
    createAccount: db.prepare('INSERT INTO accounts (email, password_hash, api_key, created_at) VALUES (?, ?, ?, ?) RETURNING *'),
    rotateKey: db.prepare('UPDATE accounts SET api_key = ? WHERE id = ?'),
    createSession: db.prepare('INSERT INTO sessions (token, account_id, expires_at) VALUES (?, ?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    routes: db.prepare('SELECT method, path, paywall, log FROM routes WHERE account_id = ? ORDER BY position'),
    clearRoutes: db.prepare('DELETE FROM routes WHERE account_id = ?'),
    addRoute: db.prepare('INSERT INTO routes (account_id, position, method, path, paywall, log) VALUES (?, ?, ?, ?, ?, ?)'),
    addLog: db.prepare(`INSERT INTO logs (account_id, ts, method, url, route, status, duration_ms, paid, payer, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    logs: db.prepare('SELECT * FROM logs WHERE account_id = ? AND id < ? ORDER BY id DESC LIMIT ?'),
    addPayment: db.prepare(`INSERT INTO payments (account_id, ts, method, url, payer, amount, asset, network, pay_to, tx)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    payments: db.prepare('SELECT * FROM payments WHERE account_id = ? AND id < ? ORDER BY id DESC LIMIT ?'),
    logStats: db.prepare(`SELECT substr(ts, 1, 10) AS day, count(*) AS requests, sum(status >= 500) AS errors,
      avg(duration_ms) AS avg_ms FROM logs WHERE account_id = ? AND ts >= ? GROUP BY day`),
    paymentStats: db.prepare(`SELECT substr(ts, 1, 10) AS day, count(*) AS payments, sum(CAST(amount AS INTEGER)) AS amount
      FROM payments WHERE account_id = ? AND ts >= ? GROUP BY day`),
    topRoutes: db.prepare(`SELECT route, count(*) AS requests, sum(paid) AS paid, sum(status >= 500) AS errors,
      round(avg(duration_ms)) AS avgMs FROM logs WHERE account_id = ? AND ts >= ?
      GROUP BY route ORDER BY requests DESC LIMIT 10`),
  };

  const listRoutes = (accountId) =>
    q.routes.all(accountId).map((r) => ({
      method: r.method,
      path: r.path,
      ...(r.paywall && { paywall: JSON.parse(r.paywall) }),
      ...(r.log && { log: true }),
    }));

  function replaceRoutes(accountId, routes) {
    if (!Array.isArray(routes)) throw new HttpError(400, 'routes must be an array');
    for (const r of routes) {
      if (typeof r.path !== 'string' || !r.path.startsWith('/')) throw new HttpError(400, `bad path: ${r.path}`);
      if (r.paywall && !Array.isArray(r.paywall.accepts)) throw new HttpError(400, `paywall.accepts must be an array (${r.path})`);
    }
    db.exec('BEGIN');
    try {
      q.clearRoutes.run(accountId);
      routes.forEach((r, i) =>
        q.addRoute.run(accountId, i, (r.method ?? '*').toUpperCase(), r.path, r.paywall ? JSON.stringify(r.paywall) : null, r.log ? 1 : 0),
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function stats(accountId, days) {
    const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const byDay = new Map();
    for (let i = 0; i < days; i++) {
      const day = new Date(Date.parse(since) + i * 86_400_000).toISOString().slice(0, 10);
      byDay.set(day, { day, requests: 0, errors: 0, avgMs: null, payments: 0, amount: 0 });
    }
    for (const r of q.logStats.all(accountId, since))
      Object.assign(byDay.get(r.day) ?? {}, { requests: r.requests, errors: r.errors, avgMs: Math.round(r.avg_ms) });
    for (const r of q.paymentStats.all(accountId, since))
      Object.assign(byDay.get(r.day) ?? {}, { payments: r.payments, amount: r.amount });
    const daily = [...byDay.values()];
    const sum = (k) => daily.reduce((s, d) => s + d[k], 0);
    const requests = sum('requests');
    const weightedMs = daily.reduce((s, d) => s + (d.avgMs ?? 0) * d.requests, 0);
    return {
      days,
      totals: {
        requests,
        errors: sum('errors'),
        payments: sum('payments'),
        amount: sum('amount'), // ponytail: atomic units summed across assets; dashboard only creates USDC (6 decimals)
        avgMs: requests ? Math.round(weightedMs / requests) : null,
      },
      daily,
      topRoutes: q.topRoutes.all(accountId, since),
    };
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
  async function verifyPayment(accountId, { payment, accepts, method, url }) {
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

    const payer = settled.payer ?? verified.payer ?? null;
    q.addPayment.run(accountId, new Date().toISOString(), method ?? null, url ?? null, payer,
      String(requirements.maxAmountRequired), requirements.asset ?? null, requirements.network, requirements.payTo ?? null,
      settled.transaction ?? null);
    return { valid: true, payer, paymentResponse: Buffer.from(JSON.stringify(settled)).toString('base64') };
  }

  function startSession(res, req, accountId) {
    const token = randomBytes(32).toString('hex');
    q.createSession.run(token, accountId, Date.now() + SESSION_DAYS * 86_400_000);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.cookie = `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86_400}${secure}`;
  }

  const sessionToken = (req) => req.headers.cookie?.match(/(?:^|;\s*)sid=([0-9a-f]+)/)?.[1];

  // Worker authenticates with its API key; the dashboard with the session cookie.
  function authAccount(req) {
    const key = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const account = key ? q.accountByKey.get(key) : sessionToken(req) && q.accountBySession.get(sessionToken(req), Date.now());
    if (!account) throw new HttpError(401, 'not logged in');
    return account;
  }

  async function handle(req, res, url) {
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /' || route === 'GET /index.html') return DASHBOARD;
    if (route === 'GET /health') return { ok: true };

    if (route === 'POST /v1/signup') {
      const { email, password } = await readJson(req);
      if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(400, 'valid email required');
      if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'password must be at least 8 characters');
      if (q.accountByEmail.get(email.toLowerCase())) throw new HttpError(409, 'email already registered');
      const account = q.createAccount.get(email.toLowerCase(), hashPassword(password), newApiKey(), new Date().toISOString());
      startSession(res, req, account.id);
      return { email: account.email };
    }

    if (route === 'POST /v1/login') {
      const { email, password } = await readJson(req);
      const account = typeof email === 'string' && q.accountByEmail.get(email.toLowerCase());
      // ponytail: no login rate limit; put one in front (Cloudflare/nginx) before public launch
      if (!account || !checkPassword(String(password), account.password_hash)) throw new HttpError(401, 'wrong email or password');
      startSession(res, req, account.id);
      return { email: account.email };
    }

    if (route === 'POST /v1/logout') {
      const token = sessionToken(req);
      if (token) q.deleteSession.run(token);
      res.cookie = 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
      return { ok: true };
    }

    const account = authAccount(req);
    const page = () => ({
      limit: Math.min(Number(url.searchParams.get('limit')) || 50, 500),
      before: Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER,
    });

    switch (route) {
      case 'GET /v1/me':
        return { email: account.email, apiKey: account.api_key, createdAt: account.created_at };
      case 'POST /v1/key/rotate': {
        const apiKey = newApiKey();
        q.rotateKey.run(apiKey, account.id);
        return { apiKey };
      }
      case 'GET /v1/worker/config':
      case 'GET /v1/routes':
        return { routes: listRoutes(account.id) };
      case 'PUT /v1/routes':
        replaceRoutes(account.id, (await readJson(req)).routes);
        return { routes: listRoutes(account.id) };
      case 'POST /v1/worker/verify':
        return verifyPayment(account.id, await readJson(req));
      case 'POST /v1/worker/logs': {
        const e = await readJson(req);
        q.addLog.run(account.id, e.ts ?? new Date().toISOString(), e.method ?? null, e.url ?? null, e.route ?? null,
          e.status ?? null, e.durationMs ?? null, e.paid ? 1 : 0, e.payer ?? null,
          JSON.stringify({ request: e.request, response: e.response }));
        return { ok: true };
      }
      case 'GET /v1/logs': {
        const { limit, before } = page();
        const logs = q.logs.all(account.id, before, limit)
          .map(({ account_id, data, paid, duration_ms, ...l }) => ({ ...l, durationMs: duration_ms, paid: !!paid, ...JSON.parse(data) }));
        return { logs, next: logs.length === limit ? logs.at(-1).id : null };
      }
      case 'GET /v1/payments': {
        const { limit, before } = page();
        const payments = q.payments.all(account.id, before, limit).map(({ account_id, pay_to, ...p }) => ({ ...p, payTo: pay_to }));
        return { payments, next: payments.length === limit ? payments.at(-1).id : null };
      }
      case 'GET /v1/stats':
        return stats(account.id, [7, 30, 90].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 7);
    }
    throw new HttpError(404, 'not found');
  }

  const server = http.createServer(async (req, res) => {
    let status = 200;
    let body;
    try {
      body = await handle(req, res, new URL(req.url, 'http://localhost'));
    } catch (err) {
      status = err.status ?? 500;
      body = { error: err.status ? err.message : 'internal error' };
      if (!err.status) console.error(err);
    }
    const headers = { 'x-content-type-options': 'nosniff' };
    if (res.cookie) headers['set-cookie'] = res.cookie;
    if (Buffer.isBuffer(body)) {
      headers['content-type'] = 'text/html; charset=utf-8';
      headers['content-security-policy'] = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'";
      return res.writeHead(status, headers).end(body);
    }
    headers['content-type'] = 'application/json';
    res.writeHead(status, headers).end(JSON.stringify(body));
  });

  return { server, db };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const newApiKey = () => `ah_${randomBytes(24).toString('hex')}`;

function hashPassword(password) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, 'hex'), 64), Buffer.from(hash, 'hex'));
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
  createApp().server.listen(PORT, () => console.log(`agent-helper app on :${PORT}`));
}

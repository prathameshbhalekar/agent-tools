const CONFIG_TTL_MS = 60_000;
const MAX_LOG_BODY = 64 * 1024;
const REDACT = new Set(['authorization', 'cookie', 'set-cookie', 'x-payment', 'x-agent-helper-secret']);

// ponytail: per-isolate cache; move to KV if config fetches show up in API load
let cache = { routes: null, at: 0 };

async function getRoutes(env) {
  if (cache.routes && Date.now() - cache.at < CONFIG_TTL_MS) return cache.routes;
  try {
    const res = await appApi(env, 'GET', '/v1/worker/config');
    if (!res.ok) throw new Error(`config ${res.status}`);
    const { routes = [] } = await res.json();
    cache = {
      routes: routes.map((r) => ({ ...r, pattern: new URLPattern({ pathname: r.path }) })),
      at: Date.now(),
    };
  } catch (err) {
    console.error('config fetch failed, using last-good', err);
    if (cache.routes) cache.at = Date.now(); // back off for one TTL
  }
  return cache.routes ?? [];
}

function appApi(env, method, path, body) {
  return fetch(env.APP_API_URL.replace(/\/$/, '') + path, {
    method,
    headers: { authorization: `Bearer ${env.API_KEY}`, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
}

function matchRoute(routes, request) {
  const { pathname } = new URL(request.url);
  return routes.find(
    (r) => (!r.method || r.method === '*' || r.method.toUpperCase() === request.method) && r.pattern.test({ pathname }),
  );
}

function paymentRequired(accepts, error) {
  return Response.json({ x402Version: 1, error, accepts }, { status: 402 });
}

function toOrigin(request, env, extraHeaders = {}) {
  const url = new URL(request.url);
  const target = env.ORIGIN_URL.replace(/\/$/, '') + url.pathname + url.search;
  const req = new Request(target, request);
  for (const [k, v] of Object.entries(extraHeaders)) req.headers.set(k, v);
  if (env.ORIGIN_SECRET) req.headers.set('x-agent-helper-secret', env.ORIGIN_SECRET);
  return fetch(req);
}

function headersObj(headers) {
  const out = {};
  for (const [k, v] of headers) out[k] = REDACT.has(k) ? '[redacted]' : v;
  return out;
}

async function bodyText(msg) {
  if (!msg.body) return null;
  const text = await msg.text();
  return text.length > MAX_LOG_BODY ? text.slice(0, MAX_LOG_BODY) : text;
}

async function postLog(env, entry, reqCopy, resCopy) {
  try {
    entry.request = { headers: headersObj(reqCopy.headers), body: await bodyText(reqCopy) };
    entry.response = { headers: headersObj(resCopy.headers), body: await bodyText(resCopy) };
    await appApi(env, 'POST', '/v1/worker/logs', entry);
  } catch (err) {
    console.error('log failed', err);
  }
}

export default {
  async fetch(request, env, ctx) {
    const route = matchRoute(await getRoutes(env), request);
    if (!route) return toOrigin(request, env);

    const start = Date.now();
    const reqCopy = route.log ? request.clone() : null;
    let response;
    let payer = null;
    let paid = false;

    if (route.paywall) {
      const accepts = route.paywall.accepts ?? [];
      const payment = request.headers.get('x-payment');
      if (!payment) {
        response = paymentRequired(accepts, 'X-PAYMENT header is required');
      } else {
        let verdict;
        try {
          const res = await appApi(env, 'POST', '/v1/worker/verify', {
            payment,
            accepts,
            method: request.method,
            url: request.url,
          });
          if (!res.ok) throw new Error(`verify ${res.status}`);
          verdict = await res.json();
        } catch (err) {
          console.error('verify failed', err);
          // fail closed: never serve a paid route without a confirmed payment
          return Response.json({ error: 'payment verification unavailable' }, { status: 502 });
        }
        if (!verdict.valid) {
          response = paymentRequired(accepts, verdict.error ?? 'invalid payment');
        } else {
          paid = true;
          payer = verdict.payer ?? null;
          const origin = await toOrigin(request, env, {
            'x-payment-verified': 'true',
            ...(payer && { 'x-payment-payer': payer }),
          });
          response = new Response(origin.body, origin);
          if (verdict.paymentResponse) response.headers.set('x-payment-response', verdict.paymentResponse);
        }
      }
    } else {
      response = await toOrigin(request, env);
    }

    if (route.log) {
      const entry = {
        ts: new Date(start).toISOString(),
        method: request.method,
        url: request.url,
        route: route.path,
        status: response.status,
        durationMs: Date.now() - start,
        paid,
        payer,
      };
      ctx.waitUntil(postLog(env, entry, reqCopy, response.clone()));
    }
    return response;
  },
};

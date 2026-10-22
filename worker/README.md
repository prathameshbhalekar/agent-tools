# agent-helper

A Cloudflare Worker that sits in front of your existing API and:

- returns **x402 `402 Payment Required`** on paywalled endpoints. When a request carries a valid `X-PAYMENT` proof, the worker forwards it to your origin with the proof attached.
- sends **request/response logs** for selected endpoints to the Agent Helper dashboard.

You choose which endpoints are paywalled or logged in the Agent Helper app. The worker fetches that config once a minute, so you don't need to redeploy.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/<org>/agent-helper/tree/main/worker)

During deploy you'll be asked for:

| Name | Kind | What |
|---|---|---|
| `API_KEY` | secret | API key from your Agent Helper dashboard |
| `ORIGIN_SECRET` | secret, optional | Sent to your origin as `X-Agent-Helper-Secret` |
| `ORIGIN_URL` | var, optional | Leave blank for route mode (recommended). Otherwise, set it to your API's base URL. |
| `APP_API_URL` | var | Agent Helper API (keep the default) |

After deploying, attach the worker to your API:

- **Route mode (recommended, your API's domain is on Cloudflare):** go to Workers & Pages → agent-helper → Settings → Domains & Routes → Add route, and enter e.g. `api.acme.com/*`. Clients keep calling the same URL. The worker runs first and passes allowed requests on to your existing server. Leave `ORIGIN_URL` blank.
- **Proxy mode (your API's domain isn't on Cloudflare):** set `ORIGIN_URL` to your API, then have clients call the worker's URL. The worker rewrites requests to `ORIGIN_URL`.

If neither is set up, requests to the bare `*.workers.dev` URL get a `500` explaining what's missing, so the worker doesn't loop into itself.

## What your origin receives on a paid request

| Header | Value |
|---|---|
| `X-PAYMENT` | the client's original payment proof |
| `X-Payment-Verified` | `true` |
| `X-Payment-Payer` | the payer address, if the verifier returned one |
| `X-Agent-Helper-Secret` | `ORIGIN_SECRET`, if set |

Only trust `X-Payment-*` when `X-Agent-Helper-Secret` matches, or when your origin can be reached only through the worker.

## Agent Helper API contract

Every call goes to `APP_API_URL` with the header `Authorization: Bearer <API_KEY>`.

**`GET /v1/worker/config`**
```json
{ "routes": [
  { "method": "GET", "path": "/api/premium/*", "paywall": { "accepts": [ /* x402 PaymentRequirements */ ] }, "log": true },
  { "method": "*",   "path": "/api/search",    "log": true }
] }
```
`path` is a [URLPattern](https://developer.mozilla.org/docs/Web/API/URLPattern) pathname, and the first matching route wins. `accepts` goes into the 402 body exactly as given.

**`POST /v1/worker/verify`**: request body `{ payment, accepts, method, url }`, response `{ valid, error?, payer?, paymentResponse? }`.
The API verifies and settles the payment (see `../app`). If it returns `paymentResponse`, the worker passes it back to the client as `X-PAYMENT-RESPONSE`. If this call fails, the worker returns `502` and does not serve the paid route.

**`POST /v1/worker/logs`**: request body `{ ts, method, url, route, status, durationMs, paid, payer, request: {headers, body}, response: {headers, body} }`.
Logs are sent after the response, so they never slow down or break a request. Bodies are cut off at 64 KB. The `authorization`, `cookie`, `set-cookie`, `x-payment` and `x-agent-helper-secret` headers are redacted.

## Develop

```sh
npm install
cp .dev.vars.example .dev.vars   # fill API_KEY
npm run dev
npm test                         # mock origin + API, runs the worker in workerd
```
